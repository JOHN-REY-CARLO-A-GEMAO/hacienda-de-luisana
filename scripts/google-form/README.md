# The client-decisions Google Form

Three builders live here:

| File | What it is | Send it? |
|---|---|---|
| `v2.1/Code.gs` | **Version 2.1** — 126 questions, seven sections; v2 with a third audit's findings fixed | **Yes** |
| `v2/Code.gs` | Version 2, revised — 124 questions, frozen at the state the third audit reviewed | No |
| `Code.gs` | Version 1 — 55 questions, kept unchanged for history | No |

Each builds a Google Form for the questions in
[`docs/CLIENT_OPEN_QUESTIONS.md`](../../docs/CLIENT_OPEN_QUESTIONS.md) — the business
facts only the Hacienda's owner can decide — and link it to a spreadsheet of answers.

Google Forms has no export file to import, so the form is **built by a script** owned by
whoever runs it. That means the form is yours, not the team's: the answers land in your
Drive, and you can edit any wording without a deploy.

---

## Build it (once, about 3 minutes)

1. Open <https://script.google.com> → **New project**.
2. Delete the sample `myFunction`, paste all of `v2.1/Code.gs`, and press **Save**.
3. In the function dropdown pick **`createClientFormV2`**, then **Run**.
4. Approve the permissions. **Read the list Google shows on its own consent screen** rather
   than trusting any summary: the script uses Google Forms (create the form), Google Sheets
   (create the answer sheet) and its own script properties (remember the form it made). If
   Google says the app is unverified: **Advanced → Go to project (unsafe) → Allow**. It is
   your own script, in your own Drive.
5. Open **View → Execution log**. It prints three links:

   ```text
   I-edit:    https://docs.google.com/forms/d/…/edit
   Sagutan:   https://forms.gle/…
   Responses: https://docs.google.com/spreadsheets/d/…
   ```

6. Open **I-edit** and press **Send** to email the form, or copy the *Sagutan* link into
   Messenger / Viber.

### Run a dummy pass before sending it

The build is tested against a mock of the Apps Script API (`npm run check:google-form`),
not against Google itself. One manual pass closes that gap:

1. Open **Sagutan** and answer every page with junk ("test") answers.
2. Confirm the response appears in the **Responses** spreadsheet, one column per question.
3. Confirm the grid questions (retention, role permissions) accept one tick per row, and
   that a checkbox grid accepts several.
4. Delete the dummy response from the form (Responses tab → the trash icon).
5. Only then send it to Ms. Aida.

### Re-running it, and recovering from a failure

- `createClientFormV2` **never makes a second form by accident.** It remembers the form it
  made. If that form is missing or permission fails, it logs and stops — it does not forget
  the record, because forgetting is what used to create a duplicate on the next run.
- The form id is saved **immediately after creation**, and the record is rewritten as the
  build proceeds (`building` → `ready`), so a build that dies halfway leaves a record that
  says exactly what exists.
- If it does die halfway the record says `incomplete`, and the next run refuses to start
  another form. Delete the half-built form and sheet in Drive, run
  **`forgetClientFormV2()`** (it clears the record and prints the links; it does not delete
  anything itself), then run `createClientFormV2` again.
- A second form takes **two deliberate steps**: run `confirmNewClientFormV2()`, which prints
  the links of the form that already exists, then run `createNewClientFormV2()` within ten
  minutes. Each confirmation buys exactly one form, and v1's `createClientFormV2Again` — a
  single click that made a duplicate — is gone.
- The whole check-create-save workflow runs under `LockService`, so two windows pressing Run
  at the same moment cannot both see an empty record and both build.
- A saved record that cannot be read now **stops** the script instead of reading as "no form
  yet". `showClientFormV2Links` reprints the links.

> v2.1 also refuses if **v2's own record** (`HDL_CLIENT_FORM_V2_STATE`) names a form: that
> form is listed, nothing is created. One real window remains — `FormApp.create()` runs
> before the first `saveState()`, so a property write that fails at that exact moment leaves
> a form in Drive with no record. It is documented, not hidden; check Drive before running
> the script a second time.

---

## What changed from v1

Version 1 was reviewed before it was sent. All five findings are fixed, and
`build-check.mjs` asserts each one so a later edit cannot quietly reintroduce it:

| v1 problem | v2 |
|---|---|
| The account question told the respondent to write down **who has each service's password** | Asks who the account is *owned by*, the registered owner email, and whether the Hacienda already has **authorized administrator access**. The form's description states the prohibition. Ownership moves through each service's *invite* / *transfer ownership* flow. |
| Included guests and maximum occupancy read as the same number | Separate questions: included in the base rate, maximum headcount, extra-guest charge. |
| The cancellation section stated that an unpublished policy means a ₱0 refund | It says no final policy exists yet and asks the owner to choose one, and asks what the refund percentage applies to. |
| The pet question used checkboxes, so "Main House" and "no pets anywhere" could both be ticked | One single-choice question with mutually exclusive answers, plus a separate question for the fee basis. |
| No confirmation of the check-in and check-out times | A question that confirms 2:00 PM / 12:00 NN, with room for a different time. |

