/* The property's own cash book, in one import site.
 *
 * One surface comes out of this family and it is a screen: `screens.md` gives
 * Finance a family of its own — "record categorised income and expense" — where
 * shifts deliberately never own a screen visit. So there is no bar and no
 * provider here, and the one act the family offers under ⌘K is registered by
 * {@link FinanceScreen} itself, which is how `app/(app)/layout.tsx` says a
 * screen declares what it offers.
 *
 * Worth knowing before reaching for it: every module here except `cash-book.ts`
 * is a client component, and a barrel is resolved as a whole. Anything wanting
 * only the pure module — the category labels, the matrix predicate — reaches
 * `./cash-book` by its own path.
 */

export {
  type BookAttempt,
  type BookFields,
  bookQuestion,
  byMethod,
  type CashBookEntry,
  type CashBookPage,
  type CashBookQuery,
  CATEGORY_LABELS,
  categoriesFor,
  DEFAULT_BOOK_FIELDS,
  DEFAULT_ENTRY_FIELDS,
  DIRECTION_LABELS,
  type EntryFields,
  entryAttempt,
  mayKeepTheBook,
  METHOD_LABELS,
  netOfTheBook,
  type OpenDrawer,
  onSide,
  openDrawersIn,
  type RecordEntry,
  type ReversalFields,
  type ReverseEntry,
  reversalAttempt,
  theOnlyOpenDrawer,
} from "./cash-book";
export { CorrectEntryForm, RecordEntryForm } from "./entry-forms";
export { FinanceScreen } from "./finance-screen";
export {
  useCashBook,
  useRecordCashBookEntry,
  useReverseCashBookEntry,
} from "./finance-queries";
