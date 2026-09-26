/// The Admin tour script.
///
/// The order follows the same Booking lifecycle the Guest's web tour teaches
/// (request → review → approval → payment → Reserved → stay → review), seen
/// from the operator's seat. The vocabulary matches CONTEXT.md: Booking,
/// Date hold, KYC, Payment proof, Published rates, Reserved, Credential,
/// Access log.
///
/// Interactive steps make the Admin *use* safe controls — tabs, filters,
/// search, opening a Booking, opening a thread, the More sheet. Steps over
/// irreversible actions (Approve, Reject, Publish) are explanations on
/// purpose: a tour must never act on a real Guest or a real rate.
library;

import 'tutorial_step.dart';

const List<TutorialStep> adminTutorialSteps = [
  TutorialStep(
    id: 'welcome',
    title: 'Welcome to the Admin app',
    body:
        'This is a hands-on tour: it highlights the real screens and buttons you run the '
        'Hacienda with, and asks you to try each one — no slides. Two minutes, and you can '
        'replay it anytime from More → "Replay the guided tour".',
    why: 'Nothing here approves, rejects or publishes anything. The tour only drives '
        'navigation; the real actions stay yours.',
    continueLabel: 'Start the tour',
  ),
  TutorialStep(
    id: 'dashboard',
    title: 'Your morning at a glance',
    targetKey: 'reviewBookings',
    body:
        'The Dashboard opens with today: check-ins, guests staying, requests waiting on you, '
        'and this month’s revenue — plus the Access log feed from the door locks. A red badge '
        'on Pending Requests (and on the Bookings tab) means the queue needs you.',
    why: 'The queue is the job: every unanswered request is one of the Guest’s date holds '
        'counting down.',
    advance: TutorialAdvance.tab,
    tabIndex: 1,
    actionHint: 'Tap “Review Bookings” (or the Bookings tab below).',
  ),
  TutorialStep(
    id: 'bookings-filters',
    title: 'Triage with the filter chips',
    targetKey: 'needsActionChip',
    ensureTab: 1,
    body:
        'These chips cut the list to whatever needs your hands. “Needs action” is the working '
        'queue: IDs to review (KYC Submitted), payment proofs to verify, check-outs to settle, '
        'refunds to send.',
    why: 'Approving is a promise: the approval re-check counts the dates that are actually '
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
        'Search by guest name, email, reference, stay or status — the same list the Guests '
        'quote from their reference number on the website.',
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
        'Each card is one Booking: who, when, which Accommodation, what it costs, and its place '
        'in the lifecycle. The status pill matches what the Guest sees on their My Bookings page.',
    advance: TutorialAdvance.event,
    eventName: 'open-detail',
    actionHint: 'Tap a Booking card to open it.',
  ),
  TutorialStep(
    id: 'detail-actions',
    title: 'Where you approve, refuse, verify',
    targetKey: 'detailActions',
    body:
        'The Actions card offers exactly the moves this Booking’s status allows — the same '
        'lifecycle the web app teaches Guests: Approve or Reject while the date hold counts '
        'down, refuse a bad ID, verify a Payment proof against your valid references, check in '
        'and out, settle refunds. Every move lands in the Activity log with your name on it.',
    why: 'The tour stops here on purpose: approving is a real promise to a real Guest, so '
        'this step only explains.',
    continueLabel: 'Got it',
  ),
  TutorialStep(
    id: 'chat-tab',
    title: 'Guests talk to you here',
    targetKey: 'tabChat',
    popToRoot: true,
    body:
        'The Chat tab is the Guest inbox — the threads Guests start from the website’s '
        'Messages page land here, newest first.',
    advance: TutorialAdvance.tab,
    tabIndex: 2,
    actionHint: 'Tap the Chat tab below.',
  ),
  TutorialStep(
    id: 'inbox-thread',
    title: 'Open a conversation',
    targetKey: 'firstThread',
    ensureTab: 2,
    body:
        'Each row is one Guest thread with its topic. Open one to read it and reply.',
    fallbackBody:
        'Each row here is one Guest thread with its topic — this device has no live '
        'conversations right now (no Firebase connected), so read along and continue.',
    advance: TutorialAdvance.event,
    eventName: 'open-thread',
    actionHint: 'Tap a conversation.',
  ),
  TutorialStep(
    id: 'thread-reply',
    title: 'Replying reaches the website',
    targetKey: 'threadComposer',
    body:
        'A reply you send here appears on the Guest’s Messages page — the same thread, one '
        'conversation per Guest. The tour won’t send anything on your behalf.',
    fallbackBody:
        'Inside a thread, the reply box at the bottom writes straight to the Guest’s Messages '
        'page on the website. The tour won’t send anything on your behalf.',
    continueLabel: 'Next',
  ),
  TutorialStep(
    id: 'more-tab',
    title: 'Everything else lives under More',
    targetKey: 'tabMore',
    popToRoot: true,
    body:
        'Rates, payment references, the smart lock logs, analytics, rooms and the guest CRM '
        'all open from the More sheet.',
    advance: TutorialAdvance.event,
    eventName: 'more-opened',
    actionHint: 'Tap More below.',
  ),
  TutorialStep(
    id: 'more-rates',
    title: 'Rates power the website’s quotes',
    targetKey: 'moreRates',
    body:
        'This screen is where Published rates come from — nightly rate per Accommodation, '
        'Security deposit, down-payment percentage and the cancellation policy.',
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
        'Publishing writes a version + effective date to site_config/rates, and the website '
        'quotes those figures from then on. Until the first publish the site cannot offer a '
        'Payment plan, and a Booking stamped with no policy refunds nothing on cancellation. '
        'Republishing only changes future quotes — never a stay already promised.',
    why: 'Again, explanation only: a publish in a tutorial would rewrite what real Guests '
        'are quoted.',
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
    body:
        'Open it to see the audit trail the hardware writes.',
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
        'The Access log is append-only: every Credential use — RFID card or Mobile Key, '
        'granted or denied — lands here and on the Dashboard feed. It is about doors, not '
        'position: the app never tracks a Guest’s live location.',
    fallbackBody:
        'The Access log is append-only: every Credential use, granted or denied, lands here '
        'and on the Dashboard feed. It is about doors, not position — the app never tracks a '
        'Guest’s live location.',
    continueLabel: 'Next',
  ),
  TutorialStep(
    id: 'done',
    title: 'You know the console now',
    body:
        'That’s the round: triage requests, review IDs, verify payments against references, '
        'publish rates, answer chat, watch the locks — with analytics, rooms and the guest '
        'CRM under More whenever you need them. Replay this tour anytime from '
        'More → “Replay the guided tour”.',
    continueLabel: 'Finish',
  ),
];
