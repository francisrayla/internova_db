<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeanFeedback;
use App\Services\ActivityLogService;
use App\Services\FeedbackThreadService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Feedback from Dean" as the coordinator sees it: threads they can read,
 * acknowledge and reply to. A coordinator only ever touches threads addressed
 * to themselves in their own school.
 */
class CoordinatorFeedbackController extends Controller
{
    private function thread(Request $request, int $id): ?DeanFeedback
    {
        return DeanFeedback::with(['dean', 'coordinator', 'replies.user'])
            ->where('coordinator_id', $request->user()->id)->where('school_id', $request->user()->school_id)->find($id);
    }

    private static function notFound(): JsonResponse
    {
        return response()->json(['success' => false, 'message' => 'Feedback not found.'], 404);
    }

    public function index(Request $request): JsonResponse
    {
        $items = DeanFeedback::with(['dean', 'coordinator', 'replies.user'])
            ->where('coordinator_id', $request->user()->id)->where('school_id', $request->user()->school_id)
            ->latest('id')->limit(100)->get();

        return response()->json([
            'success' => true,
            'items' => $items->map(fn (DeanFeedback $f) => FeedbackThreadService::payload($f, 'coordinator'))->values(),
            'unread_count' => FeedbackThreadService::coordinatorUnread($request->user()),
        ]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json(['unread_count' => FeedbackThreadService::coordinatorUnread($request->user())]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        DeanFeedback::with('replies')->where('coordinator_id', $request->user()->id)->where('school_id', $request->user()->school_id)
            ->get()->each(fn (DeanFeedback $f) => FeedbackThreadService::markReadFor('coordinator', $f));

        return response()->json(['success' => true]);
    }

    public function markRead(Request $request, int $id): JsonResponse
    {
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound();
        }
        FeedbackThreadService::markReadFor('coordinator', $f);

        return response()->json(['success' => true]);
    }

    public function acknowledge(Request $request, int $id): JsonResponse
    {
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound();
        }
        FeedbackThreadService::acknowledge($f);
        $this->log($request, $f, 'Acknowledged Dean feedback');

        return response()->json(['success' => true, 'feedback' => FeedbackThreadService::payload($f->fresh(), 'coordinator')]);
    }

    public function reply(Request $request, int $id): JsonResponse
    {
        $data = $request->validate(['message' => 'required|string|max:2000']);
        $f = $this->thread($request, $id);
        if (!$f) {
            return self::notFound();
        }
        if ($f->status === DeanFeedback::RESOLVED) {
            return response()->json(['success' => false, 'message' => 'This feedback is marked resolved. Ask your Dean to reopen it to reply.'], 422);
        }
        FeedbackThreadService::reply($f, $request->user(), 'coordinator', $data['message']);
        $this->log($request, $f, 'Replied to Dean feedback');

        return response()->json(['success' => true, 'feedback' => FeedbackThreadService::payload($f->fresh(), 'coordinator')], 201);
    }

    private function log(Request $request, DeanFeedback $f, string $action): void
    {
        ActivityLogService::record(
            module: 'Coordinator',
            action: $action,
            description: "{$request->user()->name} responded to feedback from the Dean.",
            schoolId: $f->school_id,
            request: $request
        );
    }
}