## What changed in the revision of v2

The second review found remaining gaps. Fixed here, and asserted:

| Finding | What revision 2 does |
|---|---|
| "Per stay" and "per night" pricing were mixed together | The rate is described as **one standard stay per night**, a question asks whether ₱5,000 / ₱6,000 is per night or per booking, and another asks how many weekend nights a Friday-to-Sunday stay charges. |
| The Friday-to-Sunday example was logically wrong | Replaced with a **Thursday-to-Saturday** example, which is the case where the two pricing models actually disagree (₱11,000 per-night vs ₱10,000 at the check-in night's rate). |
| Maximum occupancy was a menu of preset numbers | Three **short-answer** number questions (Main House, Annex, A-House), each accepting "Hindi pa napagdesisyunan", plus a question for the basis (beds, safety, seating) and one for what the website itself will enforce. |
| Minimum booking age and ID-at-check-in were missing | Both added. Age asks about the **person responsible for the booking**, not the guests. ID offers: none, inspected only, number recorded, photograph — in that order, with the Data Privacy cost of photographs stated. |
| Cancellation still lacked detail | Added: whether the deposit is refunded, partial vs full payment, whether a rescheduled booking keeps its price, which date a refund is based on after a reschedule, who approves and records the refund, and how damage is priced. |
| Force majeure mixed two different situations | Split: a typhoon or flood **at the Hacienda**, and a **guest's personal emergency**, asked separately. |
| The iCal description over-promised | The option now says "import", "publish", "both, where supported", or "full channel manager", and the help text states that a feed is **delayed** and cannot guarantee the absence of a double booking. |
| Checkboxes could contradict themselves | No checkbox carries an "undecided" or "nobody" answer any more. Those lists are optional, and an unanswered checkbox means "not decided". |
| Missing: balance recording, double-booking rescue, damage pricing, events, lock hardware | All added. The balance question states plainly that **the Admin app cannot record the balance as received today**. |
| Smart-lock questions assumed hardware exists | The first answer is now "no lock, and no brand chosen yet — the team still has to study it", and a separate question asks the brand, model, doors and power. Battery failure and offline access are their own questions. |
| Live Location was treated as a settled capability | A question asks whether to keep it optional, shorten it, **remove it**, or defer it. |
| Admin access did not say what each role may do | A checkbox grid: each role against approving bookings, verifying payments, approving refunds, seeing guest data, changing availability. |
| `openById` failure deleted the saved record, causing duplicates | It now logs and stops; the record is kept. `build-check.mjs` reproduces the failure and asserts that nothing is created. |
| A failed build could leave orphaned files silently | The form id is stored immediately and the record is rewritten as the build proceeds; a failure is recorded as `incomplete` and blocks a second run until `forgetClientFormV2()`. |
| "It asks only for Forms and Sheets" was a promise about scopes | The instructions now tell the reader to check Google's own consent screen. |

### Two numbers that look alike

The first review called the booking hold a **22-hour** policy. In this repository the two
numbers are different things:

- **22 hours** is the length of a **standard stay**, 2:00 PM to 12:00 NN
  (`src/config/site.ts`, `docs/BOOKING_POLICY.md`, every rate document).
- **24 hours** is the **date hold** on a Pending booking — `DATE_HOLD_MS` in
  `src/lib/booking/availability.ts`, written to `hold_expires_at` at submission.

Rather than relabel the hold as 22 hours and change a policy by accident, the form asks: 22 h,
24 h, 48 h, 72 h, another duration, or *Pag-usapan natin* — with the difference explained. It
also asks when the countdown starts and what happens when it runs out, which today is
"expire silently, with no message to the Guest and no warning to the Admin".

---

## What changed in v2.1

The third audit approved v2 conditionally. Every finding below is fixed in `v2.1/Code.gs`
and asserted in `build-check.mjs`; the seven sections and the rest of the questionnaire are
v2's, unchanged. **`v2/Code.gs` is not edited.**

| Finding | What v2.1 does |
|---|---|
| `createClientFormV2Again` made a duplicate in one click, corrupt state read as "no form", and two simultaneous runs could both build | A second form needs `confirmNewClientFormV2()` **then** `createNewClientFormV2()` inside ten minutes, one form per confirmation; unreadable state **throws** instead of counting as empty; the check-create-save path is under `LockService`. A v2 record is honoured as an existing form too. |
| The first `saveState()` could fail outside the `try`, leaving a form with no record | Moved inside the `try`. `FormApp.create()` still precedes it — that window is stated in the header and the README rather than papered over. |
| "Pwede mong i-save at balikan" promised an autosave that does not always happen | It now states the condition: same Google Account, same link, autosave up to 30 days; otherwise finish in one sitting. |
| Occupancy was a menu of preset numbers, and a typed number could be blank text | Three number-validated fields, still **optional** — blank is the recorded "not decided" — plus a question on what the system should use while the maximum is undecided. |
| The Friday-to-Sunday weekend question could not distinguish the two pricing models | Removed. The Thursday-to-Saturday example stays, and the per-night question names Main House, Annex, A-House and "Iba-iba bawat accommodation". A new question confirms the A-House's flat rate across weekday, weekend and holiday. |
| The permission grid offered "Wala sa lahat" beside the real permissions | That column is gone; a blank row means no permission, and the help text says so. |
| The refund example said ₱5,000 was capped at a greater ₱5,000 | The arithmetic is written out (₱2,500 vs ₱5,000), and the help states that a refund cannot exceed the money actually received. |
| The security deposit was defined as if one is always collected | Redefined as an additional amount that **may** be collected; the question asks whether it is required at all. |
| The OTA help quoted a fixed "15 minutes to a few hours" delay | It now says the delay depends on the provider and configuration, that iCal is not real-time, and that no feed can guarantee a clash-free calendar. |
| Account ownership listed services the project does not run on, and never asked for the registered email | The grid covers domain registrar/DNS, Firebase/Google Cloud, Supabase, Vercel and GitHub; a separate paragraph asks for the registered owner email of each, and for any service not on the list. No password is ever requested. |
| The receipt question was a yes/no dressed up as a list | It asks for the **process**: screenshot only, a simple admin invoice, a BIR official receipt, other, or not yet decided. |
| Smart-lock answers could read as confirmation that hardware exists | The help states the answers choose intent, not hardware; the first answer remains "no lock, no brand chosen". |
| Thirteen questions offered a literal "Iba pa" choice **and** Google's Other box | The literal choice is removed wherever Google's Other box is on. |
| Too many answers were required to send the form at all | 18 questions moved to optional; required answers drop from **90 to 73**. The questions v2.1 adds are optional apart from two that offer "Pag-usapan natin". |

---

## What Ms. Aida sees

Seven pages, 126 questions (73 required, 53 optional), ~40–50 minutes, with a progress bar.
The questions are in Taglish on purpose: the form is read by the owner, not by the panel.

1. **Bago magsimula** — who is answering, and whether these answers are final or need the
   owner's approval
2. **Presyo, kasama sa rate, at deposit**
3. **Cancellation, refund, at bayad**
4. **Kalendaryo, hold, at OTA**
5. **Guest, check-in, at patakaran sa pamamalagi**
6. **Operasyon at access**
7. **Privacy at go-live**

Questions marked **(Teknikal)** are implementation choices. The form's description says so,
and every one of them can be answered "Pag-usapan natin", so the owner is not forced to
decide how a smart lock should be wired.

If 40–50 minutes is too long for a first pass, the 22-question printable form in
Appendix A of `docs/CLIENT_OPEN_QUESTIONS.md` covers only what blocks go-live.

`docs/CLIENT_OPEN_QUESTIONS.md` stays the English record, with the reasoning, the cost of
getting it wrong, and where each answer gets written into the repository.

### Answer quality

- Every **required list** question offers **"Pag-usapan natin"**, **"Hindi pa
  napagdesisyunan"**, **"Hindi ko alam"**, or an **Iba pa** box.
- A **free-text** question accepts "Hindi pa napagdesisyunan" in words; the help text says so
  wherever the answer is a number (occupancy, deposit, lead time).
- Checkbox questions are **optional**, and carry no contradicting "undecided" option.
- Technical terms (security deposit, OTA, hold, force majeure, Live Location, standard stay)
  are explained once, in the form's own description, in Filipino.
- Every question's help text states the figure the system uses today, so the owner is
  correcting a number rather than inventing one.

---

## After the answers arrive

1. Read the responses spreadsheet (created next to the form).
2. Copy each answer into `docs/CLIENT_OPEN_QUESTIONS.md` under its question's **Sagot**
   line, so the repository — not a Drive file — is the record.
3. Apply the answer: Appendix B of that document maps every question to the file, screen
   or document that changes.
4. Anything answered **"Pag-usapan natin"** is a conversation, not a decision: it belongs in
   a GitHub issue with the `needs-info` label until it is answered.
5. Where the answer contradicts what the code does — the hold length, the refund base, the
   occupancy cap, the check-in time, the balance recording — write an ADR before the code,
   so the reason survives the change.

---

## Checking the script without Google

`build-check.mjs` runs all three builders against a strict mock of the Forms, Sheets,
Properties and Utilities services. It fails on anything the real API would refuse, asserts
every fix from all three reviews, and exercises the failure paths:

- a form that cannot be opened must **not** lose its record and must create nothing;
- a build that fails halfway must **throw**, keep the form id, and be marked `incomplete`;
- an unreadable record, and a held lock, must both stop the run and create nothing;
- a confirmation must be required, must expire after ten minutes, and must buy one form.

```bash
npm run check:google-form
```

v1 and v2 are only checked to still parse and run, so history stays readable without
holding older forms to rules written after them. This is a mock, not a Google execution: the dummy
pass above is still required.

The scripts are plain ES5-style Apps Script — no `const`, no arrow functions — because that
is the syntax the Apps Script editor's examples and autocomplete assume.
