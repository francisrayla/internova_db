<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DeanFeedback;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** "Feedback from Dean" as the coordinator sees it: read-only, no replies. */
class CoordinatorFeedbackController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $items = DeanFeedback::with('dean')->where('coordinator_id', $request->user()->id)->latest('id')->limit(100)->get();

        return response()->json([
            'success' => true,
            'items' => $items->map(fn (DeanFeedback $f) => [
                'id' => $f->id,
                'message' => $f->message,
                'created_at' => $f->created_at->toIso8601String(),
                'read' => $f->read_at !== null,
                'dean_name' => $f->dean ? (trim("{$f->dean->first_name} {$f->dean->last_name}") ?: $f->dean->name) : 'Your Dean',
            ])->values(),
            'unread_count' => $items->whereNull('read_at')->count(),
        ]);
    }

    public function unreadCount(Request $request): JsonResponse
    {
        return response()->json(['unread_count' => DeanFeedback::where('coordinator_id', $request->user()->id)->whereNull('read_at')->count()]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        DeanFeedback::where('coordinator_id', $request->user()->id)->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['success' => true]);
    }

    public function markRead(Request $request, int $id): JsonResponse
    {
        $f = DeanFeedback::where('coordinator_id', $request->user()->id)->find($id);
        if (!$f) {
            return response()->json(['success' => false, 'message' => 'Feedback not found.'], 404);
        }
        $f->update(['read_at' => $f->read_at ?? now()]);

        return response()->json(['success' => true]);
    }
}
