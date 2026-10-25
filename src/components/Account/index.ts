/**
 * The signed-in Guest's own components.
 *
 * Everything here is mounted only by a page behind `ProtectedRoute` (or by the
 * booking components those pages mount). Nothing in this folder is shared with
 * the public site, which is the point: the approved marketing pages keep the
 * surfaces they already have, and the Guest's pages get surfaces built for a
 * document about a real stay.
 *
 * The page is drawn as the Hacienda's guest book — one sheet, a brass-ruled date
 * margin, one entry per stay, the Guest's name on the flyleaf. Colour, radius
 * and type for that page live in the "guest book" block of `src/styles.css`
 * (the `ledger-*` tokens); a component here should not re-spell one of them.
 * The direction itself is argued in `docs/ACCOUNT.md`.
 *
 * Only what a page actually mounts is exported. `StatusTrack` and the helpers
 * that just these components share stay internal to the folder, so the barrel
 * cannot accumulate exports nobody renders.
 */
export { Flyleaf } from './Flyleaf'
export { LedgerTabs, type LedgerTab } from './LedgerTabs'
export { StayEntry } from './StayEntry'
export { StayMasthead } from './StayMasthead'
export { accommodationName, bookingReference, daysUntil, staySpan } from './stayFacts'
