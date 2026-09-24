# Local vs cloud data

| Record | Source of truth | Local |
| --- | --- | --- |
| Users / profiles | Cloud Firestore `profiles` | Session cookie / Firebase Auth persistence |
| Bookings | Cloud `bookings` | localStorage fallback only when Firebase is not configured (demo) |
| Payment proofs | Cloud Storage `payments/{uid}/…` | none |
| Payment reference catalog | Cloud `payment_references` | Admin app may keep a working copy on device |
| Access logs | Cloud `access_logs` | none |
| Chat | Cloud `conversations` | website demo cache `hdl:chat` when offline |
| Reviews | Cloud `reviews` | website demo cache `hdl:review:{bookingId}` |
| UI tutorial | Cookie `hdl_tutorial_done` (SameSite=Lax, not HttpOnly — UI preference only) | same |
| Live location | **Removed.** `tracking_sessions` is closed (no create/read/update). | none |

Never store secret API keys, PayMongo secrets, or Firebase Admin credentials in the website or mobile bundle.
