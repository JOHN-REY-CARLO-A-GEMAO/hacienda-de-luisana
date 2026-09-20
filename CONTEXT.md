# Hacienda de LuisAna

A private countryside stay in Luisiana, Laguna: a Host rents the Main House and camping units to Guests, takes bookings through a website and a mobile guest app, and controls physical access with a smart lock that accepts an RFID card or an in-app Mobile Key. This glossary is the shared vocabulary for both apps and the Firebase backend that backs them.

## Language

### People

**Guest**:
A person who books and stays at the hacienda.
_Avoid_: Customer, user, booker, client

**Host**:
The person who operates the hacienda and reviews bookings, identity checks and payments.
_Avoid_: Owner, admin (reserve admin for the system role)

**Staff**:
A caretaker or cleaner who works assigned cleaning tasks and inspections, and cannot approve bookings or verify payments.
_Avoid_: Worker, employee

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
The claim a Booking places on its dates. It counts down 24 hours while the Booking waits for review, and becomes firm when the Host approves; from there only a terminal status releases the dates.
_Avoid_: TTL, lock, block, reservation

**Expired**:
The terminal Booking status reached when a date hold runs out. Releasing the dates is part of expiring.

### Money

**Payment proof**:
The receipt or screenshot a Guest uploads to claim a payment made outside the system.
_Avoid_: OR, receipt, transaction

**Security deposit**:
A refundable amount held against damage, settled at check-out.
_Avoid_: Bond, caution money

**Refund**:
Money returned to a Guest through the refund pipeline after verified payment.
_Avoid_: Reversal, reimbursement

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
Identity verification: the government ID a Guest uploads and the Host reviews before approving a Booking.
_Avoid_: Verification, ID check, eKYC

**Activity log**:
The append-only audit record of every state change in the system, with a timestamp and the actor who made it.
_Avoid_: Audit trail, system log, history (per-Booking history is a view over this log)

**Tracking consent**:
A Guest's explicit, recorded permission for the system to record their Guest location during a stay. No consent means access logs only.
_Avoid_: Geolocation permission, opt-in

**Guest location**:
A province / city / GPS reading recorded during a consented stay.
_Avoid_: Breadcrumb, ping, route
