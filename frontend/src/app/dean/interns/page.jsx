import { Suspense } from "react";
import DeanInterns from "./DeanInterns";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DeanInterns />
    </Suspense>
  );
}
