"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchInternData } from "@/lib/internApi";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import AttendanceCard from "../AttendanceCard";

const LIVE_TYPES = ["attendance_reviewed"];

export default function AttendanceHistory() {
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function load() {
    fetchInternData(`attendance?page=${page}`)
      .then((r) => {
        setRecords(r.records ?? []);
        setTotal(r.total ?? 0);
        setHasMore(Boolean(r.has_more));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);
  useLiveRefresh(LIVE_TYPES, load);

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/intern/attendance" className="text-sm font-semibold text-blue-600 hover:underline">
          ← Back to Attendance
        </Link>
        <h2 className="mt-2 text-lg font-semibold text-slate-900">Attendance History</h2>
        <p className="mt-1 text-sm text-slate-600">Every clock in/out you&apos;ve logged, with the selfie and location stamped on each photo.</p>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">Loading attendance…</p>
      ) : records.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-400">No attendance records yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {records.map((r) => (
            <AttendanceCard key={r.id} record={r} />
          ))}
        </div>
      )}

      {total > 20 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
