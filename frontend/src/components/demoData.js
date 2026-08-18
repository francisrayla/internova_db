export const roles = {
  admin: { label: "Admin", name: "Alyssa Cruz", initials: "AC", subtitle: "System administration" },
  coordinator: { label: "OJT Coordinator", name: "Mia Santos", initials: "MS", subtitle: "Internship operations" },
  supervisor: { label: "Supervisor", name: "Mia Santos", initials: "MS", subtitle: "Company workspace" },
  intern: { label: "Intern", name: "Francis Rayla", initials: "FR", subtitle: "Student workspace" },
};

export const tasks = [
  { id: 1, title: "Attendance module QA", label: "Development", due: "Today", priority: "High", owner: "FR", status: "ongoing", subtasks: 3, doneSubtasks: 2, files: 2, comments: 3 },
  { id: 2, title: "Prepare weekly reflection", label: "Documentation", due: "Tomorrow", priority: "Medium", owner: "FR", status: "pending", subtasks: 0, doneSubtasks: 0, files: 1, comments: 1 },
  { id: 3, title: "Update company handbook", label: "Content", due: "Aug 12", priority: "Low", owner: "JM", status: "done", subtasks: 4, doneSubtasks: 4, files: 3, comments: 5 },
  { id: 4, title: "Test GPS verification", label: "Quality check", due: "Aug 14", priority: "High", owner: "FR", status: "pending", subtasks: 2, doneSubtasks: 0, files: 0, comments: 0 },
  { id: 5, title: "Portfolio case study", label: "AI assisted", due: "Aug 16", priority: "Medium", owner: "FR", status: "ongoing", subtasks: 5, doneSubtasks: 3, files: 2, comments: 4 },
];

export const interns = [
  { name: "Francis Rayla", initials: "FR", company: "Northstar Digital", progress: 72, attendance: "96%", status: "On track" },
  { name: "Janelle Mercado", initials: "JM", company: "Northstar Digital", progress: 84, attendance: "98%", status: "On track" },
  { name: "Paolo Garcia", initials: "PG", company: "Brightline Labs", progress: 61, attendance: "89%", status: "Needs review" },
  { name: "Clarisse Uy", initials: "CU", company: "Brightline Labs", progress: 77, attendance: "94%", status: "On track" },
];

export const activityFeed = [
  { text: "Janelle completed Update company handbook", time: "8 min ago", tone: "green" },
  { text: "Francis submitted a daily activity", time: "24 min ago", tone: "blue" },
  { text: "Paolo has a late attendance record", time: "1 hr ago", tone: "coral" },
];
