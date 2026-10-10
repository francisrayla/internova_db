<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use App\Services\DashboardQueueService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * Every notification query is built from the SIGNED-IN user only: audience role, school and id are never
     * taken from the request (that used to let anyone read or mark another school's / person's notifications).
     * A row is visible when it targets this user's role in this user's school (user_id null = whole audience)
     * or targets this user personally. Super admin rows are platform-wide, so no school filter for them.
     */
    private function scopedQuery(Request $request)
    {
        $user = $request->user();
        $role = $user->roles?->name;
        $audience = $role === 'super_admin' ? 'superadmin' : $role;

        $query = Notification::where('audience_role', $audience)->where('important', true);

        if ($role !== 'super_admin') {
            // A school-bound role without a school sees nothing (never "every school").
            $user->school_id ? $query->where('school_id', $user->school_id) : $query->whereRaw('1 = 0');
        }

        return $query->where(function ($q) use ($user) {
            $q->whereNull('user_id')->orWhere('user_id', $user->id);
        });
    }

    /**
     * Notifications of the signed-in user (see scopedQuery). Used both for
     * the initial bell-dropdown load and to backfill anything missed while offline —
     * the live updates themselves come over the Reverb/Echo channel, not this endpoint.
     * Only "important" rows show here — see NotificationService for what that means.
     */
    public function index(Request $request): JsonResponse
    {
        $query = $this->scopedQuery($request);
        $notifications = $query->latest('id')->limit(30)->get();

        return response()->json([
            'notifications' => $notifications->map(fn ($n) => [
                'id'         => $n->id,
                'type'       => $n->type,
                'title'      => $n->title,
                'body'       => $n->body,
                'link'       => $n->link,
                'read'       => $n->read_at !== null,
                'created_at' => $n->created_at->local()->format('F d, Y \a\t g:i A'),
            ]),
            // Every unread one (drives "Mark all read" and the blue dots).
            'unread_count' => (clone $query)->whereNull('read_at')->count(),
            // Only those that arrived since the bell was last opened: this is the red number on
            // the bell, so peeking at the list clears it even before a single one is clicked.
            'new_count' => (clone $query)->whereNull('read_at')
                ->when($request->user()?->notifications_seen_at, fn ($q, $seen) => $q->where('created_at', '>', $seen))
                ->count(),
        ]);
    }

    /**
     * "Needs your attention": the live to-do list of the signed-in person, shown at the top of the bell and on
     * the notification history page. It is worked out on the spot from real data (nothing is stored, so there are
     * no duplicates and no daily spam) and ONLY from $request->user(): role, school and id never come from the
     * request, so nobody can ask for another person's or another school's list.
     *
     * Response: items[] = {key, tone, count, title, detail, href, info}, and `badge` = how many items need action
     * (informational ones such as "you finished your hours" are listed but not counted).
     */
    public function attention(Request $request): JsonResponse
    {
        $user = $request->user();
        $role = $user->roles?->name;

        try {
            $items = match ($role) {
                'super_admin' => DashboardQueueService::superAdmin(),
                'dean' => app(DeanMonitoringController::class)->attentionQueue($user),
                'coordinator' => app(CoordinatorMonitoringController::class)->attentionQueue($user),
                'supervisor' => app(SupervisorMonitoringController::class)->attentionQueue($user),
                'intern' => app(InternMonitoringController::class)->attentionQueue($user),
                default => [],
            };
        } catch (\Throwable $e) {
            // The bell must never break a page: a failed to-do list is just an empty one (and is logged).
            report($e);
            $items = [];
        }

        $items = collect($items)->map(fn (array $i) => $i + ['info' => false])->values();

        return response()->json([
            'items' => $items,
            'badge' => $items->where('info', false)->count(),
        ]);
    }

    /** The person opened the bell: what is in it now has been seen. */
    public function markSeen(Request $request): JsonResponse
    {
        $request->user()->forceFill(['notifications_seen_at' => now()])->saveQuietly();

        return response()->json(['success' => true]);
    }

    /**
     * Full paginated history for the "View all" screen linked from the bell —
     * same important-only scope as index(), but not capped at 30 and includes
     * already-read notifications.
     */
    public function history(Request $request): JsonResponse
    {
        $data = $request->validate(['page' => 'nullable|integer|min:1']);

        $perPage = 20;
        $page = $data['page'] ?? 1;

        $query = $this->scopedQuery($request)->latest('id');
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
                'created_at' => $n->created_at->local()->format('F d, Y \a\t g:i A'),
            ]),
            'page'        => $page,
            'per_page'    => $perPage,
            'total'       => $total,
            'has_more'    => $page * $perPage < $total,
        ]);
    }

    public function markRead(Request $request, int $id): JsonResponse
    {
        // Only a notification this person can see; someone else's is a 404, same as one that does not exist.
        $notification = $this->scopedQuery($request)->findOrFail($id);
        $notification->update(['read_at' => now()]);

        return response()->json(['success' => true]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $query = $this->scopedQuery($request)->whereNull('read_at');
        $query->update(['read_at' => now()]);

        return response()->json(['success' => true]);
    }
}
