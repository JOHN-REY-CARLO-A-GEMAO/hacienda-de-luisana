// ----------------------------------------------------------------------------
// The interactive Guest tour — step model
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// A TourStep teaches one thing, anchored to the real UI element it talks
// about — never a screenshot, never a mock. The anchor is a `data-tour="…"`
// attribute on the living control; the Guest advances by *using* that control
// (clicking the real button, picking the real dates, checking the real box),
// not by pressing Next. Steps whose purpose is explaining rather than doing
// keep a plain Continue button.
// ----------------------------------------------------------------------------

/** How a step is completed. `none` = read and press Continue. */
export type TourAwait =
  | { type: 'none' }
  /** A real click on any of the step's target candidates. */
  | { type: 'click' }
  /** Every listed field satisfies its check. Values are read from the DOM. */
  | { type: 'fields'; fields: FieldRequirement[] }
  /** The checkbox/radio inside the highlighted target becomes checked. */
  | { type: 'checked' }
  /** The app emitted a `tour:<name>` CustomEvent on window. */
  | { type: 'event'; name: string }

export type FieldRequirement = {
  /** Matches `[data-tour-field="<field>"]`. */
  field: string
  /** True when the current value counts. `all` is every field's value. */
  ok: (value: string, all: Record<string, string>) => boolean
}

export type TourStep = {
  id: string
  /** Route the step lives on; the tour navigates there before resolving targets. */
  route?: string
  /**
   * Candidate `data-tour` values. The first *visible* one gets the spotlight;
   * every candidate answers the awaiting interaction (so the mobile sticky CTA
   * and the desktop nav button both count for the same step).
   */
  targets?: string[]
  eyebrow?: string
  title: string
  /** What the feature does. */
  body: string
  /** Why a Guest would use it — shown as a callout. */
  why?: string
  /**
   * Shown instead of `body` when no target is on screen (signed out, no
   * bookings yet, layout folded). The step becomes informational and can
   * always be continued — the tour never strands the Guest.
   */
  fallbackBody?: string
  await?: TourAwait
  /** Hint shown under the title while an interaction is awaited. */
  actionHint?: string
  /** Continue-button label for informational steps (default "Next"). */
  continueLabel?: string
}

export type Rect = { top: number; left: number; width: number; height: number }
