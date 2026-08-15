// The other half of `unknown-error.ts`: the throws that do reach Nest.
//
// An oRPC handler's error never gets here — `unknown-error.ts` explains why at
// length — but plenty of the application is not inside one when it fails. A
// guard, a pipe or a middleware runs before `ImplementInterceptor` is ever
// entered, and `job-trigger.controller.ts` and the webhook routes are ordinary
// Nest handlers. Those throw into Nest's exception layer, where until now the
// only trace of a defect was pino-http's completed-request line saying 500 with
// no reason attached.
//
// It extends `BaseExceptionFilter` and delegates: `super.catch` *is* the
// behaviour Nest has when no filter is registered at all, so the status, the
// body and the headers a client sees are the ones it saw before this file
// existed. Writing a response here instead would have made a logging change
// into a contract change, which is the one thing it must not be.

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Injectable,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { PinoLogger } from "nestjs-pino";
import { logUnknownError } from "./unknown-error.js";

// `@Catch()` with no argument is every exception, deliberately. A filter listing
// types would be a list somebody has to extend, and the errors worth finding are
// the ones nobody predicted.
@Injectable()
@Catch()
export class UnknownErrorFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  constructor(private readonly logger: PinoLogger) {
    // No adapter argument. `BaseExceptionFilter` has an optional injected
    // `httpAdapterHost` and reads the adapter off it at the moment it replies;
    // passing one in here would read it at construction instead, which in a
    // testing module is before an adapter exists at all.
    super();
  }

  // Nest's own default already logs an exception that is not an `HttpException`
  // — `BaseExceptionFilter.handleUnknownError` does it on the way past — so for
  // that case this adds the `err` serializer's structured stack beside Nest's
  // plain line. The case it rescues outright is an `HttpException` of 500 or
  // above: `InternalServerErrorException` from a guard or a webhook route is
  // answered and never written down by anything.
  catch(exception: unknown, host: ArgumentsHost): void {
    logUnknownError(this.logger, exception);

    super.catch(exception, host);
  }
}
