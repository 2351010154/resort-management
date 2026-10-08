// The guest's standing as a place on the house's ladder, the points beside it
// and the month the account began — the work of the book's standing chapter.
//
// **The ladder states rungs, never thresholds.** Member, Silver and Gold are
// the three answers the derivation can give (`property-and-tariff.md` §7), so
// they are fixed and safe to draw. The stays and the revenue that reach each
// rung are not: they are `system_config` rows an admin retunes without a
// deploy, and a figure printed here would be a second authority for a number
// this screen cannot read. So the ladder shows where the guest stands and the
// chapter says how standing is worked out, and neither promises a distance to
// the next rung.
//
// **It promises nothing the product does not do.** The profile used to list
// three perks — late checkout, an upgrade, a welcome amenity — under "the desk
// honours these on arrival". §7 records all three as deferred and unbuilt, and
// `screens.md` holds this screen to stating the balance and "nothing more". What
// a tier does today is the member rate the funnel quotes a signed-in Silver or
// Gold guest, and that is the one benefit said here.

import styles from "./profile-screen.module.css";

const RUNGS = [
  { code: "MEMBER", name: "Member" },
  { code: "SILVER", name: "Silver" },
  { code: "GOLD", name: "Gold" },
] as const;

export function StandingLadder({
  tier,
  points,
  memberSince,
}: {
  /** The contract's code. */
  readonly tier: string;
  /** Already grouped for display. */
  readonly points: string;
  /** "September 2026", or nothing when the account's start cannot be read. */
  readonly memberSince: string | undefined;
}) {
  const reached = RUNGS.findIndex((rung) => rung.code === tier);

  return (
    <>
      <ol aria-label="Standing" className={styles.ladder}>
        {RUNGS.map((rung, index) => (
          <li
            aria-current={rung.code === tier ? "step" : undefined}
            className={styles.rung}
            data-code={rung.code}
            data-reached={index <= reached ? "" : undefined}
            key={rung.code}
          >
            <span aria-hidden="true" className={styles.rungMark} />
            <span className={`${styles.rungName} font-display`}>
              {rung.name}
            </span>
          </li>
        ))}
      </ol>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt className={`${styles.rowLabel} caps-label`}>Loyalty points</dt>
          <dd className={`${styles.rowValue} ${styles.figures} font-display`}>
            {points}
          </dd>
        </div>
        {memberSince ? (
          <div className={styles.row}>
            <dt className={`${styles.rowLabel} caps-label`}>Member since</dt>
            <dd className={`${styles.rowValue} font-display`}>{memberSince}</dd>
          </div>
        ) : null}
      </dl>

      <p className={styles.hint}>
        Points are added from a stay&rsquo;s room charge when its bill is
        closed. There is nothing to spend them on yet.
      </p>
    </>
  );
}
