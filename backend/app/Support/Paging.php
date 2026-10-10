<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator as Paginator;
use Illuminate\Support\Collection;

/**
 * One shape for every paginated list endpoint, so the screens (Load more or
 * numbered pages) all read the same keys: total, page, per_page, last_page,
 * has_more. `per_page` comes from the query string but is always clamped.
 */
class Paging
{
    public static function perPage(Request $request, int $default = 20, int $max = 50): int
    {
        $asked = (int) $request->query('per_page', $default);

        return min($max, max(1, $asked ?: $default));
    }

    /**
     * Narrows a query to rows whose intern matches the search text (first name,
     * last name, display name or "First Last"). $relation is the path from the
     * queried model to the intern user. The search runs in SQL so it covers every
     * page, not only the one on screen.
     */
    public static function internNameLike($query, ?string $search, string $relation = 'deployment.intern')
    {
        $search = trim((string) $search);
        if ($search === '') {
            return $query;
        }
        $like = '%' . addcslashes($search, '%_\\') . '%';

        return $query->whereHas($relation, fn ($q) => $q->where(function ($w) use ($like) {
            $w->where('first_name', 'like', $like)
                ->orWhere('last_name', 'like', $like)
                ->orWhere('name', 'like', $like)
                ->orWhereRaw("CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) like ?", [$like]);
        }));
    }

    /** Was a page asked for? Lists that other screens also read stay unpaged unless the caller opts in. */
    public static function requested(Request $request): bool
    {
        return $request->query->has('page') || $request->query->has('per_page');
    }

    /** Pages a collection that is built in PHP (rows computed from several tables), after it has been filtered. */
    public static function collection(Collection $rows, Request $request, int $default = 20, int $max = 50): Paginator
    {
        $perPage = self::perPage($request, $default, $max);
        $page = max(1, (int) $request->query('page', 1));

        return new Paginator($rows->forPage($page, $perPage)->values(), $rows->count(), $perPage, $page);
    }

    /** @return array{total:int,page:int,per_page:int,last_page:int,has_more:bool} */
    public static function meta(LengthAwarePaginator $page): array
    {
        return [
            'total' => $page->total(),
            'page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'last_page' => $page->lastPage(),
            'has_more' => $page->hasMorePages(),
        ];
    }
}
