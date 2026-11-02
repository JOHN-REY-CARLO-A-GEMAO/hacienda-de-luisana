#!/usr/bin/env node
/**
 * Executes the Apps Script form builders against a strict mock of the Apps
 * Script services they use, so a typo — or a regression to a mistake a review
 * already caught — fails here rather than in the owner's browser.
 *
 * The mock fails on anything the real Forms API would refuse: a help text that
 * is not a string, `setRequired` that is not a boolean, choice values that are
 * not a non-empty array of strings, a grid with empty rows or columns.
 *
 * `v2/Code.gs` is the form being sent. What is asserted, and why:
 *
 *   From the first review
 *   - no credential is ever requested, and the form says so itself;
 *   - included guests, maximum occupancy and the extra-guest charge are
 *     separate questions;
 *   - the cancellation section does not claim that silence means no refund;
 *   - the pet question is a single choice;
 *   - check-in and check-out times are confirmed;
 *   - the booking-hold question offers both 22 and 24 hours.
 *
 *   From the second review
 *   - the rate is described as one standard stay per night, the broken
 *     Monday/Tuesday example is gone, and a question asks how many weekend
 *     nights a Friday-to-Sunday booking charges;
 *   - maximum occupancy is a free number per accommodation, not a menu;
 *   - minimum booking age and the ID-at-check-in policy are asked;
 *   - the refund section asks about the deposit, partial and full payment, a
 *     rescheduled price, cancelling after a reschedule, and who approves;
 *   - force majeure is split into "at the Hacienda" and "guest's emergency";
 *   - OTA sync offers manual / import / publish / both / channel manager, and
 *     its help text warns that iCal is delayed and cannot prevent clashes;
 *   - no checkbox carries an "undecided" or "nobody" option;
 *   - the balance-received decision, the double-booking rescue and the
 *     smart-lock hardware/battery questions exist;
 *   - Live Location can be removed or deferred;
 *   - a failed openById does not delete the saved record and does not create a
 *     second form, and a build that dies halfway records what exists.
 *
 * `v1/Code.gs` is kept for history and is only checked to still parse and run.
 *
 * Run: node scripts/google-form/build-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const STATE_KEY = 'HDL_CLIENT_FORM_V2_STATE'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Loads a builder into a fresh sandbox and returns everything the checks need.
 * `options.failAtItem` makes the Nth question throw, to exercise the recovery
 * path; `options.missingForms` makes openById refuse the given ids, to exercise
 * the "do not delete the record" path.
 */
