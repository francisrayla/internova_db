import { Suspense } from "react";
import VerifyEmail from "./VerifyEmail";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
