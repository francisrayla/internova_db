<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SupportTicket;
use App\Models\SupportTicketMessage;
use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
            'last_message' => $last?->message,
            'last_message_at' => $last?->created_at?->format('M d, Y g:i A'),
            'created_at' => $t->created_at->format('M d, Y'),
        ];
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
        ]);

        $coordinator = $request->user();
        $ticket = SupportTicket::create([
            'school_id' => $coordinator->school_id,
            'coordinator_id' => $coordinator->id,
            'subject' => $data['subject'],
            'category' => $data['category'],
            'status' => 'Open',
        ]);
        $ticket->messages()->create(['sender_id' => $coordinator->id, 'message' => $data['message']]);

        NotificationService::toSuperadmin(
            type: 'support_ticket',
            title: 'New support request',
            body: "{$coordinator->name} ({$coordinator->school?->school_name}): {$data['subject']}",
            link: '/superadmin/support'
        );

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
            'messages' => $ticket->messages->map(fn (SupportTicketMessage $m) => [
                'id' => $m->id,
                'sender_name' => $m->sender?->name,
                'is_superadmin' => $m->sender?->role_id == 1,
                'message' => $m->message,
                'created_at' => $m->created_at->format('M d, Y g:i A'),
            ]),
        ]]);
    }

    public function reply(Request $request, int $id): JsonResponse
    {
        $ticket = $this->ticketForCoordinator($id, $request->user()->id);
        if (!$ticket) {
            return response()->json(['success' => false, 'message' => 'Ticket not found.'], 404);
        }

        $data = $request->validate(['message' => 'required|string|max:3000']);
        $ticket->messages()->create(['sender_id' => $request->user()->id, 'message' => $data['message']]);
        $ticket->touch();

        NotificationService::toSuperadmin(
            type: 'support_ticket',
            title: 'New reply on a support request',
            body: "{$ticket->subject}",
            link: '/superadmin/support'
        );

        return response()->json(['success' => true]);
    }
}
