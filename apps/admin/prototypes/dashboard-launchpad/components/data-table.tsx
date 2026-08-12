import type { ReactNode } from "react";
import styles from "./data-table.module.css";

export interface DataTableColumn<Row> {
  header: string;
  /** Renders the cell. A function rather than a key name so a column can
   *  compose two fields or wrap one in an element, and so the row type is
   *  checked at the call site instead of cast to `ReactNode` here. */
  cell: (row: Row) => ReactNode;
  /** `end` for counts, times and money — the figures line up on their right
   *  edge. Text stays at the default `start`. */
  align?: "start" | "end";
}

export interface DataTableProps<Row> {
  title: string;
  columns: DataTableColumn<Row>[];
  data: Row[];
  viewAllHref?: string;
  /** Rows held back from `data`, shown as a "+N more" hint in the foot. The
   *  caller does the slicing: this component renders what it is handed and
   *  cannot know how many rows exist beyond them. */
  moreCount?: number;
}

/** The arrivals/departures list — a real `table`, because it is tabular data
 *  and a screen reader should be able to walk it by row and column.
 *
 *  `scope` on every header is what makes that work; without it the header
 *  association is guesswork. The title is a heading beside the optional
 *  "view all" link, not a `caption`, so the two sit on one line. */
export default function DataTable<Row>({
  title,
  columns,
  data,
  viewAllHref,
  moreCount,
}: DataTableProps<Row>) {
  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <h2 className={`${styles.title} caps-label`}>{title}</h2>
        {viewAllHref ? (
          <a className={`${styles.viewAll} caps-label`} href={viewAllHref}>
            View all
          </a>
        ) : null}
      </header>

      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={`${styles.th} caps-label`}
                  data-align={column.align ?? "start"}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Index keys: these rows are display-only and hold no input
                state, so there is nothing for a shifting key to strand. */}
            {data.map((row, rowIndex) => (
              <tr className={styles.row} key={rowIndex}>
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={styles.td}
                    data-align={column.align ?? "start"}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {moreCount && moreCount > 0 ? (
            <tfoot>
              <tr>
                <td className={styles.more} colSpan={columns.length}>
                  +{moreCount} more
                </td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}
