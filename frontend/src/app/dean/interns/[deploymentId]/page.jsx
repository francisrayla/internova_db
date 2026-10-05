import { Suspense } from "react";
import InternDetail from "./InternDetail";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <InternDetail />
    </Suspense>
  );
}
