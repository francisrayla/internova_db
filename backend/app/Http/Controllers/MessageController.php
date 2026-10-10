<?php

namespace App\Http\Controllers;

use App\Events\GroupMessageSent;
use App\Events\GroupUserTyping;
use App\Events\MessageSent;
use App\Events\UserTyping;
use App\Models\GroupConversation;
use App\Models\GroupMessage;
use App\Models\InternshipDeployment;
use App\Models\Message;
use App\Models\MessageThreadSetting;
use App\Models\SupervisorProfile;
use App\Models\User;
use App\Services\SchoolStaff;
use App\Support\SafeUpload;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Direct messages between the people an internship actually connects —
 * never an open roster. A coordinator reaches the supervisors and interns
 * at their own school; a supervisor reaches the interns actually deployed
 * to them plus their school's coordinators; an intern reaches their own
 * supervisor and coordinator. Nobody else is a valid target, and every
 * endpoint here re-derives that list server-side rather than trusting a
 * client-submitted id.
 */
class MessageController extends Controller
{
    private function eligibleContacts(User $user)
    {
        $role = $user->roles?->name;

        // Coordinator: every supervisor and intern at their own school.
        if ($role === 'coordinator') {
            return User::where('school_id', $user->school_id)
                ->whereIn('role_id', array_filter([SchoolStaff::roleId('supervisor'), SchoolStaff::roleId('intern')]))
                ->orderBy('first_name')
                ->get();
        }

        // Supervisor: interns at their company (shared with the company's other supervisor), plus their school's coordinators.
        if ($role === 'supervisor') {
            $internIds = InternshipDeployment::visibleToSupervisor($user)->pluck('intern_id')->unique();

            return User::where(function ($q) use ($internIds, $user) {
                $q->whereIn('id', $internIds)
                    ->orWhere(fn ($q2) => $q2->where('school_id', $user->school_id)->where('role_id', SchoolStaff::roleId('coordinator')));
            })->orderBy('first_name')->get();
        }

        // Intern: their own supervisor and coordinator, plus every other
        // intern deployed to the same company (they share a workplace even
        // though they may report to different supervisors within it).
        if ($role === 'intern') {
            $deployments = InternshipDeployment::where('intern_id', $user->id)->get();
            $supervisorIds = SupervisorProfile::whereIn('company_id', $deployments->pluck('company_id')->filter()->unique())
                ->whereHas('user', fn ($q) => $q->where('status', 'active'))->pluck('user_id');
            $ids = $supervisorIds->merge($deployments->pluck('coordinator_id'))->filter()->unique();

            $companyIds = $deployments->pluck('company_id')->filter()->unique();
            $companyMateIds = InternshipDeployment::whereIn('company_id', $companyIds)
                ->where('intern_id', '!=', $user->id)
                ->pluck('intern_id')
                ->unique();

            return User::whereIn('id', $ids->merge($companyMateIds)->unique())->orderBy('first_name')->get();
        }

        return collect();
    }

    private function isEligibleContact(User $user, int $contactId): bool
    {
        return $this->eligibleContacts($user)->contains('id', $contactId);
    }

    /**
     * Every mute/color choice the current viewer has made, keyed the same
     * way the frontend keys its own conversation state ("dm-3", "group-7")
     * so a single lookup per list-render is all mapContact/mapGroup need —
     * these are private per-viewer preferences, never shared with the peer.
     */
    private function settingsFor(User $me): Collection
    {
        return MessageThreadSetting::where('user_id', $me->id)->get()->keyBy(fn ($s) => "{$s->peer_type}-{$s->peer_id}");
    }

    /**
     * A one-line preview for the conversation list when the last message has
     * no text of its own (an attachment sent with no caption) — mirrors how
     * Messenger/WhatsApp label a photo- or file-only message in their lists.
     */
    private function previewLabel(?Message $message = null, ?GroupMessage $groupMessage = null): ?string
    {
        $message ??= $groupMessage;
        if (!$message) {
            return null;
        }
        if ($message->message !== '') {
            return $message->message;
        }
        if ($message->attachment_path) {
            return str_starts_with((string) $message->attachment_type, 'image/')
                ? '📷 Photo'
                : '📎 ' . ($message->attachment_name ?? 'File');
        }
        return $message->message;
    }

