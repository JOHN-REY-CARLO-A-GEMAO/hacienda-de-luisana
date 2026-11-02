# The client-decisions Google Form

`Code.gs` builds a Google Form for the questions in
[`docs/CLIENT_OPEN_QUESTIONS.md`](../../docs/CLIENT_OPEN_QUESTIONS.md) — the business
facts only the Hacienda's owner can decide — and links it to a spreadsheet of answers.

Google Forms has no export file to import, so the form is **built by a script** owned by
whoever runs it. That means the form is yours, not the team's: the answers land in your
Drive, and you can edit any wording without a deploy.

---

## Build it (once, about 3 minutes)

1. Open <https://script.google.com> → **New project**.
2. Delete the sample `myFunction`, paste all of `Code.gs`, and press **Save**.
3. In the function dropdown pick **`createClientForm`**, then **Run**.
4. Google asks for permission the first time. Choose your account → **Advanced** →
   **Go to project (unsafe)** → **Allow**. It is your own script; it asks only for Forms
   and Sheets. Nothing leaves your Drive.
5. Open **View → Execution log**. It prints three links:

   ```text
   Sagutan:   https://forms.gle/…            ← send this to the owner
   I-edit:    https://docs.google.com/forms/d/…/edit
   Responses: https://docs.google.com/spreadsheets/d/…
   ```

6. Open **I-edit** and press **Send** to email the form, or copy the *Sagutan* link into
   Messenger / Viber.

### Re-running it

- `createClientForm` remembers the form it made and prints the existing links instead of
  making a duplicate.
- `createClientFormAgain` builds a **new** form; the old one and its answers stay where
  they are.
- `showClientFormLinks` prints the links of the most recent form again.

---

## What the owner sees

Seven pages, 55 questions, ~15 minutes, with a progress bar:

| Section | What it settles |
|---|---|
| **1. Presyo, tao, at deposit** | the published rates, weekend/holiday rule, maximum headcount, security deposit |
| **2. Cancellation, refund, at bayad** | the refund policy, no-show, typhoon, pay-before-approval, the check-in balance |
| **3. Kalendaryo at availability** | lead time, who approves and how fast, the date hold, exclusivity, blocking dates, Airbnb/Agoda sync |
| **4. Guest, ID, at abiso** | ID at check-in, minimum age, pets, notifications, looking up a booking on another device |
| **5. Admin, access, at privacy** | who holds Admin access, internet, how the app is installed, reviews, smart lock, live location, privacy contact |
| **6. Accounts at go-live** | whose accounts own the system, go-live date, what opens first, importing old guests |

Every required list question offers an escape: **"Pag-usapan natin"**, **"Hindi ko alam"**,
or an **Iba pa** box. A free-text question accepts *"Hindi pa sigurado"*. Nothing forces the
owner to invent an answer she does not have — a "we have not decided" is a useful record.

The questions are written in Taglish on purpose: the form is read by the owner, not by the
panel. `docs/CLIENT_OPEN_QUESTIONS.md` stays the English record, with the reasoning, the
cost of getting it wrong, and where each answer gets written into the repository.

---

## After the answers arrive

1. Read the responses spreadsheet (it is created next to the form).
2. Copy each answer into `docs/CLIENT_OPEN_QUESTIONS.md` under its question's **Sagot**
   line, so the repository — not a Drive file — is the record.
3. Apply the answer: Appendix B of that document maps every question to the file, screen
   or document that changes.
4. Anything answered **"Pag-usapan natin"** is a conversation, not a decision: it belongs in
   a GitHub issue with the `needs-info` label until it is answered.

---

## Checking the script without Google

`build-check.mjs` runs `Code.gs` against a strict mock of the Forms, Sheets, Properties and
Utilities services. It fails on anything the real API would refuse (a non-string help text,
a choice list that is not a list of strings, a section with no title) and on the things this
repository cares about: no duplicate question titles, six sections, and every required list
question offering a way to say "not decided yet".

```bash
npm run check:google-form
```

The script is plain ES5-style Apps Script — no `const`/arrow functions — because the V8
runtime still tolerates older syntax in pasted code and it keeps the file readable to anyone
who has only used the Apps Script editor.
