import { Suspense } from "react";
import NewEvaluation from "./NewEvaluation";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <NewEvaluation />
    </Suspense>
  );
}
