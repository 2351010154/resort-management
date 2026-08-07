"use client";

// "Letters from Mariva" — decorative newsletter line. No backend (concept
// piece): submitting swaps the row for one quiet confirmation, "Expected." —
// the same voice as Act 2's "You have been expected."

import { useState } from "react";
import styles from "./act-6-turndown.module.css";

export function LettersFromMariva() {
  const [sent, setSent] = useState(false);

  return (
    <form
      className={styles.letters}
      onSubmit={(e) => {
        e.preventDefault();
        setSent(true);
      }}
    >
      <label
        className={`caps-label ${styles.lettersLabel}`}
        htmlFor="letters-email"
      >
        Letters from Mariva
      </label>
      <p className={styles.lettersNote}>
        Seasons, suites, and the occasional quiet invitation.
      </p>
      <div className={styles.lettersRow} data-sent={sent}>
        <input
          id="letters-email"
          name="email"
          type="email"
          required
          placeholder="Your address"
          autoComplete="email"
          disabled={sent}
        />
        <button type="submit" aria-label="Send my address" disabled={sent}>
          <span aria-hidden>&#8594;</span>
        </button>
      </div>
      <p className={styles.confirmation} role="status" aria-live="polite">
        {sent ? "Expected." : ""}
      </p>
    </form>
  );
}
