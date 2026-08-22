// The contract root: one definition the API implements and the client calls, so
// a route that changes shape breaks both sides at compile time instead of at
// runtime in whichever one was deployed second.
//
// Domain contracts join here as their modules are built — inventory and pricing
// at M3, booking, housekeeping and guest at M4. Nothing is listed
// speculatively; an entry with no implementation is a promise the type system
// will hold the client to and nobody can keep.

import { audit } from "./audit.js";
import { availability } from "./availability.js";
import { booking } from "./booking.js";
import { businessDate } from "./business-date.js";
import { feedback } from "./feedback.js";
import { finance } from "./finance.js";
import { folio } from "./folio.js";
import { guest } from "./guest.js";
import { health } from "./health.js";
import { housekeeping } from "./housekeeping.js";
import { inventory } from "./inventory.js";
import { jobs } from "./jobs.js";
import { operations } from "./operations.js";
import { payment } from "./payment.js";
import { pricing } from "./pricing.js";
import { reporting } from "./reporting.js";
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
  finance,
  audit,
  reporting,
};

export type Contract = typeof contract;

// The request and response shapes themselves, so a service can name what it is
// handed without inferring it back out of the router object.
export {
  AUDIT_PAGE_SIZE,
  auditActionSchema,
  auditActorKindSchema,
  auditEntryDetailSchema,
  auditEntryPageSchema,
  auditEntrySchema,
  auditFieldSchema,
  auditScopeSchema,
  LONGEST_AUDIT_PAGE,
  LONGEST_TABLE_NAME,
  listAuditEntriesInput,
  readAuditEntryInput,
} from "./audit.js";
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
export type {
  CashBookCategory,
  CashBookDirection,
  CashBookMethod,
} from "./finance.js";
export {
  CASH_BOOK_CATEGORIES,
  CASH_BOOK_PAGE_SIZE,
  cashBookCategorySchema,
  cashBookDirectionSchema,
  cashBookEntrySchema,
  cashBookMethodSchema,
  cashBookPageSchema,
  categorySuitsDirection,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  LONGEST_CASH_BOOK_NOTE,
  LONGEST_CASH_BOOK_PAGE,
  listCashBookEntriesInput,
  recordCashBookEntryInput,
  reverseCashBookEntryInput,
} from "./finance.js";
export {
  closeFolioInput,
  FOLIO_PAGE_SIZE,
  folioPageSchema,
  folioPostingReceiptSchema,
  folioPostingSchema,
  folioSchema,
  folioStateSchema,
  folioSummarySchema,
  LONGEST_FOLIO_PAGE,
  listedFolioSchema,
  listFoliosInput,
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
  LONGEST_HANDOVER_NOTE,
  LONGEST_PENDING_ITEM,
  LONGEST_PENDING_ITEM_PAGE,
  LONGEST_SHIFT_PAGE,
  listPendingItemsInput,
  listShiftHistoryInput,
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
  LONGEST_PAYMENT_PAGE,
  listedPaymentSchema,
  listPaymentsInput,
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
export type { RevenueBucket } from "./reporting.js";
// The Reports family. `reporting` is in `contract` above because `FR-RPT-02`'s
// two reads and `FR-RPT-03`'s KPI read are ordinary oRPC procedures; the six
// Excel exports below are named exports and nothing more, because `reporting.ts`
// opens by saying why a response measured in chunks of zip cannot be a
// procedure, and an entry in that object would be a promise `@Implement` could
// not keep.
export {
  CASH_BOOK_EXPORT_PATH,
  CASH_BOOK_EXPORT_STEM,
  CHANGE_LOG_EXPORT_PATH,
  CHANGE_LOG_EXPORT_STEM,
  cashBookExportInput,
  changeLogExportInput,
  EXCEL_MEDIA_TYPE,
  excelExportFileName,
  PERFORMANCE_REPORT_EXPORT_PATH,
  PERFORMANCE_REPORT_EXPORT_STEM,
  performanceBucketRowSchema,
  performanceFiguresSchema,
  performanceReportQuery,
  performanceReportSchema,
  performanceTotalsSchema,
  performanceTypeRowSchema,
  REVENUE_BUCKETS,
  REVENUE_REPORT_EXPORT_PATH,
  REVENUE_REPORT_EXPORT_STEM,
  ROOM_STATUS_REPORT_EXPORT_PATH,
  ROOM_STATUS_REPORT_EXPORT_STEM,
  revenueBucketRowSchema,
  revenueBucketSchema,
  revenueReportQuery,
  revenueReportSchema,
  revenueTotalsSchema,
  roomStatusCountSchema,
  roomStatusReportQuery,
  roomStatusReportSchema,
  roomStatusTypeSchema,
  SHIFT_HISTORY_EXPORT_PATH,
  SHIFT_HISTORY_EXPORT_STEM,
  shiftHistoryExportInput,
} from "./reporting.js";
export {
  bookingHitSchema,
  guestHitSchema,
  operationalSearchQuery,
  SEARCH_RESULT_LIMIT,
  searchResultsSchema,
} from "./search.js";
export type { ServiceCatalogItem } from "./service.js";
export { serviceCatalogItemSchema } from "./service.js";
export {
  systemConfigurationSchema,
  updateSystemConfigInput,
} from "./system-config.js";
