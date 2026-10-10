import NavIcon from "@/components/NavIcon";
import { Pill } from "@/components/ui";

/**
 * Honest placeholder for a nav-linked screen that isn't built yet — used
 * instead of fabricating data or copy that implies a working feature.
 */
export default function ComingSoon({ icon = "calendar", title, description }) {
  return (
    <div className="k-empty">
      <span className="k-empty-icon">
        <NavIcon name={icon} size={20} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      <div className="k-empty-action">
        <Pill tone="amber">Not built yet</Pill>
      </div>
    </div>
  );
}
