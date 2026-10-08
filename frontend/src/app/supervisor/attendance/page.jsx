import { Suspense } from "react";
import InternAttendance from "./InternAttendance";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InternAttendance />
    </Suspense>
  );
}
