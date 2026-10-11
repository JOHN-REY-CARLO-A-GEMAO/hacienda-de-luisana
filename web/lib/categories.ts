export type Category = {
  id: string
  name: string
  description: string
  kind: 'accommodation' | 'payment' | 'inquiry' | 'service'
  active: boolean
}

export const CATEGORIES: Category[] = [
  {
    id: 'main-house',
    name: 'Main House',
    description: 'The private main house stay.',
    kind: 'accommodation',
    active: true,
  },
  {
    id: 'camping',
    name: 'Camping',
    description: 'Camping units on the grounds.',
    kind: 'accommodation',
    active: true,
  },
  {
    id: 'gcash',
    name: 'GCash',
    description: 'External GCash transfer with receipt upload.',
    kind: 'payment',
    active: true,
  },
  {
    id: 'bank-transfer',
    name: 'Bank transfer',
    description: 'External bank transfer with receipt upload.',
    kind: 'payment',
    active: true,
  },
  {
    id: 'booking',
    name: 'Booking inquiry',
    description: 'Questions about dates, units, or a current booking.',
    kind: 'inquiry',
    active: true,
  },
  {
    id: 'payment-help',
    name: 'Payment help',
    description: 'Questions about receipts, references, or verification.',
    kind: 'inquiry',
    active: true,
  },
  {
    id: 'access',
    name: 'Access / smart lock',
    description: 'RFID and Mobile Key issues during a stay.',
    kind: 'inquiry',
    active: true,
  },
]

export function activeCategories(kind?: Category['kind']): Category[] {
  return CATEGORIES.filter((c) => c.active && (!kind || c.kind === kind))
}

export function isActiveCategory(id: string, kind?: Category['kind']): boolean {
  return activeCategories(kind).some((c) => c.id === id)
}
