/* Taking a screen's list away as a spreadsheet — the console's half of
 * `FR-OPS-03`.
 *
 * Three screens offer the act and one module performs it, for the same reason
 * the API has one writer behind three routes: the interesting parts — carrying
 * the filters that are on screen, presenting the session on a request the oRPC
 * client cannot make, naming the file, saying that something is happening — are
 * identical on all three, and the first of them to be written twice would be
 * the one that drifts.
 *
 * **A bare `fetch` rather than `@mariva/api-client`, and it is not a shortcut.**
 * The client is generated from the oRPC contract and every route on it answers
 * with JSON; these three answer with a zip written a chunk at a time, which is
 * the whole point of them. `lib/auth/staff-auth-requests.ts` steps outside the
 * client for its own reason and this is the second such case. What is not given
 * up is the agreement: the address, the file name and the media type come from
 * `@mariva/shared`, so the two ends still cannot drift about where an export
 * lives or what it is called.
 *
 * **The session is kept underneath it exactly as the client's calls are.**
 * `withStaffSession` replaces a token inside its expiry margin before the
 * request leaves and retries once behind a fresh one — an export is the longest
 * request the console makes, so it is the likeliest to be sent on a token about
 * to expire, and the refusal below carries its status so that retry can see a
 * 401.
 *
 * **The filters are the screen's own query object, handed over whole.** That is
 * the mechanism rather than a convention: {@link excelExportSearch} takes what
 * the screen already submitted and drops only the page from it, so a filter the
 * operator applied cannot fail to reach the file without also failing to reach
 * the list. A filter it cannot carry is thrown rather than skipped, because a
 * spreadsheet quietly wider than the screen is the failure this whole
 * arrangement exists to prevent.
 *
 * **The browser buffers the file and the server does not.** `response.blob()`
 * holds the workbook in the tab, which is the browser's own download buffer and
 * is what every download in every application does; the requirement's memory
 * profile is the API's, where a month of the change log must not become a
 * workbook in a Node process. The alternative on this side would be a plain link
 * the browser streams to disk — and a link carries no `Authorization` header, so
 * the bearer token would have to go in the url, into the history and into every
 * log between here and the API.
 */

"use client";

import { excelExportFileName, type StaffRole } from "@mariva/shared";
import { useMutation } from "@tanstack/react-query";

import { staffSession, withStaffSession } from "./auth/staff-session";
import { propertyMomentAt } from "./business-date";
import type { ConsoleMeta } from "./query-client";

// The same variable `lib/auth/staff-session.ts` and
// `lib/auth/staff-auth-requests.ts` read, and the same fallback: one name for
// the API's location across both front ends, so a deployment configures it once.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** What a list query carries that an export has no use for — an export answers
 *  with everything the filters match, so there is no page for these to name.
 *  The same two names `contract/reporting.ts` leaves out of its own shapes. */
const PAGING: readonly string[] = ["limit", "offset"];

/**
 * Who holds the matrix's *Excel export* row at all.
 *
 * Read literally, and it is deliberately not the whole answer. The row is
 * `RECEPTIONIST: ⚠`, `ACCOUNTANT: ✅`, `MANAGER: ✅`, `ADMIN: ✅` and names
 * nobody else, and the ⚠'s note — "operational lists only" — is not written
 * here in any form. A screen offers its export when this is true *and* its own
 * matrix predicate is: `mayKeepTheBook`, `mayReadDrawers`, `mayReadTheLog`. The
 * conjunction is what the note means, and it produces the right answer on each
 * screen without any of them holding a list of who may export what — which is
 * the same composition `reporting/export-authority.ts` makes on the API, and
 * that file argues at length why it is the only arrangement that cannot go
 * stale.
 *
 * Not a wall. The API's two capability checks are the wall; what this decides is
 * whether the console offers somebody a control that would answer 403.
 */
export function mayTakeAnExport(role: StaffRole): boolean {
  return (
    role === "RECEPTIONIST" ||
    role === "ACCOUNTANT" ||
    role === "MANAGER" ||
    role === "ADMIN"
  );
}

/** One of the three exports: where it answers, what its file is called, and
 *  what an operator is told when it does not arrive. */
export interface ExcelExportSubject {
  /** The path `@mariva/shared` declares for it, without a leading slash. */
  readonly path: string;
  /** The stem its file name is built from, also from `@mariva/shared`. */
  readonly stem: string;
  /** Named rather than generic, because "That could not be saved." tells the
   *  accountant nothing about which of three files did not arrive. */
  readonly failure: string;
}

