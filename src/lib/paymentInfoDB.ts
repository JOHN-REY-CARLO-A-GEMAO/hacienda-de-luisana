import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db, isFirebaseConfigured } from './firebase'
import { OFFICIAL_PAYMENT_INFORMATION } from '../config/officialBusiness'

export type PaymentMethodInformation = {
  method: string
  recipient_name: string
  account_identifier: string
}

export type PaymentInformation = {
  active: boolean
  /** Multiple official channels; legacy documents may use the three singular fields below. */
  methods?: PaymentMethodInformation[]
  method?: string
  recipient_name?: string
  account_identifier?: string
  instructions: string
  security_deposit_notes?: string
  notes?: string
}

export type PaymentInformationProblem = { path: string; message: string }

const LOCAL_KEY = 'hdl:payment-information'

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

export function validatePaymentInformation(value: unknown): PaymentInformationProblem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: '', message: 'payment information must be an object.' }]
  }
  const doc = value as Record<string, unknown>
  const problems: PaymentInformationProblem[] = []
  if (typeof doc.active !== 'boolean') problems.push({ path: 'active', message: 'must be true or false.' })
  if (doc.methods !== undefined) {
    if (!Array.isArray(doc.methods) || doc.methods.length < 1 || doc.methods.length > 5) {
      problems.push({ path: 'methods', message: 'must list between 1 and 5 public payment methods.' })
    } else {
      doc.methods.forEach((method, index) => {
        const item = method as Record<string, unknown>
        if (typeof method !== 'object' || method === null || Array.isArray(method)
            || !text(item.method, 80) || !text(item.recipient_name, 120) || !text(item.account_identifier, 120)) {
          problems.push({ path: `methods[${index}]`, message: 'must include method, recipient_name and account_identifier.' })
        }
      })
    }
  } else {
    if (!text(doc.method, 80)) problems.push({ path: 'method', message: 'is required (80 characters maximum).' })
    if (!text(doc.recipient_name, 120)) problems.push({ path: 'recipient_name', message: 'is required (120 characters maximum).' })
    if (!text(doc.account_identifier, 120)) problems.push({ path: 'account_identifier', message: 'is required (120 characters maximum).' })
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

function local(): PaymentInformation | null {
  try {
    const stored = valid(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'))
    return stored ?? OFFICIAL_PAYMENT_INFORMATION
  } catch {
    return OFFICIAL_PAYMENT_INFORMATION
  }
}

export const paymentInfoDB = {
  async get(): Promise<PaymentInformation | null> {
    if (!isFirebaseConfigured || !db) return local()
    try {
      const snap = await getDoc(doc(db, 'site_config', 'payment'))
      return snap.exists() ? valid(snap.data()) : null
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
      (snap) => callback(snap.exists() ? valid(snap.data()) : null),
      () => callback(local()),
    )
  },
}
