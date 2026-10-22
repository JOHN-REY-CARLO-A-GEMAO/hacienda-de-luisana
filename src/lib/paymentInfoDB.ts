import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { OFFICIAL_PAYMENT_INFORMATION } from '../config/officialBusiness'

export type PaymentMethodInformation = {
  method: string
  recipient_name: string
  /**
   * The account/mobile number a Guest would copy by hand. Optional once the
   * method publishes a QR code: the owner asked for the number to stop being
   * shown, and the Guest scans instead.
   */
  account_identifier?: string
  /**
   * Public path (`/images/payment/gcash-qr.png`) or https URL of the method's
   * official QR code. The asset itself is the source of truth — never draw a
   * QR code in code, because a generated one points at a different account.
   */
  qr_image?: string
  /** The line shown under the QR code. Falls back to a sentence naming the method. */
  qr_instructions?: string
}

export type PaymentInformation = {
  active: boolean
  /** Multiple official channels; legacy documents may use the three singular fields below. */
  methods?: PaymentMethodInformation[]
  method?: string
  recipient_name?: string
  account_identifier?: string
  qr_image?: string
  qr_instructions?: string
  instructions: string
  security_deposit_notes?: string
  notes?: string
}

export type PaymentInformationProblem = { path: string; message: string }

const LOCAL_KEY = 'hdl:payment-information'

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

/**
 * A QR code source the page may put in an `<img src>`. Either a site path
 * (`/images/payment/gcash-qr.png`) or an https URL (a Storage URL, if the
 * Admin ever moves the asset there). Anything else — `javascript:`, `data:`,
 * a protocol-relative `//host` — is refused rather than rendered.
 */
function qrSource(value: unknown): value is string {
  if (!text(value, 500)) return false
  const source = value.trim()
  if (/\s/.test(source)) return false
  return (source.startsWith('/') && !source.startsWith('//'))
    || source.startsWith('https://')
}

/** The instruction line under a QR code, when the config did not publish its own. */
export function qrScanInstruction(method: string): string {
  return `Scan this QR code using ${method} to pay your downpayment.`
}

export function validatePaymentInformation(value: unknown): PaymentInformationProblem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: '', message: 'payment information must be an object.' }]
  }
  const doc = value as Record<string, unknown>
  const problems: PaymentInformationProblem[] = []
  if (typeof doc.active !== 'boolean') problems.push({ path: 'active', message: 'must be true or false.' })

  const checkChannel = (channel: unknown, path: string) => {
    const item = (typeof channel === 'object' && channel !== null && !Array.isArray(channel)
      ? channel
      : {}) as Record<string, unknown>
    if (typeof channel !== 'object' || channel === null || Array.isArray(channel)) {
      problems.push({ path, message: 'must be an object.' })
      return
    }
    if (!text(item.method, 80)) {
      problems.push({ path: `${path ? `${path}.` : ''}method`, message: 'is required (80 characters maximum).' })
    }
    if (!text(item.recipient_name, 120)) {
      problems.push({ path: `${path ? `${path}.` : ''}recipient_name`, message: 'is required (120 characters maximum).' })
    }
    // A channel must name where the money goes: an account to copy, or a QR
    // code to scan. A GCash channel that publishes only a QR is valid, which is
    // the owner's choice — the number is no longer shown to Guests.
    const hasQr = qrSource(item.qr_image)
    if (item.qr_image !== undefined) {
      if (!hasQr) {
        problems.push({ path: `${path ? `${path}.` : ''}qr_image`, message: 'must be a site path starting with / or an https URL (500 characters maximum).' })
      }
    } else if (!text(item.account_identifier, 120)) {
      problems.push({ path: `${path ? `${path}.` : ''}account_identifier`, message: 'is required when the channel has no qr_image (120 characters maximum).' })
    }
    if (item.qr_instructions !== undefined
      && (typeof item.qr_instructions !== 'string' || item.qr_instructions.length > 240)) {
      problems.push({ path: `${path ? `${path}.` : ''}qr_instructions`, message: 'must be text of at most 240 characters.' })
    }
  }

  if (doc.methods !== undefined) {
    if (!Array.isArray(doc.methods) || doc.methods.length < 1 || doc.methods.length > 5) {
      problems.push({ path: 'methods', message: 'must list between 1 and 5 public payment methods.' })
    } else {
      doc.methods.forEach((method, index) => checkChannel(method, `methods[${index}]`))
    }
  } else {
    checkChannel(doc, '')
  }
  if (!text(doc.instructions, 1000)) problems.push({ path: 'instructions', message: 'is required (1,000 characters maximum).' })
  for (const key of ['security_deposit_notes', 'notes'] as const) {
    if (doc[key] !== undefined && (typeof doc[key] !== 'string' || doc[key].length > 1000)) {
      problems.push({ path: key, message: 'must be text of at most 1,000 characters.' })
    }
  }
  return problems
}

