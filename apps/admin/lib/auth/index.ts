/* The staff session, in one import site.
 *
 * A screen needs three things from this folder: `useStaffSession` to know who
 * is signed in, `api` to call the contract, and `withStaffSession` to wrap that
 * call so a token about to expire is replaced before the request leaves.
 *
 * `staffSession` itself is exported for the two callers outside the shell — the
 * login screen and the index route — that act on the session rather than read
 * it. A screen inside `(app)` should use the hook: the store's state changes
 * do not re-render anything on their own.
 */

export {
  DEFAULT_LANDING,
  LANDING_BY_ROLE,
  landingRouteFor,
  LOGIN_ROUTE,
  loginHref,
  RETURN_PARAM,
  safeReturnPath,
} from "./landing-route";
export { SessionCommands } from "./session-commands";
export { SessionGuard } from "./session-guard";
export {
  StaffSessionProvider,
  useSessionState,
  useStaffSession,
} from "./session-provider";
export {
  api,
  isUnauthorized,
  staffSession,
  withStaffSession,
} from "./staff-session";
export {
  CREDENTIALS_REFUSED,
  SIGN_IN_UNREACHABLE,
  type StaffSessionState,
  type StaffSignInOutcome,
} from "./staff-session-store";
