// Which stored addresses are payment proofs, and how one is written.
//
// This lives outside `admin-payment-proof/` for one reason: it is the part of
// that function worth testing. The function itself is Deno + Firebase Admin +
// Supabase, none of which a unit test here can run; this module is pure, so
// `test/web/supabase-storage.test.ts` runs the *real* validator instead of a
// copy of its regex pasted into the test — a copy drifts, and a drifted copy
// either lets a path through that the function refuses or, worse, tests a rule
// the function no longer has.
//
// WHY IT IS WIDER THAN `proofObjectPath()` WRITES
//
// `src/lib/payments/contract.ts` writes
// `payments/{uid}/{ref}/proof-{attempt}[-{uploadId}].{ext}` today. The Admin's
// "Buksan at Suriin ang Payment Proof" button answered
// `Not a payment proof path.` for a real Booking whose proof had been written
// by an earlier client, because the function accepted only the current shape.
// The address has changed twice already (Firebase-era `proof.{ext}`, then a
// per-attempt object once Supabase's insert-only policy made an upsert
// impossible), and every Booking written under an older shape is still in the
// estate. Refusing to sign a proof the Hacienda itself accepted left the Admin
// unable to read a receipt they were being asked to verify, which is the one
// thing this function exists to do.
//
// So the rule is now the *boundary*, not the spelling:
//
//   - it must be inside this bucket, under `payments/` — never another bucket,
//     never a top-level name, never a traversal (`..`) out of the prefix;
//   - the last segment must be a proof image (see `PROOF_EXTENSIONS`);
//   - a stored value may arrive as an address rather than a path — a dashboard
//     copy, a public/signed Supabase URL, or a Firebase-era download URL — and
//     the two former ones are reduced to the key they name.
//
// What a caller still cannot do is name an object outside `payments/`, or walk
// out of it. Signing is the whole capability this function has (ADR-0011), and
// it stays scoped to the prefix the upload policy writes under.

/** The one bucket that exists. */
export const PROOF_BUCKET = 'payment-proofs'

/**
 * Extensions a proof may carry. Mirrors `PROOF_IMAGE_EXTENSIONS` in
 * `src/lib/payments/contract.ts`; a test asserts the two lists agree, because
 * the website refuses anything else at upload time, so an object with an
 * extension from outside this list cannot be a proof.
 */
export const PROOF_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'] as const

/**
 * A proof's address inside the bucket:
 * `payments/{uid}/{…folders}/{file}.{ext}`.
 *
 * At least one folder below `payments/` — that is `{uid}`, which
 * `supabase/01-storage.sql` scopes every policy to, and a key with no folder at
 * all (`payments/proof.png`) names nothing the upload path can produce.
 *
 * The filename is deliberately unconstrained apart from its extension: proofs
 * written by earlier clients carry names like `proof.png`, `proof-2.jpg` and
 * `receipt_1.png`, and refusing one of those means refusing a receipt the Guest
 * actually sent. Nothing about the name is what makes a path safe — the
 * `payments/` prefix, the absence of traversal, and the Admin-only caller are.
 */
export const PROOF_PATH = /^payments\/(?:[^/\\]+\/){1,4}[^/\\]+\.(?:jpe?g|png|webp|heic)$/i

/** Why a stored value could not be turned into something this function signs. */
export type ProofPathProblem =
  /** Nothing was sent — no proof is recorded on the Booking. */
  | 'empty'
  /** The value names something outside this bucket's `payments/` prefix. */
  | 'foreign-bucket'
  /** It is under `payments/`, but it is not an image. */
  | 'not-an-image'
  /** `..`, an empty folder, a backslash or a control character. */
  | 'unsafe'
  /**
   * A Firebase Storage URL. The bytes are in the *previous* storage, which this
   * function has no key for, so signing cannot help — the receipt has to be
   * migrated or sent again. Worth distinguishing, because "no proof at that
   * path" would send the Admin looking in the right bucket for a file that was
   * never put there.
   */
  | 'legacy-storage'

