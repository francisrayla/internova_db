import {
  Award,
  BriefcaseBusiness,
  Building2,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  GraduationCap,
  History,
  Inbox,
  Landmark,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MapPin,
  MessageSquareText,
  MessagesSquare,
  NotebookPen,
  School,
  Settings,
  Smartphone,
  Sparkles,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

// One place that maps a short name to a drawing, so sidebars, feature cards and payment buttons
// stay consistent and a different icon is a one-word change.
const ICONS = {
  dashboard: LayoutDashboard,
  interns: Users,
  attendance: Clock,
  activities: NotebookPen,
  tasks: ListChecks,
  evaluations: ClipboardCheck,
  documents: FileText,
  files: FolderOpen,
  portfolio: BriefcaseBusiness,
  certificates: Award,
  companies: Building2,
  supervisors: UserCog,
  coordinator: UserCog,
  reports: ChartColumn,
  feedback: MessageSquareText,
  settings: Settings,
  billing: CreditCard,
  schools: School,
  inquiries: Inbox,
  plans: Layers,
  ai: Sparkles,
  support: LifeBuoy,
  activity: History,
  // landing page
  location: MapPin,
  checklist: ClipboardList,
  graduation: GraduationCap,
  chat: MessagesSquare,
  // payment methods
  gcash: Smartphone,
  maya: Wallet,
  card: CreditCard,
  bank: Landmark,
};

export default function NavIcon({ name, size = 18, className }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return <Glyph aria-hidden="true" size={size} strokeWidth={1.8} className={className} />;
}
