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
// Guest's GCash/Maya reference number and amount. The bug is invisible in
// review — the policies read like a tidy set of three — and it is the kind that
// gets written by someone trying to make a preview work. So it is a test.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_IMAGE_EXTENSIONS, proofObjectPath } from '../../src/lib/payments'

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
    expect(grants.map((g) => g.verb).sort()).toEqual(['insert', 'update'])
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
  /** The validator lifted out of the function, so the test runs the real one. */
  const pattern = fn.match(/const PROOF_PATH = \/(.+)\/$/m)?.[1]
  const proofPath = new RegExp(pattern ?? 'a^')

  it('accepts every path the website can write', () => {
    // If the function refused a path `proofObjectPath` produces, the Admin
    // could not open a proof the Guest had actually sent.
    for (const ref of ['HDL-1', 'abc123', 'A-1', '2026-0004']) {
      for (const ext of PROOF_IMAGE_EXTENSIONS) {
        const path = proofObjectPath({ uid: 'uid-abc_123', bookingRefId: ref, filename: `shot.${ext}`, attempt: 1 })
        expect(proofPath.test(path), `${path} should be openable by the Admin`).toBe(true)
      }
    }
  })

  it('refuses anything that is not one proof at the documented shape', () => {
    for (const path of [
      'payments/uid/REF/proof.png/../../other/secret.png',
      'gallery/uid/REF/proof.png',
      'payments/uid/REF/kyc.png',
      'payments/uid/proof.png',
      'proof.png',
      '',
    ]) {
      expect(proofPath.test(path), `${path} must not be signable`).toBe(false)
    }
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
})
