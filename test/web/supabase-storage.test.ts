// The Supabase side of the payment-proof contract (ADR-0011).
//
// `firestore.rules` is the enforcement this repository can test, and it is
// tested as text in auth-firestore-rules.test.ts. The proof *bytes* moved to
// Supabase, so the rules that guard them now live in `supabase/01-storage.sql`
// as RLS policies — and those were, until this file, guarded by nothing but a
// SQL editor session.
//
// The one assertion that earns the file: **no read policy for `anon`**. The
// `anon` key is public (Vite inlines it into the bundle, so every visitor has
// it), which means an `anon` select policy on the proofs bucket publishes every
// Guest's GCash/bank reference number and amount. The bug is invisible in
// review — the policies read like a tidy set of three — and it is the kind that
// gets written by someone trying to make a preview work. So it is a test.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_IMAGE_EXTENSIONS, proofObjectPath } from '../../src/lib/payments'
import { PROOF_EXTENSIONS, normalizeProofPath } from '../../supabase/functions/_shared/proof-path'

const sql = readFileSync(join(__dirname, '../../supabase/01-storage.sql'), 'utf8')
const fn = readFileSync(
  join(__dirname, '../../supabase/functions/admin-payment-proof/index.ts'),
  'utf8',
)

/** Whitespace flattened, so an assertion reads like the statement it checks. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The function's code with its prose removed — the call diagram at the top of
 *  the file names `createSignedUrl` too, and an ordering assertion must read
 *  the order things happen in, not the order they are described in. */
const fnCode = fn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

/** The `create policy` statements, comments stripped, one per entry. */
function policies(): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';')
    .map(squash)
    .filter((statement) => statement.includes('create policy'))
}

/** `for <verb> to <role>` of one policy, by its name. */
function grantOf(statement: string): { verb: string; role: string } {
  return {
    verb: (statement.match(/for\s+(insert|update|select|delete)\b/i)?.[1] ?? '').toLowerCase(),
    role: (statement.match(/\bto\s+(anon|authenticated|service_role)\b/i)?.[1] ?? '').toLowerCase(),
  }
}

describe('the payment-proofs bucket', () => {
  it('is private, and capped at the size the web already enforces', () => {
    const insert = squash(sql.match(/insert into storage\.buckets[\s\S]*?on conflict/i)?.[0] ?? '')
    expect(insert).toContain("'payment-proofs'")
    // Private: reads go through a 60-second signed URL, never a public object.
    expect(insert).toContain('false')
    // 5 MB, mirroring PROOF_MAX_BYTES so the form refuses it before the upload.
    expect(insert).toMatch(/5\s*\*\s*1024\s*\*\s*1024/)
    expect(insert).not.toMatch(/public\s*\)?\s*,\s*true/)
  })

  it('lets the anon role write, and only under payments/', () => {
    const writes = policies().filter((p) => p.includes('to anon'))
    const grants = writes.map(grantOf)

    // A Guest's browser has the anon key and no session, so write is the only
    // grant that can work — and it must be there or no Guest can ever send a
    // receipt.
    // Insert-only: `anon` may add a proof but may not replace one in place. A
    // re-send writes a new object via the attempt number and per-upload nonce.
    expect(grants.map((g) => g.verb).sort()).toEqual(['insert'])
    // Scoped to the folder `proofObjectPath` writes into.
    for (const statement of writes) {
      expect(statement).toContain("bucket_id = 'payment-proofs'")
      expect(statement).toContain("(storage.foldername(name))[1] = 'payments'")
    }
  })
})

describe('the read that must not exist', () => {
  it('grants no select policy to anon, in any wording', () => {
    // The whole point. `anon` + `select` + this bucket = every Guest's payment
    // receipt readable by anyone who loads the website.
    const anonReads = policies().filter(
      (p) => p.includes('to anon') && grantOf(p).verb === 'select',
    )
    expect(anonReads, 'an anon read policy on the proofs bucket publishes every receipt').toEqual([])
  })

  it('never grants read to anon through service_role either', () => {
    // `service_role` bypassing RLS is how the edge function signs a URL; a
    // *policy* naming service_role would be a grant that outlives the function.
    for (const statement of policies()) {
      expect(statement).not.toMatch(/to\s+service_role/i)
    }
  })

  it('says out loud that the absent read policy is deliberate', () => {
    // A reader who cannot tell an omission from an oversight will "fix" it.
    expect(sql).toMatch(/intentionally absent|no policy on purpose/i)
    expect(fn).toMatch(/service_role/i)
  })
})

