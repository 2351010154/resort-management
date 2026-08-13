// The booking-scoped credential, on its own so that both of its readers can
// have it without either importing the other.
//
// `AuthModule` needs it because `access.guard.ts` resolves the third realm;
// `BookingModule` needs it because `booking.controller.ts` issues the cookie at
// the moment the hold is taken. A module this small exists so that the booking
// module does not import the whole of the auth surface — its two realms, their
// controllers and the global guard — to reach one service.

import { Module } from "@nestjs/common";
import { BookingTokenService } from "./booking-token.service.js";

@Module({
  providers: [BookingTokenService],
  exports: [BookingTokenService],
})
export class BookingTokenModule {}
