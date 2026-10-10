"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import "./dash/page.css";

// Page size of the lists that still page on the device (the data is already loaded).
const PAGE_SIZE = 10;

export { PAGE_SIZE };

/**
 * Numbered Prev/Next footer. Used by lists that need a place to jump back to
 * (tables, queues). Server-side lists pass `total` so the footer can say how
 * many rows exist, and `loading` to keep the buttons still while a page loads.
 */
export default function Pagination({ page, totalPages, onPageChange, total, loading = false }) {
  if (totalPages <= 1) return null;

  return (
    <div className="k-pager">
      <p>
        Page {page} of {totalPages}
        {typeof total === "number" ? ` · ${total} in all` : ""}
      </p>
      <div className="k-pager-btns">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={loading || page <= 1}
          className="k-btn is-secondary is-sm"
        >
          <ChevronLeft size={16} aria-hidden="true" /> Prev
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={loading || page >= totalPages}
          className="k-btn is-secondary is-sm"
        >
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * "Load more" footer for feed-like lists (newest first): the rows already on
 * screen stay, the next server page is appended. Same look as the pager.
 */
export function LoadMore({ shown, total, hasMore, loading, onClick }) {
  if (!hasMore) return null;

  return (
    <div className="k-pager">
      <p>
        Showing {shown}
        {typeof total === "number" ? ` of ${total}` : ""}
      </p>
      <button type="button" onClick={onClick} disabled={loading} className="k-btn is-secondary is-sm">
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}
