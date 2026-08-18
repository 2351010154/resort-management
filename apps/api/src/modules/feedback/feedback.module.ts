import { Module } from "@nestjs/common";
import { BookingModule } from "../booking/booking.module.js";
import { FeedbackController } from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";

// A guest's word on a finished stay — docs/architecture/repository-structure.md
// §apps/api.
//
// `BookingModule` is imported because the ownership question this module has to
// answer is already answered there, in SQL, by `BookingService.ownBooking`: the
// account is half of the `where` clause rather than a comparison made after the
// row arrives. Importing the module that owns that rule is what keeps this one
// from writing a second version of it — and a second version is exactly the kind
// that hands a stranger's stay to whoever guessed eight characters.
//
// It is a one-way edge. `BookingModule` knows nothing about feedback: a stay's
// transitions do not consult it, nothing about checking out writes one, and a
// guest who never says anything leaves a complete booking behind. So there is no
// cycle to break and nothing here to export — every caller of this service
// arrives through the two routes above it.
//
// `DatabaseModule` is global, so nothing is imported here for the transaction
// the controller opens or for the executor the service is handed — which it
// takes as an argument and never opens itself.
@Module({
  imports: [BookingModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
