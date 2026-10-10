/** Marks an attendance entry captured while the intern was offline — its
 * time comes from their device rather than the server (see the backend's
 * resolveClockTime), so reviewers should know it isn't server-verified. */
export default function OfflineEntryBadge({ record, className = "" }) {
  const parts = [record.clock_in_is_offline && "time in", record.clock_out_is_offline && "time out"].filter(Boolean);
  if (parts.length === 0) return null;

  return (
    <span
      className={`k-pill is-sm is-warn ${className}`}
      title={`Captured offline (${parts.join(" and ")}) — the time comes from the intern's device, not the server.`}
    >
      Offline entry
    </span>
  );
}
