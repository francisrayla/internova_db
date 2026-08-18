<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    private function scopedQuery(array $data)
    {
        $query = Notification::where('audience_role', $data['audience_role'])->where('important', true);

        if (!empty($data['school_id'])) {
            $query->where('school_id', $data['school_id']);
        }

        if (!empty($data['user_id'])) {
            $query->where(function ($q) use ($data) {
                $q->whereNull('user_id')->orWhere('user_id', $data['user_id']);
            });
        } else {
            $query->whereNull('user_id');
        }

        return $query;
    }

    /**
     * Notifications for one audience: superadmin (platform-wide), or a school-scoped
     * role narrowed by school_id and optionally one specific user_id. Used both for
     * the initial bell-dropdown load and to backfill anything missed while offline —
     * the live updates themselves come over the Reverb/Echo channel, not this endpoint.
     * Only "important" rows show here — see NotificationService for what that means.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'audience_role' => 'required|string|in:superadmin,coordinator,supervisor,intern',
            'school_id'     => 'nullable|integer',
            'user_id'       => 'nullable|integer',
        ]);

        $query = $this->scopedQuery($data);
        $notifications = $query->latest('id')->limit(30)->get();

        return response()->json([
            'notifications' => $notifications->map(fn ($n) => [
                'id'         => $n->id,
                'type'       => $n->type,
                'title'      => $n->title,
                'body'       => $n->body,
                'link'       => $n->link,
                'read'       => $n->read_at !== null,
                'created_at' => $n->created_at->format('F d, Y \a\t g:i A'),
            ]),
            'unread_count' => (clone $query)->whereNull('read_at')->count(),
        ]);
    }

    /**
     * Full paginated history for the "View all" screen linked from the bell —
     * same important-only scope as index(), but not capped at 30 and includes
     * already-read notifications.
     */
    public function history(Request $request): JsonResponse
    {
        $data = $request->validate([
            'audience_role' => 'required|string|in:superadmin,coordinator,supervisor,intern',
            'school_id'     => 'nullable|integer',
            'user_id'       => 'nullable|integer',
            'page'          => 'nullable|integer|min:1',
        ]);

        $perPage = 20;
        $page = $data['page'] ?? 1;

        $query = $this->scopedQuery($data)->latest('id');
        $total = (clone $query)->count();
        $notifications = $query->forPage($page, $perPage)->get();

        return response()->json([
            'notifications' => $notifications->map(fn ($n) => [
                'id'         => $n->id,
                'type'       => $n->type,
                'title'      => $n->title,
                'body'       => $n->body,
                'link'       => $n->link,
                'read'       => $n->read_at !== null,
                'created_at' => $n->created_at->format('F d, Y \a\t g:i A'),
            ]),
            'page'        => $page,
            'per_page'    => $perPage,
            'total'       => $total,
            'has_more'    => $page * $perPage < $total,
        ]);
    }

    public function markRead(int $id): JsonResponse
    {
        $notification = Notification::findOrFail($id);
        $notification->update(['read_at' => now()]);

        return response()->json(['success' => true]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $data = $request->validate([
            'audience_role' => 'required|string|in:superadmin,coordinator,supervisor,intern',
            'school_id'     => 'nullable|integer',
            'user_id'       => 'nullable|integer',
        ]);

        $query = $this->scopedQuery($data)->whereNull('read_at');
        $query->update(['read_at' => now()]);

        return response()->json(['success' => true]);
    }
}
