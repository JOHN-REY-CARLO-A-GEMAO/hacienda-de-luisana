// The design system's own invariants, pinned against the source.
//
// Every rule here is one the audit had to enforce by hand, and each had already
// drifted at least once before it was written down: a page that invented its own
// header, a button whose size came from a `text-xs` override instead of a token,
// a form field hand-written outside `Field`, a screen that forgot the shared page
// frame. A unit test cannot see layout, but it can see the source, and these are
// the shapes that regress first.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

const pagesDir = 'src/pages'
const pageFiles = readdirSync(pagesDir)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => join(pagesDir, name))

const APPLICATION_PAGES = [
  'src/pages/AccountPage.tsx',
  'src/pages/BookingPage.tsx',
  'src/pages/BookingStatusPage.tsx',
  'src/pages/DownpaymentPage.tsx',
  'src/pages/LegalPage.tsx',
  'src/pages/MessagesPage.tsx',
  'src/pages/ReviewDeskPage.tsx',
  'src/pages/StatusPage.tsx',
  'src/pages/SupportPage.tsx',
]

const UI_DIR = 'src/components/ui'
const uiFiles = readdirSync(UI_DIR).filter((name) => name.endsWith('.tsx'))

function everySourceFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) everySourceFile(path, out)
    // Both extensions: the overlay hook that owns key handling is a `.ts` file,
    // and a scan that skipped it would have called the rule satisfied while
    // missing the implementation it exists to find.
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

const allSources = everySourceFile('src')

describe('one page title per page', () => {
  it('no page writes its own <h1>; the heading comes from the shared header', () => {
    const offenders = pageFiles.filter((file) => /<h1[\s>]/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('every heading that does render an <h1> uses the display token', () => {
    const headings = allSources.flatMap((file) =>
      [...read(file).matchAll(/<h1 className="([^"]*)"/g)].map((match) => ({ file, cls: match[1] })),
    )
    expect(headings.length).toBeGreaterThan(0)
    for (const { file, cls } of headings) {
      if (file.endsWith('Auth/AuthShell.tsx')) {
        // The sign-in page is one task in one column, and its heading is the
        // form's title rather than a page hero — it is deliberately set at the
        // section size, and it is the only heading on the page.
        expect(cls).toContain('h2')
        continue
      }
      // A hero headline may be larger than the token; nothing may be smaller.
      expect(cls, `${file} heading`).toMatch(/\bh1\b|\bdisplay\b/)
    }
  })
})

describe('the page frame', () => {
  it('application pages all sit in the shared Page component', () => {
    for (const file of APPLICATION_PAGES) {
      expect(read(file), file).toMatch(/<Page[ >]/)
      expect(read(file), file).not.toContain('min-h-screen bg-cream-50 pb-24 pt-28')
    }
  })

  it('no page or section hand-rolls a centred container', () => {
    // Scoped to pages and marketing sections: the nav bar and the shared
    // MessageScreen own their own width on purpose, and the design system is
    // where those decisions belong.
    const offenders = allSources
      .filter((file) => file.startsWith('src/pages') || file.startsWith('src/sections'))
      .filter((file) => /className="[^"]*mx-auto max-w-(3xl|4xl|5xl|6xl|7xl)/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('sections take their vertical rhythm from a spacer token', () => {
    const offenders = allSources.filter((file) => /className="[^"]*\bpy-(20|24) lg:py-(28|32|36)\b/.test(read(file)))
    expect(offenders).toEqual([])
  })
})

describe('controls', () => {
  it('no button takes its size from a text-xs override', () => {
    const offenders = allSources.filter((file) => /"[^"]*\bbtn[^"]*\btext-xs\b/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('no screen re-spells a button recipe instead of using a token', () => {
    const offenders = allSources.filter((file) => /className="btn (bg-(white|red|forest)|border)/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it('form fields are the shared component, not hand-written markup', () => {
    const offenders = allSources.filter((file) => {
      if (file.startsWith(UI_DIR)) return false
      const source = read(file)
      return /className="field(?:\s|")/.test(source) || /<span className="label">/.test(source)
    })
    // ReviewForm is the one deliberate exception: its textarea is wired to a
    // counter through `id`/`aria-describedby`, which the wrapping Field label
    // would replace with a weaker association.
    expect(offenders.filter((file) => !file.endsWith('ReviewForm.tsx'))).toEqual([])
  })
})

describe('primitives are used, not merely exported', () => {
  it('every primitive in components/ui has a consumer outside the design system', () => {
    const barrel = read(join(UI_DIR, 'index.ts'))

    // Components and helpers only — a type alias or a width constant has no
    // consumer to look for by name in the same way.
    const exported = [...barrel.matchAll(/export \{([^}]*)\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((name) => name.replace(/\btype\b/, '').trim())
      .filter((name) => name && !/Props$|Tone$|Item$|^WIDTHS$|^useOverlay$/.test(name))

    const everySource = allSources.map((file) => read(file)).join('\n')
    const unused = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(everySource))
    expect(unused).toEqual([])
  })
})

describe('one message, one shape', () => {
  it('an inline message uses the Alert component, not a tinted div', () => {
    const offenders = allSources.filter((file) => {
      if (file.startsWith(UI_DIR)) return false
      return /<(div|p)[^>]*className="[^"]*\bbg-(amber|red|emerald)-50\b/.test(read(file))
    })
    expect(offenders).toEqual([])
  })

  it('there is exactly one overlay implementation', () => {
    const trapOwners = allSources.filter((file) => /addEventListener\('keydown'/.test(read(file)))
    expect(trapOwners.sort()).toEqual(
      [
        // The one implementation every dialog, drawer, lightbox and the guided
        // tour use. The tour used to own a keydown listener of its own — which
        // is exactly how it ended up with `aria-modal` and no focus trap.
        'src/components/ui/overlay.ts',
        // Escape closes the header's mobile menu. It is a disclosure, not a
        // dialog: it has no focus trap and no backdrop to click.
        'src/components/Nav.tsx',
        // The lightbox keeps only its own arrow keys; Escape, focus and the
        // scroll lock come from `useOverlay`.
        'src/sections/Gallery.tsx',
      ].sort(),
    )
  })
})
