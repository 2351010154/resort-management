// The funnel's own bar: the mark, and the guest's account door.
//
// The arrival's `ConciergeNav` cannot be reused and is not a candidate. It reads
// the act store, changes phase on scroll and crossfades a wordmark to a monogram
// — all three only mean something on a scrollytelling page, and the store it
// reads is in the same module graph as `three` / `gsap` / `lenis`. The whole
// reason `(booking)` is a separate route group is that none of that loads here
// (`repository-structure.md` §`(booking)`), so the funnel gets its own bar: one
// mark, one identity control and a hairline.
//
// **The wordmark is a CSS mask over `currentColor`, not an `<img>`.** Same
// technique the concierge bar uses, and it is the reason this file needs no
// image loading state: the mark is painted in the text colour it inherits, so it
// is correct on the first frame and correct if the ground ever changes.
//
// **Nothing here is decorative.** The comp this screen was drawn from carries a
// language selector and a currency selector. The site is one locale and the
// tariff is in đồng, so neither would answer anything. What is here instead is
// the mark, which goes back to the arrival, and the guest identity: sign-in for
// a stranger, account destinations for somebody carrying a session.

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/features/auth/lib/guest-auth";
import {
  type GuestIdentity,
  readGuestSession,
} from "@/features/auth/lib/guest-session";
import { loginHref } from "@/features/auth/lib/sign-in";
import styles from "./funnel-nav.module.css";

/** `--space-1` in the root token set, used to place the top-layer popover. */
const PANEL_GAP_PX = 8;

export function FunnelNav({ returnTo }: { readonly returnTo: string }) {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [guest, setGuest] = useState<GuestIdentity | null>();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;

    void readGuestSession().then((identity) => {
      if (live) {
        setGuest(identity);
      }
    });

    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = () => {
      panelRef.current?.hidePopover();
    };

    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  async function leave(): Promise<void> {
    if (leaving) {
      return;
    }

    setLeaving(true);
    setError(null);

    const outcome = await signOut();

    if (outcome.ok) {
      panelRef.current?.hidePopover();
      setGuest(null);
      setOpen(false);
      setLeaving(false);
      return;
    }

    setError(outcome.message);
    setLeaving(false);
  }

  return (
    // Two elements, because the bar does two things at two different widths: the
    // hairline is the full width of the column it sits in, and the type inside it
    // holds the same measure as the heading and the calendar below. One element
    // could not do both — a rule inset to the measure floats in the middle of the
    // page while the section is centred, and type flush to the column's edge stops
    // lining up with everything under it.
    <header className={styles.bar}>
      <div className={styles.inner}>
        {/* A plain anchor, not `next/link`. Leaving the funnel for the arrival is a
            document load either way — the arrival's bundle shares nothing with this
            one — and a prefetching link would pull that bundle in behind a guest who
            is still choosing dates. */}
        <a aria-label="Mariva — the arrival" className={styles.brand} href="/">
          <span className={styles.wordmark} />
        </a>

        {guest === undefined ? (
          <span
            aria-hidden="true"
            className={`${styles.link} ${styles.pending} caps-label`}
          >
            Account
          </span>
        ) : guest === null ? (
          <a className={`${styles.link} caps-label`} href={loginHref(returnTo)}>
            Sign in
          </a>
        ) : (
          <div className={styles.account}>
            <button
              aria-controls={panelId}
              aria-expanded={open}
              className={`${styles.trigger} caps-label`}
              onClick={() => {
                setError(null);

                const trigger = triggerRef.current;
                const panel = panelRef.current;

                if (trigger && panel) {
                  const bounds = trigger.getBoundingClientRect();

                  panel.style.setProperty(
                    "--account-panel-top",
                    `${bounds.bottom + PANEL_GAP_PX}px`,
                  );
                  panel.style.setProperty(
                    "--account-panel-right",
                    `${window.innerWidth - bounds.right}px`,
                  );
                }
              }}
              popoverTarget={panelId}
              ref={triggerRef}
              type="button"
            >
              <span className={styles.triggerName} title={guest.name}>
                {guest.name}
              </span>
              <span aria-hidden="true" className={styles.disclosure}>
                {open ? "−" : "+"}
              </span>
            </button>

            <div
              className={styles.accountPanel}
              id={panelId}
              onToggle={(event) =>
                setOpen(event.currentTarget.matches(":popover-open"))
              }
              popover="auto"
              ref={panelRef}
            >
              <p className={`${styles.accountTerm} caps-label`}>Signed in as</p>
              <p className={`${styles.accountName} font-display`}>
                {guest.name}
              </p>
              <p className={styles.accountEmail}>{guest.email}</p>

              <nav aria-label="Guest account" className={styles.accountLinks}>
                <a
                  href="/account"
                  onClick={() => panelRef.current?.hidePopover()}
                >
                  Profile
                </a>
                <a
                  href="/account/stays"
                  onClick={() => panelRef.current?.hidePopover()}
                >
                  Your stays
                </a>
              </nav>

              <button
                className={styles.signOut}
                disabled={leaving}
                onClick={() => void leave()}
                type="button"
              >
                {leaving ? "Signing out" : "Sign out"}
              </button>

              {error ? (
                <p className={styles.accountError} role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
