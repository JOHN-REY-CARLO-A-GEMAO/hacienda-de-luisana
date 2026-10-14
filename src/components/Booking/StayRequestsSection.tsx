// ----------------------------------------------------------------------------
// Structured add-ons & special requests — the booking form's request controls
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// Replaces the free-text-only "Special requests" box with quiet-luxury cards:
// a pets stepper, a bonfire-wood stepper, a late-checkout hour selector,
// event/purpose chips (with a conditional "Other" explanation) and a compact
// notes area — plus the live fee breakdown that says, per charge, whether it
// is computed from the Admin's published rates and included in the estimated
// total, or a request the Admin must approve.
//
// The component is presentational: the page owns the values and the pure
// `src/lib/booking/requests` module owns every quantity ceiling, fee figure
// and status sentence, so the breakdown here, the sidebar summary and the
// stored Booking can never disagree.

import React from 'react'
import {
  EVENT_PURPOSES,
  MAX_BONFIRE_WOOD_SETS,
  MAX_LATE_CHECKOUT_HOURS,
  addonFeeLines,
  estimatedAdditionalFees,
  formatPesos,
  maxPetsFor,
  type AddonFallbackAmounts,
  type AddonFeeLine,
  type EventPurpose,
  type PublishedRates,
} from '../../lib/booking'
import { Clock, Flame, Paw } from '../../lib/icons'

export type StayRequestsFormValues = {
  pet_count: number
  bonfire_wood_sets: number
  late_checkout_hours: number
  event_purpose: EventPurpose | ''
  event_purpose_detail: string
  /** The Guest's free text for anything the structured controls do not cover. */
  notes: string
}

type StayRequestsSectionProps = {
  values: StayRequestsFormValues
  onChange: (patch: Partial<StayRequestsFormValues>) => void
  published: PublishedRates | null
  fallback: AddonFallbackAmounts
  /** A rule failure attached to the requests as a whole (e.g. a pet cap). */
  error?: string
}

