# Verified limitations (do not inflate)

## OCR

There is **no image-to-text engine** (no Tesseract, no cloud Vision API). `runReceiptOcr` / `extractReceiptFields` parse **text sidecars and filename-like strings** with regex. Guests must confirm or type the reference and amount. **OCR never sets `payment_status` to verified.**

## Rate limiting

`src/lib/rateLimit.ts` is **client UX cooldowns**. Firestore rules do not count requests. Firebase Auth has its own brute-force protections. True API rate limiting is **not implemented** in this architecture (no Cloud Functions in-repo).

## Pagination

Guest bookings and Admin bookings paginate **in memory after a uid-scoped (or admin) snapshot**. There is no Firestore `startAfter` cursor for full-text search. Chat messages use `orderBy + limit(30/40)` on the server.

## Cache and cookies

- Cookie `hdl_tutorial_done`: tutorial preference only. `SameSite=Lax`, `Secure` on HTTPS, **not HttpOnly** (must be readable by JS). No auth secrets.
- localStorage: demo bookings/chat/reviews when Firebase is not configured.
- Firebase Auth persistence is the session, not a custom cookie.

## Chat / reviews without Firebase

If `VITE_FIREBASE_*` is unset, chat and reviews persist in **this browser only**. Rules exist for cloud; the UI writes to Firestore when configured.

## Flutter

This environment has **no Flutter SDK**. Analyze / test / APK build were **not executed**.

## Guest mobile app

ADR-0007: Guest = website, Admin = Flutter. A Guest-facing mobile app is **not in this repository**. If the thesis requires a Guest APK, that remains a product gap.

## Live location

Removed. `tracking_sessions` allow create/read/update **false**. Access logs unchanged.
