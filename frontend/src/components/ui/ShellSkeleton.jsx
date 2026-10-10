import "../dash/dash.css";

/** Shown by a role layout while the session is being checked, so the screen is never blank white/dark. */
export default function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--ui-ground)] p-4 sm:p-6" role="status" aria-busy="true" aria-label="Loading">
      <div className="mx-auto grid max-w-5xl gap-4">
        <div className="dash-skel" style={{ height: 56 }} />
        <div className="dash-skel" style={{ height: 120 }} />
        <div className="dash-skel" style={{ height: 220 }} />
      </div>
    </div>
  );
}
