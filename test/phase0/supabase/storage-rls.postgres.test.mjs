// Phase 0 SUPPLEMENTAL: supabase/01-storage.sql applied VERBATIM to a real
// PostgreSQL 17 policy engine (PGlite, in-process WASM — no network, no
// Supabase project). See storage-schema.reconstruction.sql for the divergences.
// Results here characterise POLICY PREDICATES ONLY. They are not Supabase
// staging results and never upgrade a staging item to PASS.
import assert from 'node:assert/strict'
import { test, before } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertIsolatedProcess, ROOT } from '../../../scripts/phase0/boundary.mjs'

assertIsolatedProcess()
const pgliteEntry = path.join(ROOT, '.cache/phase0/tools/node_modules/@electric-sql/pglite/dist/index.js')
if (!fs.existsSync(pgliteEntry)) { console.error('[Phase0 BLOCKED] PGlite tooling missing (prepare outside TEST)'); process.exit(78) }
const { PGlite } = await import(pathToFileURL(pgliteEntry).href)

const BUCKET = 'payment-proofs'
const guestA = '11111111-1111-4111-8111-111111111111' // synthetic uid segments
const guestB = '22222222-2222-4222-8222-222222222222'
let db

async function as(role, sql, params = []) {
  await db.exec(`set role ${role}`)
  try { return { ok: true, result: await db.query(sql, params) } }
  catch (error) { return { ok: false, code: error.code, message: error.message } }
  finally { await db.exec('reset role') }
}
const insert = (role, bucket, name) => as(role, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name])
const count = async name => (await db.query('select count(*)::int as n from storage.objects where name = $1', [name])).rows[0].n

before(async () => {
  db = new PGlite()
  await db.exec(fs.readFileSync(path.join(ROOT, 'test/phase0/supabase/storage-schema.reconstruction.sql'), 'utf8'))
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/01-storage.sql'), 'utf8')) // unmodified production SQL
  // idempotency claim in the file header
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/01-storage.sql'), 'utf8'))
})

test('bucket is private with the 5 MB ceiling (size enforcement itself is storage-api: REQUIRES STAGING)', async () => {
  const { rows } = await db.query('select public, file_size_limit from storage.buckets where id = $1', [BUCKET])
  assert.deepEqual(rows, [{ public: false, file_size_limit: 5 * 1024 * 1024 }])
})
test('F05: anon may insert a proof under its own claimed uid path', async () => {
  const name = `payments/${guestA}/GCASH-REF-1/proof-1.jpg`
  assert.equal((await insert('anon', BUCKET, name)).ok, true)
  assert.equal(await count(name), 1)
})
test('F05: anon may insert under ANOTHER guest\'s uid path (uid segment is not bound to the caller)', async () => {
  const name = `payments/${guestB}/FORGED-REF/proof-1.jpg`
  assert.equal((await insert('anon', BUCKET, name)).ok, true)
})
test('F05 control: anon insert outside payments/ or into another bucket is denied by RLS', async () => {
  for (const [bucket, name] of [[BUCKET, `elsewhere/${guestA}/x.jpg`], [BUCKET, 'proof.jpg'], ['other-bucket', `payments/${guestA}/R/proof-1.jpg`]]) {
    const outcome = await insert('anon', bucket, name)
    assert.equal(outcome.ok, false, `${bucket}/${name}`)
    assert.equal(outcome.code, '42501')
  }
})
test('anon cannot read or list any proof (no select policy)', async () => {
  const outcome = await as('anon', 'select name from storage.objects')
  assert.equal(outcome.ok, true)
  assert.equal(outcome.result.rows.length, 0)
})
test('authenticated (Supabase-session) role can neither upload nor read: policies grant anon only', async () => {
  const write = await insert('authenticated', BUCKET, `payments/${guestA}/AUTH-REF/proof-1.jpg`)
  assert.equal(write.ok, false)
  assert.equal(write.code, '42501')
  const read = await as('authenticated', 'select name from storage.objects')
  assert.equal(read.result.rows.length, 0)
})
test('proof deletion: anon/authenticated delete affects 0 rows; service_role (edge function key) bypasses RLS', async () => {
  const name = `payments/${guestA}/DEL-REF/proof-1.jpg`
  await insert('anon', BUCKET, name)
  for (const role of ['anon', 'authenticated']) {
    const outcome = await as(role, 'delete from storage.objects where name = $1', [name])
    assert.equal(outcome.ok, true)
    assert.equal(outcome.result.affectedRows ?? 0, 0)
    assert.equal(await count(name), 1)
  }
  const svc = await as('service_role', 'delete from storage.objects where name = $1', [name])
  assert.equal(svc.ok, true)
  assert.equal(await count(name), 0)
})
test('anon update of an existing proof changes nothing (row not visible without a select policy)', async () => {
  const name = `payments/${guestA}/UPD-REF/proof-1.jpg`
  await insert('anon', BUCKET, name)
  const outcome = await as('anon', "update storage.objects set metadata = '{\"swapped\":true}' where name = $1", [name])
  assert.equal(outcome.ok, true)
  assert.equal(outcome.result.affectedRows ?? 0, 0)
})
test('upsert-shaped INSERT ... ON CONFLICT DO UPDATE as anon is refused even for a first upload (file comment claim)', async () => {
  const outcome = await as('anon', 'insert into storage.objects (bucket_id, name) values ($1, $2) on conflict (bucket_id, name) do update set metadata = excluded.metadata', [BUCKET, `payments/${guestA}/UPSERT-REF/proof-1.jpg`])
  assert.equal(outcome.ok, false)
  assert.equal(outcome.code, '42501')
})
test('F17/F07 storage layer: same path twice is a unique violation, but every retry attempt / duplicate reference is a new accepted object', async () => {
  const first = `payments/${guestA}/DUP-REF/proof-1.jpg`
  assert.equal((await insert('anon', BUCKET, first)).ok, true)
  const again = await insert('anon', BUCKET, first)
  assert.equal(again.ok, false)
  assert.equal(again.code, '23505')
  assert.equal((await insert('anon', BUCKET, `payments/${guestA}/DUP-REF/proof-2.jpg`)).ok, true)
  assert.equal((await insert('anon', BUCKET, `payments/${guestB}/DUP-REF/proof-1.jpg`)).ok, true) // same reference, other uid
  const { rows } = await db.query("select count(*)::int as n from storage.objects where name like '%/DUP-REF/%'")
  assert.equal(rows[0].n, 3)
})
test('booking-scoped access: no policy references a booking; the path carries no booking id', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/01-storage.sql'), 'utf8').replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /booking/i)
})
