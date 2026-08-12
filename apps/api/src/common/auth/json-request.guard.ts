// What keeps a cross-site form off a route the browser authorises by itself.
//
// A route whose credential is a cookie is a route any page can make the browser
// call. The staff refresh cookie is `sameSite: none` in production because the
// console is served from a different site than this API, and that attribute is
// exactly the one that used to prevent this: a `lax` cookie is not sent
// cross-site at all. Giving it up to make the console work gives up the
// protection with it.
//
// A cross-site `<form>` can post three content types — urlencoded, multipart,
// plain text — and none of them is JSON. Requiring JSON means the only way to
// reach the route is `fetch` with a header, which is not a simple request,
// which means a preflight, which the origin allowlist in `main.ts` answers with
// a refusal. So a page an operator merely visits cannot revoke their session or
// rotate their token behind their back.
//
// A guard rather than a check inside the handler, and that is not a style
// choice: guards run before pipes. A handler-body check on a route with a
// validated body never runs, because the validation pipe has already rejected
// the unparsed body with a 400 — a refusal by accident of body parsing rather
// than by decision, and one that would go away the day the body became
// optional.

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class JsonRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const declared = request.headers["content-type"] ?? "";

    // The parameters after the first `;` are the charset and the multipart
    // boundary. Neither changes what the body is.
    const mediaType = declared.split(";")[0]?.trim().toLowerCase() ?? "";

    if (!mediaType.endsWith("/json") && !mediaType.endsWith("+json")) {
      throw new UnauthorizedException("This route accepts application/json only");
    }

    return true;
  }
}
