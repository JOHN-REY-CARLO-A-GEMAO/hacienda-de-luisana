import { BUSINESS } from '../../config/site'
import type { PaymentInformation } from '../../lib/paymentInfoDB'

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

export function PaymentInformationPanel({
  payment,
  requiredAmount,
}: {
  payment: PaymentInformation | null
  requiredAmount?: number
}) {
  if (!payment) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
        <strong className="block">Payment account confirmation required</strong>
        Payment details are not currently published. Before sending money, confirm the official receiving
        account at {BUSINESS.contact.phoneDisplay} or {BUSINESS.contact.email}. Never send passwords, PINs,
        or one-time codes.
        {requiredAmount !== undefined && <span className="block mt-1"><strong>Required amount:</strong> {peso(requiredAmount)}</span>}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-cream-50 border border-forest-900/10 px-3 py-2.5 text-xs text-forest-800 leading-relaxed space-y-1.5">
      <strong className="block text-forest-900">Payment information</strong>
      {(payment.methods ?? [{
        method: payment.method ?? '',
        recipient_name: payment.recipient_name ?? '',
        account_identifier: payment.account_identifier ?? '',
      }]).map((method) => (
        <div key={`${method.method}-${method.account_identifier}`} className="rounded-lg border border-forest-900/10 bg-white px-3 py-2">
          <p><strong>{method.method}</strong></p>
          <p><strong>Recipient:</strong> {method.recipient_name}</p>
          <p><strong>Account / payment ID:</strong> {method.account_identifier}</p>
        </div>
      ))}
      {requiredAmount !== undefined && <p><strong>Required amount:</strong> {peso(requiredAmount)}</p>}
      <p className="whitespace-pre-line"><strong>Instructions:</strong> {payment.instructions}</p>
      {payment.security_deposit_notes && <p className="whitespace-pre-line"><strong>Security deposit:</strong> {payment.security_deposit_notes}</p>}
      {payment.notes && <p className="whitespace-pre-line"><strong>Notes:</strong> {payment.notes}</p>}
      <p><strong>Verification:</strong> keep the unique receipt reference. The booking remains Pending until an Admin verifies the proof and amount.</p>
    </div>
  )
}
