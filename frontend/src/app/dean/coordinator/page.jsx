import { Suspense } from "react";
import DeanCoordinator from "./DeanCoordinator";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DeanCoordinator />
    </Suspense>
  );
}
