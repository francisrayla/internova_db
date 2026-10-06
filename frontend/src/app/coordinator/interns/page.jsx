import { Suspense } from "react";
import InternMonitoring from "./InternMonitoring";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InternMonitoring />
    </Suspense>
  );
}
