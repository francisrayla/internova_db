<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * The task lists have two parts: the Active board (open work, plus done tasks that still wait for a grade),
 * which is returned whole, and History (rated or finished tasks), which grows for ever and is paged.
 * Opt-in with ?view=active|history; without it the endpoints keep returning every task (dashboards read those).
 */
class TaskListing
{
    /**
     * @param  \Illuminate\Database\Eloquent\Builder  $base  the role's scoped task query (eager loads and order set)
     * @param  callable  $map  Task -> array row
     * @return array|null  null when the caller did not ask for a view
     */
    public static function respond(Request $request, $base, bool $ratingsEnabled, callable $map): ?array
    {
        $view = $request->query('view');
        if (!in_array($view, ['active', 'history'], true)) {
            return null;
        }

        $counts = [
            'active' => (clone $base)->notInHistory($ratingsEnabled)->count(),
            'history' => (clone $base)->inHistory($ratingsEnabled)->count(),
            'awaiting_rating' => $ratingsEnabled ? (clone $base)->where('status', 'completed')->whereDoesntHave('evaluation')->count() : 0,
        ];

        if ($view === 'active') {
            return ['tasks' => (clone $base)->notInHistory($ratingsEnabled)->get()->map($map)->values(), 'counts' => $counts];
        }

        $query = (clone $base)->inHistory($ratingsEnabled);
        if (($search = trim((string) $request->query('search'))) !== '') {
            $like = '%' . addcslashes($search, '%_\\') . '%';
            $query->where(function ($w) use ($like) {
                $w->where('title', 'like', $like)
                    ->orWhereHas('assignees.user', fn ($u) => $u->where(function ($n) use ($like) {
                        $n->where('name', 'like', $like)->orWhere('first_name', 'like', $like)->orWhere('last_name', 'like', $like);
                    }));
            });
        }
        if ($deploymentId = $request->query('deployment_id')) {
            $query->whereHas('assignees', fn ($a) => $a->where('deployment_id', (int) $deploymentId));
        }

        if ($userId = $request->query('user_id')) {
            $query->whereHas('assignees', fn ($a) => $a->where('user_id', (int) $userId));
        }

        $page = $query->paginate(Paging::perPage($request, 15, 50));

        return [
            'tasks' => collect($page->items())->map($map)->values(),
            ...Paging::meta($page),
            'counts' => $counts,
        ];
    }
}
