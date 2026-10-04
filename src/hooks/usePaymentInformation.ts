import { useEffect, useState } from 'react'
import { paymentInfoDB, type PaymentInformation } from '../lib/paymentInfoDB'

/** Valid, active public payment instructions, or null when Admin configuration is unavailable/invalid. */
export function usePaymentInformation(): PaymentInformation | null {
  const [payment, setPayment] = useState<PaymentInformation | null>(null)
  useEffect(() => paymentInfoDB.subscribe((value) => setPayment(value?.active ? value : null)), [])
  return payment
}