/**
 * The act, with somewhere for a screen to read that it is running.
 *
 * A mutation and not a bare async function, so that the failure is reported the
 * way every other failure in this console is: `lib/query-client.ts` raises the
 * toast centrally off `meta.errorMessage`, and a screen that wrote its own
 * `catch` here would be the one place a refusal is worded differently. It is a
 * mutation rather than a query because it is an act somebody presses — nothing
 * about it should be cached, refetched on focus, or retried on its own.
 *
 * `isPending` is the progress affordance. An export of a quiet month is over
 * before anything could be drawn, and one of a year is not; the act disables in
 * place and says what it is doing, which is what `design-foundations.md` §5 asks
 * of an operational surface — feedback under 150 ms and no entrance animation.
 */
export function useExcelExport(subject: ExcelExportSubject) {
  return useMutation({
    mutationFn: (filters: object) => takeExcelExport(subject, filters),
    meta: { errorMessage: subject.failure } satisfies ConsoleMeta,
  });
}

/**
 * A screen's query as an export's query string.
 *
 * Everything the screen asked for, minus the page. Absent, null and empty
 * filters are dropped rather than sent as empty parameters, because the API's
 * shapes read an empty string as a value and would refuse it — an operator who
 * cleared a filter means every category, not the category named by nothing.
 *
 * A value that is neither text nor a number throws. All three screens' queries
 * are scalars and so are the shapes behind them, so this cannot fire today; it
 * is written as a throw rather than a skip because the only alternative to
 * refusing is a file holding rows the operator had filtered out of the screen
 * they pressed the button on.
 */
export function excelExportSearch(filters: object): string {
  const search = new URLSearchParams();

  for (const [name, value] of Object.entries(filters)) {
    if (PAGING.includes(name) || value === undefined || value === null) {
      continue;
    }

    if (typeof value === "number") {
      search.set(name, value.toString());
      continue;
    }

    if (typeof value !== "string") {
      throw new Error(
        `the ${name} filter is not something an export can carry, so this file would not be the list on screen`,
      );
    }

    if (value !== "") {
      search.set(name, value);
    }
  }

  return search.toString();
}

/** The API refusing, carrying the status so `withStaffSession` can see a 401 and
 *  `apiMessage` can prefer the handler's own sentence over a generic one. */
class ExportRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExportRefused";
  }
}

async function takeExcelExport(
  subject: ExcelExportSubject,
  filters: object,
): Promise<void> {
  const search = excelExportSearch(filters);
  const address =
    search === ""
      ? `${API_URL}/${subject.path}`
      : `${API_URL}/${subject.path}?${search}`;

  const file = await withStaffSession(async () => {
    const token = staffSession.token();

    const answer = await fetch(address, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    });

    if (!answer.ok) {
      throw await refusalFrom(answer);
    }

    return answer.blob();
  });

  // The day is the property's own calendar day and not the browser's, so two
  // operators in different places name the same export the same thing. It is the
  // calendar day rather than the business date deliberately: this stamps a file
  // with when somebody took it, which is a fact about a person at a desk rather
  // than about the property's books — the sheet inside carries the minute and
  // the filters.
  save(
    file,
    excelExportFileName(
      subject.stem,
      propertyMomentAt(new Date()).calendarDate,
    ),
  );
}

/**
 * What the API said about refusing, or a sentence for a refusal that said
 * nothing.
 *
 * The handler's own words are preferred, which is `lib/api.ts`'s rule for the
 * contract's routes applied to these three: a caller refused the cash-book
 * export is told they may not read the book, which is the fact they are
 * missing. A body that is not the JSON Nest writes — a proxy's HTML error page,
 * a connection cut mid-answer — falls back rather than putting markup in a
 * toast.
 */
async function refusalFrom(answer: Response): Promise<ExportRefused> {
  try {
    const body: unknown = await answer.json();
    const said =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message?: unknown }).message
        : undefined;

    if (typeof said === "string" && said.trim() !== "") {
      return new ExportRefused(answer.status, said);
    }
  } catch {
    // Nothing parseable came back. The status is still the answer.
  }

  return new ExportRefused(answer.status, "The export was refused.");
}

/**
 * Hands the file to the browser under the name the contract chose.
 *
 * An anchor rather than `window.open`, because a download named by
 * `Content-Disposition` is not available here: that header is not one CORS
 * exposes to page code, and the console reaches the API on another origin. So
 * the name is composed on both sides from the same function, and this is where
 * the console's copy of it lands.
 *
 * The anchor is in the document because Firefox will not follow one that is
 * not, and the object url is released on the next turn rather than immediately:
 * the click starts the download synchronously, but revoking in the same task
 * has been observed to race it, and an object url held for one tick costs
 * nothing.
 */
function save(file: Blob, name: string): void {
  const address = URL.createObjectURL(file);
  const anchor = document.createElement("a");

  anchor.href = address;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(address);
  }, 0);
}
