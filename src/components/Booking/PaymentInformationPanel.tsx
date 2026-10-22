import { BUSINESS } from '../../config/site'
import {
  qrScanInstruction,
  type PaymentInformation,
  type PaymentMethodInformation,
} from '../../lib/paymentInfoDB'
import { PaymentQrCode } from './PaymentQrCode'
import { Alert } from '../ui'

function peso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
}

/** The channels to render: the list shape, or one channel from a legacy document. */
function channelsOf(payment: PaymentInformation): PaymentMethodInformation[] {
  if (payment.methods) return payment.methods
  return [{
    method: payment.method ?? '',
    recipient_name: payment.recipient_name ?? '',
    account_identifier: payment.account_identifier,
    qr_image: payment.qr_image,
    qr_instructions: payment.qr_instructions,
  }]
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
      <Alert tone="warning" className="text-xs" title="Payment account confirmation required">
        <>
        Payment details are not currently published. Before sending money, confirm the official receiving
        account at {BUSINESS.contact.phoneDisplay} or {BUSINESS.contact.email}. Never send passwords, PINs,
        or one-time codes.
        {requiredAmount !== undefined && <span className="block mt-1"><strong>Required amount:</strong> {peso(requiredAmount)}</span>}
        </>
      </Alert>
    )
  }

  return (
    <div className="rounded-xl bg-cream-50 border border-forest-900/10 px-3 py-2.5 text-xs text-forest-800 leading-relaxed space-y-1.5">
      <strong className="block text-forest-900">Payment information</strong>
      {channelsOf(payment).map((method, index) => {
        const instruction = method.qr_instructions?.trim() || qrScanInstruction(method.method)
        return (
          <div
            key={`${method.method}-${method.qr_image ?? method.account_identifier ?? index}`}
            className="rounded-lg border border-forest-900/10 bg-white px-3 py-2"
          >
            <p><strong>{method.method}</strong></p>
            <p><strong>Recipient:</strong> {method.recipient_name}</p>
            {/* A published QR code replaces the number: the Guest scans, so the
                owner's mobile/account number is not printed for copying. A
                channel without one (BDO today) still shows its account. */}
            {method.qr_image ? (
              <PaymentQrCode src={method.qr_image} method={method.method} instruction={instruction} />
            ) : (
              <p><strong>Account / payment ID:</strong> {method.account_identifier}</p>
            )}
          </div>
        )
      })}
      {requiredAmount !== undefined && <p><strong>Required amount:</strong> {peso(requiredAmount)}</p>}
      <p className="whitespace-pre-line"><strong>Instructions:</strong> {payment.instructions}</p>
      {payment.security_deposit_notes && <p className="whitespace-pre-line"><strong>Security deposit:</strong> {payment.security_deposit_notes}</p>}
      {payment.notes && <p className="whitespace-pre-line"><strong>Notes:</strong> {payment.notes}</p>}
      <p><strong>Verification:</strong> keep the unique receipt reference. The booking remains Pending until an Admin verifies the proof and amount.</p>
    </div>
  )
}
