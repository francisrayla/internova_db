import SettingsHub from "./SettingsHub";

// What each role finds under Settings: only things that have no other place in the app.
// Anything already in the sidebar (billing, plans, grading criteria, ...) or the header
// (the light/dark toggle) is not repeated here.
const ACCOUNT = (role) => ({ href: `/${role}/settings/account`, icon: "user", title: "Account and password", description: "Change your password and see how you sign in." });

const HUBS = {
  superadmin: {
    intro: "Platform-wide settings and your own account.",
    groups: [
      { heading: "Platform", items: [{ href: "/superadmin/settings/system", icon: "gear", title: "System", description: "System name, support email and maintenance mode." }] },
      { heading: "Personal", items: [ACCOUNT("superadmin")] },
    ],
  },
  dean: {
    intro: "Your school's details and your account.",
    groups: [
      { heading: "School", items: [{ href: "/dean/settings/school", icon: "building", title: "School information", description: "Name, address and contact details. Your coordinator can see them but not edit them." }] },
      {
        heading: "Personal",
        items: [
          { href: "/dean/settings/notifications", icon: "bell", title: "Email notifications", description: "Turn the Monday weekly summary email on or off." },
          ACCOUNT("dean"),
        ],
      },
    ],
  },
  coordinator: {
    intro: "How your school's reports are set up, and your account.",
    groups: [
      {
        heading: "School program",
        items: [
          { href: "/coordinator/settings/school", icon: "building", title: "School information", description: "Your school's details. Only your school head can change them." },
          { href: "/coordinator/settings/narrative", icon: "file", title: "Narrative report layout", description: "Letterhead, cover page and the sections of every intern's report." },
          { href: "/coordinator/settings/requirements", icon: "list", title: "Requirements per course", description: "Choose which documents the interns of each course must submit." },
        ],
      },
      { heading: "Personal", items: [ACCOUNT("coordinator")] },
    ],
  },
  supervisor: {
    intro: "How attendance works for your company, and your account.",
    groups: [
      {
        heading: "Company",
        items: [
          { href: "/supervisor/settings/attendance", icon: "calendar", title: "Attendance format", description: "One time in and out a day, or morning and afternoon (4 entries). Applies to every intern and supervisor of your company." },
        ],
      },
      { heading: "Personal", items: [ACCOUNT("supervisor")] },
    ],
  },
  intern: {
    intro: "Your account.",
    groups: [{ heading: "Personal", items: [ACCOUNT("intern")] }],
  },
};

export default function RoleSettingsHub({ role }) {
  const hub = HUBS[role];
  return <SettingsHub intro={hub.intro} groups={hub.groups} />;
}