    /**
     * The compact "replying to X" snippet embedded in a message payload —
     * just enough (who, and a one-line preview) to render a quoted strip
     * above the reply, without shipping the entire original message.
     */
    private function mapReplySnippet(Message|GroupMessage|null $original): ?array
    {
        if (!$original) {
            return null;
        }

        return [
            'id' => $original->id,
            'sender_name' => trim("{$original->sender?->first_name} {$original->sender?->last_name}") ?: $original->sender?->name,
            'preview' => $this->previewLabel($original instanceof Message ? $original : null, $original instanceof GroupMessage ? $original : null),
        ];
    }

    private function mapMessagePayload(Message $m): array
    {
        return [
            'id' => $m->id,
            'sender_id' => $m->sender_id,
            'message' => $m->message,
            'attachment_url' => $m->attachment_url,
            'attachment_name' => $m->attachment_name,
            'attachment_type' => $m->attachment_type,
            'attachment_size' => $m->attachment_size,
            'reply_to' => $this->mapReplySnippet($m->replyTo),
            'read_at' => $m->read_at?->local()?->format('M d, Y g:i A'),
            'created_at' => $m->created_at->local()->format('g:i A'),
            'created_at_full' => $m->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    private function mapGroupMessagePayload(GroupMessage $m): array
    {
        return [
            'id' => $m->id,
            'sender_id' => $m->sender_id,
            'sender_name' => trim("{$m->sender?->first_name} {$m->sender?->last_name}") ?: $m->sender?->name,
            'message' => $m->message,
            'attachment_url' => $m->attachment_url,
            'attachment_name' => $m->attachment_name,
            'attachment_type' => $m->attachment_type,
            'attachment_size' => $m->attachment_size,
            'reply_to' => $this->mapReplySnippet($m->replyTo),
            'is_system' => (bool) $m->is_system,
            'created_at' => $m->created_at->local()->format('g:i A'),
            'created_at_full' => $m->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    /**
     * Saves the optional file attached to a message/group-message post — a
     * pure caption-only send never calls this, so it's always safe to merge
     * a null result straight into the create() payload.
     */
    private function storeAttachment(Request $request, int $senderId): ?array
    {
        if (!$request->hasFile('attachment')) {
            return null;
        }

        // Already vetted by SafeUpload::chatRule() in the request validation; stored under a generated
        // name, with the type taken from the allow list (never the browser-supplied one).
        return SafeUpload::storeChat($request->file('attachment'), "message-attachments/{$senderId}");
    }

    private function mapContact(User $me, User $contact, Collection $settings): array
    {
        $lastMessage = Message::where(function ($q) use ($me, $contact) {
            $q->where('sender_id', $me->id)->where('receiver_id', $contact->id);
        })->orWhere(function ($q) use ($me, $contact) {
            $q->where('sender_id', $contact->id)->where('receiver_id', $me->id);
        })->latest('created_at')->first();

        $unreadCount = Message::where('sender_id', $contact->id)
            ->where('receiver_id', $me->id)
            ->whereNull('read_at')
            ->count();

        $setting = $settings->get("dm-{$contact->id}");

        return [
            'id' => $contact->id,
            'name' => trim("{$contact->first_name} {$contact->last_name}") ?: $contact->name,
            'role' => $contact->roles?->name === 'coordinator' ? 'coordinator' : ($contact->roles?->name === 'supervisor' ? 'supervisor' : 'intern'),
            'avatar_url' => $contact->avatar_url,
            'last_message' => $this->previewLabel($lastMessage),
            'last_message_at' => $lastMessage?->created_at?->local()?->format('g:i A'),
            'last_message_at_sort' => $lastMessage?->created_at?->timestamp ?? 0,
            'last_message_from_me' => $lastMessage ? $lastMessage->sender_id === $me->id : null,
            'unread_count' => $unreadCount,
            'muted' => (bool) ($setting->muted ?? false),
            'color' => $setting->color ?? null,
        ];
    }

    public function contacts(Request $request): JsonResponse
    {
        $me = $request->user();
        $settings = $this->settingsFor($me);
        $contacts = $this->eligibleContacts($me)
            ->map(fn (User $c) => $this->mapContact($me, $c, $settings))
            ->sortByDesc('last_message_at_sort')
            ->values();

        return response()->json(['contacts' => $contacts]);
    }

    /**
     * One shared endpoint for both kinds of conversation — mute and chat
     * color are purely cosmetic viewer preferences, so the only thing worth
     * guarding is that you can't set them on a conversation you're not
     * actually part of.
     */
    public function updateThreadSetting(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'type' => 'required|in:dm,group',
            'id' => 'required|integer',
            'muted' => 'sometimes|boolean',
            'color' => 'sometimes|nullable|string|max:20',
        ]);

        if ($data['type'] === 'dm' && !$this->isEligibleContact($me, (int) $data['id'])) {
            return response()->json(['success' => false, 'message' => 'Not a valid contact.'], 403);
        }
        if ($data['type'] === 'group' && !$this->groupForMember((int) $data['id'], $me->id)) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        $updates = [];
        if ($request->has('muted')) {
            $updates['muted'] = (bool) $data['muted'];
        }
        if ($request->has('color')) {
            $updates['color'] = $data['color'];
        }

        $setting = MessageThreadSetting::updateOrCreate(
            ['user_id' => $me->id, 'peer_type' => $data['type'], 'peer_id' => $data['id']],
            $updates
        );

        return response()->json(['success' => true, 'muted' => (bool) $setting->muted, 'color' => $setting->color]);
    }

    private function wantsPage(Request $request): bool
    {
        return $request->query->has('limit') || $request->query->has('before_id');
    }

    /**
     * The newest page of a thread, oldest first (what the chat window draws), plus whether anything older exists.
     * `limit` is clamped (default 30, max 100); `before_id` continues from the oldest message already on screen.
     *
     * @return array{0: Collection, 1: bool}
     */
    private function newestPage($query, Request $request): array
    {
        $limit = min(100, max(10, (int) $request->query('limit', 30)));
        if ($before = (int) $request->query('before_id')) {
            $query->where('id', '<', $before);
        }
        $rows = $query->orderByDesc('id')->limit($limit + 1)->get();

        return [$rows->take($limit)->reverse()->values(), $rows->count() > $limit];
    }

    public function thread(Request $request, int $userId): JsonResponse
    {
        $me = $request->user();
        if (!$this->isEligibleContact($me, $userId)) {
            return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
        }

        $query = Message::with('replyTo.sender')->where(function ($pair) use ($me, $userId) {
            $pair->where(function ($q) use ($me, $userId) {
                $q->where('sender_id', $me->id)->where('receiver_id', $userId);
            })->orWhere(function ($q) use ($me, $userId) {
                $q->where('sender_id', $userId)->where('receiver_id', $me->id);
            });
        });

        // Opening the thread is what "reads" it.
        Message::where('sender_id', $userId)->where('receiver_id', $me->id)->whereNull('read_at')->update(['read_at' => now()]);

        // Opt-in: ?limit=N returns the newest N (oldest first), ?before_id= the N before that message.
        if ($this->wantsPage($request)) {
            [$messages, $hasMore] = $this->newestPage($query, $request);

            return response()->json(['messages' => $messages->map(fn (Message $m) => $this->mapMessagePayload($m))->values(), 'has_more' => $hasMore]);
        }

        $messages = $query->orderBy('created_at')->get();

        return response()->json(['messages' => $messages->map(fn (Message $m) => $this->mapMessagePayload($m))]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'receiver_id' => 'required|integer',
            'message' => 'required_without:attachment|nullable|string|max:2000',
            'attachment' => ['sometimes', 'file', 'max:'.SafeUpload::CHAT_MAX_KB, SafeUpload::chatRule()],
            'reply_to_id' => 'sometimes|nullable|integer',
        ]);

        if (!$this->isEligibleContact($me, (int) $data['receiver_id'])) {
            return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
        }

        // Only a message actually in this same thread can be quoted — never
        // trust a client-submitted id from a different conversation.
        $replyToId = null;
        if (!empty($data['reply_to_id'])) {
            $original = Message::where('id', $data['reply_to_id'])
                ->where(function ($q) use ($me, $data) {
                    $q->where(fn ($q2) => $q2->where('sender_id', $me->id)->where('receiver_id', $data['receiver_id']))
                        ->orWhere(fn ($q2) => $q2->where('sender_id', $data['receiver_id'])->where('receiver_id', $me->id));
                })->first();
            $replyToId = $original?->id;
        }

        $message = Message::create(array_merge([
            'sender_id' => $me->id,
            'receiver_id' => $data['receiver_id'],
            'reply_to_id' => $replyToId,
            'school_id' => $me->school_id,
            'message' => $data['message'] ?? '',
        ], $this->storeAttachment($request, $me->id) ?? []));

        try {
            broadcast(new MessageSent($message));
        } catch (Throwable $e) {
            Log::warning('Message broadcast failed, continuing without live push.', [
                'message_id' => $message->id,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json(['success' => true, 'message_data' => $this->mapMessagePayload($message)]);
    }

    /**
     * Re-sends an existing message's content (text + attachment reference —
     * the stored file itself is never re-uploaded, just pointed to again)
     * into a different conversation. Source and target can each be a DM or
     * a group, independently — four combinations, one endpoint. Every
     * access check that a normal send would apply still applies here: you
     * can only forward a message you could actually see, and only to
     * someone/some group you're actually allowed to message.
     */
    public function forwardMessage(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'source_type' => 'required|in:dm,group',
            'source_id' => 'required|integer',
            'target_type' => 'required|in:dm,group',
            'target_id' => 'required|integer',
        ]);

        if ($data['source_type'] === 'dm') {
            $source = Message::where('id', $data['source_id'])
                ->where(fn ($q) => $q->where('sender_id', $me->id)->orWhere('receiver_id', $me->id))
                ->first();
        } else {
            // source_id is the group message's own id — resolve authorization
            // via membership on that message's group, not a group id directly.
            $source = GroupMessage::find($data['source_id']);
            if ($source && !$this->groupForMember($source->group_conversation_id, $me->id)) {
                $source = null;
            }
        }

        if (!$source) {
            return response()->json(['success' => false, 'message' => 'Original message not found.'], 404);
        }

        $payload = [
            'sender_id' => $me->id,
            'message' => $source->message ?? '',
            'attachment_path' => $source->attachment_path,
            'attachment_name' => $source->attachment_name,
            'attachment_type' => $source->attachment_type,
            'attachment_size' => $source->attachment_size,
        ];

        if ($data['target_type'] === 'dm') {
            if (!$this->isEligibleContact($me, (int) $data['target_id'])) {
                return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
            }

            $message = Message::create(array_merge($payload, [
                'receiver_id' => $data['target_id'],
                'school_id' => $me->school_id,
            ]));

            try {
                broadcast(new MessageSent($message));
            } catch (Throwable $e) {
                Log::warning('Forwarded message broadcast failed.', ['message_id' => $message->id, 'error' => $e->getMessage()]);
            }

            return response()->json(['success' => true, 'message_data' => $this->mapMessagePayload($message)]);
        }

        $targetGroup = $this->groupForMember((int) $data['target_id'], $me->id);
        if (!$targetGroup) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        $message = $targetGroup->messages()->create($payload);
        $targetGroup->touch();
        $targetGroup->members()->where('user_id', $me->id)->update(['last_read_at' => now()]);

        $recipientIds = $targetGroup->members()->where('user_id', '!=', $me->id)->pluck('user_id')->all();
        if (!empty($recipientIds)) {
            try {
                broadcast(new GroupMessageSent($message->load('sender'), $recipientIds));
            } catch (Throwable $e) {
                Log::warning('Forwarded group message broadcast failed.', ['message_id' => $message->id, 'error' => $e->getMessage()]);
            }
        }

        return response()->json(['success' => true, 'message_data' => $this->mapGroupMessagePayload($message)]);
    }

    /**
     * Fire-and-forget — no row is written, this only exists to broadcast a
     * "typing" pulse to the recipient's open chat window. The frontend
     * throttles how often it calls this and lets the indicator expire on
     * its own, so this endpoint doesn't need to track any state either.
     */
    public function typing(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate(['receiver_id' => 'required|integer']);

        if (!$this->isEligibleContact($me, (int) $data['receiver_id'])) {
            return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
        }

        try {
            broadcast(new UserTyping((int) $data['receiver_id'], $me->id, $me->name));
        } catch (Throwable $e) {
            Log::warning('Typing broadcast failed, continuing without live push.', ['error' => $e->getMessage()]);
        }

        return response()->json(['success' => true]);
    }

    // ---------------------------------------------------------------
    // Group chats — a coordinator/supervisor thing to start (see
    // createGroup), but everyone added can post once it exists.
    // ---------------------------------------------------------------

    private function groupDisplayName(User $me, GroupConversation $g): string
    {
        if ($g->name) {
            return $g->name;
        }

        $otherNames = $g->members
            ->filter(fn ($m) => $m->user_id !== $me->id)
            ->map(fn ($m) => trim("{$m->user?->first_name} {$m->user?->last_name}") ?: $m->user?->name)
            ->filter();

        return $otherNames->implode(', ') ?: 'Group';
    }

    private function mapGroup(User $me, GroupConversation $g, Collection $settings): array
    {
        $myMembership = $g->members->firstWhere('user_id', $me->id);
        $lastReadAt = $myMembership?->last_read_at;
        $lastMessage = $g->messages->last();

        $unreadCount = $g->messages
            ->filter(fn (GroupMessage $m) => $m->sender_id !== $me->id && (!$lastReadAt || $m->created_at->gt($lastReadAt)))
            ->count();

        $setting = $settings->get("group-{$g->id}");

        return [
            'id' => $g->id,
            'type' => 'group',
            'name' => $this->groupDisplayName($me, $g),
            'members' => $g->members->map(fn ($m) => [
                'id' => $m->user_id,
                'name' => trim("{$m->user?->first_name} {$m->user?->last_name}") ?: $m->user?->name,
                'avatar_url' => $m->user?->avatar_url,
            ])->values(),
            'last_message' => $this->previewLabel(groupMessage: $lastMessage),
            'last_message_at' => $lastMessage?->created_at?->local()?->format('g:i A'),
            'last_message_at_sort' => $lastMessage?->created_at?->timestamp ?? $g->created_at->timestamp,
            'last_message_from_me' => $lastMessage ? $lastMessage->sender_id === $me->id : null,
            'last_message_sender_name' => $lastMessage ? (trim("{$lastMessage->sender?->first_name} {$lastMessage->sender?->last_name}") ?: $lastMessage->sender?->name) : null,
            'unread_count' => $unreadCount,
            'muted' => (bool) ($setting->muted ?? false),
            'color' => $setting->color ?? null,
        ];
    }

    public function groups(Request $request): JsonResponse
    {
        $me = $request->user();
        $settings = $this->settingsFor($me);

        $groups = GroupConversation::with(['members.user', 'messages.sender'])
            ->whereHas('members', fn ($q) => $q->where('user_id', $me->id))
            ->get();

        return response()->json([
            'groups' => $groups->map(fn (GroupConversation $g) => $this->mapGroup($me, $g, $settings))->sortByDesc('last_message_at_sort')->values(),
        ]);
    }

    public function createGroup(Request $request): JsonResponse
    {
        $me = $request->user();
        if (!in_array($me->roles?->name, ['coordinator', 'supervisor'], true)) {
            return response()->json(['success' => false, 'message' => 'Only coordinators and supervisors can start a group.'], 403);
        }

        $data = $request->validate([
            'name' => 'nullable|string|max:100',
            'member_ids' => 'required|array|min:1',
            'member_ids.*' => 'integer',
        ]);

        // Only people this coordinator/supervisor could already 1:1 message
        // can be added — no smuggling in someone outside that scope.
        $eligibleIds = $this->eligibleContacts($me)->pluck('id');
        $memberIds = collect($data['member_ids'])->unique()->filter(fn ($id) => $eligibleIds->contains($id));
        if ($memberIds->isEmpty()) {
            return response()->json(['success' => false, 'message' => 'Select at least one valid person.'], 422);
        }

        $allMemberIds = $memberIds->push($me->id)->unique();
        if ($allMemberIds->count() < 3) {
            return response()->json(['success' => false, 'message' => 'A group needs at least 3 members — add at least 2 people.'], 422);
        }

        $group = GroupConversation::create([
            'name' => $data['name'] ?? null,
            'created_by' => $me->id,
            'school_id' => $me->school_id,
        ]);

        foreach ($allMemberIds as $userId) {
            $group->members()->create(['user_id' => $userId, 'last_read_at' => $userId === $me->id ? now() : null]);
        }

        $group->messages()->create([
            'sender_id' => $me->id,
            'message' => "{$me->name} created the group.",
            'is_system' => true,
        ]);

        return response()->json(['success' => true, 'id' => $group->id]);
    }

    private function groupForMember(int $id, int $userId): ?GroupConversation
    {
        return GroupConversation::whereHas('members', fn ($q) => $q->where('user_id', $userId))->find($id);
    }

    public function groupThread(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $group = $this->groupForMember($id, $me->id);
        if (!$group) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        // Opening the thread is what "reads" it, same as a 1:1 conversation.
        $markRead = fn () => $group->members()->where('user_id', $me->id)->update(['last_read_at' => now()]);

        if ($this->wantsPage($request)) {
            [$messages, $hasMore] = $this->newestPage(GroupMessage::with('sender', 'replyTo.sender')->where('group_conversation_id', $group->id), $request);
            $markRead();

            return response()->json(['messages' => $messages->map(fn (GroupMessage $m) => $this->mapGroupMessagePayload($m))->values(), 'has_more' => $hasMore]);
        }

        $group->load('messages.sender', 'messages.replyTo.sender');
        $markRead();

        return response()->json(['messages' => $group->messages->map(fn (GroupMessage $m) => $this->mapGroupMessagePayload($m))]);
    }

    public function storeGroupMessage(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $group = $this->groupForMember($id, $me->id);
        if (!$group) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        $data = $request->validate([
            'message' => 'required_without:attachment|nullable|string|max:2000',
            'attachment' => ['sometimes', 'file', 'max:'.SafeUpload::CHAT_MAX_KB, SafeUpload::chatRule()],
            'reply_to_id' => 'sometimes|nullable|integer',
        ]);

        // Only a message actually in this same group can be quoted.
        $replyToId = !empty($data['reply_to_id'])
            ? $group->messages()->where('id', $data['reply_to_id'])->value('id')
            : null;

        $message = $group->messages()->create(array_merge([
            'sender_id' => $me->id,
            'reply_to_id' => $replyToId,
            'message' => $data['message'] ?? '',
        ], $this->storeAttachment($request, $me->id) ?? []));
        $group->touch();
        $group->members()->where('user_id', $me->id)->update(['last_read_at' => now()]);

        $recipientIds = $group->members()->where('user_id', '!=', $me->id)->pluck('user_id')->all();
        if (!empty($recipientIds)) {
            try {
                broadcast(new GroupMessageSent($message->load('sender'), $recipientIds));
            } catch (Throwable $e) {
                Log::warning('Group message broadcast failed, continuing without live push.', [
                    'message_id' => $message->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return response()->json(['success' => true, 'message_data' => $this->mapGroupMessagePayload($message)]);
    }

    public function groupTyping(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $group = $this->groupForMember($id, $me->id);
        if (!$group) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        $recipientIds = $group->members()->where('user_id', '!=', $me->id)->pluck('user_id')->all();
        if (!empty($recipientIds)) {
            try {
                broadcast(new GroupUserTyping($group->id, $recipientIds, $me->id, $me->name));
            } catch (Throwable $e) {
                Log::warning('Group typing broadcast failed, continuing without live push.', ['error' => $e->getMessage()]);
            }
        }

        return response()->json(['success' => true]);
    }
}
