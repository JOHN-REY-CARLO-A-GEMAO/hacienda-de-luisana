// ----------------------------------------------------------------------------
// The Guest tour script
// Hacienda de LuisAna
// ----------------------------------------------------------------------------
// The order follows the real life of a Booking: browse → request → hold →
// follow it at /account → chat → access with an RFID or Mobile Key → review.
// The vocabulary matches CONTEXT.md (Booking, Date hold, Payment plan,
// Reserved…) so the tour teaches the same words the booking flow uses.
// ----------------------------------------------------------------------------

import type { TourStep } from './types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const GUEST_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    eyebrow: 'Guest tour',
    title: 'Kumusta! Let’s walk through your first stay',
    body:
      'This is a hands-on tour of the Hacienda website: instead of slides, it highlights the real buttons and pages ' +
      'you will use, and asks you to try each one. It takes about two minutes, and you can replay it anytime.',
    why: 'You can leave anytime with Exit — nothing here is a trap, and the tour never blocks normal browsing.',
    continueLabel: 'Start the tour',
  },
  {
    id: 'stay',
    route: '/',
    targets: ['accommodation-cta', 'nav-book', 'mobile-cta', 'hero-cta'],
    eyebrow: 'Guest tour',
    title: 'Choose how you want to stay',
    body:
      'Each card is an Accommodation you can book — the private Main House for the whole barkada, or a camping unit. ' +
      'The rate on each card is the figure the Hacienda has published — its Published rates when there are any, otherwise its listed price — and the final quote is always confirmed with you.',
    why: 'Picking “Book this room” carries your choice into the Booking form. No account is required.',
    actionHint: 'Tap “Book this room” on a stay card to continue.',
    await: { type: 'click' },
  },
  {
    id: 'dates',
    route: '/book',
    targets: ['stay-details'],
    eyebrow: 'Guest tour · 1 of 5 — your request',
    title: 'Pick your dates first',
    body:
      'Every Booking starts with dates. While you choose, the website checks them against the live calendar — ' +
      'if another Booking is holding those nights you will see it here before you send anything.',
    why: 'A hold lasts 24 hours while the Hacienda reviews a request, so picking free dates means your request goes straight through.',
    actionHint: 'Choose a Check-in and a Check-out date to continue.',
    await: {
      type: 'fields',
      fields: [
        { field: 'check-in', ok: (v) => ISO_DATE.test(v) },
        { field: 'check-out', ok: (v, all) => ISO_DATE.test(v) && (!ISO_DATE.test(all['check-in']) || v > all['check-in']) },
      ],
    },
  },
  {
    id: 'party',
    route: '/book',
    targets: ['accommodation-field'],
    eyebrow: 'Guest tour · 2 of 5 — your request',
    title: 'Tell us who’s coming',
    body:
      'Set the headcount and the Accommodation here — the summary on the right follows your choices and shows the ' +
      'estimated total at the published rate. The Hacienda confirms the final figure before anything is reserved.',
    why: 'Capacity is checked against the Accommodation, so an honest headcount saves a back-and-forth later.',
    continueLabel: 'Next',
  },
  {
    id: 'details',
    route: '/book',
    targets: ['guest-details'],
    eyebrow: 'Guest tour · 3 of 5 — your details',
    title: 'Who do we confirm with?',
    body:
      'Your name, mobile number and email are how the Hacienda reaches you about this exact request — a real person ' +
      'reviews it, not an auto-responder. Special requests (birthdays, pets, late arrival) ride along with the Booking.',
    actionHint: 'Type your name to continue — fill the mobile and email too, the request needs them.',
    why: 'Signed-in Guests have these pre-filled and never type them twice.',
    await: {
      type: 'fields',
      fields: [{ field: 'guest-name', ok: (v) => v.trim().length >= 2 }],
    },
  },
  {
    id: 'terms',
    route: '/book',
    targets: ['terms'],
    eyebrow: 'Guest tour · 4 of 5 — the fine print',
    title: 'Read and accept the Terms',
    body:
      'One checkbox covers the Terms, privacy policy, cancellation and smart-lock rules — the link opens the exact ' +
      'version you are accepting. Nobody accepts it for you: the Booking records that you did.',
    actionHint: 'Tick the checkbox to continue.',
    await: { type: 'checked' },
  },
  {
    id: 'send',
    route: '/book',
    targets: ['submit-booking'],
    eyebrow: 'Guest tour · 5 of 5 — send it',
    title: 'Continue to the downpayment',
    body:
      'This step does not submit the booking. Next you upload a screenshot of the downpayment — that file is ' +
      'required. The booking is then Pending until an admin approves or rejects the proof. It is not confirmed yet.',
    why: 'A booking without a downpayment screenshot is not a booking.',
    actionHint: 'Press “Continue to downpayment” to open the payment page.',
    await: { type: 'click' },
  },
  {
    id: 'sent',
    route: '/book/pay',
    targets: ['payment-proof', 'booking-success'],
    eyebrow: 'Guest tour',
    title: 'Upload the downpayment screenshot',
    body:
      'The booking is submitted only after a screenshot is attached, and it stays Pending until the Hacienda ' +
      'approves or rejects it. In demo mode the review desk on this website makes that decision.',
    why: 'No screenshot, no booking. Approval is what confirms the stay.',
    continueLabel: 'Next',
  },
  {
    id: 'account',
    route: '/account',
    targets: ['booking-card', 'account-tools'],
    eyebrow: 'Guest tour',
    title: 'My Bookings — follow your own stay',
    body:
      'Everything about your Booking lives here: its status as it moves Pending → Approved, and the decision the ' +
      'Hacienda made on your downpayment screenshot. A request that hasn’t been reviewed yet can also be withdrawn from here.',
    fallbackBody:
      'My Bookings is where your requests live once you are signed in: statuses, the Date hold, your ID upload, ' +
      'your Payment plan, and the withdraw button. Sign in as a Guest and this page fills with your own stay.',
    why: 'Only you can read this page — the database checks the identity each Booking was created with.',
    continueLabel: 'Next',
  },
  {
    id: 'account-next',
    route: '/account',
    targets: ['booking-card', 'account-tools'],
    eyebrow: 'Guest tour',
    title: 'After approval: pay, upload, arrive',
    body:
      'Approval is the confirmation: the Hacienda accepted the screenshot. On your stay dates your RFID card or ' +
      'in-app Mobile Key opens the door — every unlock, granted or denied, is logged. After check-out you can leave ' +
      'a star rating and a review here.',
    fallbackBody:
      'The life of a Booking after approval: choose a Payment plan, pay externally and upload the receipt for ' +
      'verification; a verified payment makes the stay Reserved. On stay dates an RFID card or the Mobile Key opens ' +
      'the door (unlock attempts are logged), and after check-out you can leave a review.',
    continueLabel: 'Next',
  },
  {
    id: 'messages',
    route: '/messages',
    targets: ['message-composer'],
    eyebrow: 'Guest tour',
    title: 'Chat with the Admin',
    body:
      'Questions about your dates, a GCash reference, a birthday setup? This chat goes straight to the Admin app — ' +
      'only your conversation is visible here. Pick a topic and write below; the Admin answers from the same app ' +
      'that reviewed your Booking.',
    fallbackBody:
      'The Messages page is a direct line to the Admin — topics, your own thread only, answers from the same app ' +
      'that handles your Booking. Sign in as a Guest to use it.',
    actionHint: 'Type a message to try it — you don’t have to send it.',
    await: { type: 'fields', fields: [{ field: 'message', ok: (v) => v.trim().length > 0 }] },
  },
  {
    id: 'done',
    eyebrow: 'Guest tour',
    title: 'You know your way around now',
    body:
      'That’s the whole journey: pick a stay, send your details, upload the downpayment screenshot, and wait for ' +
      'the Hacienda to approve or reject it. Chat is always one tap away. ' +
      'The “Replay tutorial” button (bottom right) brings this tour back whenever you want.',
    continueLabel: 'Finish',
  },
]
