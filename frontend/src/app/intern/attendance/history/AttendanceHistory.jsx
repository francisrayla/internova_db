"use client";

import { useEffect, useState } from "react";
import { fetchInternData } from "@/lib/internApi";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { Btn, EmptyState, ErrorNote, Page, PageHeader, SkeletonList } from "@/components/dash/page";
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
    <Page>
      <PageHeader
        back={{ href: "/intern/attendance", label: "Back to Attendance" }}
        title="Attendance history"
        sentence="Every clock in/out you've logged, with the selfie and location stamped on each photo."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <SkeletonList rows={2} height="h-56" />
      ) : records.length === 0 ? (
        <EmptyState icon="attendance" title="No attendance records yet" text="Once you clock in, each day shows up here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {records.map((r) => (
            <AttendanceCard key={r.id} record={r} />
          ))}
        </div>
      )}

      {total > 20 && (
        <div className="k-pager border-0 p-0">
          <Btn onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Btn>
          <p>
            Page {page} of {totalPages}
          </p>
          <Btn onClick={() => setPage((p) => p + 1)} disabled={!hasMore}>
            Next
          </Btn>
        </div>
      )}
    </Page>
  );
}
