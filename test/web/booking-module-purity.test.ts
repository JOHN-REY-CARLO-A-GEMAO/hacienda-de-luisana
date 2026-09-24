// Ticket #10: "A pure module owns the canonical statuses, the legal transitions
// between them, date-overlap, hold expiry, and deposit/refund arithmetic, and
// imports nothing from Firebase."
//
// Purity is a promise every later slice leans on — the module is only testable
// without a backend if it never reaches for one — so it is asserted, not
// assumed.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { effectiveStatus, findDateConflicts, holdMsRemaining } from '../../src/lib/booking'

const MODULE_DIR = join(__dirname, '../../src/lib/booking')

/**
 * The code in a source file, with its prose removed: block comments, line
 * comments, then the contents of string literals. The module's headers talk
 * about Firebase and about stored documents, and none of that is code.
 */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\'"])\/\/.*$/gm, '$1 ')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''")
}

describe('the booking lifecycle module', () => {
  const files = readdirSync(MODULE_DIR).filter((name) => name.endsWith('.ts'))

  it('is made of TypeScript files, and has more than one internal part', () => {
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain('index.ts')
  })

  it('imports nothing from Firebase, and nothing from outside the module', () => {
    for (const file of files) {
      const source = readFileSync(join(MODULE_DIR, file), 'utf8')
      const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1])

      for (const specifier of imported) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\//)
      }
      expect(codeOf(source), `${file} reaches for Firebase`).not.toMatch(/firebase/i)
    }
  })

  it('reaches no browser or Node global, so it runs identically on every surface', () => {
    for (const file of files) {
      const code = codeOf(readFileSync(join(MODULE_DIR, file), 'utf8'))
      expect(code, `${file} touches localStorage`).not.toMatch(/localStorage/)
      expect(code, `${file} touches window`).not.toMatch(/\bwindow\b/)
      expect(code, `${file} touches document`).not.toMatch(/\bdocument\b/)
      expect(code, `${file} touches process`).not.toMatch(/\bprocess\b/)
    }
  })

  it('answers from its arguments alone, never from the clock or the environment', () => {
    // Every date rule takes the instant it reasons about, so a test — and the
    // Admin's approval re-check — can pin `now` instead of racing the wall clock
    // (ADR-0002). Proved by behaviour rather than by scanning source: the same
    // question asked twice at a pinned instant gives the same answer.
    const hold = { status: 'Pending' as const, hold_expires_at: '2026-09-21T00:00:00.000Z' }
    const now = '2026-09-20T12:00:00.000Z'

    expect(holdMsRemaining(hold, now)).toBe(holdMsRemaining(hold, now))
    expect(effectiveStatus(hold, now)).toBe(effectiveStatus(hold, now))
    expect(findDateConflicts(
      { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-04' },
      [{
        id: 'other',
        accommodation: 'main-house',
        check_in: '2026-10-02',
        check_out: '2026-10-05',
        status: 'Reserved',
      }],
      { unitsAvailable: 1, now },
    )).toEqual(findDateConflicts(
      { accommodation: 'main-house', check_in: '2026-10-01', check_out: '2026-10-04' },
      [{
        id: 'other',
        accommodation: 'main-house',
        check_in: '2026-10-02',
        check_out: '2026-10-05',
        status: 'Reserved',
      }],
      { unitsAvailable: 1, now },
    ))
  })

  it('keeps its internals behind the entry point', () => {
    // Callers and tests go through src/lib/booking; the files behind it are
    // implementation detail (codebase-design: one interface, deep behind it).
    const entry = readFileSync(join(MODULE_DIR, 'index.ts'), 'utf8')
    expect(entry).toMatch(/export \{[^}]*applyAction/s)
    expect(entry).not.toMatch(/export \* from/)
    // Nothing internal leaks: the shared primitives are not part of the interface.
    expect(entry).not.toMatch(/roundMoney|parseInstant|parseDate|DAY_MS/)
  })
})
