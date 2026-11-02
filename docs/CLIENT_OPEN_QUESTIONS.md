# Client open questions — Hacienda de LuisAna

**Status date:** 2 November 2026
**Audience:** the team, and the Hacienda's owner/operator (the client)
**Purpose:** the system is built; what is left is a short list of **business facts only the owner can decide**. Each one is already answered somewhere in the code — by an assumption. This page names the assumption, says what it costs if it is wrong, and leaves a line for the real answer.

> Read with `CONTEXT.md` (the vocabulary), `docs/BOOKING_POLICY.md` (the rules as built) and `docs/LIMITATIONS.md` (what the system does **not** do). Nothing here is a request to redesign; most answers are a number, a date, a name, or a yes/no.

---

## How to use this page

1. **Answer §1 and §2 first.** Everything below them assumes those are settled.
2. Write the answer in the **Sagot** line (or in the Filipino form in [Appendix A](#appendix-a--tanong-sa-may-ari-one-page-form)).
3. Bring the answers back to the repo: [Appendix B](#appendix-b--where-each-answer-gets-written-down) says which file or screen changes for each one. An answer that reaches no file is an answer the system never hears.
4. **Do not re-ask what is already settled** — see [§7](#7-already-settled--huwag-nang-itanong).
5. **Gusto ng Google Form?** Patakbuhin ang [`scripts/google-form/Code.gs`](../scripts/google-form/Code.gs) sa <https://script.google.com> at bubuo ito ng form at ng response sheet — 55 tanong, Taglish, anim na seksyon. Nasa [`scripts/google-form/README.md`](../scripts/google-form/README.md) ang mga hakbang. Ang dokumentong ito pa rin ang English na record.

### Priority key

| Mark | Meaning | If it is still unanswered… |
|---|---|---|
| 🔴 | **Blocks go-live** | The website will take real bookings on an assumption that can cost the owner money or a double-booking |
| 🟠 | **Blocks defense / accuracy** | The demo is defensible, but a figure, a rule or a screen will be visibly wrong or unexplainable to the panel |
| ⚪ | **Decide later** | Nothing breaks today; a feature exists only if the answer is yes |

---

## The 14 that block go-live

Every 🔴 question in one place. These are the ones to answer before the website is allowed to take a real booking.

| # | Question | Today's assumption |
|---|---|---|
| Q1 | Are the published rates the real ones, effective when? | Main House ₱5,000 / ₱6,000; Annex ₱4,000 / ₱5,000; A-House ₱1,000 |
| Q2 | Is a weekend stay priced by the **check-in night** for every night? | Yes — Fri–Sun 2 nights = 2 × weekend rate |
| Q3 | What is the **absolute** maximum headcount per accommodation? | No cap for Main House and Annex; the form accepts up to 100 guests |
| Q4 | Security deposit: how much, collected when, returned when? | Amount published by Admin; **not** part of what the Guest sends; refund maths assumes it is |
| Q5 | What is the cancellation / refund / no-show / typhoon policy? | No published policy → **a cancellation refunds nothing** |
| Q6 | Is paying **before** approval acceptable, and who refunds a rejected proof? | Yes, 50% up front; a Reject opens no refund record |
| Q10 | Is the **30-day** minimum lead time real? | Yes, enforced server-side, configurable |
| Q11 | Who reviews a Pending booking within **24 hours**? | Nobody in particular; after 24 h the hold expires |
| Q12 | May the A-Houses be rented while the Main House is booked? | Yes — inventory is independent; a guest review on the site says the opposite |
| Q14 | How do we block dates for the owner's use, repairs, or a private event? | Nothing blocks the website except a Booking; the Rooms status is unread |
| Q15 | Who blocks Airbnb/Agoda dates here, and how fast? | Nobody — there is **no** channel sync; a double-booking is one forgotten manual block away |
| Q24 | Who are the Admin accounts? | The bootstrap allowlist holds the **developer's** address; adding an Admin needs a Firebase-console edit |
| Q35 | Whose accounts hold the domain, Firebase, Cloudflare and GitHub? | The student's accounts, as the repo stands |
| Q37 | When is go-live, who is trained, and who can turn bookings off? | No plan; no import of existing Guests or OTA bookings |

---

## 1. Money

### Q1 🔴 Are these the rates we should publish, and from when?

**Today.** Seeded in `src/config/officialBusiness.ts` and publishable from the Admin app's Rates screen:

| Accommodation | Weekday | Weekend / holiday | Included guests | Extra guest |
|---|---|---|---|---|
| Main House | ₱5,000 / stay | ₱6,000 / stay | 10 | ₱500 each |
| Annex | ₱4,000 / stay | ₱5,000 / stay | 6 | ₱500 each |
| A-House (×2 units) | ₱1,000 / unit | ₱1,000 / unit | 3 | not allowed |

**Bakit.** Every online quote is computed from this document; a wrong figure is charged to a Guest and stamped on the Booking as its price. The Rates screen is the only place it can be corrected after go-live.

**Sagot.**

- ☐ Current, publish as-is ☐ Different figures (write them)
- Effective date: __________  Any 2027 change: __________
- Peak seasons (Christmas, Holy Week, fiesta) that should use the weekend rate: __________

---

### Q2 🔴 Is the whole stay charged at the **check-in night's** rate?

**Today.** The check-in night decides the classification of **every night**. Weekend = Friday and Saturday. A Friday–Sunday 2-night stay is charged **2 × weekend rate** (₱12,000 at the Main House), not one weekend night + one weekday night. Holidays are dates the Admin types into `site_config/rates`.

**Bakit.** This is the single biggest pricing decision in the system. Most resorts charge the weekend rate only for the Friday/Saturday nights themselves; this model charges it for the whole stay. If the owner wants per-night classification it is a **code change** (pricing, rules and both apps), not a setting.

**Sagot.**

- ☐ Keep (whole stay at the check-in night's classification) ☐ Change to per-night pricing
- Holiday dates to publish for 2026–2027 (national + local fiesta): __________

---

### Q3 🔴 What is the absolute maximum number of guests?

**Today.** Main House and Annex have **no hard cap**. The guest field accepts any number from 1 to 100; every guest above 10 (Main House) or 6 (Annex) is simply charged ₱500 more. A-House is capped at 3.

**Bakit.** Without an answer the website will accept 25 guests in the Main House and charge them ₱500 each. A cap is also a safety/fire-code statement, not a pricing one — and it needs a model change: the rates validator currently refuses `max_guests` for anything but the A-House.

**Sagot.**

- Main House maximum: ______ guests   Annex maximum: ______ guests
- Do children count in the guest count? ☐ Yes ☐ Only above age ____ ☐ No
- Do pets count? ☐ Yes ☐ No

---

### Q4 🔴 Security deposit — how much, collected when, returned when?

**Today.** The amount is published per accommodation in the Rates screen (the repo seeds **no** figure). The Guest is shown it **separately** and explicitly told it is **not** included in the amount they send. But the refund calculation (`settleRefund`, `src/lib/booking/money.ts`) assumes the deposit **is** part of the verified money, and the legacy "Verify payment" action even requires the proof to cover `amount_due + security_deposit` (`lib/services/booking_lifecycle.dart`). Both cannot be true.

**Bakit.** The answer decides three things at once: what the Guest is told to send, what the Admin verifies, and what a cancellation refunds. If the deposit is collected at check-in, the current refund arithmetic over-refunds a full-payment booking.

**Sagot.**

- Amount — Main House: ₱______   Annex: ₱______   A-House: ₱______
- Collected: ☐ With the down payment ☐ At check-in (cash/GCash) ☐ Not collected
- Returned: ☐ At check-out, after inspection ☐ Within ____ days after check-out
- Who inspects and decides a deduction: __________

---

### Q5 🔴 What is the cancellation, refund and no-show policy?

**Today.** The Admin publishes flat or tiered percentages (minimum days before check-in → percent refunded) plus a deposit-refund percent (default 100%). **If nothing is published, a cancellation refunds ₱0.** No-show and force majeure (typhoon, flood, road closure) are **not modelled at all**.

**Bakit.** This is the policy the Guest reads on `/legal` before paying, and the one stamped on the Booking. A missing policy is legally and commercially the harshest possible one ("no refund"), which is probably not what the owner means.

**Sagot.** Fill or tick:

| Cancelled before check-in | Refund of the stay payment |
|---|---|
| 30+ days | ____ % |
| 15–29 days | ____ % |
| 7–14 days | ____ % |
| 3–6 days | ____ % |
| 0–2 days | ____ % |

- Security deposit on cancellation: ____ %
- No-show: ☐ no refund ☐ refund deposit only ☐ refund ____ %
- Typhoon / force majeure: ☐ free rebooking ☐ full refund ☐ ____
- Refund channel & turnaround: ☐ GCash ☐ BDO ☐ cash — within ____ days

---

### Q6 🔴 Pay-before-approval: is that the flow the owner wants?

**Today.** The Guest sends the 50% down payment **before** any Admin sees the Booking, uploads the screenshot, and only then submits. If the Admin rejects the proof, the Booking goes to **Rejected**, `payment_status: rejected`, and **no refund record is opened** — the money must be returned outside the system, by hand. The 50% is pinned in `firestore.rules` (`down_payment_percent == 50`); a different percentage is a code change.

**Bakit.** Every rejected proof is a refund the owner must remember manually. If that is not acceptable, either the flow (approval before payment) or the refund-on-reject rule changes.

**Sagot.**

- ☐ Keep 50% before approval ☐ Change percentage to ____ % (code change)
- A rejected proof gets refunded: ☐ in full, always ☐ minus ____ ☐ case by case
- Who sends the refund back, and how quickly: __________

---

### Q7 🟠 How is the **check-in balance** collected and recorded?

**Today.** `balance_due` is computed and shown to both apps, but **nothing records it being paid**. There is no "balance received" action, no receipt number, no cash-vs-GCash note.

**Bakit.** The Admin app can prove the down payment was verified but not the other 50%. If the owner needs a record (for disputes, or for BIR), that is a small feature to add before go-live.

**Sagot.**

- Collected at check-in by: ☐ cash ☐ GCash ☐ BDO ☐ any
- Should the app record it? ☐ Yes (add "Balance received") ☐ No
- Do you issue an official receipt (BIR)? ☐ Yes — OR series ______ ☐ No

---

### Q8 🟠 Are the optional charges final?

**Today.** Pet sanitation ₱300 per pet, bonfire wood ₱150 per set, approved late checkout ₱250 per hour after 12:00 noon, wedding-preparation package ₱8,500 per overnight set (up to 10 pax). Drinking water and special events are listed with **no price** ("ask the Hacienda").

**Bakit.** These print on `/rates` and are quoted into a Booking when selected. Anything missing (corkage, extra mattress, early check-in, day use, shoot fee) has no way to be charged online.

**Sagot.** ☐ All current ☐ Correct these: __________
Missing charges to publish: __________

---

### Q9 ⚪ Is the website price the same as Airbnb and Agoda?

**Today.** No parity check anywhere; each channel sets its own price and fees.

**Bakit.** A Guest comparing tabs will notice. Some owners price the direct website lower to avoid OTA commission — that is a deliberate decision, not an accident.

**Sagot.** ☐ Same price ☐ Website cheaper by ____ % ☐ Website higher by ____ %

---

## 2. Calendar and inventory

### Q10 🔴 Is the 30-day minimum lead time real?

**Today.** A Guest must book at least **30 Manila calendar days** before check-in (today + 30 is allowed, today + 29 is not). Enforced by the `submitBooking` callable and the calendar. Configurable in `site_config/booking.minimumBookingLeadTimeDays` without a deploy.

**Bakit.** Thirty days blocks almost all last-minute trade — the kind a countryside stay gets on a long weekend. If the owner wants 7 or 0, it must be said now, not discovered when a Guest cannot book this Saturday.

**Sagot.** ____ days (30 = current). Walk-ins/last-minute: ☐ Admin books them manually ☐ open the website to X days ☐ not accepted

---

### Q11 🔴 Who reviews a Pending booking, and within 24 hours?

**Today.** Each Pending Booking holds its dates for **24 hours**; after that it expires and the dates free themselves. Nothing assigns the review to a person or a time of day.

**Bakit.** If the owner cannot check the app on a Sunday evening, the Guest's hold dies and the Booking is lost — and the Guest has already sent money. The hold and the reply habit must match.

**Sagot.**

- Who watches the queue: __________
- Realistic maximum response time: ____ hours
- Should the hold be: ☐ 24 h ☐ 48 h ☐ 72 h

---

### Q12 🔴 Exclusivity — can the A-Houses be rented while the Main House is booked?

**Today.** Inventory is **independent**: one Main House, one Annex and two A-House units can all be sold on the same night, and the availability calendar treats them separately. A guest review published on the site (`src/config/site.ts`, `GUEST_NOTES.exclusive`) says the owner told a Guest the opposite: *"when the main house is booked, they don't rent out the A-houses to other guests, and vice versa."*

**Bakit.** If that is the real policy, the availability code must couple the Main House and the A-Houses (a code change and an ADR, not a setting). If it is not, the guest note on the site must be corrected — it is a promise the system currently breaks.

**Sagot.**

- ☐ Independent (current behaviour is right; correct the note)
- ☐ Exclusive by default (block the other accommodation automatically)
- ☐ Exclusive on request (Admin blocks manually)
- Should the whole estate be bookable as one product? ☐ Yes ☐ No

---

### Q13 🟠 Can a group book both A-House units / the whole estate?

**Today.** One Booking = **one** A-House unit (2 units exist, 3 guests each). A second unit needs a second Booking. There is no combined booking and no estate-wide product.

**Bakit.** Church groups and families routinely want both A-Houses. Today they must book twice, pay twice, and get two references.

**Sagot.** ☐ Fine as is ☐ Add multi-unit booking (feature) ☐ Admin books manually

---

### Q14 🔴 How do we block dates for the owner's own use, repairs, or a private event?

**Today.** The Admin app has a Rooms status (`available` / `occupied` / `maintenance`), but **nothing on the website reads it** — setting a room to maintenance does not block a Guest. The only ways to block a date are to create a manual Booking or to lower `available_units` for everyone.

**Bakit.** The family uses the house. A repair closes a unit. A wedding blocks the estate. All three are normal, and none has a clean button today.

**Sagot.** ☐ We need a proper date-block (feature) ☐ Manual Booking is fine ☐ Does not happen

---

### Q15 🔴 Airbnb / Agoda double-booking — who blocks the dates here, and how fast?

**Today.** There is **no channel sync** — no iCal feed, no channel manager, no import. A booking taken on Airbnb does not block the website; the website does not block Airbnb. The only guard is the Admin remembering to create the equivalent Booking in the app.

**Bakit.** This is the most likely real-world failure once the site goes live next to two OTA listings. The owner must either commit to a blocking routine (and a deadline, e.g. within 1 hour) or the team must build iCal import/export.

**Sagot.**

- Who blocks dates after an OTA booking: __________
- Within: ____ minutes/hours
- Do you want iCal sync built? ☐ Yes, import only ☐ Import + export ☐ No

---

## 3. Guests

### Q16 🟠 Do Guests get any automatic confirmation?

**Today.** **No email and no SMS to Guests** — only push notifications to the Admin's devices (Firebase Cloud Messaging). A Guest sees the reference once on the confirmation screen and must return to the site to follow the status. If they close the tab, the reference is gone unless they saved it.

**Bakit.** For a Guest who paid ₱3,000 by GCash, "check the website" is thin. Email needs a provider (e.g. Resend/SendGrid) and a verified sender domain; SMS needs a paid PH gateway. Both are recurring costs the owner must accept.

**Sagot.** ☐ Email only ☐ Email + SMS ☐ Neither (chat/Facebook is enough) — who pays: __________

---

### Q17 🟠 Can a Guest see their booking on another device?

**Today.** A website Booking is tied to an **anonymous** Firebase identity stored in that one browser (ADR-0004). `/booking/status` search by reference + email only looks inside that same identity's Bookings, so a Guest who books on a phone cannot open it on a laptop, and a cleared browser loses it. The Admin still sees everything.

**Bakit.** This is invisible in a demo and very visible in real life. Fixing it means a server lookup (`reference + email`, rate-limited, returns a redacted summary) or requiring a real account before booking.

**Sagot.** ☐ Keep as is (tell Guests to save the reference) ☐ Add lookup on any device ☐ Require an account to book

---

### Q18 🟠 Does the Hacienda require an ID at check-in?

**Today.** **No.** Government-ID KYC was removed from the system (2026-09-27); nothing uploads, stores or reviews an ID. Many Philippine resorts still ask for one at the door.

**Bakit.** If the owner wants an ID check, the safest form is a **record, not a photo** (name, ID type, number, who checked) — storing ID images creates a Data Privacy Act obligation the system deliberately dropped. Either answer is fine; silence is not, because the front desk will improvise.

**Sagot.** ☐ No ID ☐ Ask at check-in, record number only ☐ Ask but do not record ☐ Upload/photo

---

### Q19 🟠 Minimum age to book — 10 or 18?

**Today.** The terms (`src/lib/legal.ts`) and the sign-up validator (`lib/utils/validators.dart`, `minGuestAge = 10`) both say **10 years old**. That is almost certainly a leftover, not a policy.

**Bakit.** A ten-year-old cannot enter a contract or consent to data processing. Under the Data Privacy Act a minor's consent needs a guardian. The panel will ask. This needs one answer and one code edit.

**Sagot.** ☐ 18 ☐ 21 ☐ Other ____ — minors allowed only with a guardian: ☐ Yes ☐ No

---

### Q20 🟠 Pets — where, how many, and for how much?

**Today.** Pets are welcome everywhere; ₱300 per pet is charged as a one-per-stay add-on the Guest declares at booking (not automatic). No limit on the number of pets, no size/breed rule, no "pets not allowed in the bedrooms" rule.

**Bakit.** The fee is per **stay**, not per night — confirm that is intended. An unlimited pet count on a sofa bed is a damage risk the Security deposit may not cover.

**Sagot.** Allowed in: ☐ Main House ☐ Annex ☐ A-House. Max pets: ____. Rule: __________. Fee ☐ per stay ☐ per night

---

### Q21 ⚪ Who answers the Guest chat, and when?

**Today.** One conversation per Guest, messages up to 1,000 characters with one image, read a page at a time. Chat survives until **90 days after the Booking closes** (the stamp exists; the scheduled sweep is not deployed yet). There is no "we reply within…" promise on the site.

**Bakit.** The chat is the Guest's only direct line once they have paid. An unanswered inbox is worse than no inbox.

**Sagot.** Who: __________ Hours: __________ Publish a reply-time promise? ☐ Yes, ____ ☐ No

---

### Q22 🟠 Are events, shoots and day use bookable online?

**Today.** Only **overnight stays** (1–20 nights) are priced and bookable. Events, team building, shoots and the wedding-preparation package are "discuss with the Admin" — the Admin records them as a manual Booking, if at all.

**Bakit.** The listings advertise events. If that is real revenue, the owner should decide whether it stays manual (fine, but say so) or needs a separate enquiry flow (a feature).

**Sagot.** ☐ Manual is fine ☐ We need an event/day-use booking flow

---

### Q23 ⚪ Which language should the Guest website speak?

**Today.** It is mixed. Page copy and headings are English; the booking form labels, the payment step and the status messages are Taglish ("Bilang ng Bisita", "Babayaran Ngayon", "Natitirang bayad sa check-in"); server errors arrive in English. Each language is written by hand, not translated at build time.

**Bakit.** Mixed voice is the first thing a panel notices about a client-facing site, and it costs a Guest nothing to fix but a little discipline to keep. Pick one as the default and treat the other as a bilingual aid, or accept the mix deliberately.

**Sagot.** ☐ English throughout ☐ Filipino throughout ☐ Keep the Taglish booking flow with English marketing pages

---

## 4. Admin and operations

### Q24 🔴 Who are the Admin accounts?

**Today.** The bootstrap allowlist contains exactly one address — `gemaojohnreyarguilles@gmail.com`, the developer's. An Admin can also be a `profiles/{uid}` document with `role: "admin"`, but **there is no screen that writes it**; it is a Firebase-console edit by someone technical. Every Admin sees everything: revenue, refunds, guest contact details, chat, CRM.

**Bakit.** At handover the owner must be able to sign in, and the developer's access should be a deliberate choice, not a leftover. If a caretaker also needs the app, that is a second Admin with full access — there is no limited "staff" role (ADR-0007).

**Sagot.**

- Owner's Google/email account: __________
- Other Admins (name + email): __________
- Keep the developer's access after turnover? ☐ Yes ☐ Remove

---

### Q25 🟠 Who sets the Admin Security PIN, and on which device?

**Today.** A six-digit PIN is set per Admin account, PBKDF2-hashed in `admin_security/{uid}`, cached on the device for offline checks, locked out after five wrong entries. A forgotten PIN can be reset once per 24 hours by a signed-in Admin (ADR-0016) — it needs the server.

**Bakit.** If the PIN is set on the owner's phone and the caretaker also uses that phone, they share one PIN and one lockout counter. If the owner forgets it while travelling, the 24-hour rule bites.

**Sagot.** One device ☐ / several devices ☐ — devices: __________. Who knows the PIN: __________

---

### Q26 🟠 What is the internet and power like at the hacienda?

**Today.** The whole system is cloud-first: Firestore, Storage, the availability callable, chat. Only the PIN check and the Admin app's cached data work offline; a Booking cannot be created or approved without a connection.

**Bakit.** This decides whether the Admin app is usable at the gatehouse, and whether the website's guest-facing flow is realistic for Guests on mobile data. It also decides whether an offline queue is worth building.

**Sagot.** Admin device network: ☐ Wi-Fi ☐ mobile data ☐ both — signal strength: ☐ good ☐ patchy ☐ none.
Backup power: ☐ Yes ☐ No. Outages per month: ____

---

### Q27 🟠 How does the Admin app get installed and updated?

**Today.** The Flutter app builds as an APK (`docs/ANDROID.md`); nothing is published to Google Play. Updates are a rebuild and a reinstall.

**Bakit.** Sideloading an APK is fine for a pilot but means every update needs someone technical. A Play Store closed/internal track costs a one-time developer fee and makes updates the owner's own tap.

**Sagot.** ☐ APK sideload ☐ Play Store internal testing ☐ Play Store production — who owns the developer account: __________

---

### Q28 ⚪ What does the owner want to see every month?

**Today.** The Analytics screen shows average stay, guests hosted, conversion, projected revenue, collected/outstanding/refunded, length of stay, weekend-vs-weekday split and revenue by accommodation. There is **no export** (PDF/Excel/CSV).

**Bakit.** A monthly report the owner actually reads is worth more than a screen full of charts. If it must reach a bookkeeper or BIR, exporting is a feature.

**Sagot.** Needed: ☐ revenue ☐ occupancy ☐ guest list ☐ outstanding balances ☐ channel mix ☐ other ____. Export: ☐ PDF ☐ Excel/CSV ☐ screen is enough

---

### Q29 🟠 Reviews — who moderates, and what may be published?

**Today.** A Guest may review only after `Checked-Out`/`Completed`, edit their own words for **14 days**, and the Admin may `publish`, `hide` or reply — never edit. A **Testimonial** is a separate public document the Admin writes (rating, quotation, display name, month) and withdrawing it means deleting it.

**Bakit.** Two client decisions hide here: (a) who moderates and how quickly, (b) may a Guest's words and first name appear on the public site, and does the owner ask permission first? A hidden review is kept and logged — the owner cannot make an unhappy Guest disappear, only unpublished.

**Sagot.** Moderator: __________ Within ____ days. Publish testimonials: ☐ Yes, with first name + month ☐ Anonymous ☐ Never without asking the Guest first

---

## 5. Access and smart lock

### Q30 ⚪ Is there a physical smart lock today?

**Today.** **No.** The repository contains an `access_logs` contract and an Admin screen that lists and simulates events; there is no firmware, no driver, no hardware integration, and no device provisioning (the audit says this plainly). `docs/SMART_LOCK.md` is a contract for a lock that does not exist yet.

**Bakit.** If the owner expects a working lock at defense, that is a separate hardware phase (microcontroller, RFID module, lock body, power, Wi-Fi, offline behaviour). If not, the screen should be presented honestly as an audit-log viewer.

**Sagot.** ☐ No lock yet ☐ Lock exists — brand/model: __________ Doors: ____ Power: ☐ mains ☐ battery ☐ both Wi-Fi at the door: ☐ Yes ☐ No

---

### Q31 ⚪ RFID cards or Mobile Key — who issues them?

**Today.** Neither is issued by the system. There is no credential collection, no card registry, no lost-card process; a "Revoke key" action only records a decision on the Booking.

**Bakit.** A card handed to a Guest is a real object with a deposit, a return and a loss fee. That is an operations decision before it is a code decision.

**Sagot.** ☐ RFID cards ☐ Mobile Key ☐ both. Card deposit: ₱____. Lost card fee: ₱____. Who programs cards: __________

---

### Q32 ⚪ Will the Live location feature actually be used?

**Today.** A Guest may share their position from inside the chat for **15, 30 or 60 minutes**. The coordinate lives in Realtime Database and becomes unreadable at expiry; Firestore holds only the consent record. The Admin sees it on an OpenStreetMap tile, never as a stored route. An abandoned node's bytes can still exist and are visible in the Firebase console.

**Bakit.** A privacy feature nobody uses is a liability with no upside; one that is used needs a purpose written into the Privacy notice (e.g. "so we can guide you on the last kilometre"). The Guest must be told what it is for.

**Sagot.** ☐ Will use — purpose: __________ ☐ Will not use ☐ Only on request

---

## 6. Legal, content, accounts

### Q33 🟠 Privacy notice and data requests — who is responsible?

**Today.** The Privacy Policy is three bullets inside `/legal` (`src/lib/legal.ts`, version `2026-10-30`). It says what is stored (account, booking, proof, chat, access logs), that there is no GPS trail, and that data is not sold. It does **not** say how long anything is kept, who to contact, or how to request deletion/correction — the rights the Data Privacy Act gives a Guest.

**Bakit.** The system stores names, mobile numbers, emails, payment screenshots and chat images. A real business needs a named contact and a retention rule. Chat already has one (90 days after the booking closes); Bookings and CRM have none.

**Sagot.**

- Contact for privacy requests (name + email/phone): __________
- Keep Bookings/CRM: ☐ forever ☐ ____ years ☐ until ____
- Deletion requests handled by: __________

---

### Q34 🟠 Does the owner sign off on the terms, and on the content rights?

**Today.** The Terms page was written by the team (version `2026-10-30`): min age 10 (see Q19), refunds follow the published policy, deposit refundable after inspection, down payment approval gate, no-show not mentioned.

**Bakit.** These are the words a Guest accepts before paying. The owner should read them once as the business, not as a developer. Separately: the gallery uses Google Maps photos of the property and the review quotes are verbatim Airbnb reviews — the owner should confirm the property photos are hers to publish, or supply her own.

**Sagot.** Terms ☐ approved ☐ changes: __________
Photos: ☐ ours ☐ need new photos. Review quotes: ☐ fine ☐ ask each Guest first

---

### Q35 🔴 Whose accounts hold the system?

**Today.** The Firebase project is `hacienda-de-luisana`; the site's canonical origin is `https://haciendadeluisana.com`; the booking callables can run on Firebase or on a Cloudflare Worker (ADR-0024); the code lives in a GitHub repository; hosting config exists for both Firebase Hosting and Vercel.

**Bakit.** At turnover the owner (or the team, on her behalf) must hold: the domain registrar, the Firebase project owner, the Cloudflare account, the GitHub repo and the hosting account. If the student's personal account is the owner of all five, the business stops when the account does.

**Sagot.** Domain owner: __________ Firebase owner: __________ Cloudflare: __________ GitHub: __________ Will accounts be transferred? ☐ Yes, when: __________ ☐ No

---

### Q36 🟠 Who pays for it, and what happens after the defense?

**Today.** Free tiers can carry this volume (Firebase Spark + Cloudflare Worker free tier), but push notifications, the Worker beyond its free quota, the domain, an email provider and a Play Store account are all recurring or one-time costs. Nothing is monitored after handover.

**Bakit.** A capstone that stops working in March is worse than one never deployed. The owner needs to know the yearly cost and who to call.

**Sagot.** Pays for: domain ☐ hosting ☐ email ☐ Play Store ☐ — who: __________
Maintenance after turnover: ☐ team, best effort ☐ paid support ☐ nobody (accept the risk)

---

### Q37 🔴 Go-live: when, and how do we start?

**Today.** The repository takes no real bookings yet, and there is no path for importing existing Guests, past stays or OTA bookings.

**Bakit.** The first real booking should not be the first test. A short plan — one weekend of supervised bookings, then open — is cheaper than an incident.

**Sagot.** Target date: __________ Start with: ☐ one accommodation ☐ all ☐ invitation only for ____ weeks
Import past Guests/Bookings? ☐ Yes (from Airbnb/Agoda/Facebook) ☐ No
Who is trained before launch: __________. Rollback (turn booking off) decided by: __________

---

### Q38 ⚪ Do we need professional photos / final copy?

**Today.** The gallery is Google Maps imagery; captions and descriptions were written by the team from the listings. The property is presented honestly but not professionally.

**Bakit.** A booking site sells on photographs. This is optional for the defense and close to essential for real trade.

**Sagot.** ☐ Current is fine ☐ New photos planned — date: __________

---

## 7. Already settled — huwag nang itanong

These are already in the repo and should be **confirmed, not re-negotiated**:

- Contact details, address, Facebook/Messenger, Instagram, maps pin — `src/config/site.ts` `BUSINESS`.
- GCash and BDO QR codes and recipient names — `src/config/officialBusiness.ts`, `public/images/payment/README.md`.
- The three accommodations and their canonical ids — `main-house`, `annex`, `house-a-camping` (2 units, 3 guests each).
- Check-in 2:00 PM, check-out 12:00 noon, 22-hour standard stay.
- House rules already published (clean as you go, pets, kitchen, parking, bonfire).
- Included amenities and the "free use" list.
- 50% down payment and the option to pay in full.
- 1–20 night stay limit; checkout date is reusable.
- One role, two apps (website for Guests, Flutter app for the Admin).

---

## 8. Not the client's to answer — the team's own gaps

These look like client questions and are not. They must be fixed by the team, and each one is visible in a demo if left alone.

| Item | Where it is | What it needs |
|---|---|---|
| Minimum age is **10** | `lib/utils/validators.dart:127`, `src/lib/legal.ts:18` | Set from Q19; one edit |
| Guest lookup only inside one browser | `src/pages/BookingStatusPage.tsx` uses a uid-scoped `list()` | A callable or an account requirement (Q17) |
| Balance/deposit never recorded as paid | `lib/services/booking_lifecycle.dart`, no action | A "Balance received" action (Q7) |
| A Guest who cancels while still **Pending** has already paid, but gets no refund record | `src/lib/booking/actions.ts`, the `Cancel` branch only opens a refund from `Reserved` or a verified `Approved` | Open a refund whenever a claimed/verified payment exists (Q5, Q6) |
| Deposit lies inside the verified amount in refund maths | `settleRefund`, `src/lib/booking/money.ts` | Align with Q4's answer |
| Legacy "Verify payment" requires proof ≥ downpayment + deposit | `booking_lifecycle.dart` | Align with Q4 / Q6 |
| `docs/BOOKING_POLICY.md` still says one night is the only standard stay | vs ADR-0022 (1–20 nights priced) | Delete the stale paragraph |
| Rules verified by the in-repo evaluator only | `docs/LIMITATIONS.md` | `npm run test:emulator` on a machine with Java |
| Chat retention has a stamp but no sweeper | `docs/MESSAGING.md` § 4 | Deploy the scheduled function |
| No CSP header | `docs/LIMITATIONS.md` | Hardening, before real traffic |
| Callables may be undeployed | ADR-0024 / `docs/quotes/IMPLEMENTATION.md` | Decide Worker vs Blaze, deploy, then enable quotes |

---

## Appendix A — Tanong sa may-ari (one-page form)

**Pangalan:** ______________________ **Petsa:** ____________

1. **Presyo.** Tama ba ang mga ito? Main House ₱5,000 (weekday) / ₱6,000 (weekend-holiday), hanggang 10 tao, +₱500 bawat dagdag. Annex ₱4,000 / ₱5,000, hanggang 6. A-House ₱1,000 bawat unit, hanggang 3 bawat unit.
   ☐ Tama ☐ May babaguhin: ______________________________________
2. **Weekend/Holiday.** Ang buong stay ba ay siningil sa rate ng araw ng check-in? (Halimbawa: Biyernes–Linggo, 2 gabi = 2 × weekend rate.)
   ☐ Oo ☐ Hindi — gusto ko per gabi: ______________________________
3. **Maximum na tao.** Main House: ____ Annex: ____ A-House: 3 bawat unit. Kasama ba ang bata sa bilang? ☐ Oo ☐ Hindi
4. **Security deposit.** Magkano? MH ₱____ Annex ₱____ A-House ₱____. Kailan kinokolekta? ☐ Kasama ng down payment ☐ Sa check-in. Kailan ibinabalik? ☐ Pagka-check-out ☐ After ____ araw
5. **Cancellation.** Ilang porsyento ang maibabalik? 30+ araw ____% · 15–29 ____% · 7–14 ____% · 3–6 ____% · 0–2 ____%. No-show: ☐ walang refund ☐ deposit lang. Bagyo: ☐ rebook ☐ refund.
6. **Bayad bago approve.** Okay lang bang nagbabayad muna ang guest bago i-approve? ☐ Oo ☐ Hindi. Kapag na-reject ang resibo, paano ibinabalik ang pera at gaano kabilis? ______________________
7. **Natitirang bayad.** Paano kinokolekta sa check-in? ☐ Cash ☐ GCash ☐ BDO. Kailangan bang may resibo (BIR)? ☐ Oo, series: ______ ☐ Hindi
8. **Exclusive ba?** Kapag may naka-book sa Main House, pwede pa bang paupahan ang A-House? ☐ Pwede ☐ Hindi pwede ☐ Depende
9. **Airbnb/Agoda.** Sino ang nagba-block ng petsa dito kapag may booking sa Airbnb/Agoda? ____________ Gaano kabilis? ____ oras. Gusto ba ng automatic sync? ☐ Oo ☐ Hindi
10. **Lead time.** Ilang araw bago dapat mag-book ang guest? ____ araw (ngayon: 30). Tumitanggap ba ng last-minute/walk-in? ☐ Oo ☐ Hindi
11. **Approval.** Sino ang mag-a-approve ng booking at gaano kabilis? ____________ oras. Sapat na ba ang 24 oras na hawak sa petsa? ☐ Oo ☐ Gawing ____ oras
12. **Admin account.** Sino-sino ang gagamit ng Admin app? Pangalan at email: ______________________. Kailangan pa ba ng access ng developer pagkatapos? ☐ Oo ☐ Hindi
13. **ID sa check-in.** Kailangan ba ng valid ID? ☐ Hindi ☐ Oo, itatala lang ang number (walang picture)
14. **Edad.** Ilang taon ang pinakabatang pwedeng mag-book? ☐ 18 ☐ 21 ☐ Iba: ____
15. **Pets.** Pwede saan? ☐ Main House ☐ Annex ☐ A-House. Ilan ang maximum? ____. ₱300 bawat pet — ☐ bawat stay ☐ bawat gabi
16. **Abiso sa guest.** Gusto ba ng email o SMS confirmation? ☐ Email ☐ SMS ☐ Wala. Sino ang sasagot sa gastos? ____________
17. **Events/day use.** Gusto bang mabook online ang events, shoot, at day use? ☐ Hindi, manual lang ☐ Oo
18. **Smart lock.** May totoong lock na ba? ☐ Wala pa ☐ Meron — brand: ________ pinto: ____ Wi-Fi: ☐ Oo ☐ Wala
19. **Reviews.** Sino ang magmo-moderate? ____________ Pwede bang ilathala sa website ang review na may first name? ☐ Oo, magtanong muna ☐ Oo, basta't first name ☐ Hindi
20. **Privacy.** Para sa data requests, sino ang kokontakin? Pangalan at email: ______________________. Gaano katagal itatago ang booking at guest records? ____ taon
21. **Accounts at bayad.** Kanino ang domain, Firebase, Cloudflare, GitHub? ______________________. Sino ang magbabayad ng domain/hosting/email? ____________
22. **Go-live.** Kailan? ____________ Sino ang i-train? ____________. May i-import ba na lumang guest/booking? ☐ Oo ☐ Wala

---

## Appendix B — where each answer gets written down

| Answer | Lands in |
|---|---|
| Q1 rates, Q2 holiday dates | Admin app → Rates screen → `site_config/rates`; seed in `src/config/officialBusiness.ts` |
| Q2 per-night pricing (if changed) | `src/lib/booking/rates.ts`, mirrored `functions/src/pricing.ts`, `firestore.rules` — ADR first |
| Q3 headcount cap | `GuestRateSchedule.max_guests` + validator (`allowDocumentedCap`) + rules; ADR |
| Q4 deposit collection | `site_config/rates`, `settleRefund` (`src/lib/booking/money.ts`), Dart mirror |
| Q5 cancellation / no-show / typhoon | Rates screen (`refund` block), `src/lib/legal.ts` (LEGAL_VERSION bump), `docs/BOOKING_POLICY.md` |
| Q6 down-payment percentage | `firestore.rules` (`down_payment_percent == 50`), rates validator, money.ts |
| Q7 balance recording | New Admin action + rules + Dart mirror (feature) |
| Q8 optional charges | `OFFICIAL_STAY_POLICIES.optional_charges`, `src/config/site.ts` `FEES` |
| Q9 price parity | Admin Rates screen; write the rule down in `docs/BOOKING_POLICY.md` (no code) |
| Q21 chat promise | `docs/MESSAGING.md`; the reply-time line in `src/config/site.ts` |
| Q22 events | `manual_review_notice` and `optional_charges` in `site_config/rates`; a new flow only if the answer is yes |
| Q23 language | Copy in `src/pages/` and `src/config/site.ts`; no code |
| Q26 connectivity | Operational; note the limits in `docs/LIMITATIONS.md` |
| Q28 reports | `lib/views/analytics/`; an export is a feature |
| Q34 terms & rights | `src/lib/legal.ts` (LEGAL_VERSION bump), `GALLERY` and `REVIEWS` in `src/config/site.ts` |
| Q38 photos | `public/images/` + `GALLERY` in `src/config/site.ts` |
| Q10 lead time | `site_config/booking.minimumBookingLeadTimeDays` (no deploy) |
| Q11 hold length | `DATE_HOLD_MS` in `src/lib/booking/availability.ts` (mirrored in `functions/src/booking/availability.ts` and the Dart mirror) + rules |
| Q12 exclusivity | `src/lib/booking/availability.ts` projection + `firestore.rules` + new ADR; or fix `GUEST_NOTES` in `src/config/site.ts` |
| Q13 multi-unit | New feature; `units_per_booking` is already in the rates shape |
| Q14 date blocks | New Admin action + projection; or document the manual-Booking workaround |
| Q15 channel sync | New ADR + Worker/cron; or an operations note in `docs/LIMITATIONS.md` |
| Q16 guest email/SMS | New provider + `functions/` (or Worker) + `.env.example` + Privacy notice |
| Q17 cross-device lookup | New callable (reference + email) or account gate; ADR-0004 is the decision to revisit |
| Q18 check-in ID | `src/lib/legal.ts`, Admin check-in screen, Privacy notice |
| Q19 minimum age | `lib/utils/validators.dart`, `src/lib/legal.ts`, `RegisterForm.tsx` hint |
| Q20 pets | `optional_charges.pets`, `src/config/site.ts` `FEES`, `HOUSE_RULES` |
| Q24 admin accounts | `firestore.rules` `adminEmails()`, `src/lib/auth/profile.ts`, `lib/services/auth_store.dart`, `functions/src/notifications.ts` — all four, or a Profile in the console |
| Q25 PIN | Set in the Admin app; policy in ADR-0015/0016 (no code change) |
| Q27 distribution | `docs/ANDROID.md`, Play Console |
| Q29 reviews/testimonials | Admin review screen; `docs/REVIEWS.md`; `src/lib/legal.ts` |
| Q30–Q31 lock | New hardware phase + firmware; `docs/SMART_LOCK.md` is the contract |
| Q32 live location | Privacy notice; `docs/MESSAGING.md` |
| Q33 privacy/retention | `src/lib/legal.ts` (new LEGAL_VERSION), `docs/LIMITATIONS.md`, retention job |
| Q35–Q36 ownership | Outside the repo: registrar, Firebase, Cloudflare, GitHub, Play Console |
| Q37 go-live | New `docs/GO_LIVE.md` checklist |
