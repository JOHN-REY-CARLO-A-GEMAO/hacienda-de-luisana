# ADR-0026: Live location is retired from both apps

- **Status:** Accepted
- **Date:** 2026-11-07

## Context

The Guest website could share a live location in chat, and the Admin app had a
matching live-location page and inbox panel backed by the Realtime Database and
OpenStreetMap tiles. The feature was never part of the Booking lifecycle: the
Admin's job is to answer messages and review Bookings, and a live position is
personal data that is easy to leave switched on and hard to justify collecting.

## Decision

Live location is removed, not hidden:

- web: `useLiveLocation`, the live-location libraries and policy, the Admin
  live-location page, and the chat share/status controls are deleted;
- Admin app: the location service, proximity helper, inbox panel and map tiles
  are deleted, and the inbox keeps messages only;
- storage and rules: `database.rules.json`, the Realtime Database block in
  `firebase.json` and the location-backed constants are removed;
- tests that asserted the feature are rewritten or removed with it.

Chat remains; only the position sharing that rode on it is gone.

## Consequences

- No location is collected, stored, or displayed. There is nothing to expire,
  purge, or leak.
- The Guest website no longer initialises the Realtime Database, so
  `firebase_options.dart` and `firebaseDefaults` carry no `databaseURL`.
- Restoring the feature would be a new decision with its own retention policy,
  not a revert of this one.
