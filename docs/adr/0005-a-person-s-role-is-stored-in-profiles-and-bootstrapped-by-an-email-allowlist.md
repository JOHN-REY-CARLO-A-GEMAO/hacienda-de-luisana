# A person's role is stored in `profiles/{uid}`, and bootstrapped by an email allowlist

**Status**: accepted

The three roles in CONTEXT.md § People already existed in three places that could not agree: `src/lib/booking` refuses an action from the wrong `ActorKind`, `firestore.rules` authorised by *email address* (`ownerEmails()` for the Host, `anakEmails()` for the locks-readonly one), and `lib/services/auth_store.dart` kept a third copy of the same two addresses. Authorising by address means the only way to add a second Host, or to name a real caretaker as Staff, is to edit a rules file and redeploy it — and it means a person's role lives nowhere that a screen can read. So the role is now stored: exactly one of `guest`, `host`, `staff` at `profiles/{uid}`, which `firestore.rules` reads with `get()` and `src/lib/auth` resolves the same way, in the same order — bootstrap allowlist, then Profile, then Guest. Signing up writes a Profile that says Guest and cannot say anything else; only a Host may write a role, and not their own, so no click can leave the hacienda with nobody able to make the next one.

## Considered Options

- **Custom claims set by a Cloud Function** — the usual Firebase answer, and the cheapest to evaluate (`request.auth.token.role`, no document read). Rejected because it needs the Admin SDK, which needs a new deployable tier, a service identity and a way to run it; this repository has no `functions/` and both apps are client-only. A document the rules can already read buys the same enforcement for no new moving part, and can be moved to claims later without changing a single caller, because both sides ask `src/lib/auth` and `role()` rather than reading a claim.
- **Role chosen at sign-up** — rejected outright: a role a client sends is a role anybody can send.
- **Keep the email allowlists as the only mechanism** — rejected: it cannot name a second person without a deploy, and it leaves the Staff role a placeholder address (`anak`) rather than a job.

## Consequences

- A signed-in request that is not on the allowlist costs the rules one `exists()` and one `get()` on `profiles/{uid}`. Guest reads of their own Booking are ordered to check `isOwnDoc()` first, so the identity that books the most pays for nothing.
- No Profile is a Guest, on both sides. Anonymous booking (ADR-0004) therefore needs no Profile and is unchanged, and a document with an invented role grants nothing.
- The bootstrap allowlist now exists in four files that must stay in step: `firestore.rules`, `storage.rules`, `src/lib/auth/profile.ts` and `lib/services/auth_store.dart`. `test/web/auth-firestore-rules.test.ts` compares the first and the third, so the pair that decides web authorization cannot drift silently; the Flutter copy still has to be changed by hand.
- `storage.rules` still recognises the Host by address rather than by Profile. Storage rules would have to reach into Firestore to do otherwise, and nothing in either app writes to the two paths that grant covers (`/gallery`, `/accommodations`); the grant that matters, a Host reading a Guest's government ID under `/kyc`, is unchanged. If the site grows an image-publishing screen, that is the moment to teach Storage about Profiles.
- In demo mode there is no server, so the local adapter's checks are the only checks. It is labelled as such in the UI and writes nothing but this browser's storage.
