import { SearchX } from "lucide-react";
import StatusScreen from "@/components/StatusScreen";
import { Btn } from "@/components/dash/page";

export const metadata = { title: "Page not found | Internova" };

// Rendered for any URL that matches no route, and for notFound() calls.
export default function NotFound() {
  return (
    <StatusScreen
      icon={SearchX}
      eyebrow="Error 404"
      title="We can't find that page"
      text="The link may be old or mistyped. Head back home, or sign in to get to your workspace."
    >
      <Btn variant="primary" href="/" block>Back to home</Btn>
      <Btn href="/login" block>Go to sign in</Btn>
    </StatusScreen>
  );
}
