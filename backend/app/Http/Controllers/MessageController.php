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
use App\Models\User;
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
        $roleId = (int) $user->role_id;

        // Coordinator: every supervisor and intern at their own school.
        if ($roleId === 2) {
            return User::where('school_id', $user->school_id)
                ->whereIn('role_id', [3, 4])
                ->orderBy('first_name')
                ->get();
        }

        // Supervisor: interns actually deployed to them, plus their school's coordinators.
        if ($roleId === 3) {
            $internIds = InternshipDeployment::where('supervisor_id', $user->id)->pluck('intern_id')->unique();

            return User::where(function ($q) use ($internIds, $user) {
                $q->whereIn('id', $internIds)
                    ->orWhere(fn ($q2) => $q2->where('school_id', $user->school_id)->where('role_id', 2));
            })->orderBy('first_name')->get();
        }

        // Intern: their own supervisor and coordinator only.
        if ($roleId === 4) {
            $deployments = InternshipDeployment::where('intern_id', $user->id)->get();
            $ids = $deployments->pluck('supervisor_id')->merge($deployments->pluck('coordinator_id'))->filter()->unique();

            return User::whereIn('id', $ids)->orderBy('first_name')->get();
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
            'role' => $contact->role_id == 2 ? 'coordinator' : ($contact->role_id == 3 ? 'supervisor' : 'intern'),
            'avatar_url' => $contact->avatar_url,
            'last_message' => $lastMessage?->message,
            'last_message_at' => $lastMessage?->created_at?->format('g:i A'),
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

    public function thread(Request $request, int $userId): JsonResponse
    {
        $me = $request->user();
        if (!$this->isEligibleContact($me, $userId)) {
            return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
        }

        $messages = Message::where(function ($q) use ($me, $userId) {
            $q->where('sender_id', $me->id)->where('receiver_id', $userId);
        })->orWhere(function ($q) use ($me, $userId) {
            $q->where('sender_id', $userId)->where('receiver_id', $me->id);
        })->orderBy('created_at')->get();

        // Opening the thread is what "reads" it.
        Message::where('sender_id', $userId)->where('receiver_id', $me->id)->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['messages' => $messages->map(fn (Message $m) => [
            'id' => $m->id,
            'sender_id' => $m->sender_id,
            'message' => $m->message,
            'created_at' => $m->created_at->format('g:i A'),
        ])]);
    }

    public function store(Request $request): JsonResponse
    {
        $me = $request->user();
        $data = $request->validate([
            'receiver_id' => 'required|integer',
            'message' => 'required|string|max:2000',
        ]);

        if (!$this->isEligibleContact($me, (int) $data['receiver_id'])) {
            return response()->json(['success' => false, 'message' => 'You can\'t message this person.'], 403);
        }

        $message = Message::create([
            'sender_id' => $me->id,
            'receiver_id' => $data['receiver_id'],
            'school_id' => $me->school_id,
            'message' => $data['message'],
        ]);

        try {
            broadcast(new MessageSent($message));
        } catch (Throwable $e) {
            Log::warning('Message broadcast failed, continuing without live push.', [
                'message_id' => $message->id,
                'error' => $e->getMessage(),
            ]);
        }

        return response()->json(['success' => true, 'message_data' => [
            'id' => $message->id,
            'sender_id' => $message->sender_id,
            'message' => $message->message,
            'created_at' => $message->created_at->format('g:i A'),
        ]]);
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
            'last_message' => $lastMessage?->message,
            'last_message_at' => $lastMessage?->created_at?->format('g:i A'),
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
        if (!in_array((int) $me->role_id, [2, 3], true)) {
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

        $group = GroupConversation::create([
            'name' => $data['name'] ?? null,
            'created_by' => $me->id,
            'school_id' => $me->school_id,
        ]);

        foreach ($memberIds->push($me->id)->unique() as $userId) {
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

        $group->load('messages.sender');

        // Opening the thread is what "reads" it, same as a 1:1 conversation.
        $group->members()->where('user_id', $me->id)->update(['last_read_at' => now()]);

        return response()->json(['messages' => $group->messages->map(fn (GroupMessage $m) => [
            'id' => $m->id,
            'sender_id' => $m->sender_id,
            'sender_name' => trim("{$m->sender?->first_name} {$m->sender?->last_name}") ?: $m->sender?->name,
            'message' => $m->message,
            'is_system' => (bool) $m->is_system,
            'created_at' => $m->created_at->format('g:i A'),
        ])]);
    }

    public function storeGroupMessage(Request $request, int $id): JsonResponse
    {
        $me = $request->user();
        $group = $this->groupForMember($id, $me->id);
        if (!$group) {
            return response()->json(['success' => false, 'message' => 'Group not found.'], 404);
        }

        $data = $request->validate(['message' => 'required|string|max:2000']);

        $message = $group->messages()->create(['sender_id' => $me->id, 'message' => $data['message']]);
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

        return response()->json(['success' => true, 'message_data' => [
            'id' => $message->id,
            'sender_id' => $message->sender_id,
            'sender_name' => trim("{$me->first_name} {$me->last_name}") ?: $me->name,
            'message' => $message->message,
            'created_at' => $message->created_at->format('g:i A'),
        ]]);
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
