<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\SupportTicketNotification;
use App\Models\SupportTicket;
use App\Models\SupportTicketMessage;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

/**
 * A coordinator's direct line to the platform owner — billing questions,
 * account issues, bug reports. Deliberately separate from the
 * coordinator/supervisor/intern messaging system (see MessageController):
 * Super Admin never appears there, and this never reaches
 * supervisors/interns.
 */
class CoordinatorSupportController extends Controller
{
    private function mapTicket(SupportTicket $t): array
    {
        $last = $t->messages->last();

        return [
            'id' => $t->id,
            'subject' => $t->subject,
            'category' => $t->category,
            'status' => $t->status,
            'last_message' => $last?->message ?: ($last?->attachment_name ? "📎 {$last->attachment_name}" : null),
            'last_message_at' => $last?->created_at?->local()?->format('M d, Y g:i A'),
            'created_at' => $t->created_at->local()->format('M d, Y'),
        ];
    }

    private function mapMessage(SupportTicketMessage $m): array
    {
        return [
            'id' => $m->id,
            'sender_name' => $m->sender?->name,
            'is_superadmin' => $m->sender?->role_id == 1,
            'message' => $m->message,
            'attachment_url' => $m->attachment_path ? Storage::disk('public')->url($m->attachment_path) : null,
            'attachment_name' => $m->attachment_name,
            'attachment_type' => $m->attachment_type,
            'attachment_size' => $m->attachment_size,
            'created_at' => $m->created_at->local()->format('M d, Y g:i A'),
        ];
    }

    /**
     * Emails every active Super Admin account — there's normally just one,
     * but this holds up if that ever changes instead of hardcoding an
     * address. Failures are logged, not thrown: a stuck mail server should
     * never turn a reply that already saved into a 500 for the coordinator.
     */
    private function notifySuperadmins(SupportTicket $ticket, User $sender, string $body, bool $hasAttachment): void
    {
        $admins = User::where('role_id', 1)->where('status', 'active')->get();
        foreach ($admins as $admin) {
            if (!$admin->email) {
                continue;
            }
            Mail::to($admin->email, $admin->name)->queue(new SupportTicketNotification(
                recipientName: $admin->name,
                senderLabel: $sender->name,
                ticketSubject: $ticket->subject,
                messageBody: $body ?: '(attachment only)',
                hasAttachment: $hasAttachment,
                ticketUrl: config('app.frontend_url') . '/superadmin/support',
            ));
        }
    }

    public function index(Request $request): JsonResponse
    {
        $tickets = SupportTicket::with('messages')
            ->where('coordinator_id', $request->user()->id)
            ->orderByDesc('updated_at')
            ->get();

        return response()->json(['tickets' => $tickets->map(fn (SupportTicket $t) => $this->mapTicket($t))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'subject' => 'required|string|max:150',
            'category' => 'required|string|in:Billing,Account,Platform,General',
            'message' => 'required|string|max:3000',
            'attachment' => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
        ]);

        $coordinator = $request->user();
        $ticket = SupportTicket::create([
            'school_id' => $coordinator->school_id,
            'coordinator_id' => $coordinator->id,
            'subject' => $data['subject'],
            'category' => $data['category'],
            'status' => 'Open',
        ]);

        $attachment = $this->storeAttachment($request, $coordinator->id);
        $ticket->messages()->create(['sender_id' => $coordinator->id, 'message' => $data['message'], ...$attachment]);

        NotificationService::toSuperadmin(
            type: 'support_ticket',
            title: 'New support request',
            body: "{$coordinator->name} ({$coordinator->school?->school_name}): {$data['subject']}",
            link: '/superadmin/support'
        );
        $this->notifySuperadmins($ticket, $coordinator, $data['message'], (bool) $attachment['attachment_path']);

        return response()->json(['success' => true, 'id' => $ticket->id]);
    }

    private function ticketForCoordinator(int $id, int $coordinatorId): ?SupportTicket
    {
        return SupportTicket::where('coordinator_id', $coordinatorId)->find($id);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $ticket = $this->ticketForCoordinator($id, $request->user()->id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        $ticket->load('messages.sender');

        return response()->json(['ticket' => [
            ...$this->mapTicket($ticket),
            'messages' => $ticket->messages->map(fn (SupportTicketMessage $m) => $this->mapMessage($m)),
        ]]);
    }

    private function storeAttachment(Request $request, int $userId): array
    {
        if (!$request->hasFile('attachment')) {
            return ['attachment_path' => null, 'attachment_name' => null, 'attachment_type' => null, 'attachment_size' => null];
        }

        $file = $request->file('attachment');
        $path = $file->store("support-attachments/{$userId}", 'public');

        return [
            'attachment_path' => $path,
            'attachment_name' => $file->getClientOriginalName(),
            'attachment_type' => $file->getClientMimeType(),
            'attachment_size' => $file->getSize(),
        ];
    }

    public function reply(Request $request, int $id): JsonResponse
    {
        $ticket = $this->ticketForCoordinator($id, $request->user()->id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        $data = $request->validate([
            'message' => 'nullable|string|max:3000',
            'attachment' => 'nullable|file|mimes:jpg,jpeg,png,webp,pdf,doc,docx|max:5120',
        ]);
        $attachment = $this->storeAttachment($request, $request->user()->id);
        if (empty($data['message']) && !$attachment['attachment_path']) {
            return response()->json(['success' => false, 'message' => 'Write a message or attach a file.'], 422);
        }

        $ticket->messages()->create(['sender_id' => $request->user()->id, 'message' => $data['message'] ?? '', ...$attachment]);
        // A follow-up from the coordinator means this isn't actually settled
        // yet — reopening it here is what lets them keep replying at all,
        // since the reply form only shows for a ticket that isn't Resolved.
        $ticket->update(['status' => 'Open']);

        NotificationService::toSuperadmin(
            type: 'support_ticket',
            title: 'New reply on a support request',
            body: "{$ticket->subject}",
            link: '/superadmin/support'
        );
        $this->notifySuperadmins($ticket, $request->user(), $data['message'] ?? '', (bool) $attachment['attachment_path']);

        return response()->json(['success' => true]);
    }
}