function valid(value: unknown): PaymentInformation | null {
  return validatePaymentInformation(value).length === 0 ? value as PaymentInformation : null
}

/**
 * Fill in the official QR code for a channel that matches one the business
 * config publishes, when the stored document does not carry one.
 *
 * `site_config/payment` is written by the Admin, and a document published
 * before the owner supplied a QR code still names GCash with a mobile number.
 * Waiting for a re-publication would leave Guests copying that number, which is
 * exactly what the owner asked to stop. The QR is a static site asset, not
 * account data, so it is read from the one configuration that already knows it
 * (`OFFICIAL_PAYMENT_INFORMATION`) rather than duplicated here. A channel that
 * publishes its own `qr_image` — including a future Storage URL — always wins.
 *
 * The account number stays in the document; the panel simply stops showing it
 * when a QR code is present, so nothing is destroyed and no schema changes.
 */
export function withOfficialQrCode(payment: PaymentInformation): PaymentInformation {
  const official = new Map(
    (OFFICIAL_PAYMENT_INFORMATION.methods ?? [])
      .filter((method) => method.qr_image)
      .map((method) => [method.method.trim().toLowerCase(), method]),
  )
  const fill = (method: PaymentMethodInformation): PaymentMethodInformation => {
    if (method.qr_image) return method
    const match = official.get(method.method.trim().toLowerCase())
    return match?.qr_image
      ? { ...method, qr_image: match.qr_image, qr_instructions: match.qr_instructions }
      : method
  }
  if (payment.methods) return { ...payment, methods: payment.methods.map(fill) }
  const filled = fill({
    method: payment.method ?? '',
    recipient_name: payment.recipient_name ?? '',
    account_identifier: payment.account_identifier,
    qr_image: payment.qr_image,
    qr_instructions: payment.qr_instructions,
  })
  return { ...payment, qr_image: filled.qr_image, qr_instructions: filled.qr_instructions }
}

function local(): PaymentInformation | null {
  try {
    const stored = valid(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'))
    return withOfficialQrCode(stored ?? OFFICIAL_PAYMENT_INFORMATION)
  } catch {
    return withOfficialQrCode(OFFICIAL_PAYMENT_INFORMATION)
  }
}

export const paymentInfoDB = {
  async get(): Promise<PaymentInformation | null> {
    if (!isFirebaseConfigured || !db) return local()
    try {
      const snap = await getDoc(doc(db, 'site_config', 'payment'))
      const stored = snap.exists() ? valid(snap.data()) : null
      return stored ? withOfficialQrCode(stored) : null
    } catch {
      return local()
    }
  },
  subscribe(callback: (payment: PaymentInformation | null) => void): () => void {
    if (!isFirebaseConfigured || !db) {
      callback(local())
      return () => undefined
    }
    return onSnapshot(
      doc(db, 'site_config', 'payment'),
      (snap) => {
        const stored = snap.exists() ? valid(snap.data()) : null
        callback(stored ? withOfficialQrCode(stored) : null)
      },
      () => callback(local()),
    )
  },
}