export function StayRequestsSection({ values, onChange, published, fallback, error }: StayRequestsSectionProps) {
  const lines = addonFeeLines(published, values, fallback)
  const maxPets = maxPetsFor(published)
  const petsPriced = Boolean(published?.pet_policy && typeof published.pet_policy.fee_per_pet === 'number')
  const latePriced = typeof published?.late_checkout_per_hour === 'number'

  return (
    <div className="pt-2 border-t border-forest-900/5" data-tour="stay-requests">
      <h2 className="font-serif text-2xl text-forest-900 mt-6">Add-ons &amp; Requests</h2>
      <p className="mt-2 text-sm text-forest-700 leading-relaxed">
        All optional. Quantities are reviewed by the Hacienda with your booking — nothing here is
        confirmed until the Admin approves it.
      </p>

      <div className="mt-5 grid sm:grid-cols-2 gap-4">
        {/* Pets */}
        <div className="rounded-2xl border border-forest-900/10 bg-cream-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-forest-900">
              <Paw size={16} className="text-forest-600" />
              <span className="text-sm font-semibold">Pets</span>
            </div>
            <UnitBadge priced={petsPriced} />
          </div>
          <p className="mt-1.5 text-xs text-forest-700/75 leading-relaxed">
            {fallback.fee_per_pet !== undefined
              ? `${formatPesos(fallback.fee_per_pet)} per pet sanitation fee.`
              : 'Sanitation fee applies per pet.'}{' '}
            {petsPriced
              ? 'Added to your estimated total.'
              : 'Confirmed by the Admin with your booking.'}
          </p>
          <QuantityStepper
            className="mt-3"
            label="pets"
            value={values.pet_count}
            max={maxPets}
            onChange={(next) => onChange({ pet_count: next })}
          />
          <p className="mt-1.5 text-[11px] text-forest-600/70">Up to {maxPets} per booking.</p>
        </div>

        {/* Bonfire wood */}
        <div className="rounded-2xl border border-forest-900/10 bg-cream-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-forest-900">
              <Flame size={16} className="text-forest-600" />
              <span className="text-sm font-semibold">Bonfire wood</span>
            </div>
            <UnitBadge priced={false} />
          </div>
          <p className="mt-1.5 text-xs text-forest-700/75 leading-relaxed">
            The bonfire pit is free to use.
            {fallback.bonfire_wood_per_set !== undefined
              ? ` A wood set is ${formatPesos(fallback.bonfire_wood_per_set)}, prepared on approval.`
              : ' Wood sets are prepared on approval.'}
          </p>
          <QuantityStepper
            className="mt-3"
            label="bonfire wood sets"
            value={values.bonfire_wood_sets}
            max={MAX_BONFIRE_WOOD_SETS}
            onChange={(next) => onChange({ bonfire_wood_sets: next })}
          />
          <p className="mt-1.5 text-[11px] text-forest-600/70">Up to {MAX_BONFIRE_WOOD_SETS} sets per booking.</p>
        </div>

        {/* Late checkout */}
        <div className="rounded-2xl border border-forest-900/10 bg-cream-50 p-4 sm:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-forest-900">
              <Clock size={16} className="text-forest-600" />
              <span className="text-sm font-semibold">Late checkout</span>
            </div>
            <UnitBadge priced={latePriced} />
          </div>
          <p className="mt-1.5 text-xs text-forest-700/75 leading-relaxed">
            Standard check-out is 12:00 noon.
            {fallback.late_checkout_per_hour !== undefined
              ? ` Extra hours are ${formatPesos(fallback.late_checkout_per_hour)} per hour, subject to availability and Admin approval.`
              : ' Extra hours are subject to availability and Admin approval.'}
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Additional hours after 12:00 noon check-out</span>
            <select
              className="field text-sm w-full sm:max-w-xs"
              aria-label="Late checkout hours"
              value={values.late_checkout_hours}
              onChange={(event) => {
                const next = Number(event.target.value)
                onChange({
                  late_checkout_hours: Number.isInteger(next) && next >= 0 && next <= MAX_LATE_CHECKOUT_HOURS ? next : 0,
                })
              }}
            >
              <option value={0}>No extension — check out by 12:00 noon</option>
              {Array.from({ length: MAX_LATE_CHECKOUT_HOURS }, (_, index) => index + 1).map((hours) => (
                <option key={hours} value={hours}>
                  +{hours} hour{hours === 1 ? '' : 's'} — until {hours}:00 PM
                  {fallback.late_checkout_per_hour !== undefined
                    ? ` (${formatPesos(hours * fallback.late_checkout_per_hour)})`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Event / purpose */}
      <fieldset className="mt-5">
        <legend className="label">Event / purpose of stay <span className="normal-case tracking-normal text-forest-500">(optional)</span></legend>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Event or purpose of stay">
          {EVENT_PURPOSES.map((purpose) => {
            const selected = values.event_purpose === purpose.id
            return (
              <button
                key={purpose.id}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  onChange(selected
                    ? { event_purpose: '', event_purpose_detail: '' }
                    : { event_purpose: purpose.id, ...(purpose.id === 'other' ? {} : { event_purpose_detail: '' }) })
                }
                className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-forest-700 bg-forest-700 text-cream-50'
                    : 'border-forest-900/15 bg-white text-forest-800 hover:border-forest-600 hover:bg-cream-50'
                }`}
              >
                {purpose.label}
              </button>
            )
          })}
        </div>
        {values.event_purpose === 'other' && (
          <label className="mt-3 block">
            <span className="label">Tell us about your event</span>
            <input
              className="field"
              placeholder="e.g. 50th birthday lunch, baptism reception…"
              maxLength={160}
              value={values.event_purpose_detail}
              onChange={(event) => onChange({ event_purpose_detail: event.target.value })}
            />
          </label>
        )}
        {values.event_purpose && (
          <p className="mt-2 text-xs text-forest-700/70 leading-relaxed">
            Events are discussed and confirmed with the Admin; no event charge is added automatically.
            {values.event_purpose === 'wedding_prep'
              ? ' The wedding-preparation package applies only to a booking explicitly identified and confirmed for that purpose.'
              : ''}
          </p>
        )}
      </fieldset>

      {/* Additional notes */}
      <label className="mt-5 block">
        <span className="label">Additional notes <span className="normal-case tracking-normal text-forest-500">(optional)</span></span>
        <textarea
          className="field min-h-[84px] resize-y text-sm"
          placeholder="Anything else the Hacienda should know — arrival time, celebrations, accessibility needs…"
          maxLength={1000}
          value={values.notes}
          data-tour-field="special-requests"
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </label>

      <div className="mt-4">
        <AddonFeeBreakdown lines={lines} />
      </div>

      {error && <p className="mt-3 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}

/**
 * The live breakdown of estimated add-on fees. Rendered wherever the Guest can
 * change a request, with `aria-live` so screen readers hear the total move.
 */
export function AddonFeeBreakdown({ lines }: { lines: AddonFeeLine[] }) {
  if (lines.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-forest-900/15 bg-white px-4 py-3 text-xs text-forest-700/70">
        No add-ons selected yet. Estimated additional fees: {formatPesos(0)}.
      </div>
    )
  }
  const total = estimatedAdditionalFees(lines)
  return (
    <div className="rounded-2xl border border-brass-300/50 bg-cream-100/70 p-4" aria-live="polite">
      <div className="eyebrow text-forest-600">Estimated add-on fees</div>
      <ul className="mt-3 space-y-2.5">
        {lines.map((line) => (
          <li key={line.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-forest-900">{line.label}</span>
              {line.unitAmount !== null && (
                <span className="text-forest-700/70"> · {formatPesos(line.unitAmount)} {line.unitLabel}</span>
              )}
              <span
                className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  line.includedInTotal
                    ? 'bg-forest-100 text-forest-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {line.includedInTotal ? 'Added to total' : 'Pending approval'}
              </span>
              <span className="mt-0.5 block text-[11px] text-forest-700/70 leading-snug">{line.note}</span>
            </span>
            <span className="shrink-0 font-mono text-forest-900">
              {line.amount !== null ? formatPesos(line.amount) : 'Quoted by Admin'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-forest-900/10 pt-3">
        <span className="text-sm font-semibold text-forest-900">Estimated additional fees</span>
        <span className="font-serif text-xl text-forest-900">{formatPesos(total)}</span>
      </div>
      <p className="mt-2 text-[11px] text-forest-700/70 leading-relaxed">
        “Added to total” charges are computed from the Admin’s published rates and are included in your
        estimated total and 50% downpayment. “Pending approval” charges are requests only — they are not
        added to your booking total; the Admin confirms availability and the final fee. No charge of any
        kind is confirmed until the Hacienda approves your booking.
      </p>
    </div>
  )
}

/** A compact echo of the breakdown for the sticky stay summary. */
export function AddonFeeSummary({ lines }: { lines: AddonFeeLine[] }) {
  if (lines.length === 0) return null
  const total = estimatedAdditionalFees(lines)
  return (
    <div className="pt-4 border-t border-forest-900/10 text-xs">
      <div className="eyebrow text-forest-600">Add-ons &amp; requests</div>
      <ul className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <li key={line.id} className="flex items-baseline justify-between gap-2">
            <span className="text-forest-700">
              {line.label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                line.includedInTotal ? 'bg-forest-100 text-forest-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {line.includedInTotal ? 'In total' : 'Approval'}
              </span>
            </span>
            <span className="font-mono text-forest-900">
              {line.amount !== null ? formatPesos(line.amount) : '—'}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-baseline justify-between border-t border-forest-900/10 pt-2">
        <span className="font-semibold text-forest-900">Estimated additional fees</span>
        <span className="font-mono text-forest-900">{formatPesos(total)}</span>
      </div>
    </div>
  )
}

function UnitBadge({ priced }: { priced: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        priced ? 'bg-forest-100 text-forest-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {priced ? 'Added to total' : 'Pending approval'}
    </span>
  )
}

function QuantityStepper({
  label,
  value,
  max,
  onChange,
  className = '',
}: {
  label: string
  value: number
  min?: number
  max: number
  onChange: (next: number) => void
  className?: string
}) {
  // Quantities are whole numbers clamped to [0, max] — the same ceiling the
  // pure sanitizer applies, so the UI cannot offer what validation would refuse.
  const clamp = (next: number) => Math.min(max, Math.max(0, Math.floor(next)))
  const button =
    'flex h-9 w-9 items-center justify-center rounded-full border border-forest-900/15 bg-white text-lg font-medium text-forest-800 transition-colors hover:border-forest-600 hover:bg-cream-50 disabled:cursor-not-allowed disabled:opacity-35'
  return (
    <div className={`flex items-center gap-3 ${className}`} role="group" aria-label={`${label} quantity`}>
      <button
        type="button"
        className={button}
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <span className="w-8 text-center font-serif text-xl text-forest-900" aria-live="polite">
        {value}
        <span className="sr-only"> {label}</span>
      </span>
      <button
        type="button"
        className={button}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  )
}
