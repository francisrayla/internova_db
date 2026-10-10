"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";
import { Btn } from "@/components/dash/page";

// Next 16 error boundary for every route below the root layout (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md):
// the prop is `retry`, not the older `reset`.
export default function Error({ error, retry }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      icon={TriangleAlert}
      tone="amber"
      eyebrow="Something went wrong"
      title="We couldn't load this page"
      text="That was on our side, not yours. Your work is safe. Try again, or go back to the home page."
      detail={error?.digest ? `Reference: ${error.digest}` : null}
    >
      <Btn variant="primary" block onClick={() => retry()}>Try again</Btn>
      <Btn href="/" block>Back to home</Btn>
    </StatusScreen>
  );
}