describe('the Admin read path', () => {
  // The validator itself, not a copy of its regex: a copy drifts from the
  // function and then tests a rule the deployed code no longer has.
  const open = (path: unknown) => normalizeProofPath(path)
  const accepted = (path: string) => {
    const check = open(path)
    expect(check.ok, `${path} should be signable`).toBe(true)
    return check.ok ? check.path : ''
  }
  const refused = (path: unknown) => {
    const check = open(path)
    expect(check.ok, `${String(path)} must not be signable`).toBe(false)
    return check.ok ? '' : check.problem
  }

  it('accepts every path the website can write', () => {
    // If the function refused a path `proofObjectPath` produces, the Admin
    // could not open a proof the Guest had actually sent.
    for (const ref of ['HDL-1', 'abc123', 'A-1', '2026-0004']) {
      for (const ext of PROOF_IMAGE_EXTENSIONS) {
        const path = proofObjectPath({
          uid: 'uid-abc_123', bookingRefId: ref, filename: `shot.${ext}`, attempt: 1,
          uploadId: '00000000-0000-4000-8000-000000000001',
        })
        expect(accepted(path), `${path} should be openable by the Admin`).toBe(path)
      }
    }
  })

  it('accepts the shapes earlier clients wrote, which are still on Bookings', () => {
    // The regression this module was written for: a Booking whose proof was
    // uploaded before the per-attempt naming still has to open, because the
    // Admin is being asked to verify it either way. Every shape below has been
    // written by this codebase at some point (ADR-0011, storage.rules,
    // `nextProofAttempt`'s legacy branch).
    for (const path of [
      'payments/uid-abc/HDL-4821/proof.png',
      'payments/uid-abc/HDL-4821/proof-2.png',
      'payments/uid-abc/HDL-4821/receipt_1.jpg',
      'payments/uid-abc/HDL-4821/proof-1-00000000-0000-4000-8000-000000000001.jpeg',
      'payments/uid-abc/HDL-4821/2026/proof.PNG',
    ]) {
      expect(accepted(path)).toBe(path)
    }
  })

  it('reduces a stored address to the key it names', () => {
    // A value can be an address rather than a key: copied out of the
    // dashboard, or a URL that was written by an older record. All four name
    // the same object, and all four have to end up signing it.
    const key = 'payments/uid-abc/HDL-4821/proof-1.png'
    for (const path of [
      '/payments/uid-abc/HDL-4821/proof-1.png',
      'payment-proofs/payments/uid-abc/HDL-4821/proof-1.png',
      'payments%2Fuid-abc%2FHDL-4821%2Fproof-1.png',
      'https://project.supabase.co/storage/v1/object/public/payment-proofs/payments/uid-abc/HDL-4821/proof-1.png',
      'https://project.supabase.co/storage/v1/object/sign/payment-proofs/payments/uid-abc/HDL-4821/proof-1.png?token=abc.def',
      ' https://project.supabase.co/payments/uid-abc/HDL-4821/proof-1.png ',
    ]) {
      expect(accepted(path), `${path} names ${key}`).toBe(key)
    }
  })

  it('refuses anything that is not one proof inside this bucket', () => {
    // What must not be signable is anything outside `payments/` in the proofs
    // bucket, and anything that walks out of it. The *filename* is no longer
    // part of the rule: `payments/uid/REF/kyc.png` used to be refused as "not
    // the documented shape", but nothing about that name is what makes a path
    // safe once the prefix, the bucket and the caller are all checked.
    expect(refused('payments/uid/REF/proof.png/../../other/secret.png')).toBe('unsafe')
    expect(refused('payments/uid/REF/proof%2F..%2F..%2Fsecret.png')).toBe('unsafe')
    expect(refused('gallery/uid/REF/proof.png')).toBe('foreign-bucket')
    expect(refused('payments/proof.png')).toBe('not-an-image')
    expect(refused('payments/uid/REF/notes.txt')).toBe('not-an-image')
    expect(refused('proof.png')).toBe('foreign-bucket')
    expect(refused('pending-proof')).toBe('foreign-bucket')
    expect(refused('')).toBe('empty')
    expect(refused(null)).toBe('empty')
  })

  it('names a Firebase-era receipt rather than calling it absent', () => {
    // The old receipts live in a bucket this function has no key for. Signing
    // cannot help, and "no proof is stored at that path" would send the Admin
    // looking in the right bucket for a file that was never put there.
    expect(
      refused(
        'https://firebasestorage.googleapis.com/v0/b/hacienda.appspot.com/o/payments%2Fuid%2FREF%2Fproof.jpg?alt=media&token=abc',
      ),
    ).toBe('legacy-storage')
  })

  it('accepts exactly the extensions the website can write', () => {
    // The website refuses anything outside its list at upload time, so an
    // object with an extension the function does not know cannot be a proof —
    // and an extension the function knows but the website refuses would be a
    // shape nothing can ever write. Asserted by behaviour, not by comparing two
    // constants: the pattern is a literal, and a literal is what drifts.
    expect([...PROOF_EXTENSIONS].sort()).toEqual([...PROOF_IMAGE_EXTENSIONS].sort())
    for (const ext of PROOF_IMAGE_EXTENSIONS) {
      expect(accepted(`payments/uid/REF/proof.${ext}`)).toBe(`payments/uid/REF/proof.${ext}`)
    }
    for (const ext of ['gif', 'txt', 'pdf', 'svg', 'png.exe']) {
      expect(refused(`payments/uid/REF/proof.${ext}`)).toBe('not-an-image')
    }
  })

  it('keeps the verified token in scope for the allowlist check', () => {
    // The deployed bundle is not type-checked, so a `const` declared inside the
    // `try` block is invisible to the bootstrap-allowlist check sixty lines
    // below it. It was written that way, and every request that got past the
    // path check died on `decoded is not defined` — a 500 behind a button
    // labelled "open the receipt". Order and declaration, asserted on the text.
    const hoist = fnCode.indexOf('let decoded')
    expect(hoist).toBeGreaterThan(0)
    expect(fnCode).not.toMatch(/const decoded = await getAuth/)
    expect(fnCode.indexOf('verifyIdToken')).toBeGreaterThan(hoist)
    expect(fnCode.indexOf('bootstrapAdminEmails.includes')).toBeGreaterThan(hoist)
  })

  it('is the validator the function actually calls', () => {
    // Otherwise this file could pass while the function signs something else.
    expect(fnCode).toContain('normalizeProofPath')
    const validate = fnCode.indexOf('normalizeProofPath(')
    const admin = fnCode.indexOf("role !== 'admin'")
    const sign = fnCode.indexOf('createSignedUrl')
    expect(validate).toBeGreaterThan(0)
    expect(admin).toBeGreaterThan(validate)
    expect(sign).toBeGreaterThan(admin)
  })

  it('checks the caller is an Admin before signing anything', () => {
    // Order matters as much as presence: a signed URL for a path the caller had
    // no right to name is the failure this function exists to prevent.
    const verify = fnCode.indexOf('verifyIdToken')
    const admin = fnCode.indexOf("role !== 'admin'")
    const sign = fnCode.indexOf('createSignedUrl')
    expect(verify).toBeGreaterThan(0)
    expect(admin).toBeGreaterThan(verify)
    expect(sign).toBeGreaterThan(admin)
  })

  it('does not carry a sixth copy of the bootstrap allowlist', () => {
    // The list lives in five files already; one drifted and locked the Admin
    // out of their own database. A function copy would be a sixth.
    expect(fn).not.toMatch(/@gmail\.com/)
    expect(fn).toMatch(/profiles/)
  })

  it('reads the bootstrap allowlist from its environment, not a literal', () => {
    // Configuring an Admin is one edit in `src/config/admin-roles.json`. A
    // literal address here is a copy nothing keeps in step with it, so the
    // allowlist has to arrive as configuration — and no address may be spelled
    // out in this file at all, comment or code.
    expect(fnCode).toMatch(/BOOTSTRAP_ADMIN_EMAILS/)
    expect(fnCode).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  })

  it('still refuses a caller the allowlist does not name', () => {
    // The bootstrap half reads an environment variable now; the decision it
    // feeds must survive the move. A missing or empty secret is "no bootstrap
    // Admin", never "everyone is the Admin".
    const allowlist = fnCode.match(/const bootstrapAdminEmails[\s\S]{0,240}?\.filter\(Boolean\)/)
    expect(allowlist).not.toBeNull()
    expect(allowlist?.[0]).toMatch(/Deno\.env\.get\('BOOTSTRAP_ADMIN_EMAILS'\)/)
    expect(allowlist?.[0]).toMatch(/\.toLowerCase\(\)/)
    expect(fnCode).toMatch(/decoded\.email_verified === true/)
    expect(fnCode).toMatch(/if \(role !== 'admin' && !isBootstrapAdmin\)/)
  })
})
