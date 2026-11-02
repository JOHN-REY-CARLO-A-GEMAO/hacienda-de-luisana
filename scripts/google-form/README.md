# The client-decisions Google Form

Two builders live here:

| File | What it is | Send it? |
|---|---|---|
| `v2/Code.gs` | **Version 2** — 101 questions, seven sections, built from the review of v1 | **Yes** |
| `Code.gs` | Version 1 — 55 questions, kept unchanged for history | No |

Both build a Google Form for the questions in
[`docs/CLIENT_OPEN_QUESTIONS.md`](../../docs/CLIENT_OPEN_QUESTIONS.md) — the business
facts only the Hacienda's owner can decide — and link it to a spreadsheet of answers.

Google Forms has no export file to import, so the form is **built by a script** owned by
whoever runs it. That means the form is yours, not the team's: the answers land in your
Drive, and you can edit any wording without a deploy.

---

## Build v2 (once, about 3 minutes)

1. Open <https://script.google.com> → **New project**.
2. Delete the sample `myFunction`, paste all of `v2/Code.gs`, and press **Save**.
3. In the function dropdown pick **`createClientFormV2`**, then **Run**.
4. Google asks for permission the first time. Choose your account → **Advanced** →
   **Go to project (unsafe)** → **Allow**. It is your own script; it asks only for Forms
   and Sheets. Nothing leaves your Drive.
5. Open **View → Execution log**. It prints three links:

   ```text
   Sagutan:   https://forms.gle/…            ← send this to Ms. Aida
   I-edit:    https://docs.google.com/forms/d/…/edit
   Responses: https://docs.google.com/spreadsheets/d/…
   ```

6. Open **I-edit** and press **Send** to email the form, or copy the *Sagutan* link into
   Messenger / Viber.

### Re-running it

- `createClientFormV2` remembers the form it made and prints the existing links instead of
  making a duplicate.
- `createClientFormV2Again` builds a **new** form; the old one and its answers stay where
  they are.
- `showClientFormV2Links` prints the links of the most recent form again.

---

## What changed from v1

Version 1 was reviewed before it was sent, and the review found five things to fix. All
five are fixed in v2, and `build-check.mjs` asserts each one so a later edit cannot
quietly reintroduce it:

| v1 problem | v2 |
|---|---|
| The account question told the respondent to write down **who has each service's password** | Asks who the account is *owned by*, the registered owner email, and whether the Hacienda already has **authorized administrator access**. The form's own description states the prohibition: no password, PIN, OTP, recovery code or API key belongs in any answer. Ownership moves through each service's *invite* / *transfer ownership* flow. |
| Included guests and maximum occupancy read as the same number | Three separate questions: *included in the base rate*, *maximum headcount*, and *extra-guest charge*. |
| The cancellation section stated that an unpublished policy means a ₱0 refund | It says no final policy exists yet, asks the owner to choose one, and adds what the review found missing: **what the refund percentage applies to** (down payment received / all money received / whole stay total), reschedules, shortened stays, cancellation by the Hacienda. |
| The pet question used checkboxes, so "Main House" and "no pets anywhere" could both be ticked | One single-choice question with mutually exclusive answers, plus a separate question for the fee basis (per pet per stay / per pet per night / per stay). |
| No confirmation of the check-in and check-out times | A question that confirms 2:00 PM / 12:00 NN, with room for a different time. |

### Two numbers that look alike

The review called the booking hold a **22-hour** policy. In this repository the two numbers
are different things:

- **22 hours** is the length of a **standard stay**, 2:00 PM to 12:00 NN
  (`src/config/site.ts`, `docs/BOOKING_POLICY.md`, every rate document).
- **24 hours** is the **date hold** on a Pending booking — `DATE_HOLD_MS` in
  `src/lib/booking/availability.ts`, written to `hold_expires_at` at submission.

Rather than relabel the hold as 22 hours and change a policy by accident, v2 asks: the
options are 22 h, 24 h, 48 h, 72 h, another duration, and *Pag-usapan natin* — and the help
text explains the difference. It also asks **when the countdown starts** (submission,
approval, or payment request) and **what happens when it runs out**, which today is
"expire silently, with no message to the Guest and no warning to the Admin".

### What v2 adds beyond the fixes

Section 5 and parts of 6 and 7 are new: early check-in, late-checkout grace, quiet hours,
smoking, parties and visitors, children and infants, extra beds, damage and cleaning, how
the maximum headcount is enforced, the maximum stay and booking horizon, same-day /
short-notice / walk-in asked separately, changing dates after payment, who handles
check-in, complaints, emergencies, payment confirmation and overrides, a backup contact,
the smart-lock operating workflow (who issues a code, when it activates and expires,
manual unlock, power or Wi-Fi failure, backup key, who receives alerts), OTA sync as three
distinct levels (manual, calendar feed, full API), admin access tiers, and retention asked
**per record type** in a grid instead of one answer for everything.

---

## What Ms. Aida sees

Seven pages, 101 questions, ~30–45 minutes, with a progress bar. The questions are in
Taglish on purpose: the form is read by the owner, not by the panel.

1. **Bago magsimula** — who is answering, and whether these answers are final or need the
   owner's approval
2. **Presyo, kasama sa rate, at deposit**
3. **Cancellation, refund, at bayad**
4. **Kalendaryo, hold, at OTA**
5. **Check-in, check-out, at patakaran sa pamamalagi**
6. **Operasyon at access**
7. **Admin, privacy, at go-live**

`docs/CLIENT_OPEN_QUESTIONS.md` stays the English record, with the reasoning, the cost of
getting it wrong, and where each answer gets written into the repository.

### Answer quality

- Every **required list** question offers **"Pag-usapan natin"**, **"Hindi pa
  napagdesisyunan"**, **"Hindi ko alam"**, or an **Iba pa** box. Nothing forces the owner to
  invent an answer; "we have not decided" is a useful record.
- About a fifth of the questions are **optional** (no asterisk) — the operational details
  the team can default — so the form does not demand a decision on everything.
- Technical terms (security deposit, OTA, hold, force majeure, Live Location) are explained
  once, in the form's own description, in Filipino.
- Every question has a `help` text with the figure the system uses today, so the owner is
  correcting a number rather than inventing one.

---

## After the answers arrive

1. Read the responses spreadsheet (it is created next to the form).
2. Copy each answer into `docs/CLIENT_OPEN_QUESTIONS.md` under its question's **Sagot**
   line, so the repository — not a Drive file — is the record.
3. Apply the answer: Appendix B of that document maps every question to the file, screen
   or document that changes.
4. Anything answered **"Pag-usapan natin"** is a conversation, not a decision: it belongs in
   a GitHub issue with the `needs-info` label until it is answered.
5. Where the answer contradicts what the code does — the hold length, the refund base, the
   occupancy cap, the check-in time — write an ADR before the code, so the reason survives
   the change.

---

## Checking the script without Google

`build-check.mjs` runs both builders against a strict mock of the Forms, Sheets, Properties
and Utilities services. It fails on anything the real API would refuse (a non-string help
text, a choice list that is not a list of strings, a grid with empty rows) and on the
review's rules: no credential request, occupancy split, no "silence means no refund"
wording, a single-choice pet question, both hold lengths offered, check-in confirmed, seven
sections, and an escape answer on every required list question.

```bash
npm run check:google-form
```

v1 is only checked to still parse and run, so history stays readable without holding the
new form to rules it was written before.

The scripts are plain ES5-style Apps Script — no `const`, no arrow functions — because that
is the syntax the Apps Script editor's autocomplete and examples assume.
