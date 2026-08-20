// The contract root: one definition the API implements and the client calls, so
// a route that changes shape breaks both sides at compile time instead of at
// runtime in whichever one was deployed second.
//
// Domain contracts join here as their modules are built — inventory and pricing
// at M3, booking, housekeeping and guest at M4. Nothing is listed
// speculatively; an entry with no implementation is a promise the type system
// will hold the client to and nobody can keep.

import { availability } from "./availability.js";
import { booking } from "./booking.js";
import { businessDate } from "./business-date.js";
import { feedback } from "./feedback.js";
import { folio } from "./folio.js";
import { guest } from "./guest.js";
import { health } from "./health.js";
import { housekeeping } from "./housekeeping.js";
import { inventory } from "./inventory.js";
import { jobs } from "./jobs.js";
import { operations } from "./operations.js";
import { payment } from "./payment.js";
import { pricing } from "./pricing.js";
import { search } from "./search.js";
import { service } from "./service.js";
import { systemConfig } from "./system-config.js";

export const contract = {
  health,
  availability,
  inventory,
  pricing,
  booking,
  housekeeping,
  guest,
  folio,
  service,
  payment,
  jobs,
  search,
  systemConfig,
  businessDate,
  feedback,
  operations,
};

export type Contract = typeof contract;

// The request and response shapes themselves, so a service can name what it is
// handed without inferring it back out of the router object.
export { rateCalendarQuery, stayOfferQuery } from "./availability.js";
export {
  assignRoomInput,
  bookingSchema,
  cancelInput,
  changeDepartureInput,
  changeRoomTypeInput,
  checkInGuestSchema,
  checkInInput,
  createBookingInput,
  extendedStaySchema,
  ownBookingInput,
  policyChargeSchema,
  reinstateInput,
  roomAssignmentSchema,
  roomTypeChangeSchema,
  shortenedStaySchema,
} from "./booking.js";
export { businessDateSchema } from "./business-date.js";
export {
  feedbackRatingSchema,
  feedbackSchema,
  HIGHEST_RATING,
  LONGEST_FEEDBACK_COMMENT,
  submitFeedbackInput,
} from "./feedback.js";
export {
  closeFolioInput,
  FOLIO_PAGE_SIZE,
  folioPageSchema,
  folioPostingReceiptSchema,
  folioPostingSchema,
  folioSchema,
  folioStateSchema,
  folioSummarySchema,
  listedFolioSchema,
  listFoliosInput,
  LONGEST_FOLIO_PAGE,
  postChargeInput,
  postingTypeSchema,
  postOverrideRefundInput,
  postPaymentInput,
  postPolicyRefundInput,
  postServiceItemInput,
  readFolioInput,
  reversePostingInput,
} from "./folio.js";
export {
  cccdRevealSchema,
  guestProfileSchema,
  guestRecordSchema,
  transcribeDocumentInput,
  unmaskCccdInput,
  updateProfileInput,
  vipTierSchema,
} from "./guest.js";
export {
  boardRoomSchema,
  housekeepingBoardQuery,
  housekeepingBoardSchema,
  roomConditionSchema,
  roomReadinessSchema,
  setConditionInput,
  setOutOfOrderInput,
} from "./housekeeping.js";
export { closeRoomInput, roomClosureSchema } from "./inventory.js";
export { jobRunSchema, triggerJobInput } from "./jobs.js";
export {
  closeShiftInput,
  listPendingItemsInput,
  listShiftHistoryInput,
  LONGEST_HANDOVER_NOTE,
  LONGEST_PENDING_ITEM,
  LONGEST_PENDING_ITEM_PAGE,
  LONGEST_SHIFT_PAGE,
  openShiftInput,
  PENDING_ITEM_PAGE_SIZE,
  pendingItemPageSchema,
  pendingItemSchema,
  raisePendingItemInput,
  resolvePendingItemInput,
  SHIFT_PAGE_SIZE,
  shiftPageSchema,
  shiftSchema,
} from "./operations.js";
export {
  listedPaymentSchema,
  listPaymentsInput,
  LONGEST_PAYMENT_PAGE,
  openedPaymentSchema,
  openPaymentAttemptInput,
  PAYMENT_PAGE_SIZE,
  paymentDiscrepancyKindSchema,
  paymentMethodSchema,
  paymentPageSchema,
  paymentStatusSchema,
} from "./payment.js";
export {
  isUnrestricted,
  pricingRangeQuery,
  ratePlanSchema,
  setRateCalendarInput,
  setStayRestrictionsInput,
  stayRestrictionSchema,
  updateRatePlanInput,
} from "./pricing.js";
export {
  bookingHitSchema,
  guestHitSchema,
  operationalSearchQuery,
  SEARCH_RESULT_LIMIT,
  searchResultsSchema,
} from "./search.js";
export { serviceCatalogItemSchema } from "./service.js";
export type { ServiceCatalogItem } from "./service.js";
export {
  systemConfigurationSchema,
  updateSystemConfigInput,
} from "./system-config.js";
