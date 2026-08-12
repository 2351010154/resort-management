import type { ReactNode } from "react";
import styles from "./concierge-tool-button.module.css";

export interface ConciergeToolButtonProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/** A tool in the concierge tray — start a booking, log a request.
 *
 *  `type="button"` because these sit inside forms often enough that the
 *  default `submit` would eventually post one by accident. The icon is
 *  decorative and the visible label is the accessible name, so no
 *  `aria-label`: adding one would override the text the operator can see. */
export default function ConciergeToolButton({
  icon,
  label,
  onClick,
}: ConciergeToolButtonProps) {
  return (
    <button type="button" className={styles.button} onClick={onClick}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={`${styles.label} caps-label`}>{label}</span>
    </button>
  );
}
