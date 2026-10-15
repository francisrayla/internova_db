/*
 * DRAFT. This Privacy Notice was written from how Internova works in the code.
 * It is NOT legal advice and must be reviewed by the school / thesis adviser
 * (and ideally a lawyer, or the school's Data Protection Officer) before the
 * system is used with real people. Items to confirm: retention period,
 * response time for requests, the list of third-party services.
 * When the text changes, bump TERMS_VERSION in src/lib/legal.js and
 * config('internova.terms_version') in backend/config/internova.php.
 */
import Link from "next/link";
import LegalPage, { Bullets } from "@/components/LegalPage";
import { getSupportEmail } from "@/lib/legal";

export const metadata = {
  title: "Privacy Notice | Internova",
  description: "What personal data Internova collects, why, who can see it and how to use your rights under the Data Privacy Act of 2012.",
};

export default async function PrivacyPage() {
  const support = await getSupportEmail();

  const sections = [
    {
      id: "intro",
      title: "What this notice covers",
      content: (
        <>
          <p>
            This notice explains what personal information Internova collects when schools, school heads, coordinators, company supervisors and interns use it,
            why we collect it, who can see it, and what your rights are under the Data Privacy Act of 2012 (Republic Act No. 10173).
          </p>
          <p>
            It goes together with the <Link href="/terms" className="font-semibold text-blue-700 hover:underline">Terms and Conditions</Link>.
          </p>
        </>
      ),
    },
    {
      id: "roles",
      title: "Who is responsible for your data",
      content: (
        <>
          <Bullets
            items={[
              <><strong>Your school</strong> is the personal information controller for its interns, coordinators and supervisors: it decides what is collected and why, for its internship program.</>,
              <><strong>Internova</strong> is the personal information processor: it stores and handles the data for the school, only to run the service, and keeps it secure.</>,
              <>For the person who registers a school (the Dean, Principal or School Head) and for billing, Internova is the controller of the registration and payment details.</>,
            ]}
          />
        </>
      ),
    },
    {
      id: "collect",
      title: "What we collect",
      content: (
        <>
          <Bullets
            items={[
              <><strong>Account details:</strong> name, email address, phone number, role, school, profile photo (optional) and your password, which is stored only in a scrambled (hashed) form.</>,
              <><strong>Intern record:</strong> student number, course or program, assigned company and supervisor, internship dates and required hours.</>,
              <><strong>Attendance:</strong> the date and time you clock in and out, a selfie taken at that moment, your GPS position, how far it is from the company, and the place name for that position. To get the place name your coordinates are sent to OpenStreetMap (Nominatim) and BigDataCloud.</>,
              <><strong>Work records:</strong> activities and narrative entries, tasks, comments, proofs you upload (photos or files), documents, portfolio items, ratings and evaluations, and the narrative report built from them.</>,
              <><strong>Messages:</strong> chat messages and attachments, feedback threads and support tickets you send.</>,
              <><strong>School and payment details:</strong> school name, address, contact person, the plan, amounts, payment status and references, and bank proof of payment if you upload one. Card and e-wallet details are entered on PayMongo&apos;s page. Internova does not receive or store them.</>,
              <><strong>Technical data:</strong> when you sign in, notifications you received, activity logs of important actions, and your IP address and browser details, used for security and to limit abuse. Whether an email bounced is also recorded.</>,
            ]}
          />
          <p>
            We do not collect more than the internship program needs and we do not sell personal data.
          </p>
        </>
      ),
    },
    {
      id: "why",
      title: "Why we use it",
      content: (
        <Bullets
          items={[
            "To run the internship program: record hours and attendance, assign and review work, evaluate interns and produce the narrative report and certificates.",
            "To show the right people the right information, and to flag unusual attendance (for example odd hours or far from the company) for a supervisor to check.",
            "To send emails and notifications about your account: invitations, verification codes, password resets and reminders.",
            "To manage subscriptions and payments, give support, and keep the system secure and working.",
            "To help write narrative text with AI when the school is on the Premium plan.",
          ]}
        />
      ),
    },
    {
      id: "access",
      title: "Who can see your data",
      content: (
        <>
          <p>Access depends on role and school. Nobody can see another school&apos;s data.</p>
          <Bullets
            items={[
              <><strong>Interns</strong> see their own records.</>,
              <><strong>Company supervisors</strong> see the interns of their own company: attendance (including selfies and location), activities, tasks, documents and evaluations.</>,
              <><strong>Coordinators</strong> see the interns, companies and supervisors of their own school.</>,
              <><strong>The school head (Dean, Principal or School Head)</strong> sees monitoring summaries and records of their own school, and the billing details.</>,
              <><strong>The Internova team (Super Admin)</strong> can see school registrations, billing and support requests, and may access data when needed to give support or keep the system safe.</>,
              "Chat messages can be read by the people in that conversation.",
            ]}
          />
        </>
      ),
    },
    {
      id: "thirdparties",
      title: "Services we use",
      content: (
        <>
          <p>To run Internova we share only what each service needs:</p>
          <Bullets
            items={[
              <><strong>Railway:</strong> hosts the application, the database and uploaded files.</>,
              <><strong>Resend:</strong> sends our emails (invitations, codes, reminders).</>,
              <><strong>PayMongo:</strong> processes online payments for school subscriptions.</>,
              <><strong>Google Gemini:</strong> on Premium, an intern&apos;s daily log text, or the titles and descriptions of the tasks done that day, are sent to it to polish or draft the narrative.</>,
              <><strong>OpenStreetMap (Nominatim) and BigDataCloud:</strong> turn your GPS coordinates into a place name when you clock in or out.</>,
            ]}
          />
          <p>
            Some of these services are run outside the Philippines, so your data can be processed abroad. They have their own privacy policies. We may also
            disclose data if the law or a court requires it.
          </p>
        </>
      ),
    },
    {
      id: "keep",
      title: "How long we keep it",
      content: (
        <>
          <p>
            We keep personal data while the account and the school&apos;s subscription are active, because internship records are needed for grading,
            reports and the school&apos;s own records. When a school removes an intern, supervisor or company, or an account is closed, the related records are
            deleted or made unreachable in the system.
          </p>
          <p>
            If a school&apos;s subscription ends, its data is kept for up to 12 months so that it can renew or export what it needs. After that it is deleted,
            unless the law requires us to keep something longer (for example payment records for accounting). Sign-in tokens expire automatically.
          </p>
        </>
      ),
    },
    {
      id: "security",
      title: "How we protect it",
      content: (
        <Bullets
          items={[
            "Role- and school-based access checks on the server for every request.",
            "Passwords are hashed. Sessions expire, and an account can only be signed in on one device at a time (two for supervisors).",
            "Uploaded files are checked and served only to people allowed to see them. Connections use HTTPS.",
            "Limits on repeated sign-in and code attempts to stop guessing.",
            "No system is perfect. If there is a breach that puts your rights at risk we will notify the school and the people affected as the law requires.",
          ]}
        />
      ),
    },
    {
      id: "rights",
      title: "Your rights",
      content: (
        <>
          <p>Under the Data Privacy Act of 2012 you have the right to:</p>
          <Bullets
            items={[
              "be informed about how your data is used (this notice),",
              "access the personal data we hold about you,",
              "object to the processing of your data, or withdraw your consent where it is based on consent,",
              "correct wrong or out-of-date data,",
              "ask us to block or remove your data when it is no longer needed or was collected unlawfully (erasure),",
              "get a copy of your data in a usable format (data portability),",
              "claim compensation if you were harmed by misuse of your data, and",
              "complain to the National Privacy Commission (privacy.gov.ph).",
            ]}
          />
          <p>
            Some of these rights can be limited by law, or by the school&apos;s need to keep internship records. You can fix your name, phone and photo yourself in
            your account settings. For anything else, see the next section.
          </p>
        </>
      ),
    },
    {
      id: "requests",
      title: "How to make a request",
      content: (
        <>
          <p>
            To ask for access, correction, a copy or deletion of your data, or to ask a question or complain, email{" "}
            <a href={`mailto:${support}`} className="font-semibold text-blue-700 hover:underline">{support}</a>{" "}
            from the email address of your account, and tell us your name, your school and what you need. We will answer as soon as we can, normally within
            15 working days.
          </p>
          <p>
            Because your school is the controller of your internship records, we may need to check with your school or coordinator before changing or deleting them.
          </p>
        </>
      ),
    },
    {
      id: "children",
      title: "Minors",
      content: <p>Internova is meant for students in higher education and the people who run their internships. If an intern is under 18, the school must get the consent of a parent or guardian where the law requires it.</p>,
    },
    {
      id: "changes",
      title: "Changes to this notice",
      content: (
        <p>
          We may update this notice. The date and version at the top of the page show the latest one, and we will tell the school or ask you to agree again if
          the change is important.
        </p>
      ),
    },
  ];

  return (
    <LegalPage
      kind="privacy"
      title="Privacy Notice"
      sentence="What we collect, why, who sees it and what you can do about it."
      sections={sections}
    />
  );
}
