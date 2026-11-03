// -----------------------------------------------------------------------------
// Legal content model — Hacienda de LuisAna
// -----------------------------------------------------------------------------
// The /legal page is a reading page, but it is also the copy the booking and
// payment steps point at and the version a Guest records when they accept. The
// content is therefore data, not JSX: one typed block list per section, so the
// page can render a table of contents, a summary, print styles and the dynamic
// cancellation alert without re-typing the wording.
//
// The wording is deliberately plain. It is written for a Guest, not for a court
// filing, and it avoids promising anything the Hacienda has not published. Where
// a figure is dynamic (the security deposit, the refund policy, the optional
// charges), the page reads it from the Admin's published rates rather than
// freezing a number here.
// -----------------------------------------------------------------------------

/** The tone of a callout. Maps to the site's existing `Alert` tones. */
export type LegalNoteTone = 'info' | 'success' | 'warning' | 'danger'

/**
 * One piece of a section. A discriminated union rather than a bag of optional
 * fields: a paragraph cannot accidentally carry a table, and the renderer does
 * not need a chain of `if (block.items)` checks.
 */
export type LegalBlock =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'sub'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][]; caption?: string }
  | { kind: 'note'; tone: LegalNoteTone; title: string; text: string }

/** The five groups the table of contents is arranged under. */
export type LegalPartId = 'booking' | 'conduct' | 'privacy' | 'content' | 'legal'

export type LegalPart = {
  id: LegalPartId
  title: string
  blurb: string
}

export type LegalSection = {
  /** Stable anchor. Other pages and the booking flow link into these. */
  id: string
  title: string
  /** One sentence shown under the heading and in the print view. */
  summary: string
  part: LegalPartId
  blocks: LegalBlock[]
}

/** One entry in the version-history table at the foot of the page. */
export type LegalVersionEntry = {
  version: string
  effective: string
  summary: string
}

/** One line of the plain-language summary at the top of the page. */
export type LegalSummaryPoint = {
  lead: string
  text: string
}
