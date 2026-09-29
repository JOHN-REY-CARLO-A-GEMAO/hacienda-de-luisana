# Local vs cloud data

| Record | Source of truth | Local |
| --- | --- | --- |
| Users / profiles | Cloud Firestore `profiles` | Session cookie / Firebase Auth persistence |
| Bookings | Cloud `bookings` | localStorage fallback only when Firebase is not configured (demo) |
| Payment proofs | Cloud Storage `payments/{uid}/…` | none |
| Payment reference catalog | Cloud `payment_references` | Admin app may keep a working copy on device |
| Access logs | Cloud `access_logs` | none |
| Chat | Cloud `conversations` (≤1,000 chars a message, read a page at a time) | website demo cache `hdl:chat` when offline, paginated the same way |
| Review | Cloud `reviews` | website demo cache `hdl:review:{bookingId}` |
| Testimonial (public) | Cloud `public_reviews` | website demo cache `hdl:public-reviews` |
| Public review average | Cloud `site_config/review_summary` | computed from the published testimonials |
| UI tutorial | Cookie `hdl_tutorial_done` (SameSite=Lax, not HttpOnly — UI preference only) | same |
| Live location — consent | Cloud Firestore `location_sessions/{convoId}` (no coordinate; ADR-0013) | none |
| Live location — position | Cloud **Realtime Database** `live_location/{convoId}/{guestUid}`, deleted server-side at the session's expiry | none — nothing is stored on the device |
| Live location (retired module) | `tracking_sessions` stays closed to every reader and writer (Admin delete only) | none |

Never store secret API keys, PayMongo secrets, or Firebase Admin credentials in the website or mobile bundle.
