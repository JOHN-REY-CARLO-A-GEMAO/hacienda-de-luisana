/// The Admin tour script.
///
/// The order follows the same Booking lifecycle the Guest's web tour teaches
/// (request → review → approval → payment → Reserved → stay → review), seen
/// from the operator's seat. The vocabulary matches CONTEXT.md: Booking,
/// Date hold, Payment proof, Published rates, Reserved, Credential,
/// Access log.
///
/// Interactive steps make the Admin *use* safe controls — tabs, filters,
/// search, opening a Booking, opening a thread, the More sheet. Steps over
/// irreversible actions (Approve, Reject, Publish) are explanations on
/// purpose: a tour must never act on a real Guest or a real rate.
///
/// Copy is kept to one or two sentences per step: the card is read on a phone
/// while the real control waits behind the spotlight.
library;

import 'tutorial_step.dart';

const List<TutorialStep> adminTutorialSteps = [
  TutorialStep(
    id: 'welcome',
    title: 'Welcome to the Admin app',
    body:
        'A hands-on tour of the real screens and buttons you run the Hacienda with — no '
        'slides. Two minutes, and you can replay it anytime from More.',
    why: 'Nothing here approves, rejects or publishes anything. The tour only drives '
        'navigation; the real actions stay yours.',
    continueLabel: 'Start the tour',
  ),
  TutorialStep(
    id: 'dashboard',
    title: 'Your morning at a glance',
    targetKey: 'reviewBookings',
    body:
        'Today at a glance: check-ins, guests staying, requests waiting on you, and this '
        'month’s revenue. A red badge on Pending Requests means the queue needs you.',
    why: 'The queue is the job — every unanswered request is one of the Guest’s date holds '
        'counting down.',
    advance: TutorialAdvance.tab,
    tabIndex: 1,
    actionHint: 'Tap “Review Bookings”, or the Bookings tab below.',
  ),
  TutorialStep(
    id: 'bookings-filters',
    title: 'Triage with the filter chips',
    targetKey: 'needsActionChip',
    ensureTab: 1,
    body:
        'Chips cut the list to whatever needs your hands. “Needs action” is the working '
        'queue: approvals, payment proofs, check-outs, refunds.',
    why: 'Approving is a promise — the approval re-check counts the dates that are actually '
        'committed, so a no-show slot never blocks a real one.',
    advance: TutorialAdvance.event,
    eventName: 'filter-changed',
    actionHint: 'Tap any filter chip — try “Needs action”.',
  ),
  TutorialStep(
    id: 'bookings-search',
    title: 'Find a Booking in seconds',
    targetKey: 'searchField',
    ensureTab: 1,
    body:
        'Search by guest name, email, reference, stay or status — the reference number '
        'Guests quote on the website.',
    advance: TutorialAdvance.input,
    eventName: 'search-typed',
    actionHint: 'Type anything into the search field.',
  ),
  TutorialStep(
    id: 'bookings-card',
    title: 'Open a Booking',
    targetKey: 'firstBookingCard',
    ensureTab: 1,
    body:
        'One card is one Booking: who, when, which Accommodation, what it costs, and its '
        'place in the lifecycle.',
    advance: TutorialAdvance.event,
    eventName: 'open-detail',
    actionHint: 'Tap a Booking card to open it.',
  ),
  TutorialStep(
    id: 'detail-actions',
    title: 'Where you approve, refuse, verify',
    targetKey: 'detailActions',
    body:
        'Actions offers exactly the moves this Booking’s status allows — Approve or Reject, '
        'verify a Payment proof, check in and out, settle refunds. Every move lands in the '
        'Activity log with your name on it.',
    why: 'Approving is a real promise to a real Guest, so this step only explains.',
    continueLabel: 'Got it',
  ),
  TutorialStep(
    id: 'chat-tab',
    title: 'Guests talk to you here',
    targetKey: 'tabChat',
    popToRoot: true,
    body:
        'The Chat tab is the Guest inbox — threads from the website’s Messages page land '
        'here, newest first.',
    advance: TutorialAdvance.tab,
    tabIndex: 2,
    actionHint: 'Tap the Chat tab below.',
  ),
  TutorialStep(
    id: 'inbox-thread',
    title: 'Open a conversation',
    targetKey: 'firstThread',
    ensureTab: 2,
    body: 'Each row is one Guest thread with its topic. Open one to read it and reply.',
    fallbackBody:
        'This device has no live conversations right now, so read along and continue.',
    advance: TutorialAdvance.event,
    eventName: 'open-thread',
    actionHint: 'Tap a conversation.',
  ),
  TutorialStep(
    id: 'thread-reply',
    title: 'Replying reaches the website',
    targetKey: 'threadComposer',
    body:
        'A reply you send here appears on the Guest’s Messages page. The tour won’t send '
        'anything on your behalf.',
    fallbackBody:
        'The reply box at the bottom writes straight to the Guest’s Messages page on the '
        'website.',
    continueLabel: 'Next',
  ),
  TutorialStep(
    id: 'more-tab',
    title: 'Everything else lives under More',
    targetKey: 'tabMore',
    popToRoot: true,
    body:
        'Rates, payment references, smart lock logs, analytics, rooms and the guest CRM all '
        'open from the More sheet.',
    advance: TutorialAdvance.event,
    eventName: 'more-opened',
    actionHint: 'Tap More below.',
  ),
  TutorialStep(
    id: 'more-rates',
    title: 'Rates power the website’s quotes',
    targetKey: 'moreRates',
    body:
        'This screen publishes weekday and weekend rates, included occupancy, the refundable '
        'Security deposit, the 50% down payment, holiday dates and the cancellation policy.',
    advance: TutorialAdvance.event,
    eventName: 'open-rates',
    actionHint: 'Tap “Rates & Cancellation Policy”.',
  ),
  TutorialStep(
    id: 'rates-publish',
    title: 'Publishing is a website event',
    targetKey: 'ratesPublish',
    ensureTab: 8,
    body:
        'Publishing writes a version + effective date, and the website quotes those figures '
        'from then on. Republishing only changes future quotes — never a stay already '
        'promised.',
    why: 'A publish in a tutorial would rewrite what real Guests are quoted.',
    continueLabel: 'Got it',
  ),
  TutorialStep(
    id: 'more-smartlock',
    title: 'The door has a diary',
    targetKey: 'tabMore',
    popToRoot: true,
    body:
        'One more from the More sheet: the smart lock. Guests arrive with an RFID card or the '
        'in-app Mobile Key.',
    advance: TutorialAdvance.event,
    eventName: 'more-opened',
    actionHint: 'Tap More below, then “Smart Lock Security Logs”.',
  ),
  TutorialStep(
    id: 'more-smartlock-tile',
    title: 'Smart Lock Security Logs',
    targetKey: 'moreSmartLock',
    body: 'Open it to see the audit trail the hardware writes.',
    advance: TutorialAdvance.event,
    eventName: 'open-smartlock',
    actionHint: 'Tap “Smart Lock Security Logs”.',
  ),
  TutorialStep(
    id: 'smartlock-info',
    title: 'Every knock, recorded',
    targetKey: 'smartLockStats',
    ensureTab: 5,
    body:
        'The Access log is append-only: every Credential use — granted or denied — lands here '
        'and on the Dashboard feed.',
    fallbackBody:
        'Every Credential use, granted or denied, lands here and on the Dashboard feed. It is '
        'about doors, not position.',
    continueLabel: 'Next',
  ),
  TutorialStep(
    id: 'done',
    title: 'You know the console now',
    body:
        'That’s the round: triage requests, verify payments, publish rates, answer chat, '
        'watch the locks. Analytics, rooms and the CRM live under More — replay this tour '
        'anytime.',
    continueLabel: 'Finish',
  ),
];