export type ProofPathCheck =
  | { ok: true; path: string }
  /** `recorded` is the value as stored, trimmed and capped, for the screen. */
  | { ok: false; problem: ProofPathProblem; recorded: string }

/** Hosts whose object keys are real but are not in this bucket. */
const LEGACY_STORAGE_HOST =
  /(^|\.)(firebasestorage\.googleapis\.com|firebasestorage\.app|appspot\.com|storage\.googleapis\.com)$/i

/** How much of the stored value is echoed back — enough to recognise, not a log. */
const RECORDED_LIMIT = 200

/**
 * Percent-decoding, twice.
 *
 * An object key copied out of a URL arrives encoded (`payments%2F…%2Fproof.png`),
 * and a signed URL encodes its own path again, so one pass is not always enough.
 * A value that will not decode is left as it is rather than treated as an
 * error: the checks below decide.
 */
function decoded(value: string): string {
  let out = value
  for (let pass = 0; pass < 2 && out.includes('%'); pass += 1) {
    try {
      out = decodeURIComponent(out)
    } catch {
      break
    }
  }
  return out
}

/** The key a URL names, when that URL carries one. */
function pathFromUrl(value: string): { path: string } | { problem: ProofPathProblem } | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const segments = decoded(url.pathname)
    .split('/')
    .filter((segment) => segment !== '')

  if (LEGACY_STORAGE_HOST.test(url.hostname)) {
    return segments.includes('payments') ? { problem: 'legacy-storage' } : null
  }

  // `/{storage/v1}/object/{public|sign|authenticated}/payment-proofs/payments/…`
  const bucket = segments.indexOf(PROOF_BUCKET)
  if (bucket >= 0) return { path: segments.slice(bucket + 1).join('/') }

  // An address for the object rather than for the API that serves it
  // (`https://host/payments/{uid}/{ref}/proof.png`).
  const payments = segments.indexOf('payments')
  return payments >= 0 ? { path: segments.slice(payments).join('/') } : null
}

/**
 * The storage path of a payment proof, or why the value is not one.
 *
 * Pure, and the only place that decides. Everything it returns either starts
 * with `payments/` and names an image, or is refused with a reason the Admin's
 * screen can turn into a sentence.
 */
export function normalizeProofPath(input: unknown): ProofPathCheck {
  if (typeof input !== 'string') return { ok: false, problem: 'empty', recorded: '' }

  const recorded = input.trim().slice(0, RECORDED_LIMIT)
  if (recorded === '') return { ok: false, problem: 'empty', recorded }

  let candidate = recorded
  if (/^https?:\/\//i.test(candidate)) {
    const fromAddress = pathFromUrl(candidate)
    if (fromAddress === null) return { ok: false, problem: 'foreign-bucket', recorded }
    if ('problem' in fromAddress) return { ok: false, problem: fromAddress.problem, recorded }
    candidate = fromAddress.path
  }

  candidate = decoded(candidate).replace(/^\/+/, '')

  // The bucket is not part of the key, but a value copied out of the dashboard
  // or an API reply often carries it in front (`payment-proofs/payments/…`).
  if (candidate.toLowerCase().startsWith(`${PROOF_BUCKET}/`)) {
    candidate = candidate.slice(PROOF_BUCKET.length + 1)
  }

  const segments = candidate.split('/')
  const unsafe = segments.some(
    (segment) =>
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\\') ||
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u001f\u007f]/.test(segment),
  )
  if (unsafe) return { ok: false, problem: 'unsafe', recorded }

  if (!PROOF_PATH.test(candidate)) {
    return {
      ok: false,
      problem: /^payments\//i.test(candidate) ? 'not-an-image' : 'foreign-bucket',
      recorded,
    }
  }

  return { ok: true, path: candidate }
}
