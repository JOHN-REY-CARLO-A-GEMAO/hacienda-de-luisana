# Hacienda de LuisAna

A private countryside stay in Luisiana, Laguna: the Admin rents the Main House and camping units to Guests, takes bookings through a Guest-facing website, runs the whole operation from an Admin mobile app, and controls physical access with a smart lock that accepts an RFID card or an in-app Mobile Key. This glossary is the shared vocabulary for both apps and the Firebase backend that backs them.

## Language

### People

**Guest**:
A person who books and stays at the hacienda. The Guest uses the website — and only the website.
_Avoid_: Customer, user, booker, client (the thesis calls this role the "client"; in code and docs it is the Guest)

**Admin**:
The person who operates the hacienda: reviews bookings, identity checks and payments, settles refunds, publishes rates, and reads every record. The Admin uses the mobile app — and only the mobile app.
_Avoid_: Owner, host, staff, caretaker, super admin (there is one operator role; ADR-0007)

**Role**:
Exactly one of Guest or Admin, held by every signed-in person and read by the Firestore rules before anything is allowed. Nobody signs up as anything but a Guest; the Admin is recognised by the bootstrap allowlist or by a Profile that says so. There is no third role and no role hierarchy among operators.
_Avoid_: Permission level, user type, actor (an actor is a Role acting on a Booking — or the system, which is never a Role), Staff, Host

**Profile**:
The document at `profiles/{uid}` that stores a person's Role and the name the Activity log shows for them. No Profile means Guest.
_Avoid_: User record, account (the account is the sign-in; the Profile is the Role it carries)

**Permission**:
One named act a Role may perform: creating a Booking, reading one's own Booking, uploading KYC (Guest); reviewing a Booking, verifying Payment proof, reading the Access log, publishing rates (Admin). Pages and buttons ask for a Permission by name; `firestore.rules` enforces the same one, so hiding a control is a courtesy and never the authorization.
_Avoid_: Scope, entitlement, access level

### Applications

**Website**:
The Guest's application (`src/`): availability, the Booking form, KYC and Payment proof upload, Payment plan choice, the Guest's own Bookings at `/account`, chat with the Admin, and a review after the stay. It has no management screens; `/admin` and `/app` only point at the Admin app.
_Avoid_: Portal, dashboard, admin site

**Admin app**:
The Admin's application (`lib/`, Flutter, Android): every management function of the system — Booking review and lifecycle, KYC, payments, refunds, Published rates, stays, the chat inbox, Access log, rooms, CRM, analytics.
_Avoid_: Owner app, guest app, client app, staff app

### Stay

**Accommodation**:
A rentable unit: the Main House or a camping unit.
_Avoid_: Room, villa, property (the property is the whole estate)

**Booking**:
A Guest's request for one Accommodation over a date range, tracked from submission through to a completed stay.
_Avoid_: Reservation (a Booking that has been paid and reserved), inquiry, order

**Stay**:
The period a Guest occupies an Accommodation, from check-in to check-out.

**Booking status**:
The Booking's position in the lifecycle: Pending → KYC Submitted → Approved → Payment Pending → Payment Verified → Reserved → Checked-In → Staying → Checked-Out → Completed, with the terminal branches Rejected, Cancelled and Expired.
_Avoid_: Confirmed (retired; the paid state is Reserved), "booking state"

**Date hold**:
The claim a Booking places on its dates. It counts down 24 hours while the Booking waits for review, and becomes firm when the Admin approves; from there only a terminal status releases the dates.
_Avoid_: TTL, lock, block, reservation

**Expired**:
The terminal Booking status reached when a date hold runs out. Releasing the dates is part of expiring.

### Money

**Payment plan**:
The Guest's promise of money for a stay: Full Payment, or a Down Payment — both plus the refundable Security deposit. Offered from the Published rates, chosen from the moment the Admin approves, and recorded on the Booking the moment it is chosen.
_Avoid_: Payment option (an option is one of the plans on offer), rate, price

**Down payment**:
A percentage of the stay the Guest sends up front, offered alongside Full Payment when the Admin has published a down-payment percentage. Floored to whole centavos, so the down payment and the balance add back to exactly what was quoted.
_Avoid_: Deposit (the Security deposit is a different, refundable-at-check-out amount), advance, retainer

**Payment proof**:
The receipt or screenshot a Guest uploads to claim a payment made outside the system.
_Avoid_: OR, receipt, transaction

**Security deposit**:
A refundable amount held against damage, settled at check-out.
_Avoid_: Bond, caution money

**Refund**:
Money returned to a Guest through the refund pipeline after verified payment.
_Avoid_: Reversal, reimbursement

**Published rates**:
The Admin's published figures — the per-Accommodation nightly rate, Security deposit, down-payment percentage and cancellation policy — under a version that takes effect on a date. Published from the Admin app's Rates screen to `site_config/rates`; the website only reads them. Until they are published, no Payment plan can be chosen and a cancellation refunds nothing.
_Avoid_: Price list (the prices in the page copy are display placeholders), tariff, menu

**Policy stamp**:
The version and effective date of the Published rates that the Booking is quoted under, stamped on it the moment the Guest chooses their Payment plan. A later republish changes the terms of future choices only, never the refund terms of a stay already promised; a Booking stamped with nothing refunds nothing.
_Avoid_: Policy lock, snapshot (the snapshot is what an action is handed; the stamp is what the Booking carries)

### Access

**Credential**:
The thing that unlocks an Accommodation: an RFID card or tag, or the in-app Mobile Key. Both go through one verification pipeline.
_Avoid_: Key, pass, access token

**Access log**:
The append-only record of one Credential use at a lock, granted or denied.
_Avoid_: Door log, lock record

**Check-in**:
The moment the first Credential use succeeds on the check-in day; it is what moves a Booking to Checked-In.

### Trust and records

**KYC**:
Identity verification: the government ID a Guest uploads and the Admin reviews before approving a Booking.
_Avoid_: Verification, ID check, eKYC

**Guest identity**:
The anonymous sign-in a Guest's own Booking and uploaded documents are keyed to, attached when the Booking is created. A Booking created without one cannot be claimed later — in the cloud the rules now refuse such a creation outright, so the failure is loud (ADR-0004, as amended).
_Avoid_: User account, login, session

**Activity log**:
The append-only audit record of every state change in the system, with a timestamp and the actor who made it.
_Avoid_: Audit trail, system log, history (per-Booking history is a view over this log)

**Live location (removed)**:
Location tracking was retired (ADR-0009). `tracking_sessions` is closed to every writer and reader, no application records or shows a Guest's position, and the vocabulary that used to describe it — Tracking consent, Tracking session, Guest location, arrival radar — has no referent in this repository. The Access log remains: it is about doors, not position.
_Avoid_: Breadcrumb, ping, route, radar, geofence
