import { BUSINESS, LISTINGS } from '../../config/site'
import type { LegalSection } from './types'

// -----------------------------------------------------------------------------
// Part A — Booking, payment and the stay (sections 1–10)
// -----------------------------------------------------------------------------
// These are the sections a Guest is most likely to be held to, so they carry
// the operational detail: what a hold means, when a booking is confirmed, what
// the money covers, and what happens when a Guest cancels or does not arrive.
// Figures that the Admin publishes live (the security deposit, the refund
// policy, the optional charges) are described by rule and read from the rates
// document on the page, not frozen here.
// -----------------------------------------------------------------------------

export const BOOKING_SECTIONS: LegalSection[] = [
  {
    id: 'about',
    title: 'About these terms',
    summary: 'What these terms cover, who they bind, and how they fit with the house rules and your booking.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'These terms and conditions, together with the house rules, the published rates and your booking confirmation (together, the “Agreement”), govern your use of the Hacienda de LuisAna website and any booking, stay, payment or access to the property.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is a private hospitality business in Luisiana, Laguna, Philippines. It provides accommodation and related on-site services. It is not a travel agency and does not arrange transport, tours, travel insurance or other travel services unless it agrees to do so in writing.',
      },
      { kind: 'sub', text: 'Who these terms bind' },
      {
        kind: 'list',
        items: [
          'Every guest named on a booking, and every person who stays in or visits the property during a booking.',
          'The account holder who makes the booking, even if someone else stays in the accommodation.',
          'Anyone who pays for a booking or sends payment proof, including a parent, guardian, employer or friend paying on the guest’s behalf.',
          'Anyone who uses the website, including a parent or guardian acting for a minor.',
        ],
      },
      { kind: 'sub', text: 'How to accept' },
      {
        kind: 'p',
        text: 'You accept these terms when you tick the acceptance box on the booking or payment step and submit a booking or payment. That tick is an electronic signature and acceptance under the Electronic Commerce Act of 2000 (Republic Act No. 8792). If you do not agree, do not book, pay or stay.',
      },
      {
        kind: 'p',
        text: 'We record the version of these terms you accepted, the date and time, and the booking it relates to. If these terms change, the version stamped on your booking is the one that governs that booking, except where a change is required by law or a safety rule applies immediately.',
      },
      { kind: 'sub', text: 'Order of precedence' },
      {
        kind: 'list',
        ordered: true,
        items: [
          'These terms.',
          'The booking confirmation and the version of the published rates stamped on it.',
          'The house rules.',
          'The FAQs and other website content. Website content is information, not a promise that overrides the Agreement.',
        ],
      },
      { kind: 'sub', text: 'Plain language' },
      {
        kind: 'p',
        text: 'Headings are for navigation only. “Including” means “including without limitation”. A reference to a law includes any amendment or re-enactment of it. The singular includes the plural. These terms are written in English; any translation is for convenience only.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Read the short version first.',
        text: 'The summary at the top of this page is a guide, not a substitute for the full terms. If the summary and the full terms differ, the full terms apply.',
      },
    ],
  },
  {
    id: 'who-we-are',
    title: 'Who we are and what we provide',
    summary: 'The business behind the booking, the property address, and the limits of what the Hacienda provides.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'Hacienda de LuisAna (“the Hacienda”, “we”, “us”) operates the property at Luisiana–Lucban Road, Brgy. San Isidro, Luisiana, Laguna, Philippines.',
      },
      {
        kind: 'table',
        caption: 'Business details',
        head: ['Detail', 'Information'],
        rows: [
          ['Trading name', BUSINESS.name],
          ['Property address', BUSINESS.address.formatted],
          ['Website', 'haciendadeluisana.com'],
          ['Phone', BUSINESS.contact.phoneDisplay],
          ['Email', BUSINESS.contact.email],
          ['Facebook', BUSINESS.contact.facebook],
          ['Instagram', BUSINESS.contact.instagram],
          ['Official listings', `${LISTINGS.airbnb.label} and ${LISTINGS.agoda.label}`],
        ],
      },
      {
        kind: 'p',
        text: 'The property is private land. A booking gives you a licence to use the booked accommodation and the shared areas reasonably necessary for your stay. It does not give you ownership, a lease, or any right to use the property outside the booking.',
      },
      {
        kind: 'p',
        text: 'We may refuse or cancel a booking at our discretion, including where the dates are unavailable, the information is incomplete or inaccurate, the booking appears fraudulent, the requested use is not permitted, or the booking would exceed the property’s capacity or safety limits. We will tell you the reason and, where money has been paid, apply the cancellation terms.',
      },
      {
        kind: 'p',
        text: 'We do not provide medical services, security guards, transport, childcare or travel insurance. Emergency and medical services are provided by the relevant public authorities.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Registration and permits.',
        text: 'For business registration, permit, tax or receipt details, contact us using the channels below. We will provide the documents that apply to your booking or inquiry.',
      },
    ],
  },
  {
    id: 'definitions',
    title: 'Definitions',
    summary: 'The words used throughout these terms, so the same word means the same thing in every section.',
    part: 'booking',
    blocks: [
      { kind: 'p', text: 'In these terms:' },
      {
        kind: 'table',
        head: ['Term', 'Meaning'],
        rows: [
          ['Booking', 'A reservation for one accommodation unit and one set of dates, created through the website or an official channel.'],
          ['Booking request', 'A booking that has been submitted but not yet approved. It is not a confirmed reservation.'],
          ['Confirmed booking', 'A booking the Admin has approved after verifying the downpayment or full payment. Only a confirmed booking gives access to the property.'],
          ['Pending', 'The status of a booking request while the Admin reviews it.'],
          ['Rejected', 'The status of a booking request the Admin declined. The reason is recorded and, where appropriate, sent to the guest.'],
          ['Expired', 'A booking request whose 24-hour hold ended without approval or payment.'],
          ['Guest', 'The person named on the booking, and any person staying in the booked accommodation.'],
          ['Admin', 'The person or team authorised by the Hacienda to manage bookings, payments, access and the property.'],
          ['Standard stay', 'A 22-hour stay: check-in at 2:00 PM and check-out by 12:00 noon the following day. A longer stay is successive standard stays, one per night.'],
          ['Stay total', 'The published rate for the accommodation and dates, plus any confirmed extras and the charge for additional guests, but excluding the security deposit.'],
          ['Downpayment', 'The percentage of the stay total the guest pays to request confirmation, as published on the payment step (currently 50%).'],
          ['Balance', 'The part of the stay total not paid as a downpayment, due at or before check-in.'],
          ['Security deposit', 'A refundable amount held against damage, loss or cleaning beyond normal use. It is separate from the stay total.'],
          ['Published rates', 'The rates document the Admin publishes in the site_config/rates record, as shown on the Rates page and the booking step.'],
          ['Refund policy snapshot', 'The cancellation and refund policy in force when the guest chose a payment plan, stamped on the booking.'],
          ['Official channels', 'The phone number, email address, Facebook page, Messenger, Instagram, the payment step of this website, and the Hacienda’s Airbnb and Agoda listings.'],
          ['Personal data', 'Any information relating to an identified or identifiable person, as defined in the Data Privacy Act of 2012 (Republic Act No. 10173).'],
          ['Processing', 'Any operation performed on personal data, including collection, recording, storage, use, disclosure and deletion.'],
          ['Force majeure', 'An event outside a party’s reasonable control that prevents or delays performance, as described in section 26.'],
        ],
      },
      {
        kind: 'p',
        text: 'A definition does not limit a right you have under mandatory Philippine law.',
      },
    ],
  },
  {
    id: 'eligibility',
    title: 'Eligibility and guest accounts',
    summary: 'Who may book, who may create an account, and who is responsible for a stay.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'You may create an account if you are at least 10 years old. However, a booking is a contract: you must be of legal age (18 years or older) to make a booking, pay for it and accept these terms. If you are under 18, a parent or legal guardian must make the booking, accept these terms and remain responsible for the stay, the guests and any damage or loss.',
      },
      {
        kind: 'p',
        text: 'Guests under 18 must be accompanied by a responsible adult during the stay. The accompanying adult is responsible for the minor’s conduct and safety.',
      },
      {
        kind: 'p',
        text: 'You agree to provide accurate, current and complete information about yourself, the guests, the dates, the accommodation and any pets. You must update your account and booking details if they change.',
      },
      {
        kind: 'p',
        text: 'You are responsible for keeping your login credentials confidential and for all activity under your account. Tell us immediately if you suspect unauthorized access. We may suspend an account that appears to be used for fraud, abuse, unlawful conduct or a security risk.',
      },
      {
        kind: 'p',
        text: 'One person may hold one guest account. Accounts may not be sold, shared or transferred. A booking may not be transferred to another account or person without our written consent.',
      },
      {
        kind: 'p',
        text: 'We may ask for a government-issued ID at check-in to confirm the identity of the booking guest. We will handle it as personal data under section 17.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Bookings made by someone other than the guest.',
        text: 'The person who makes the booking is responsible for ensuring that every guest knows and accepts these terms and the house rules, and for paying any amount due.',
      },
    ],
  },
  {
    id: 'accommodation',
    title: 'Accommodation, occupancy and permitted use',
    summary: 'What the booking includes, how many people may stay, and what the property may not be used for.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'The Hacienda offers the Main House, the Annex and A-House camping units. The description, sleeping arrangements, amenities and capacity of each unit are on the Stay page and in your booking confirmation.',
      },
      {
        kind: 'p',
        text: 'The rates include the number of guests stated in the published rates. Additional guests may incur a per-guest charge. Included occupancy is not a licence to exceed a published maximum, a fire-safety limit or the capacity of the unit.',
      },
      {
        kind: 'p',
        text: 'Every person who stays overnight must be included in the booking. Visitors must be approved by the Admin in advance, must follow these terms and the house rules, and must leave when the Admin asks.',
      },
      {
        kind: 'p',
        text: 'The booked unit is for the guest’s private use during the stay. Other units, private areas, staff areas and neighbouring land are not included unless the booking says so. The Hacienda may restrict access to areas for safety, maintenance, privacy or another guest’s stay.',
      },
      {
        kind: 'p',
        text: 'The accommodation may not be used for a party, event, reunion, team-building, shoot or other gathering that the Admin has not approved in writing; a commercial activity, including selling goods or services, soliciting or running a business; filming, photography or live streaming for commercial use; or any unlawful purpose.',
      },
      {
        kind: 'p',
        text: 'Weddings, reunions, team building, shoots and similar uses require the Admin’s discussion and written confirmation. No event charge is added automatically. The wedding-preparation overnight package applies only to a booking explicitly identified and confirmed for that purpose.',
      },
      {
        kind: 'p',
        text: 'You must not sublet, assign or share the accommodation with anyone outside the booking, and you must not exceed the occupancy limit.',
      },
      {
        kind: 'p',
        text: 'We may enter the accommodation without notice in an emergency, or with reasonable notice for inspection, maintenance, cleaning or safety, and we will respect your privacy as far as the circumstances allow.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Exclusive use.',
        text: 'A booking for one unit does not automatically give you exclusive use of the whole property. If you need the whole property for a private event, ask the Admin before booking.',
      },
    ],
  },
  {
    id: 'booking-rules',
    title: 'Booking requests, holds and confirmation',
    summary: 'How a request becomes a confirmed booking, what a 24-hour hold means, and when the Admin may decline.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'A booking is a request, not a confirmed reservation. The process is: you submit a booking request with the dates, unit, guests and any extras; the dates are held for 24 hours; the Admin reviews the request and the payment proof; the Admin approves or rejects it; if the hold expires before approval, the dates are released.',
      },
      {
        kind: 'p',
        text: 'A held date is not a confirmed reservation. The hold prevents the system from offering the same dates to another guest while the request is reviewed, but it does not guarantee that the booking will be approved.',
      },
      {
        kind: 'p',
        text: 'The Admin may decline a request for any lawful reason, including that the dates are no longer available, the information is incomplete or inaccurate, the requested use is not permitted, the occupancy or safety limits would be exceeded, the payment proof is unclear or unverifiable, or the request appears fraudulent. The reason is recorded and, where appropriate, sent to you.',
      },
      {
        kind: 'p',
        text: 'A booking is confirmed only when the Admin approves it after verifying the downpayment or full payment. Until then, the booking status is Pending. If the payment proof is declined, the booking is Rejected. If the hold expires, the booking is Expired.',
      },
      {
        kind: 'p',
        text: 'The confirmation records the accommodation, dates, guests, rate version, stay total, downpayment, balance, security deposit, refund policy snapshot and the version of these terms you accepted. Later changes to the published rates or these terms do not rewrite a confirmed booking, except where a change is required by law or a safety rule applies immediately.',
      },
      {
        kind: 'p',
        text: 'Check-in cannot be in the past. Check-out must be after check-in. Stays are 1–20 nights. Check-in must be at least 30 days before the arrival date, or the minimum lead time shown on the booking page if the Admin has published a different period.',
      },
      {
        kind: 'p',
        text: 'Only one active booking identity is attached to a booking at creation. It cannot be claimed later by another account. If you need to change the guest name, contact the Admin before check-in.',
      },
      {
        kind: 'p',
        text: 'A change to the dates, unit or occupancy after confirmation is a new request. It is subject to availability, the rates in force at the time of the change, and the refund policy. Do not assume a change is confirmed until you receive written confirmation.',
      },
      {
        kind: 'p',
        text: 'If a booking is not confirmed before the hold expires, the dates are released and any payment proof is reviewed against the refund policy. The Hacienda is not obliged to hold dates indefinitely.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Do not travel on an unconfirmed booking.',
        text: 'A Pending booking does not entitle you to check in, and the property may be occupied by another guest.',
      },
    ],
  },
  {
    id: 'rates',
    title: 'Rates, fees and what is included',
    summary: 'How the stay total is calculated, which optional charges apply, and what is already included.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'Rates are in Philippine pesos (₱). The published rate for each unit is a per-standard-stay rate, with separate weekday and weekend/holiday schedules and a per-guest charge for guests above the included count. The rate that applies to your booking is the one shown before you submit and stamped on the confirmation.',
      },
      {
        kind: 'p',
        text: 'The stay total is the published rate for the unit and dates, plus the charge for additional guests and any extras the Admin has confirmed in writing. The security deposit is separate and is not part of the stay total.',
      },
      {
        kind: 'p',
        text: 'The following optional charges may apply when you request them and the Admin confirms them: pet sanitation ₱300 per pet; bonfire wood set ₱150 per set; approved late checkout ₱250 per hour after 12:00 noon; wedding-preparation overnight package ₱8,500 for up to 10 guests, only for a booking explicitly identified and confirmed for that purpose; and any special-event charge the Admin confirms in writing. The current amounts are on the Rates page.',
      },
      {
        kind: 'p',
        text: 'The following are included in the stay at no extra charge, subject to the unit and the published rates: Wi-Fi, parking, use of the gas stove and kitchen utensils, the ihawan (grill), the bonfire pit, air conditioning, a rice cooker, television and piano, refrigerator, microwave and electric kettle, and the dedicated workspace or patio/balcony. The Stay page lists what each unit includes.',
      },
      {
        kind: 'p',
        text: 'Any tax or statutory charge that applies to your booking will be disclosed before you pay. If a rate is quoted inclusive of a tax, it will say so. We do not add hidden charges.',
      },
      {
        kind: 'p',
        text: 'No event charge is added automatically. Reunions, team building, shoots and weddings require the Admin’s discussion and written confirmation of any agreed amount.',
      },
      {
        kind: 'p',
        text: 'If the Admin publishes a new rate after your booking is confirmed, the new rate does not apply to your booking. If the Admin publishes a lower rate before you pay, we will honour the lower rate for your confirmed dates if you tell us before paying.',
      },
      {
        kind: 'p',
        text: 'We may correct a pricing error before you pay. If you have already paid, we will discuss a fair resolution, including a refund of the difference.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'The Rates page is the live source.',
        text: 'The figures on this page are the published optional charges at the version date. The Rates page and your booking confirmation always show the current amounts.',
      },
    ],
  },
  {
    id: 'payment',
    title: 'Payment terms and payment verification',
    summary: 'The downpayment, the balance, the security deposit, and how the Admin verifies a payment.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'Pay the downpayment using the official payment methods shown on the payment step. The current methods are GCash and BDO InstaPay, using the QR codes the Admin publishes on the payment step. The remaining balance is due at or before check-in, unless you chose full payment.',
      },
      {
        kind: 'p',
        text: 'The downpayment is 50% of the stay total, rounded down to whole centavos, plus the security deposit. The payment step shows the exact amount, the recipient name and the QR code. The security deposit is refundable after check-out inspection and is separate from the stay total.',
      },
      {
        kind: 'p',
        text: 'A screenshot or photo of the transfer is required before the booking can be submitted. Upload a clear image that shows the amount, date, reference number and recipient. OCR may suggest a reference and amount; you must confirm or correct them. OCR is not a decision: the booking stays Pending until an Admin approves or rejects the screenshot.',
      },
      {
        kind: 'p',
        text: 'We verify payment against the official account and the reference number. We may ask for more information or a clearer image. We will not approve a booking based on a screenshot alone if the payment cannot be verified.',
      },
      {
        kind: 'p',
        text: 'Do not send passwords, PINs, one-time codes (OTPs), banking credentials or remote access to your device. We never ask for them. If someone asks, stop and contact us through the official channels.',
      },
      {
        kind: 'p',
        text: 'Pay only through the official channels. We do not accept payment to a personal account that is not published on the payment step, and we are not responsible for money sent to a third party or an unofficial channel.',
      },
      {
        kind: 'p',
        text: 'If you believe you have paid a scammer or sent money to the wrong account, contact your bank or e-wallet immediately, report the incident to the Philippine National Police Anti-Cybercrime Group or the National Bureau of Investigation, and tell us what happened. We will cooperate with the investigation.',
      },
      {
        kind: 'p',
        text: 'If you dispute a payment with your bank or e-wallet after we have confirmed the booking, the booking may be cancelled and the property may be released. Talk to us first so we can resolve the issue.',
      },
      {
        kind: 'p',
        text: 'We issue a receipt or acknowledgment for payments made through the official channels. Ask for it at check-in or by email. Receipts are issued in the name of the booking guest or the person who paid, as you request.',
      },
      {
        kind: 'p',
        text: 'Bookings made through Airbnb or Agoda are paid to those platforms under their terms. The platform’s payment, cancellation and refund terms apply to that transaction; the Hacienda’s stay rules apply on-site.',
      },
      {
        kind: 'note',
        tone: 'danger',
        title: 'Never pay a deposit to a person who contacts you privately.',
        text: 'This includes anyone who claims to be the owner or staff, or asks you to send money to a personal account. Verify through the phone number or email on the Contact page before paying.',
      },
    ],
  },
  {
    id: 'cancellation',
    title: 'Cancellations, refunds, no-shows and changes',
    summary: 'How to cancel, which refund policy applies, what happens to the security deposit, and what a no-show means.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'Refunds follow the published rates policy stamped on your booking when you chose a payment plan. The current published policy is shown below. This is the current policy, not necessarily the one stamped on an existing booking. Check your booking’s recorded policy for the terms that apply to it.',
      },
      {
        kind: 'p',
        text: 'If no policy was published at that moment, a cancellation refunds nothing. The security deposit is refundable after check-out inspection, separate from the stay total, less any deductions for damage, loss or cleaning beyond normal use.',
      },
      {
        kind: 'p',
        text: 'To cancel, contact the Admin through an official channel and include your booking reference. A cancellation is effective when the Admin acknowledges it in writing. A cancellation request sent to an unofficial channel is not effective.',
      },
      {
        kind: 'p',
        text: 'Approved refunds are processed through the refund pipeline after the payment is verified. We will refund to the original payment channel where practicable. Your bank or e-wallet may take additional time to post the credit. We are not responsible for delays caused by the payment provider.',
      },
      {
        kind: 'p',
        text: 'If you do not arrive and do not contact us before the check-in date, the booking may be treated as a no-show. The stay amount may be non-refundable under the refund policy, and the dates may be released. If we cannot reach you, we may cancel the booking after the check-in date.',
      },
      {
        kind: 'p',
        text: 'If you leave early, the unused nights are not refunded unless the Admin agrees in writing. The refund policy may still apply to the cancelled portion if the Admin agrees.',
      },
      {
        kind: 'p',
        text: 'The security deposit is returned after check-out inspection, less any amount agreed or itemized for damage, loss, missing items, or cleaning beyond normal use. We will give you an itemized statement and the reason for any deduction. Any balance is refunded through the original payment channel where practicable.',
      },
      {
        kind: 'p',
        text: 'Refunds are not automatic. You must request a refund and provide the information we need to verify the payment. We will not refund an amount that has already been refunded or applied to another booking.',
      },
      {
        kind: 'p',
        text: 'If the Hacienda cancels a confirmed booking for a reason within its control, you may choose a reschedule or a full refund of the amounts paid for the cancelled stay. If the Hacienda cancels because of force majeure, section 26 applies.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Book travel insurance.',
        text: 'The Hacienda’s refund policy is limited to the amounts you paid for the stay. It does not cover your travel, accommodation elsewhere, transport or other losses.',
      },
    ],
  },
  {
    id: 'stay',
    title: 'Check-in, check-out and the standard stay',
    summary: 'The 22-hour stay, arrival, late checkout, cleaning, keys and what to do if something goes wrong.',
    part: 'booking',
    blocks: [
      {
        kind: 'p',
        text: 'The standard 22-hour stay checks in at 2:00 PM and checks out by 12:00 noon the following day. A longer stay is successive standard stays, one per night. The check-in and check-out times are on your booking confirmation and the Rates page.',
      },
      {
        kind: 'p',
        text: 'Check-in is at the property. Contact the Admin when you are on the way or when you arrive, using the official channels. We may ask for a government-issued ID and the booking reference.',
      },
      {
        kind: 'p',
        text: 'Early check-in and late checkout are by request and approval, subject to availability. Approved late checkout is ₱250 per hour after 12:00 noon. Do not assume an early check-in or late checkout is approved until the Admin confirms it.',
      },
      {
        kind: 'p',
        text: 'Access is granted only for a Reserved or in-stay booking on the valid dates, using an RFID credential or the in-app Mobile Key. See section 15 for the access rules.',
      },
      {
        kind: 'p',
        text: 'You are responsible for the accommodation and its contents during your stay. Keep doors and windows secure, use the facilities reasonably, and follow the house rules and any safety instructions.',
      },
      {
        kind: 'p',
        text: 'Please leave the accommodation reasonably clean and tidy. “Clean as you go” means washing what you use, taking out what you bring in, and leaving the unit ready for the next guest. If cleaning beyond normal use is needed, the Hacienda may charge a reasonable cleaning fee or deduct it from the security deposit, with an itemized statement.',
      },
      {
        kind: 'p',
        text: 'Report damage, loss or a maintenance problem immediately. Do not attempt repairs yourself. The Hacienda will arrange the repair and discuss the cost with you.',
      },
      {
        kind: 'p',
        text: 'Lost property is held for a reasonable period. We will try to return it, but you are responsible for the shipping cost. We are not responsible for items left behind.',
      },
      {
        kind: 'p',
        text: 'Quiet enjoyment: please keep noise reasonable, especially at night, out of respect for other guests and the neighbours. The property is in a rural area; sound carries.',
      },
      {
        kind: 'p',
        text: 'Check-out is by 12:00 noon. Return all keys, RFID cards and access devices, and leave the unit in the condition described above. If you need a late checkout, ask the Admin before 12:00 noon.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Arrival outside the property.',
        text: 'The road to the property is narrow and the house is a short walk from the parking area. Confirm the exact location and parking with the Admin before travelling, and use the landmark on the Location page.',
      },
    ],
  },
]
