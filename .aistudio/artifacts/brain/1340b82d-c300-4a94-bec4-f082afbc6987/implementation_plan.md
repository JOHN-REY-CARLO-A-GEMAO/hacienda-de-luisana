# Strict Input Validation & Live Character Limits Plan

A comprehensive enhancement to make input fields across the Hacienda de LuisAna guest web application stricter: preventing number entry on alphabetical name fields, restricting non-digit entry on phone fields, enforcing maximum length boundaries, and rendering real-time character counters.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following validation rules and boundaries are configured as part of this plan:
> - **Name & Person Fields**: Number characters (`0-9`) cannot be typed or pasted into guest name inputs (Booking name, First name, Last name, Middle name). Only letters, spaces, hyphens, periods, and apostrophes are accepted.
> - **Phone Fields**: Letters cannot be typed into phone inputs; only digits (`0-9`) and standard dial separators (`+`, space, `-`, `()`) are accepted.
> - **Additional Notes**: Standardized at **500 characters** with an explicit live counter (`{count} / 500 characters`) and helper guidance in the Booking form.
> - **Chat Messages**: Preserves the 1,000-character ceiling with clear tabular count display (`{count} / 1000 characters`).
> - **Event Details & Dispute Inquiries**: Equipped with length limits and real-time character meters.

## 1. Overview & Core Concept

- **What It Does**: Enhances user input handling across all Guest forms so users receive immediate, proactive constraints rather than post-submit rejections. Name fields immediately reject numerical keypresses and pasted digits, phone fields reject letters, and long-form text fields (such as "Additional notes" in Booking, "Tell us about your event", Chat messages, and Guest reviews) actively show real-time character counts and strict maximum length bounds.
- **Target Audience**: Guests reserving a stay, submitting inquiries, chatting with the Admin, or reviewing their experience at Hacienda de LuisAna.
- **Key Value**: Eliminates input errors before submission, provides immediate visual feedback on remaining character limits, and maintains pristine data quality across the application.

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Booking Name Entry*: When the guest types in the "Name" input field on `/book`, numeric keystrokes (`0-9`) are filtered out on the fly. If pasted with numbers, numbers are automatically stripped.
  2. *Additional Notes in Booking*: When the guest focuses on the "Additional notes" textarea in `StayRequestsSection`, a quiet, elegant character counter appears directly beneath the textarea (e.g., `0 / 500 characters`). As the user types, the count updates dynamically. If the user approaches the limit (e.g., > 450 chars), the counter shifts from muted forest green to a warm brass/amber tone; at 500 characters, further typing is halted.
  3. *Event Purpose Detail*: For guests selecting "Other" celebration or event purpose, the detail input enforces a 160-character limit with a live counter (`{count} / 160 characters`).
  4. *Phone & Contact Number Entry*: As users type a mobile number on `/book` or `/guest/auth`, alphabetical keystrokes are rejected so only valid phone digits and standard separators can be entered.
  5. *Authentication & Profile*: First name, last name, and display name inputs in `RegisterForm` apply the same strict text-only filtering.
- **Visual Identity & Theme**:
  - Counters use quiet editorial typography (`text-[11px] text-forest-700/60 dark:text-cream-200/60 tabular-nums`) placed flush with the right boundary of the field.
  - No loud warning banners or garish badges; smooth visual transitions adhering to the anti-slop guidelines.

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Real-Time Input Sanitization vs Inline Error Alert**:
  - *Chosen Approach*: Real-time sanitization (strip numeric characters on change/keydown) paired with clear placeholder hints.
  - *Why*: Prevents invalid submissions entirely and prevents guests from getting frustrated with delayed form rejection messages upon clicking "Continue to downpayment".
- **Decision 2: Standardizing Additional Notes Limit at 500 Characters**:
  - *Chosen Approach*: 500 characters with live counter (up from unstructured input, capped comfortably for mobile readability and Firestore document payload size).
  - *Why*: Accommodates detailed dietary preferences, arrival times, and special celebrations without overloading the admin mobile screen.

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                       Guest Web App                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [ Input Sanitizer Utilities: src/lib/validation.ts ]        │
│   ├─ sanitizeNameInput(val): strips [0-9]                   │
│   ├─ sanitizePhoneInput(val): strips [a-zA-Z]               │
│   └─ Limits: NOTES_MAX (500), EVENT_MAX (160), etc.         │
│                                                             │
│  [ Form Components ]                                        │
│   ├─ BookingPage: Guest Name, Phone, Email                  │
│   ├─ StayRequestsSection: Additional Notes & Event Detail   │
│   │   └─ Live Character Meter ({notes.length}/500)          │
│   ├─ RegisterForm: First, Last, Middle & Display Name       │
│   ├─ MessagesPage: Chat composer ({text.length}/1000)        │
│   └─ ReviewForm: Review composer ({text.length}/1000)       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Reusable Sanitizers & Validators**:
  - `sanitizeNameInput(value: string)`: filters out numeric digits while preserving Unicode letters, accents (`ñ`, `é`), spaces, hyphens, and apostrophes.
  - `sanitizePhoneInput(value: string)`: strips letters while keeping digits and valid telephone symbols (`+`, `-`, `(`, `)`, space).
- **Component Updates**:
  - `src/components/Booking/StayRequestsSection.tsx`: Add live character counter for `Additional notes` (`maxLength={500}`) and `event_purpose_detail` (`maxLength={160}`).
  - `src/pages/BookingPage.tsx`: Hook name input to `sanitizeNameInput`, phone to `sanitizePhoneInput`.
  - `src/components/Auth/RegisterForm.tsx`: Apply `sanitizeNameInput` to `displayName`, `firstName`, `lastName`, and `middleName`.
  - `src/lib/validation.ts`: Export shared constants (`ADDITIONAL_NOTES_MAX = 500`, `EVENT_DETAIL_MAX = 160`) and sanitization helper functions.
