import { Suspense } from "react";
import DailyPerformanceEvaluation from "./DailyPerformanceEvaluation";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DailyPerformanceEvaluation />
    </Suspense>
  );
}
