# No live location tracking: the module is removed, the Access log stays

**Status**: accepted, 2026-09-24. Supersedes the Guest Location Tracking module (Flow §4, goal G6) of the architecture as originally charted.

The system does **not** collect, store, transmit or display a Guest's location — no GPS reading, no province/city ping, no distance or ETA, in either application.

| Concern | Where it lives now |
| --- | --- |
| `tracking_sessions` collection | **Closed.** `firestore.rules` denies read, create and update to every caller (including the Admin); delete is Admin-only so an orphan can be cleared. |
| Guest website | No share button, no consent screen, no `/track` route, no tracking module in `src/lib/`. |
| Admin mobile app | No Radar tab, no map, no distance/ETA, no proximity notification, no tracking model or stream. |
| What is *kept* | The **Access log** (`access_logs`): door events only, `granted` / `denied`, with the credential used and a timestamp. Per-Booking `activity` entries and Booking timestamps are also untouched. |

## Why

- **The data was the risk, not the feature.** A live position feed is the most sensitive personal data the system would hold, and it needed a consent record, a retention rule, an expiry, an encryption-at-rest claim and a purge path to be lawful. Removing the feed removes all five problems at once.
- **The operation never depended on it.** The Admin's real question — *is the Guest here?* — is answered at the door by the credential: a successful unlock writes `access_logs/{id}` with `result: granted`. An estimated arrival time on a map was convenience, not control.
- **Dead code is a liability.** The module was already unreachable: the website had stopped offering a share, and the rules denied the writes, so what remained was a model, a haversine helper, a simulation widget, a map dependency and a set of screens that could only ever render seeded demo data.

## What the decision means in code

- **Rules**: `match /tracking_sessions/{id}` allows `delete: isAdmin()`, everything else `false`. The offline suite (`test/rules/firestore-rules.test.ts`, Tracker suite) asserts the denials; `test/emulator/rules.emulator.test.ts` carries the same cases for a machine that can run the emulator.
- **Flutter**: `GuestLocationModel`, `GeoUtils`, `SimulationBar` and `streamTrackingSessions` are deleted; `google_maps_flutter` and `geolocator` are no longer dependencies; the proximity notification id is gone (the booking and security alerts remain). No `GoogleMap`, `LatLng` or `Geolocator` reference is left under `lib/`.
- **Website**: no `tracking.ts` / `trackingSessions.ts`; the booking confirmation panel describes the RFID / Mobile Key credential and the Access log, and states that no GPS location is collected.
- **Docs**: `CONTEXT.md` keeps the retired vocabulary in one entry so a reader who meets the old word "radar" learns it has no referent; `docs/DATA_STORES.md` and `docs/LIMITATIONS.md` record the closure.

## Consequences

- An expected-arrival estimate is no longer available to the Admin. If the operation ever needs one, the honest shape is a Guest-declared "on my way" flag on the Booking — a fact the Guest types, not a position the system tracks — and it would reopen this ADR.
- The security guarantee that mattered (who entered, when, and whether the door granted or denied) is unaffected: access logging is intact and still written by the lock path.
- No location data exists, so there is nothing to expire, purge, or disclose in a data-subject request.
