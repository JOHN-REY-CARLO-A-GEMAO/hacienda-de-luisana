import React from 'react'
import type { Booking } from '../../lib/storage'
import { ACCOMMODATIONS } from '../../config/site'

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
  const petFee = (booking as unknown as { pet_fee?: number }).pet_fee ?? (booking.special_requests?.toLowerCase().includes('pet') ? 300 : 0)
  const lateCheckoutFee = (booking as unknown as { late_checkout_fee?: number }).late_checkout_fee ?? 0
  const additionalCharges = (booking as unknown as { additional_charges?: { description: string; amount: number }[] }).additional_charges ?? []

  const totalAdditional = additionalCharges.reduce((acc, curr) => acc + (curr.amount || 0), 0) + lateCheckoutFee + petFee
  const grandTotal = stayTotal + securityDeposit + totalAdditional
  const downpaymentRequired = booking.amount_due ?? Math.floor(stayTotal * 0.5)
  const amountPaid = booking.amount_verified ?? booking.amount_claimed ?? 0
  const balanceDue = Math.max(0, grandTotal - amountPaid)

  const printInvoice = () => {
    window.print()
  }

  return (
    <div className="bg-white rounded-3xl border border-forest-900/10 shadow-lg p-6 sm:p-8 max-w-2xl mx-auto my-4 print:shadow-none print:border-none print:m-0 print:p-0">
      {/* Header */}
      <div className="flex justify-between items-start border-b border-forest-900/10 pb-6">
        <div>
          <h2 className="font-serif text-2xl font-bold text-forest-900">Hacienda de LuisAna</h2>
          <p className="text-xs text-forest-700/70 mt-1">Private Countryside Stay · Luisiana, Laguna</p>
          <p className="text-xs text-forest-700/70">haciendadeluisana.com</p>
        </div>
        <div className="text-right">
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-cream-100 text-forest-800 border border-forest-900/10">
            OFFICIAL INVOICE
          </span>
          <p className="text-xs font-mono font-bold text-forest-900 mt-2">
            Ref: {booking.ref_id || booking.id.slice(0, 8).toUpperCase()}
          </p>
          <p className="text-[11px] text-forest-600">
            Date: {new Date(booking.created_at || Date.now()).toLocaleDateString('en-PH', { dateStyle: 'medium' })}
          </p>
        </div>
      </div>

      {/* Guest & Stay Details */}
      <div className="grid grid-cols-2 gap-4 py-6 border-b border-forest-900/10 text-xs">
        <div>
          <h3 className="font-bold text-forest-900 mb-1">Guest Information</h3>
          <p className="font-medium text-forest-900">{booking.guest_name}</p>
          <p className="text-forest-700/80">{booking.email}</p>
          <p className="text-forest-700/80">{booking.phone}</p>
        </div>
        <div>
          <h3 className="font-bold text-forest-900 mb-1">Stay Details</h3>
          <p className="font-medium text-forest-900">{getAccommodationName(booking.accommodation)}</p>
          <p className="text-forest-700/80">Check-in: {booking.check_in} (2:00 PM)</p>
          <p className="text-forest-700/80">Check-out: {booking.check_out} (12:00 PM)</p>
          <p className="text-forest-700/80">Guests: {booking.guests}</p>
        </div>
      </div>

      {/* Itemized charges table */}
      <div className="py-6">
        <h3 className="font-serif text-base font-bold text-forest-900 mb-3">Itemized Statement</h3>
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-forest-900/10 text-forest-700/70 font-bold">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-forest-900/5">
            <tr>
              <td className="py-2.5 font-medium text-forest-900">
                Base Stay Total ({getAccommodationName(booking.accommodation)})
              </td>
              <td className="py-2.5 text-right font-mono text-forest-900">₱{stayTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
            </tr>
            {securityDeposit > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Refundable Security Deposit</td>
                <td className="py-2.5 text-right font-mono text-forest-900">₱{securityDeposit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {petFee > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Pet Fee (Standard flat rate)</td>
                <td className="py-2.5 text-right font-mono text-forest-900">₱{petFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {lateCheckoutFee > 0 && (
              <tr>
                <td className="py-2.5 text-forest-800">Late Checkout Extension Fee</td>
                <td className="py-2.5 text-right font-mono text-forest-900">₱{lateCheckoutFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            )}
            {additionalCharges.map((item, idx) => (
              <tr key={idx}>
                <td className="py-2.5 text-forest-800">{item.description}</td>
                <td className="py-2.5 text-right font-mono text-forest-900">₱{(item.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals Summary */}
      <div className="bg-cream-50 rounded-2xl p-4 text-xs space-y-2 border border-forest-900/5">
        <div className="flex justify-between text-forest-800 font-bold text-sm pt-1 border-t border-forest-900/10">
          <span>Grand Total</span>
          <span className="font-mono text-forest-900">₱{grandTotal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-forest-700/80">
          <span>Required 50% Downpayment</span>
          <span className="font-mono">₱{downpaymentRequired.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-emerald-800 font-semibold">
          <span>Total Paid / Verified</span>
          <span className="font-mono">₱{amountPaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-forest-900 font-bold text-sm pt-1 border-t border-forest-900/10">
          <span>Remaining Balance Due (on check-in)</span>
          <span className="font-mono text-forest-900">₱{balanceDue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      {/* Footer / Actions */}
      <div className="mt-6 flex items-center justify-between print:hidden">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn bg-white border border-forest-900/10 text-forest-800 text-xs hover:bg-cream-100"
          >
            Close
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={printInvoice}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          🖨️ Print / Save Invoice
        </button>
      </div>
    </div>
  )
}
