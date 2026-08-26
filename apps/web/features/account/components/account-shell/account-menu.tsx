"use client";

// The identity control at the right end of the account bar: an initial in a
// ring, and the two destinations plus the way out behind it.
//
// **It is a chip and not a name.** `funnel-nav.tsx` sets the guest's full name
// in the funnel's bar because that bar holds two things and has the width for
// it. This one already carries three destinations before it, and a name set
// beside them reads as a fourth — so the chip is the initial, and the name is
// inside the panel where it is the heading of the thing it names.
//
// **The session is read here rather than passed in.** `AccountShell` frames two
// screens and neither of them holds an identity the bar could borrow: the stays
// list never reads a profile, and the profile itself is still fetching one when
// the bar first paints. Better Auth's session is the smaller read and the one
// already used for exactly this — `guest-session.ts` exists for a navigation
// asking who is signed in.
//
// **Nothing is drawn until the read lands.** A ring with no letter in it, or a
// letter that changes once, is a bar that moves under a guest who is reading
// the screen below it. The chip holds its space and stays invisible instead.
//
// The panel is the platform's popover, on `funnel-nav.tsx`'s reasoning: the top
// layer, light dismiss and focus return are the browser's, and none of the
// three is worth re-implementing. It is dark on an ivory bar because that is
// the account panel's established treatment in this app, and a guest crossing
// from the funnel should meet the same object.

import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/features/auth/lib/guest-auth";
import {
  type GuestIdentity,
  readGuestSession,
} from "@/features/auth/lib/guest-session";
import { loginHref } from "@/features/auth/lib/sign-in";
import styles from "./account-shell.module.css";

/** `--space-1` in the root token set, used to place the top-layer popover. */
const PANEL_GAP_PX = 8;

export function AccountMenu({ returnTo }: { readonly returnTo: string }) {
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

  // A popover placed from the trigger's box has to close when that box moves,
  // because the top layer does not travel with the element it was measured
  // against.
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

  // Still reading. The ring keeps its width so the three links beside it do not
  // shift when the answer arrives.
  if (guest === undefined) {
    return <span aria-hidden="true" className={styles.chipPlaceholder} />;
  }

  // A browser with no session on an account screen is a browser that is about
  // to be sent to the login. The bar says so rather than drawing a ring with
  // nobody in it.
  if (guest === null) {
    return (
      <a className={`${styles.navLink} caps-label`} href={loginHref(returnTo)}>
        Sign in
      </a>
    );
  }

  return (
    <>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={`Your account, ${guest.name}`}
        className={styles.chip}
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
        {/* The letter is decorative twice over: the button is labelled above,
            and an initial read aloud is one character of a name the panel
            spells out in full. */}
        <span aria-hidden="true" className={`${styles.chipMark} caps-label`}>
          {initial(guest)}
        </span>
        <span aria-hidden="true" className={styles.chipCaret} />
      </button>

      <div
        className={styles.panel}
        id={panelId}
        onToggle={(event) =>
          setOpen(event.currentTarget.matches(":popover-open"))
        }
        popover="auto"
        ref={panelRef}
      >
        <p className={`${styles.panelTerm} caps-label`}>Signed in as</p>
        <p className={`${styles.panelName} font-display`}>{guest.name}</p>
        <p className={styles.panelEmail}>{guest.email}</p>

        <nav aria-label="Guest account" className={styles.panelLinks}>
          <a href="/account" onClick={() => panelRef.current?.hidePopover()}>
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
          className={styles.panelOut}
          disabled={leaving}
          onClick={() => void leave()}
          type="button"
        >
          {leaving ? "Signing out" : "Sign out"}
        </button>

        {error ? (
          <p className={styles.panelError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The one character the ring carries.
 *
 * Split by code point rather than by `charAt`, so a name beginning with an
 * astral character contributes a whole glyph instead of half a surrogate pair.
 * The address is the fallback because Better Auth allows a blank name and the
 * ring is not a place to print nothing.
 */
function initial(guest: GuestIdentity): string {
  const source = guest.name.trim() || guest.email.trim();

  return ([...source][0] ?? "").toUpperCase();
}
