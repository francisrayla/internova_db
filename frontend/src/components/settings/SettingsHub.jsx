import NavIcon from "@/components/NavIcon";
import { DataList, DataRow, Page, PageHeader, Section } from "@/components/dash/page";

/**
 * The single "Settings" page of a role: a short list of rows per group, each
 * opening its own screen. Role pages pass their own groups (see RoleSettingsHub).
 */
export default function SettingsHub({ title = "Settings", intro, groups }) {
  return (
    <Page className="max-w-4xl">
      <PageHeader title={title} sentence={intro} />

      {groups.map((group) => (
        <Section key={group.heading} title={group.heading} flush>
          <DataList>
            {group.items.map((item) => (
              <DataRow
                key={item.href}
                href={item.href}
                wrap
                lead={<span className="shrink-0 text-slate-500"><NavIcon name={item.icon} size={20} /></span>}
                title={item.title}
                sub={item.description}
                side={<span className="text-slate-400"><NavIcon name="arrow" size={16} /></span>}
              />
            ))}
          </DataList>
        </Section>
      ))}
    </Page>
  );
}
