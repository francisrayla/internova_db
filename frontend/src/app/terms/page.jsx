/*
 * DRAFT. These Terms and Conditions were written from how Internova works in
 * the code. They are NOT legal advice and must be reviewed by the school /
 * thesis adviser (and ideally a lawyer) before the system is used with real
 * people. Items to confirm are listed in the hand-off notes: refund rule,
 * data-retention period, governing law, response time for privacy requests.
 * When the text changes, bump TERMS_VERSION in src/lib/legal.js and
 * config('internova.terms_version') in backend/config/internova.php.
 */
import Link from "next/link";
import LegalPage, { Bullets } from "@/components/LegalPage";
import { getSupportEmail } from "@/lib/legal";

export const metadata = {
  title: "Terms and Conditions | Internova",
  description: "The rules for using Internova, the internship (OJT) monitoring workspace for schools, companies and interns.",
};

export default async function TermsPage() {
  const support = await getSupportEmail();

  const sections = [
    {
      id: "about",
      title: "About these Terms",
      content: (
        <>
          <p>
            Internova is a web app that helps schools run and monitor their internship (On-the-Job Training, or OJT) program. It is used by
            schools, the people who run them, partner companies and the interns themselves. By creating an account, or by activating an
            account you were invited to, you agree to these Terms and to the <Link href="/privacy" className="font-semibold text-blue-700 hover:underline">Privacy Notice</Link>.
          </p>
          <p>If you do not agree, please do not create or activate an account.</p>
        </>
      ),
    },
    {
      id: "who",
      title: "Who uses Internova",
      content: (
        <>
          <p>Every account has one role, and what you can see and do depends on it.</p>
          <Bullets
            items={[
              <><strong>School Head (Dean, Principal or School Head):</strong> registers the school, accepts the plan, pays the subscription, invites the coordinators and can follow the school&apos;s internship progress.</>,
              <><strong>Coordinator:</strong> adds interns and partner companies, invites supervisors, sets requirements and evaluation criteria and follows the interns of their school.</>,
              <><strong>Company supervisor:</strong> guides the interns of their company: reviews attendance and activities, gives tasks and ratings and fills in evaluations.</>,
              <><strong>Intern:</strong> clocks in and out, records activities, finishes tasks, uploads documents and builds a portfolio and narrative report.</>,
              <><strong>Internova team (Super Admin):</strong> runs the platform, approves school registrations and provides support.</>,
            ]}
          />
        </>
      ),
    },
    {
      id: "accounts",
      title: "Your account and security",
      content: (
        <>
          <Bullets
            items={[
              "You must give true information and keep it up to date.",
              "Your account is personal. Do not share your password or let someone else use your account.",
              "Most accounts are created by an invitation link sent to your email. A link works for one account and expires; if it expires, ask whoever invited you for a new one.",
              "To keep accounts safe, an account can be signed in on one device at a time. Company supervisors can be signed in on two devices (for example a phone and a laptop). Signing in on another device signs the oldest one out.",
              "Sign-in sessions end automatically after a few days and you will need to log in again.",
              "Tell us right away if you think someone else used your account.",
            ]}
          />
        </>
      ),
    },
    {
      id: "use",
      title: "Acceptable use",
      content: (
        <>
          <p>Internova is for real internship records. You agree not to:</p>
          <Bullets
            items={[
              "Fake attendance, for example by clocking in with someone else's selfie, a photo of a photo, or a GPS position you are not really at.",
              "Enter false hours, activities, task proofs, documents or evaluations.",
              "Upload anything illegal, harmful, hateful or that you do not have the right to share (this includes other people's private data).",
              "Use chat to harass, threaten or spam anyone.",
              "Try to see data of another school or another person, break the security of the system, upload malware or overload the service.",
              "Use another person's account or create accounts for people who did not agree to it.",
            ]}
          />
          <p>
            Some entries are flagged automatically (for example attendance at odd hours or far from the company) so that supervisors can check them.
            A flag is not a punishment. It only asks a person to look.
          </p>
        </>
      ),
    },
    {
      id: "content",
      title: "Your content and school records",
      content: (
        <>
          <p>
            What you put into Internova (selfies, location, documents, activities, task proofs, messages, evaluations) stays yours or your school&apos;s.
            You give Internova the right to store it, show it to the people your role allows and process it only to run the service.
          </p>
          <p>
            The school is responsible for its interns&apos; records. Evaluations, hours and reports in Internova are working records for the school&apos;s program.
            The school and the company decide the final grade and whether an internship is complete. Internova only helps to collect the information.
          </p>
        </>
      ),
    },
    {
      id: "school",
      title: "What schools are responsible for",
      content: (
        <>
          <p>When a school uses Internova it also agrees that:</p>
          <Bullets
            items={[
              "The school decides why and how its interns' personal data is used. Under the Data Privacy Act of 2012 (RA 10173) the school is the personal information controller for its interns, and Internova processes the data for the school and on its instructions.",
              "The school has the right to put its interns, coordinators and supervisors into Internova, and tells them about it before they are invited (for example in its OJT orientation or waiver).",
              "If an intern is under 18, the school gets the consent of the parent or guardian where the law requires it.",
              "The school only invites people who really belong to its internship program and removes accounts that should no longer have access.",
              "The person who registers the school is authorised to bind the school to these Terms and to the subscription.",
            ]}
          />
        </>
      ),
    },
    {
      id: "plans",
      title: "Subscriptions, payments and refunds",
      content: (
        <>
          <Bullets
            items={[
              "Schools use Internova under a subscription plan (Basic or Premium), billed monthly or yearly. Some features, such as AI help with the narrative report, are only in Premium.",
              "A registration is reviewed by the Internova team. After approval the school gets an offer that must be accepted within 14 days. The school's dashboard opens once payment is confirmed.",
              "Payment is made online through PayMongo or by bank transfer with proof of payment that the Internova team checks. Internova does not see or store your card number.",
              "Upgrading to a higher plan is prorated for the time left on the current plan. Other plan changes need approval and are paid before they start.",
              "When a subscription ends or is not paid, the school's users cannot use the system until it is renewed. The data is not deleted right away (see the Privacy Notice).",
              "Payments are not refundable once the subscription period has started, unless the law requires it or Internova agrees in writing. Prices and plans can change for future periods and we will tell the school before they apply.",
            ]}
          />
        </>
      ),
    },
    {
      id: "ai",
      title: "AI writing help",
      content: (
        <p>
          On Premium, Internova can use AI to polish an intern&apos;s daily log, or to draft a short narrative from the tasks the intern worked on that day.
          The text involved (what the intern wrote, or the task titles and descriptions) is sent to Google&apos;s Gemini service.
          AI can make mistakes. The intern is responsible for reading and correcting what it writes, and supervisors review the entries before they count.
        </p>
      ),
    },
    {
      id: "availability",
      title: "Availability and changes to the service",
      content: (
        <>
          <p>
            We try to keep Internova running, but it is provided &quot;as is&quot;. There can be maintenance, outages or problems with the services we depend on
            (hosting, email, maps, payments). Because phones lose signal, attendance can be saved offline and sent later, but it still has to be
            checked like any other record.
          </p>
          <p>We can add, change or remove features. If we make a big change that affects what you pay or what you can do, we will tell the school.</p>
        </>
      ),
    },
    {
      id: "suspension",
      title: "Suspension and ending",
      content: (
        <>
          <p>
            We may suspend or close an account or a school if these Terms are broken, if a payment is missing, or to protect other users or the system.
            A school can ask to close its account. You can ask us to delete your personal data as explained in the Privacy Notice.
          </p>
        </>
      ),
    },
    {
      id: "liability",
      title: "Limits of liability",
      content: (
        <>
          <p>
            Internova is a tool to record and monitor internships. We are not a party to the agreement between a school, a company and an intern, and we
            are not responsible for decisions they make with the information (for example grades, hours or whether someone passes).
          </p>
          <p>
            As far as the law allows, Internova is not liable for indirect or unexpected losses, or for losses caused by things outside our control
            (internet or power problems, wrong GPS, third-party services, or someone misusing an account). Our total responsibility to a school for any
            claim is limited to the amount that school paid for the subscription in the 12 months before the claim. Nothing here removes rights that
            the law says cannot be removed.
          </p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Changes to these Terms",
      content: (
        <p>
          We may update these Terms and the Privacy Notice. The date and version at the top of the page show the latest one. If a change is important we will tell
          the school or ask you to agree again. Using Internova after a change means you accept the new version.
        </p>
      ),
    },
    {
      id: "law",
      title: "Governing law",
      content: <p>These Terms follow the laws of the Republic of the Philippines.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      content: (
        <p>
          Questions about these Terms? Write to{" "}
          <a href={`mailto:${support}`} className="font-semibold text-blue-700 hover:underline">{support}</a>.
        </p>
      ),
    },
  ];

  return (
    <LegalPage
      kind="terms"
      title="Terms and Conditions"
      sentence="The rules for using Internova, in plain English."
      sections={sections}
    />
  );
}
