"use client";

import { useEffect, useState } from "react";

const PER_PAGE = 15;

/**
 * The History list of a task screen: finished and graded tasks, 15 at a time, newest first.
 * The server does the search (task title or intern name) and the intern filter over the whole history,
 * so a page of results is never "whatever happened to be loaded". "Load more" adds the next page.
 *
 * fetcher(queryString) -> Promise of the tasks route response ({ tasks, total, has_more, page }).
 * `filters` are extra server filters (deployment_id, user_id, company_id). Nothing is requested while `enabled` is false (the Active tab is showing).
 * `refreshKey` changes whenever the screen reloaded its data, which reloads page 1 too.
 */
export function useTaskHistory({ fetcher, enabled, search = "", filters = {}, refreshKey = 0 }) {
  const [debounced, setDebounced] = useState(search.trim());
  const [state, setState] = useState({ key: null, items: [], total: 0, page: 1, hasMore: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // `filters` = extra query params the server understands (deployment_id, user_id, company_id).
  const key = `${debounced}|${JSON.stringify(filters)}|${refreshKey}`;

  function query(page) {
    const qs = new URLSearchParams({ view: "history", page: String(page), per_page: String(PER_PAGE) });
    if (debounced) qs.set("search", debounced);
    for (const [name, value] of Object.entries(filters)) if (value) qs.set(name, value);
    return qs.toString();
  }

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true; // a slower, older answer must not replace a newer one
    fetcher(query(1))
      .then((r) => {
        if (!live) return;
        setState({ key, items: r.tasks ?? [], total: r.total ?? 0, page: 1, hasMore: Boolean(r.has_more) });
        setError("");
      })
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setState((s) => ({ ...s, key }));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await fetcher(query(state.page + 1));
      setState((s) => {
        const have = new Set(s.items.map((t) => t.id));
        return { ...s, items: [...s.items, ...(r.tasks ?? []).filter((t) => !have.has(t.id))], page: s.page + 1, hasMore: Boolean(r.has_more), total: r.total ?? s.total };
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    items: state.items,
    total: state.total,
    hasMore: state.hasMore,
    loading: enabled && state.key !== key,
    loadingMore,
    loadMore,
    error,
  };
}
