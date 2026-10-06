import { Suspense } from "react";
import CompanyDetail from "./CompanyDetail";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CompanyDetail />
    </Suspense>
  );
}
