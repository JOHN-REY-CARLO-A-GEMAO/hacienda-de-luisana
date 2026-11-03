import type { LegalSection } from './types'

// -----------------------------------------------------------------------------
// Part C — Privacy and personal data (sections 17–20)
// -----------------------------------------------------------------------------
// The Hacienda processes names, contact details, payment screenshots, messages
// and access logs. That is personal data under the Data Privacy Act of 2012
// (RA 10173), and the privacy notice has to say what is collected, why, who it
// is shared with, how long it is kept, and how a Guest exercises their rights.
// The retention periods here match the product: chat is swept 90 days after a
// booking reaches a terminal status, and booking/payment records are kept for
// accounting and legal purposes.
// -----------------------------------------------------------------------------

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    id: 'privacy',
    title: 'Privacy policy — scope and principles',
    summary: 'How the Hacienda handles personal data under the Data Privacy Act, and how to make a privacy request.',
    part: 'privacy',
    blocks: [
      {
        kind: 'p',
        text: 'This section explains how the Hacienda collects, uses, shares, retains and protects personal data when you use the website, make a booking, stay at the property, or contact us. It is the Hacienda’s privacy notice under the Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is the personal information controller for the personal data described in this section. Our privacy contact is the Admin at haciendadeluisiana@gmail.com. Please use the subject line “Privacy request”.',
      },
      {
        kind: 'p',
        text: 'We process personal data lawfully, fairly and transparently, for a specific and legitimate purpose, and only to the extent necessary. We keep it accurate, secure and retained only as long as needed.',
      },
      {
        kind: 'p',
        text: 'We do not sell personal data. We do not use your personal data for automated decision-making that produces legal or similarly significant effects, except as described in this notice.',
      },
      {
        kind: 'p',
        text: 'This notice covers the website and the stay. It does not cover third-party platforms such as Airbnb, Agoda, GCash, BDO, Google or Facebook, which have their own privacy notices. We encourage you to read them.',
      },
      {
        kind: 'p',
        text: 'If you are a guest from outside the Philippines, your data may be transferred to the Philippines and processed there. See section 19.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Privacy questions.',
        text: 'For any privacy question, request or complaint, email haciendadeluisiana@gmail.com with the subject line “Privacy request”. We will verify your identity before acting on a request.',
      },
    ],
  },
  {
    id: 'privacy-data',
    title: 'Personal data we collect and why',
    summary: 'The categories of data, the examples, and the purpose each one serves.',
    part: 'privacy',
    blocks: [
      { kind: 'p', text: 'We collect the following categories of personal data:' },
      {
        kind: 'table',
        head: ['Category', 'Examples', 'Why we collect it'],
        rows: [
          [
            'Identity and contact',
            'Name, email address, phone number, account username, profile photo if you add one',
            'To create and manage your account, contact you about your booking, and verify your identity.',
          ],
          [
            'Booking details',
            'Dates, accommodation, number of guests, special requests, pets, arrival time, booking reference, status',
            'To manage the booking, allocate the unit, plan staffing and services, and keep records.',
          ],
          [
            'Payment information',
            'Payment method, amount, date, reference number, screenshot or photo of the receipt, recipient name',
            'To verify payment, confirm the booking, process refunds, and meet accounting and legal obligations. We do not store full card numbers or banking credentials; payments are made through GCash or BDO.',
          ],
          [
            'Messages',
            'The content of your messages with the Hacienda, attachments, timestamps',
            'To answer your questions, coordinate the stay, resolve disputes, and keep a record.',
          ],
          [
            'Access logs',
            'Timestamp, result (granted or denied), reason, credential type',
            'To control access, protect the property and guests, investigate incidents, and comply with the law.',
          ],
          [
            'Device and technical data',
            'Browser type, device type, IP address, pages visited, referral source, error logs',
            'To operate and secure the website, diagnose problems, and understand how the site is used.',
          ],
          [
            'Uploaded content',
            'Photos or documents you upload, such as a payment screenshot or a review photo',
            'For the purpose you uploaded them, such as payment verification or a review.',
          ],
          [
            'Communications with authorities',
            'Records of a report, request or incident',
            'To cooperate with law enforcement, regulators and emergency services.',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'We collect this data directly from you, automatically when you use the website, and from third parties such as Airbnb or Agoda if you book through them, or from payment providers when you pay.',
      },
      {
        kind: 'p',
        text: 'We do not intentionally collect sensitive personal information such as your race, religion, political affiliation, health, genetic data, sexual orientation or criminal record. Payment screenshots may contain account numbers; we treat them as confidential and use them only to verify the payment.',
      },
      {
        kind: 'p',
        text: 'We do not ask for your password, PIN, OTP or banking credentials. Never send them to us or to anyone claiming to be the Hacienda.',
      },
      {
        kind: 'p',
        text: 'If you provide personal data about another person, such as a guest or an emergency contact, you must have their permission and tell them about this notice.',
      },
      {
        kind: 'p',
        text: 'We do not use the website to make automated decisions that produce legal or similarly significant effects. The Admin reviews bookings and payment proofs manually.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Do not upload more than needed.',
        text: 'Send only the payment screenshot and information we ask for. Do not include unrelated personal data in a message or upload.',
      },
    ],
  },
  {
    id: 'privacy-sharing',
    title: 'Sharing, transfers and retention',
    summary: 'Who receives the data, where it may be processed, and how long each record is kept.',
    part: 'privacy',
    blocks: [
      {
        kind: 'p',
        text: 'We share personal data only with the following categories of recipients, and only for the purposes described in this notice:',
      },
      {
        kind: 'table',
        head: ['Recipient', 'Purpose', 'Safeguards'],
        rows: [
          [
            'Service providers',
            'Firebase (Google) for authentication, database and file storage; Supabase for database services; Vercel for website hosting; email or SMS providers for notifications',
            'We use provider terms and security features, and we do not allow them to use your data for their own marketing.',
          ],
          [
            'Payment providers',
            'GCash and BDO, to process payments and verify transfers',
            'Their own terms and privacy notices apply.',
          ],
          [
            'Professional advisers',
            'Lawyers, accountants and auditors, to obtain advice, meet legal obligations or resolve a dispute',
            'They are bound by confidentiality.',
          ],
          [
            'Authorities',
            'The Philippine National Police, National Bureau of Investigation, courts, regulators and local government, when required by law, a valid legal process, or to protect the rights and safety of the Hacienda, guests or the public',
            'We disclose only what is required and keep a record of the request.',
          ],
          [
            'A successor',
            'A buyer or successor in a merger, acquisition or sale of the business',
            'As part of the transaction, subject to this notice.',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'We do not sell personal data. We do not share it with third parties for their own marketing.',
      },
      {
        kind: 'p',
        text: 'Some service providers may process data outside the Philippines, including in the United States or the European Union. We use providers that offer appropriate safeguards, and we transfer data only for the purposes described in this notice. The Data Privacy Act applies to the processing, regardless of where it takes place.',
      },
      {
        kind: 'p',
        text: 'We retain personal data only as long as needed for the purpose it was collected, or as required by law:',
      },
      {
        kind: 'table',
        head: ['Record', 'Retention'],
        rows: [
          ['Account data', 'For as long as your account is open, and for a reasonable period after it is closed to resolve disputes and meet legal obligations.'],
          ['Booking and payment records', 'For the period required by accounting, tax and other laws, and for as long as needed to resolve a dispute or claim.'],
          ['Chat messages', 'For 90 days after the booking reaches a terminal status (Completed, Cancelled, Rejected or Expired), unless a longer period is needed for a dispute or legal obligation. The Admin may extend the retention for a specific conversation.'],
          ['Access logs', 'For a reasonable period for security, incident investigation and legal compliance.'],
          ['Website technical logs', 'For a short period for security and troubleshooting, unless needed for an investigation.'],
          ['Marketing preferences', 'Until you unsubscribe or withdraw consent.'],
        ],
      },
      {
        kind: 'p',
        text: 'When the retention period ends, we delete or anonymize the data. Some data may remain in backups for a short period until the backups are overwritten.',
      },
      {
        kind: 'p',
        text: 'We may keep a record of a booking even after a stay ends, because it is a financial and legal record. We do not keep chat messages indefinitely.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Chat retention.',
        text: 'A conversation is kept while the booking is active. When the booking reaches a terminal status, the conversation is scheduled for deletion 90 days later. The Admin can extend this for a specific conversation if a stay or dispute needs it.',
      },
    ],
  },
  {
    id: 'privacy-rights',
    title: 'Your privacy rights, cookies and security',
    summary: 'How to access, correct or erase your data, how cookies are used, and how the Hacienda protects the data.',
    part: 'privacy',
    blocks: [
      {
        kind: 'p',
        text: 'Under the Data Privacy Act, you have the right to: be informed about the processing of your personal data; object to the processing; access your personal data; rectify inaccurate or incomplete data; erase or block data where there is no lawful basis to keep it; claim damages for a violation; file a complaint with the National Privacy Commission; and, where applicable, data portability.',
      },
      {
        kind: 'p',
        text: 'To exercise a right, email haciendadeluisiana@gmail.com with the subject line “Privacy request”. We may ask you to verify your identity. We will respond within the period required by the Data Privacy Act and its Implementing Rules and Regulations. We will not charge a fee for a reasonable request.',
      },
      {
        kind: 'p',
        text: 'If you are not satisfied with our response, you may complain to the National Privacy Commission. The NPC’s website is privacy.gov.ph. You may also contact the Hacienda’s privacy contact first so we can try to resolve the issue.',
      },
      {
        kind: 'p',
        text: 'We use cookies and local storage for essential functions: keeping you signed in, remembering your booking draft, remembering your preferences, and protecting the website from abuse. We do not use advertising cookies or sell data to advertisers.',
      },
      {
        kind: 'p',
        text: 'You can clear or block cookies and local storage in your browser. Some features may stop working, such as staying signed in or completing a booking. We do not use cookies to track you across other websites.',
      },
      {
        kind: 'p',
        text: 'We use reasonable technical and organizational measures to protect personal data: access controls, database security rules, encryption in transit, least-privilege access, and staff confidentiality. No system is perfectly secure, but we work to protect your data.',
      },
      {
        kind: 'p',
        text: 'If a data breach occurs, we will notify affected individuals and the National Privacy Commission as required by the Data Privacy Act and its Implementing Rules and Regulations, and we will take reasonable steps to contain and remedy the breach.',
      },
      {
        kind: 'p',
        text: 'We keep personal data accurate and up to date. You can update your account details in your profile or by contacting us.',
      },
      {
        kind: 'p',
        text: 'Our website is not directed to children under 10. If you believe a child under 10 has provided personal data, contact us and we will delete it.',
      },
      {
        kind: 'p',
        text: 'We may update this privacy notice. The current version is on this page, with the version date. Material changes will be posted on the website and, where appropriate, sent to you.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Your responsibility.',
        text: 'Keep your account credentials and devices secure. Do not share your password, PIN or OTP with anyone, including someone claiming to be the Hacienda. We will never ask for them.',
      },
    ],
  },
]
