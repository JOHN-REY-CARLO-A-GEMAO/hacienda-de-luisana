// Explicit SOURCE/SCHEMA/INVENTORY assertions only. No assertion in this file
// proves cloud rules, a delivered notification, a purge, or a physical device.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import baseline from './fixtures/production-baseline.json'
import findings from '../../docs/phase0/FINDINGS.json'
import { scenarios } from './fixtures'
const source = (name: string) => readFileSync(resolve(name), 'utf8')

it('SCOPE: all 210 pinned production source/config/lock files remain byte-identical to the authorized baseline', () => {
  expect(Object.keys(baseline.files)).toHaveLength(210)
  for (const [name, hash] of Object.entries(baseline.files)) expect(createHash('sha256').update(readFileSync(resolve(name))).digest('hex'), name).toBe(hash)
})
it('MATRIX: every F01–F33 has existing-test, new-regression, invariant, environment and qualified coverage', () => {
  expect(findings.map(row => row.finding)).toEqual(Array.from({ length: 33 }, (_, n) => `F${String(n + 1).padStart(2, '0')}`))
  const allowed = ['COVERED', 'PARTIALLY COVERED', 'NOT COVERED', 'NOT TESTABLE IN CURRENT HARNESS', 'REQUIRES RUNTIME/STAGING VERIFICATION']
  for (const row of findings) {
    expect(allowed).toContain(row.coverage)
    expect(row.existingTests.length).toBeGreaterThan(0)
    expect(row.newRegressionGroups.length).toBeGreaterThan(0)
    expect(row.expectedInvariant).not.toBe('')
    expect(row.environment).not.toBe('')
    expect(row.notes).not.toBe('')
  }
})
it('FIXTURES: identities/evidence/finance are synthetic and required scenario categories are present', () => {
  expect(scenarios.meta.synthetic).toBe(true)
  expect(Object.keys(scenarios.identities)).toEqual(expect.arrayContaining(['anonymousGuest', 'authenticatedGuest', 'secondGuest', 'adminA', 'adminB', 'nonAdmin', 'forgedUid', 'unverifiedAllowlisted']))
  expect(Object.keys(scenarios.money)).toEqual(expect.arrayContaining(['noPayment', 'claimedOnly', 'proofAttached', 'partial', 'full', 'duplicateReference', 'rejectedProof', 'refundPending', 'refundCompleted', 'refundUnresolved']))
  expect(Object.keys(scenarios.evidence)).toEqual(expect.arrayContaining(['valid', 'missing', 'foreignUid', 'wrongBooking', 'duplicate', 'localOnly', 'cloudOnly']))
  for (const identity of Object.values(scenarios.identities)) expect(identity.uid).toMatch(/^phase0-/)
})
it('F05-SOURCE: SQL grants anonymous payments-namespace insertion without Firebase UID/booking binding; no anonymous read grant', () => {
  const sql = source('supabase/01-storage.sql').split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  expect(sql).toMatch(/on storage\.objects for insert to anon/)
  expect(sql).toContain("(storage.foldername(name))[1] = 'payments'")
  expect(sql).not.toMatch(/for select to anon/)
  expect(sql).not.toContain('auth.uid()')
})
it('F04/F05-SOURCE: Edge function verifies Firebase tokens and stored Admin role despite gateway JWT=false', () => {
  const edge = source('supabase/functions/admin-payment-proof/index.ts')
  expect(edge).toContain('verifyIdToken')
  expect(edge).toContain("collection('profiles')")
  expect(edge).toContain("role !== 'admin'")
  expect(source('supabase/config.toml')).toContain('verify_jwt = false')
})
it('F20-SOURCE: mobile simulator toJson omits required booking/UID/result fields; not a physical event contract', () => {
  const model = source('lib/models/smart_lock_event_model.dart').split('Map<String, dynamic> toJson()')[1]
  expect(model).toContain("'timestamp'")
  for (const key of ['uid', 'ref_id', 'result']) expect(model).not.toContain(`'${key}'`)
  expect(source('firestore.rules')).toContain("hasAll(['timestamp','uid','ref_id','result','reason'])")
  expect(source('lib/services/firestore_service.dart')).toContain('.add(event.toJson())')
})
it('F21-SOURCE: mobile consent reader asks for session_secret; the actual web writer uses stream_secret', () => {
  expect(source('lib/services/live_location_service.dart')).toContain("data['session_secret']")
  expect(source('src/lib/liveLocation.ts')).toContain('stream_secret: secret')
  expect(source('database.rules.json')).toContain('now + 90000')
})
it('F26-SOURCE: checked-in Firestore indexes contain no reviews composites (deployment remains unknown)', () => {
  const indexes = JSON.parse(source('firestore.indexes.json'))
  expect(indexes.indexes.some((index: { collectionGroup: string }) => index.collectionGroup === 'reviews')).toBe(false)
})
it('F27-SOURCE: privacy text denies live tracking while the feature exists; no purge inferred from a retention helper', () => {
  expect(source('src/lib/legal.ts')).toContain('We do not run a live location tracker.')
  expect(source('src/lib/liveLocation.ts')).toContain('publishFix')
  expect(source('src/lib/chatRetention.ts')).toContain('Nothing here deletes anything.')
})
it('F28-SOURCE: mobile totalAmount defaults to nights*12000 instead of recorded stay_total', () => {
  const line = source('lib/models/booking_model.dart').split('\n').find(line => line.includes('totalAmount: (json'))!
  expect(line).toContain('(nights * 12000.0)')
  expect(line).not.toContain("json['stay_total']")
})
it('F29-SOURCE: room-status writes are separate from rates/sellable-unit configuration', () => {
  const method = source('lib/services/firestore_service.dart').split('Future<void> updateRoomStatus')[1].split('void dispose()')[0]
  expect(method).toContain("{'status': status.name}")
  expect(method).not.toContain('colSiteConfig')
  expect(method).not.toContain('availableUnits')
})
it('F30-SOURCE: booking collection approval query/listener is unbounded, not a paginated capacity authority', () => {
  const text = source('src/lib/firestoreBookings.ts')
  expect(text).toContain("getDocs(query(collection(db!, COLLECTION), orderBy('created_at', 'desc')))")
  expect(text).not.toMatch(/limit\(/)
})
it('F31-SOURCE: original deploy build still uses Node20 while locked Supabase requires Node>=22', () => {
  expect(source('.github/workflows/deploy.yml')).toContain('node-version: 20')
  const lock = JSON.parse(source('package-lock.json'))
  expect(lock.packages['node_modules/@supabase/supabase-js'].engines.node).toBe('>=22.0.0')
})
it('F32-SOURCE: release Android signing remains debug; no release/device proof is asserted', () => {
  expect(source('android/app/build.gradle')).toMatch(/signingConfig\s*(?:=\s*)?signingConfigs\.debug/)
})
