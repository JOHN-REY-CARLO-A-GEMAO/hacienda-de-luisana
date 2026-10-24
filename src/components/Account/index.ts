/**
 * The signed-in Guest's own components.
 *
 * Everything here is mounted only by a page behind `ProtectedRoute` (or by the
 * booking components those pages mount). Nothing in this folder is shared with
 * the public site, which is the point: the approved marketing pages keep the
 * surfaces they already have, and the Guest's pages get surfaces built for a
 * document about a real stay.
 *
 * Colour, radius and type for these surfaces live in the "Signed-in (Guest)
 * surfaces" block of `src/styles.css` — the `guest-*` tokens. A component here
 * should not re-spell one of them.
 *
 * Only what a page actually mounts is exported. The helpers in `stayFacts` that
 * just these components share stay internal to the folder, so the barrel cannot
 * accumulate exports nobody renders.
 */
export { AccountRail, HelpPanel, RailFacts, RailPanel } from './AccountRail'
export { BookingFolio } from './BookingFolio'
export { StatusTrack } from './StatusTrack'
export { StayMasthead } from './StayMasthead'
export { accommodationName, bookingReference, daysUntil, peso } from './stayFacts'
