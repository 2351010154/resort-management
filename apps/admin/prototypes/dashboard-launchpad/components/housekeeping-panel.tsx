import styles from "./housekeeping-panel.module.css";

export interface HousekeepingItem {
  number: number;
  label: string;
}

export interface HousekeepingPanelProps {
  items: HousekeepingItem[];
}

/** Room states at a glance — clean, occupied, out of order.
 *
 *  A description list, not a `ul`: each row is a term and its count, and `dl`
 *  is the one list kind that says the two belong together. The count is read
 *  first by eye and so is written first in the DOM; `dt` before `dd` keeps the
 *  pairing valid, and the visual order is the panel's, set in CSS. */
export default function HousekeepingPanel({ items }: HousekeepingPanelProps) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div className={styles.row} key={item.label}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={`${styles.figure} font-display`}>{item.number}</dd>
        </div>
      ))}
    </dl>
  );
}
