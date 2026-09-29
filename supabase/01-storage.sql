-- Supabase Storage — the `payment-proofs` bucket (ADR-0011).
--
-- This file is what `storage.rules` used to do. Firebase Storage rules and
-- Supabase's RLS are different languages, so nothing can be ported across: this
-- is the same *job* — deciding who may put a payment receipt in the bucket and
-- who may read it back — written as policies on `storage.objects`.
--
-- Apply with the Supabase SQL editor, or:
--   psql "$SUPABASE_DB_URL" -f supabase/01-storage.sql
--
-- Idempotent: the bucket upsert is `on conflict do update` and each policy is
-- preceded by a `drop policy if exists`, so running it twice is a no-op rather
-- than an error. (Postgres has no `create policy if not exists`, which is why
-- the drop is explicit.)
--
-- THE SHAPE OF THE GRANT, and why it is asymmetric
-- ------------------------------------------------
-- Writes are anonymous. A Guest's browser holds the `anon` key and nothing
-- else — no Supabase account, no session — so `to anon` is the only role that
-- can possibly write. That is safe: the key is public, but a write can only
-- *add* a file the Guest themselves is about to be shown for their own Booking,
-- and the rules downstream (payment verification) are what actually mean
-- anything by it.
--
-- Reads are NOT anonymous. A payment proof is a GCash or Maya reference number
-- and an amount — money-adjacent personal data, and RA 10173 is not a
-- hypothetical for this project. So there is deliberately **no** `select`
-- policy for `anon` here, and adding one is the single most damaging change
-- anyone could make to this file: the `anon` key ships inside the public Vite
-- bundle (`src/lib/supabase.ts`), so an `anon` read policy publishes every
-- Guest's receipt to the internet. Admins read through
-- `supabase/functions/admin-payment-proof`, which hands back a 60-second signed
-- URL after checking the caller is an Admin.
--
-- The missing read grant has a cost that shaped the website, not just this
-- file: Supabase refuses an upsert without one, so `upsert: true` fails on this
-- bucket and every attempt writes its own object. That is spelled out under
-- the update policy below, where it matters.
--
-- `test/web/supabase-storage.test.ts` reads this file and fails if an `anon`
-- read policy ever appears, so that mistake cannot be made quietly.

-- ----------------------------------------------------------------------------
-- The bucket: private, 5 MB ceiling
-- ----------------------------------------------------------------------------
-- Private, because reads go through a signed URL and a public bucket would
-- serve every object to anyone who can guess or list a path.
--
-- 5 MB mirrors `PROOF_MAX_BYTES` in `src/lib/payments/contract.ts`, which
-- exists so a Guest learns the limit from a form validation instead of from a
-- rejected upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('payment-proofs', 'payment-proofs', false, 5 * 1024 * 1024)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- ----------------------------------------------------------------------------
-- Guest writes
-- ----------------------------------------------------------------------------
-- The address a proof lands on is built by `proofObjectPath()` in
-- `src/lib/payments/contract.ts`: `payments/{uid}/{safeRef}/proof-{n}.{ext}`.
-- `n` counts upload attempts, because a proof is never overwritten — a re-send
-- is a second object. See the update policy below for why that is forced.
--
-- Scoping every policy to the `payments/` first segment keeps the rules honest
-- if the bucket ever grows a second kind of file.
--
-- The object name's `{uid}` segment is written by the client, so it is not
-- evidence of who uploaded it — these policies are deliberately not scoped per
-- uid, and the honest statement is that the `anon` role may write any path
-- under `payments/`. What makes that acceptable is that writing a file grants
-- nobody anything: verification is the Admin's, the Booking document is in
-- Firestore under `firestore.rules`, and a forged path cannot mark a payment
-- verified.

drop policy if exists "guests upload payment proofs" on storage.objects;

create policy "guests upload payment proofs"
  on storage.objects for insert to anon
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = 'payments'
  );

-- The website does not rely on this policy, and cannot. `upsert: true` in
-- `uploadPaymentProofFile` is refused on this bucket: it sends
-- `Prefer: resolution=merge-duplicates`, which evaluates THIS policy alongside
-- the insert one, and `anon` holds no read grant here — so every upsert comes
-- back `42501 new row violates row-level security policy`, on a first upload as
-- much as on a re-send. That is why no Guest could complete a booking at all,
-- and why `proofObjectPath` carries an attempt number.
--
-- That read gap is the security property of this file, not an oversight.
-- Granting `anon` a `select` here is the one change that would publish every
-- Guest's GCash receipt and reference number to the internet, because the anon
-- key ships inside the public Vite bundle. Do not close it.
--
-- A re-send therefore writes a new object (`proof-2.ext`) instead of replacing
-- the bytes. That is also what `firestore.rules` needs: a Guest may clear a
-- `payment_reject_reason` only by attaching a *different* `payment_proof_url`,
-- which a single fixed address could never satisfy. The rejected proof is kept
-- as evidence rather than overwritten.
drop policy if exists "guests replace payment proofs" on storage.objects;

create policy "guests replace payment proofs"
  on storage.objects for update to anon
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = 'payments'
  )
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = 'payments'
  );

-- ----------------------------------------------------------------------------
-- Admin reads — no policy on purpose
-- ----------------------------------------------------------------------------
-- Intentionally absent, and the absence is the security property:
--
--   create policy "guests read payment proofs" on storage.objects
--     for select to anon using (...);   -- DO NOT ADD THIS
--
-- `service_role` bypasses RLS entirely, which is how the edge function signs a
-- URL without holding a read grant of its own.
