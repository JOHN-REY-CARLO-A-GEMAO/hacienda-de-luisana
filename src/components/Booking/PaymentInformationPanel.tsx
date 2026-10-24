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

/**
 * Where the money actually goes.
 *
 * This is the one block on the page a Guest copies from, so the thing being
 * copied is the loudest element in it and the prose around it is quiet. Each
 * channel is its own bordered block with the method as its heading, so two
 * channels (GCash and BDO) can never be read as one long paragraph of numbers.
 *
 * A channel that has published a QR code shows the QR instead of an account
 * number: the Guest scans, so the owner's mobile number is not printed for
 * copying.
 */
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
          Payment details are not currently published. Before sending money, confirm the official
          receiving account at {BUSINESS.contact.phoneDisplay} or {BUSINESS.contact.email}. Never
          send passwords, PINs, or one-time codes.
          {requiredAmount !== undefined && (
            <span className="mt-1 block">
              <strong>Required amount:</strong> {peso(requiredAmount)}
            </span>
          )}
        </>
      </Alert>
    )
  }

  return (
    <section className="rounded-[10px] border border-forest-900/10 bg-white/70 dark:border-cream-100/12 dark:bg-forest-900/50">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-forest-900/8 px-4 py-3 dark:border-cream-100/10">
        <h5 className="text-[11px] font-semibold uppercase tracking-eyebrow text-forest-600 dark:text-sage-400">
          Send it here
        </h5>
        {requiredAmount !== undefined && (
          <p className="guest-num text-lg leading-none text-forest-900 dark:text-cream-50">
            {peso(requiredAmount)}
          </p>
        )}
      </header>

      <div className="space-y-2.5 px-4 py-3.5">
        {channelsOf(payment).map((method, index) => {
          const instruction = method.qr_instructions?.trim() || qrScanInstruction(method.method)
          return (
            <div
              key={`${method.method}-${method.qr_image ?? method.account_identifier ?? index}`}
              className="rounded-[10px] border border-forest-900/10 bg-cream-50 px-3.5 py-3 dark:border-cream-100/10 dark:bg-forest-950/40"
            >
              <p className="text-sm font-semibold text-forest-900 dark:text-cream-50">
                {method.method}
              </p>
              <p className="mt-0.5 text-xs text-forest-700 dark:text-cream-100/75">
                Recipient: {method.recipient_name}
              </p>
              {/* A published QR code replaces the number: the Guest scans, so the
                  owner's mobile/account number is not printed for copying. A
                  channel without one still shows its account. */}
              {method.qr_image ? (
                <PaymentQrCode src={method.qr_image} method={method.method} instruction={instruction} />
              ) : (
                <p className="guest-num mt-1.5 break-all text-sm text-forest-900 dark:text-cream-50">
                  {method.account_identifier}
                </p>
              )}
            </div>
          )
        })}

        <dl className="space-y-2 border-t border-forest-900/8 pt-3 text-xs leading-relaxed dark:border-cream-100/10">
          <Note label="Instructions">{payment.instructions}</Note>
          {payment.security_deposit_notes && (
            <Note label="Security deposit">{payment.security_deposit_notes}</Note>
          )}
          {payment.notes && <Note label="Notes">{payment.notes}</Note>}
          <Note label="Verification">
            Keep the unique receipt reference. The booking stays Pending until an Admin verifies the
            proof and the amount.
          </Note>
        </dl>
      </div>
    </section>
  )
}

/** One labelled note inside the payment panel. */
function Note({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="guest-label">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-forest-800/90 dark:text-cream-100/80">
        {children}
      </dd>
    </div>
  )
}
