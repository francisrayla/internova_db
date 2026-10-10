import { Suspense } from "react";
import InternActivities from "./InternActivities";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InternActivities />
    </Suspense>
  );
}
