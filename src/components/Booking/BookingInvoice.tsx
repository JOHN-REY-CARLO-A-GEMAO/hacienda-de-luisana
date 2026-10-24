import React from 'react'
import type { Booking } from '../../lib/storage'
import { ACCOMMODATIONS } from '../../config/site'
import { RequestBadge } from '../ui'

interface BookingInvoiceProps {
  booking: Booking
  onClose?: () => void
}

function getAccommodationName(id: string) {
  return ACCOMMODATIONS.find((acc) => acc.id === id)?.name ?? id
}

export const BookingInvoice: React.FC<BookingInvoiceProps> = ({ booking, onClose }) => {
  const stayTotal = booking.stay_total ?? booking.total_amount ?? 0
  const securityDeposit = booking.security_deposit ?? 0
  // Structured add-ons (src/lib/booking/requests.ts). A priced pet count is
  // already inside `stay_total`; a pending `pet_request` is an estimate the
  // Admin has not approved, so neither may be summed in as a separate charge.
  // The old free-text heuristic ("special_requests mentions 'pet' → ₱300") is
  // kept ONLY for legacy documents that predate the structured fields, so old
  // invoices render exactly as they always did.
  const petCount = booking.pet_count ?? 0
  const petRequest = booking.pet_request
  const lateCheckoutHours = booking.late_checkout_hours ?? 0
  const lateCheckoutRequest = booking.late_checkout_request
  const bonfireWoodSets = booking.bonfire_wood_sets ?? 0
  // Only the keys the structured booking form writes mark a document as "new":
  // a legacy Booking that already carried a `late_checkout_request` (from the
  // post-booking extension flow) keeps its old invoice rendering untouched.
  const hasStructuredRequests =
    petCount > 0 || Boolean(petRequest) || lateCheckoutHours > 0
    || bonfireWoodSets > 0 || Boolean(booking.event_purpose)
  const petFee = (booking as unknown as { pet_fee?: number }).pet_fee
    ?? (!hasStructuredRequests && booking.special_requests?.toLowerCase().includes('pet') ? 300 : 0)
  const lateCheckoutFee = booking.late_checkout_fee ?? 0
  const additionalCharges = booking.additional_charges ?? []

  const totalAdditional = additionalCharges.reduce((acc, curr) => acc + (curr.amount || 0), 0) + lateCheckoutFee + petFee
  const grandTotal = stayTotal + securityDeposit + totalAdditional
  const downpaymentRequired = booking.amount_due ?? Math.floor(stayTotal * 0.5)
  const amountPaid = booking.amount_verified ?? booking.amount_claimed ?? 0
  const balanceDue = Math.max(0, grandTotal - amountPaid)

  const printInvoice = () => {
    window.print()
  }

  return (
    <div className="mx-auto my-4 max-w-2xl rounded-[14px] border border-forest-900/10 bg-white p-6 shadow-[0_1px_2px_rgba(21,36,27,0.05),0_18px_50px_-28px_rgba(21,36,27,0.4)] print:m-0 print:border-none print:p-0 print:shadow-none sm:p-8">
      {/* Letterhead */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b-2 border-forest-800 pb-5">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight text-forest-900">Hacienda de LuisAna</h2>
          <p className="mt-1 text-xs leading-relaxed text-forest-700/80">
            Private countryside stay
            <br />
            Luisiana, Laguna · haciendadeluisana.com
          </p>
        </div>
        <div className="text-right">
          <span className="inline-block rounded-full border border-forest-900/15 bg-cream-100 px-3 py-1 text-[11px] font-bold uppercase tracking-eyebrow text-forest-800">
            Invoice
          </span>
          <p className="guest-num mt-2.5 text-sm font-bold text-forest-900">
            {booking.ref_id || booking.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="guest-num mt-0.5 text-[11px] text-forest-600">
            {new Date(booking.created_at || Date.now()).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
          </p>
        </div>
      </div>

      {/* Who and what — two columns of facts, ruled, not boxed */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 border-b border-forest-900/10 py-5 text-xs sm:grid-cols-2">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-eyebrow text-forest-600">Guest</h3>
          <p className="mt-1.5 text-sm font-medium text-forest-900">{booking.guest_name}</p>
          <p className="mt-0.5 text-forest-700/85">{booking.email}</p>
          <p className="guest-num text-forest-700/85">{booking.phone}</p>
        </div>
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-eyebrow text-forest-600">Stay</h3>
          <p className="mt-1.5 text-sm font-medium text-forest-900">
            {getAccommodationName(booking.accommodation)}
          </p>
          <p className="guest-num mt-0.5 text-forest-700/85">
            {booking.check_in} in at 2:00 PM
          </p>
          <p className="guest-num text-forest-700/85">{booking.check_out} out by 12:00 PM</p>
          <p className="text-forest-700/85">
            {booking.guests} guest{booking.guests === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {/* Itemised charges */}
      <div className="py-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-eyebrow text-forest-600">
          Itemised statement
        </h3>
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-forest-900/15 text-[11px] font-semibold uppercase tracking-wide text-forest-600">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5">
            <tr>
              <td className="py-2.5 font-medium text-forest-900">
                Base Stay Total ({getAccommodationName(booking.accommodation)})
              </td>
              <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{stayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
            </tr>
            {securityDeposit > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Refundable Security Deposit</td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{securityDeposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {petFee > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Pet Fee (Standard flat rate)</td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{petFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {lateCheckoutFee > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Late Checkout Extension Fee</td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{lateCheckoutFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {petCount > 0 && petFee === 0 && (
              <tr>
                <td className="py-2.5 text-forest-800" colSpan={2}>
                  Pet sanitation fee ({petCount} pet{petCount === 1 ? '' : 's'}) — included in the Base Stay Total
                </td>
              </tr>
            )}
            {petRequest && (
              <tr>
                <td className="py-2.5 text-forest-800">
                  Pet sanitation fee ({petRequest.count} pet{petRequest.count === 1 ? '' : 's'}) —{' '}
                  <RequestBadge status={petRequest.status} />
                </td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">
                  {petRequest.status === 'approved' ? '' : `₱${(petRequest.estimated_fee || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} est.`}
                </td>
              </tr>
            )}
            {lateCheckoutHours > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800" colSpan={2}>
                  Late checkout (+{lateCheckoutHours} hour{lateCheckoutHours === 1 ? '' : 's'}) — included in the Base Stay Total
                </td>
              </tr>
            )}
            {lateCheckoutRequest && lateCheckoutFee === 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">
                  Late checkout (+{lateCheckoutRequest.hours} hour{lateCheckoutRequest.hours === 1 ? '' : 's'}) —{' '}
                  <RequestBadge status={lateCheckoutRequest.status} />
                </td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{(lateCheckoutRequest.fee || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} est.</td>
              </tr>
            )}
            {bonfireWoodSets > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800" colSpan={2}>
                  Bonfire wood ({bonfireWoodSets} set{bonfireWoodSets === 1 ? '' : 's'}) —{' '}
                  <RequestBadge status="pending" />
                </td>
              </tr>
            )}
            {additionalCharges.map((item, idx) => (
              <tr key={idx}>
                <td className="py-2.5 text-forest-800">{item.description}</td>
                <td className="guest-num py-2.5 text-right font-medium text-forest-900">₱{(item.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals Summary */}
      <div className="rounded-[10px] border border-forest-900/8 bg-cream-100/70 px-4 py-3.5 text-xs">
        <div className="flex items-baseline justify-between gap-4 border-t border-forest-900/10 py-2 first:border-t-0">
          <span className="font-bold text-forest-900">Grand total</span>
          <span className="guest-num text-lg font-bold text-forest-900">
            ₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-forest-900/10 py-1.5 text-forest-700/85">
          <span>Required 50% downpayment</span>
          <span className="guest-num">₱{downpaymentRequired.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-forest-900/10 py-1.5 font-semibold text-emerald-800">
          <span>Paid and verified</span>
          <span className="guest-num">₱{amountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-forest-900/10 py-2">
          <span className="font-bold text-forest-900">Balance due at check-in</span>
          <span className="guest-num text-lg font-bold text-forest-900">
            ₱{balanceDue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Footer / Actions */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn-quiet btn-sm"
          >
            Close
          </button>
        ) : (
          <span />
        )}
        <button type="button" onClick={printInvoice} className="btn-primary btn-sm">
          Print or save invoice
        </button>
      </div>
    </div>
  )
}