function loadBuilder(source, options = {}) {
  const { failAtItem = 0, missingForms = [] } = options
  const questions = []
  let createdForms = 0
  let createdSheets = 0
  let itemCount = 0
  const properties = new Map()
  const form = { id: 'FORM-1', destination: null }

  function item(kind) {
    itemCount += 1
    if (failAtItem && itemCount === failAtItem) {
      throw new Error(`simulated failure while adding question ${itemCount}`)
    }

    const record = { kind, title: '', help: null, required: false, choices: null, other: false, rows: null, columns: null }
    questions.push(record)

    const strings = (values, label) => {
      const ok = Array.isArray(values) && values.length > 0
        && values.every((v) => typeof v === 'string' && v.trim().length > 0)
      if (!ok) throw new TypeError(`${kind} "${record.title}": ${label} got ${JSON.stringify(values)}`)
      return values
    }

    const chain = {
      setTitle(value) {
        if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${kind}: setTitle needs a non-empty string`)
        record.title = value
        return chain
      },
      setHelpText(value) {
        if (typeof value !== 'string') throw new TypeError(`${kind} "${record.title}": setHelpText got ${typeof value}`)
        record.help = value
        return chain
      },
      setRequired(value) {
        if (typeof value !== 'boolean') throw new TypeError(`${kind} "${record.title}": setRequired got ${typeof value}`)
        record.required = value
        return chain
      },
      setChoiceValues(values) {
        record.choices = strings(values, 'setChoiceValues')
        return chain
      },
      showOtherOption(value) {
        if (typeof value !== 'boolean') throw new TypeError(`${kind} "${record.title}": showOtherOption got ${typeof value}`)
        record.other = value
        return chain
      },
      setIncludesYear(value) {
        if (typeof value !== 'boolean') throw new TypeError(`${kind} "${record.title}": setIncludesYear got ${typeof value}`)
        record.includesYear = value
        return chain
      },
      setRows(values) {
        record.rows = strings(values, 'setRows')
        return chain
      },
      setColumns(values) {
        record.columns = strings(values, 'setColumns')
        return chain
      },
    }
    return chain
  }

  Object.assign(form, {
    setDescription(text) {
      if (typeof text !== 'string' || !text.trim()) throw new TypeError('setDescription needs a string')
      form.description = text
      return form
    },
    setConfirmationMessage(text) {
      if (typeof text !== 'string') throw new TypeError('setConfirmationMessage needs a string')
      return form
    },
    setCollectEmail(value) { if (typeof value !== 'boolean') throw new TypeError('setCollectEmail'); return form },
    setProgressBar(value) { if (typeof value !== 'boolean') throw new TypeError('setProgressBar'); return form },
    setShuffleQuestions(value) { if (typeof value !== 'boolean') throw new TypeError('setShuffleQuestions'); return form },
    addPageBreakItem: () => item('section'),
    addTextItem: () => item('text'),
    addParagraphTextItem: () => item('paragraph'),
    addMultipleChoiceItem: () => item('choice'),
    addCheckboxItem: () => item('checks'),
    addDateItem: () => item('date'),
    addGridItem: () => item('grid'),
    addCheckboxGridItem: () => item('checkboxGrid'),
    setDestination(type, id) {
      if (type !== 'spreadsheet') throw new TypeError(`setDestination got ${type}`)
      if (!id) throw new TypeError('setDestination needs a spreadsheet id')
      form.destination = id
    },
    getId: () => form.id,
    getPublishedUrl: () => 'https://forms.gle/TEST',
    getEditUrl: () => 'https://docs.google.com/forms/d/FORM-1/edit',
  })

  const sandbox = {
    FormApp: {
      create(title) {
        if (typeof title !== 'string' || !title.trim()) throw new TypeError('FormApp.create needs a title')
        createdForms += 1
        return form
      },
      openById(id) {
        if (missingForms.includes(id) || id !== form.id) {
          throw new Error(`FormApp.openById(${id}) — not found or not permitted`)
        }
        return form
      },
      DestinationType: { SPREADSHEET: 'spreadsheet' },
    },
    SpreadsheetApp: {
      create(name) {
        if (typeof name !== 'string') throw new TypeError('SpreadsheetApp.create needs a name')
        createdSheets += 1
        return { getId: () => 'SHEET-1', getUrl: () => 'https://docs.google.com/spreadsheets/d/SHEET-1' }
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
        setProperty: (key, value) => properties.set(key, value),
        deleteProperty: (key) => properties.delete(key),
      }),
    },
    Utilities: { formatDate: () => '2026-11-02' },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    Logger: { log: () => {} },
  }

  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'Code.gs' })

  return {
    sandbox,
    form,
    questions,
    properties,
    stats: () => ({ createdForms, createdSheets }),
  }
}

const ESCAPES = ['Pag-usapan natin', 'Hindi pa napagdesisyunan']

function hasEscape(question) {
  if (question.other) return true
  return (question.choices ?? []).some(
    (choice) => ESCAPES.includes(choice)
      || /^Iba p/i.test(choice)
      || /pag-usapan/i.test(choice)
      || /hindi ko alam/i.test(choice)
      || /napagdesisyunan/i.test(choice),
  )
}

const asks = (list, pattern) => list.find((q) => q.kind !== 'section' && pattern.test(q.title))

// ---------------------------------------------------------------------------
// v2 — the form being sent
// ---------------------------------------------------------------------------

console.log('\ngoogle-form builder — v2 (the form to send)\n')

const v2 = loadBuilder(readFileSync(join(here, 'v2', 'Code.gs'), 'utf8'))

let result
try {
  result = v2.sandbox.createClientFormV2()
} catch (error) {
  console.error('  FAIL the builder threw:', error.message)
  process.exit(1)
}

const items = v2.questions.filter((q) => q.kind !== 'section')
const sections = v2.questions.filter((q) => q.kind === 'section')
const titles = items.map((q) => q.title)
const allText = [
  v2.form.description ?? '',
  ...items.flatMap((q) => [q.title, q.help ?? '', ...(q.choices ?? []), ...(q.rows ?? []), ...(q.columns ?? [])]),
].join('\n')

check('every question has a title', items.every((q) => q.title.trim().length > 0))
check('no two questions share a title', new Set(titles).size === titles.length,
  titles.filter((t, i) => titles.indexOf(t) !== i).join(' | '))
check('seven sections, so the form is grouped', sections.length === 7, `got ${sections.length}`)
check('the answers sheet is linked', v2.form.destination === 'SHEET-1')
check('the three links come back', /^https:\/\/forms\.gle\//.test(result?.publishedUrl ?? '')
  && /\/edit$/.test(result?.editUrl ?? '')
  && /spreadsheets/.test(result?.sheetUrl ?? ''))

// --- Review 1: credentials -------------------------------------------------
const credentialWords = /\bpassword\b|\bpasscode\b|\bPIN\b|\bOTP\b|api key|recovery code|credential/i
const credentialLines = allText.split('\n').filter((line) => credentialWords.test(line))
check('a credential is never requested — every mention is a prohibition',
  credentialLines.every((line) => /huwag|never|hindi nagtatanong|do not/i.test(line)),
  credentialLines.filter((line) => !/huwag|never|hindi nagtatanong|do not/i.test(line)).join(' | '))
check('the form states the prohibition up front', /huwag ilagay ang password/i.test(v2.form.description ?? ''))

// --- Review 2, item 1: per-night versus per-stay pricing -------------------
const rateQuestion = asks(items, /bawat gabi ba ang ₱5,000/i)
check('a question asks whether the rate is per night or per booking', Boolean(rateQuestion))
check('the rate question describes one standard stay per night',
  /standard stay/i.test(rateQuestion?.help ?? ''))
const pricingModel = asks(items, /paano sisingilin ang bawat gabi/i)
check('the pricing-model question uses a real two-model example (Huwebes–Sabado)',
  /Huwebes/i.test(pricingModel?.help ?? ''))
check('the broken Saturday-weekday example is gone',
  !/Sabado ay weekday/i.test(allText))
check('a question asks how many weekend nights Friday-to-Sunday charges',
  Boolean(asks(items, /ilang gabi ang weekend rate/i)))

// --- Review 2, item 2: occupancy is a number, not a menu -------------------
const mainMax = asks(items, /maximum na papayagan sa Main House/i)
const annexMax = asks(items, /maximum na papayagan sa Annex/i)
const campMax = asks(items, /maximum na papayagan sa A-House/i)
check('occupancy is asked as a typed number for each accommodation',
  [mainMax, annexMax, campMax].every((q) => q?.kind === 'text'),
  [mainMax, annexMax, campMax].map((q) => q?.kind).join(','))
check('the occupancy answer accepts "not decided" in words',
  [mainMax, annexMax, campMax].every((q) => /napagdesisyunan/i.test(q?.help ?? '')))
check('the basis of the maximum is asked', Boolean(asks(items, /batayan ng maximum/i)))
check('included guests and the extra-guest charge are still separate',
  Boolean(asks(items, /dagdag sa bawat extra guest/i)))
check('what the website will enforce is asked separately', Boolean(asks(items, /tatanggapin ng website/i)))

// --- Review 2, item 3: age and ID ------------------------------------------
check('the minimum age of the responsible booker is asked',
  Boolean(asks(items, /pinakabatang pwedeng maging responsible/i)))
check('minors travelling with a guardian is asked',
  Boolean(asks(items, /kasamang minor/i)))
const idQuestion = asks(items, /kailangan ba ng ID sa check-in/i)
check('the ID-at-check-in policy is asked', Boolean(idQuestion))
const idChoices = idQuestion?.choices ?? []
check('ID photograph is not the default — inspection and note-taking come first',
  idChoices[0] === 'Wala — hindi kailangan'
  && idChoices.findIndex((c) => /kukunin ang litrato|upload ng ID/i.test(c)) >= 3)

// --- Review 2, item 4: cancellation precision ------------------------------
check('whether the deposit is refunded on cancellation is asked',
  Boolean(asks(items, /security deposit sa refund/i)))
check('partial payment is asked', Boolean(asks(items, /partial payment lang/i)))
check('full payment is asked', Boolean(asks(items, /full payment na at nag-cancel/i)))
check('a rescheduled booking’s price is asked', Boolean(asks(items, /mananatili ba ang dating presyo/i)))
check('cancelling after a reschedule is asked', Boolean(asks(items, /pagkatapos magpalit ng petsa/i)))
check('who approves and records a refund is asked',
  Boolean(asks(items, /nag-a-approve ng refund/i)))
check('a typhoon at the property and a guest emergency are asked separately',
  Boolean(asks(items, /SA HACIENDA/i)) && Boolean(asks(items, /personal na emergency/i)))

// --- Review 2, item 5: OTA wording ----------------------------------------
const ota = asks(items, /antas ng koneksyon sa OTA/i)
const otaChoices = ota?.choices ?? []
check('OTA offers manual, import, publish, both and channel manager',
  ['Manual lang', 'Mag-import ng OTA calendar feed', 'I-publish ang availability', 'Import at export', 'channel-manager']
    .every((needle) => otaChoices.some((c) => c.includes(needle))))
check('the iCal description warns about delay and the double-booking guarantee',
  /delay/i.test(ota?.help ?? '') && /hindi nito kayang garantiyahin/i.test(ota?.help ?? ''))
check('the double-booking rescue is asked', Boolean(asks(items, /nadoble ang booking/i)))

// --- Review 2, section 3: contradictory checkboxes ------------------------
const checkboxes = items.filter((q) => q.kind === 'checks')
check('no checkbox offers an "undecided" or "nobody" answer',
  checkboxes.every((q) => !(q.choices ?? []).some((c) => /napagdesisyunan|walang tumatanggap/i.test(c))),
  checkboxes.filter((q) => (q.choices ?? []).some((c) => /napagdesisyunan|walang tumatanggap/i.test(c)))
    .map((q) => q.title).join(' | '))

// --- Review 2: other gaps -------------------------------------------------
check('the balance-received recording decision is asked',
  Boolean(asks(items, /i-record sa Admin app na natanggap/i)))
check('the smart lock offers a "no brand chosen yet" answer',
  Boolean(asks(items, /may totoong smart lock/i)?.choices.some((c) => /wala pang napiling brand/i.test(c))))
check('the smart-lock brand, model and power are asked',
  Boolean(asks(items, /brand at model/i)))
check('lock battery failure is asked', Boolean(asks(items, /battery ng lock/i)))
check('Live Location can be removed or deferred',
  Boolean(asks(items, /ituloy ang Live Location/i)?.choices.some((c) => /alisi/i.test(c))))
check('Live Location deferral is an option too',
  Boolean(asks(items, /ituloy ang Live Location/i)?.choices.some((c) => /ipagpaliban/i.test(c))))
check('role permissions are asked as a grid', items.some((q) => q.kind === 'checkboxGrid'))
check('technical questions are marked, so an owner may defer them',
  (allText.match(/\(Teknikal\)/g) ?? []).length >= 8)

// --- Required answer quality ----------------------------------------------
check('every required list question can be answered "not decided yet"',
  items.filter((q) => q.required && q.choices && !hasEscape(q)).length === 0,
  items.filter((q) => q.required && q.choices && !hasEscape(q)).map((q) => q.title).join(' | '))
check('every required grid can be answered "not decided yet"',
  items.filter((q) => q.required && q.kind === 'grid'
    && !(q.columns ?? []).some((c) => /napagdesisyunan/i.test(c))).length === 0)
check('the retention grid separates the kinds of record',
  (items.find((q) => q.kind === 'grid')?.rows ?? []).length >= 4)
check('the form asks whose answers these are', Boolean(asks(items, /final na desisyon/i)))
check('technical terms are explained in the form',
  ['OTA', 'Force majeure', 'Live Location', 'standard stay'].every((term) => (v2.form.description ?? '').includes(term)))
const v2Source = readFileSync(join(here, 'v2', 'Code.gs'), 'utf8')
check('the script tells the reader to check the consent screen for scopes',
  /consent[\s\S]{0,40}screen/i.test(v2Source))
check('the script no longer promises a fixed two-scope authorisation',
  !/asks only for Forms and Sheets/i.test(v2Source))

// --- Builder behaviour ----------------------------------------------------
const formsBefore = v2.stats().createdForms
const itemsBefore = v2.questions.length
v2.sandbox.createClientFormV2()
check('a second run does not create a second form', v2.stats().createdForms === formsBefore)
check('a second run does not add questions', v2.questions.length === itemsBefore)

const savedState = JSON.parse(v2.properties.get(STATE_KEY) ?? '{}')
check('the form id is saved before the questions are built', savedState.formId === 'FORM-1')
check('the saved record ends in "ready"', savedState.status === 'ready')
check('the saved record carries the sheet', savedState.sheetId === 'SHEET-1')

// A form that cannot be opened must NOT be forgotten: that is what used to make
// a duplicate on the next run.
const blocked = loadBuilder(readFileSync(join(here, 'v2', 'Code.gs'), 'utf8'), { missingForms: ['GONE'] })
blocked.properties.set(STATE_KEY, JSON.stringify({ formId: 'GONE', status: 'ready' }))
let threw = false
try {
  blocked.sandbox.createClientFormV2()
} catch (error) {
  threw = true
}
check('a form that cannot be opened stops the run', threw)
check('a form that cannot be opened keeps its record (no duplicate)', blocked.properties.has(STATE_KEY))
check('a form that cannot be opened creates nothing', blocked.stats().createdForms === 0)

// A build that dies halfway must leave a record saying so.
const broken = loadBuilder(readFileSync(join(here, 'v2', 'Code.gs'), 'utf8'), { failAtItem: 6 })
let brokeDown = false
try {
  broken.sandbox.createClientFormV2()
} catch (error) {
  brokeDown = true
}
const brokenState = JSON.parse(broken.properties.get(STATE_KEY) ?? '{}')
check('a build that fails halfway throws', brokeDown)
check('a build that fails halfway records the form id', brokenState.formId === 'FORM-1')
check('a build that fails halfway is marked incomplete', brokenState.status === 'incomplete')

// ---------------------------------------------------------------------------
// v1 — kept for history, only checked that it still runs
// ---------------------------------------------------------------------------

console.log('\ngoogle-form builder — v1 (kept for history)\n')
const v1 = loadBuilder(readFileSync(join(here, 'Code.gs'), 'utf8'))
try {
  v1.sandbox.createClientForm()
  check('v1 still runs', true)
} catch (error) {
  check('v1 still runs', false, error.message)
}

const required = items.filter((q) => q.required).length
const optional = items.length - required
console.log(`\n  v2: ${items.length} questions (${required} required, ${optional} optional), ${sections.length} sections`)
console.log(`  v1: ${v1.questions.filter((q) => q.kind !== 'section').length} questions (left as it was)\n`)

if (failures > 0) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log('all checks passed\n')
