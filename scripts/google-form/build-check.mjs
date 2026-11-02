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
  const { failAtItem = 0, missingForms = [], lockHeld = false, stateOverride = null } = options
  const questions = []
  let createdForms = 0
  let createdSheets = 0
  let itemCount = 0
  const properties = new Map()
  if (stateOverride !== null) properties.set(options.stateKey ?? 'HDL_CLIENT_FORM_V21_STATE', stateOverride)
  const form = { id: 'FORM-1', destination: null }
  let lockHeldNow = lockHeld
  let validationsBuilt = 0

  function item(kind) {
    itemCount += 1
    if (failAtItem && itemCount === failAtItem) {
      throw new Error(`simulated failure while adding question ${itemCount}`)
    }

    const record = {
      kind, title: '', help: null, required: false, choices: null, other: false,
      rows: null, columns: null, validation: null,
    }
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
      setValidation(validation) {
        if (!validation || typeof validation !== 'object') {
          throw new TypeError(`${kind} "${record.title}": setValidation needs a built validation`)
        }
        record.validation = validation
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
      createTextValidation() {
        const built = { kind: 'text' }
        const builder = {
          requireNumber() {
            built.requiresNumber = true
            return builder
          },
          setHelpText(text) {
            if (typeof text !== 'string' || !text.trim()) throw new TypeError('validation setHelpText needs a string')
            built.helpText = text
            return builder
          },
          build() {
            if (!built.requiresNumber) throw new Error('validation was built without a rule')
            validationsBuilt += 1
            return built
          },
        }
        return builder
      },
    },
    LockService: {
      getScriptLock: () => ({
        tryLock() {
          return !lockHeldNow
        },
        waitLock() {
          if (lockHeldNow) throw new Error('lock is held')
        },
        releaseLock() {
          lockHeldNow = false
        },
      }),
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
    stats: () => ({ createdForms, createdSheets, validationsBuilt }),
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
// v2.1 — the revision that answers the audit of v2
// ---------------------------------------------------------------------------

console.log('\ngoogle-form builder — v2.1 (the audit revision)\n')

const v21source = readFileSync(join(here, 'v2.1', 'Code.gs'), 'utf8')
const v21 = loadBuilder(v21source)
let v21result
try {
  v21result = v21.sandbox.createClientFormV2()
} catch (error) {
  console.error('  FAIL the builder threw:', error.message)
  process.exit(1)
}

const q21 = v21.questions.filter((q) => q.kind !== 'section')
const s21 = v21.questions.filter((q) => q.kind === 'section')
const t21 = q21.map((q) => q.title)
const text21 = [
  v21.form.description ?? '',
  ...q21.flatMap((q) => [q.title, q.help ?? '', ...(q.choices ?? []), ...(q.rows ?? []), ...(q.columns ?? [])]),
].join('\n')

check('v2.1 keeps the seven sections', s21.length === 7, `got ${s21.length}`)
check('v2.1 has no duplicate titles', new Set(t21).size === t21.length,
  t21.filter((t, i) => t21.indexOf(t) !== i).join(' | '))
check('v2.1 builds a form, a sheet and the three links',
  v21.stats().createdForms === 1 && v21.stats().createdSheets === 1
  && /spreadsheets/.test(v21result?.sheetUrl ?? ''))

// --- Critical: duplicate protection ---------------------------------------
check('createClientFormV2Again() is gone', !/function createClientFormV2Again/.test(v21source))
check('a second form needs an explicit confirmation step',
  /function confirmNewClientFormV2/.test(v21source)
  && /function createNewClientFormV2/.test(v21source))

const noConfirm = loadBuilder(v21source)
let refusedNew = false
try {
  noConfirm.sandbox.createNewClientFormV2()
} catch (error) {
  refusedNew = true
}
check('createNewClientFormV2() refuses without confirmation', refusedNew)
check('an unconfirmed new form creates nothing', noConfirm.stats().createdForms === 0)

const confirmed = loadBuilder(v21source)
confirmed.sandbox.confirmNewClientFormV2()
confirmed.sandbox.createNewClientFormV2()
check('a confirmed new form is created once', confirmed.stats().createdForms === 1)
let secondUse = false
try {
  confirmed.sandbox.createNewClientFormV2()
} catch (error) {
  secondUse = true
}
check('one confirmation buys exactly one form', secondUse && confirmed.stats().createdForms === 1)

const staleConfirm = loadBuilder(v21source)
staleConfirm.properties.set('HDL_CLIENT_FORM_V21_CONFIRM', String(Date.now() - 11 * 60 * 1000))
let staleRefused = false
try {
  staleConfirm.sandbox.createNewClientFormV2()
} catch (error) {
  staleRefused = true
}
check('a confirmation older than ten minutes does not count',
  staleRefused && staleConfirm.stats().createdForms === 0)

// --- Critical: corrupted state fails closed -------------------------------
const corrupt = loadBuilder(v21source, {
  stateKey: 'HDL_CLIENT_FORM_V21_STATE',
  stateOverride: '{not json',
})
let corruptThrew = false
try {
  corrupt.sandbox.createClientFormV2()
} catch (error) {
  corruptThrew = true
}
check('a corrupted saved record stops the run', corruptThrew)
check('a corrupted saved record creates nothing', corrupt.stats().createdForms === 0)
check('a corrupted saved record is not deleted',
  corrupt.properties.get('HDL_CLIENT_FORM_V21_STATE') === '{not json')

// --- Critical: execution lock ---------------------------------------------
const locked = loadBuilder(v21source, { lockHeld: true })
let lockedThrew = false
try {
  locked.sandbox.createClientFormV2()
} catch (error) {
  lockedThrew = true
}
check('a held script lock stops a second run', lockedThrew)
check('a held script lock creates nothing', locked.stats().createdForms === 0)
check('the lock is used around the check-create-save workflow',
  v21source.includes('LockService.getScriptLock()') && v21source.includes('tryLock('))

// --- Critical: v2's own form must not be duplicated ----------------------
const legacyRecord = JSON.stringify({
  formId: 'legacy-form-id',
  status: 'ready',
  editUrl: 'https://docs.google.com/forms/d/legacy/edit',
  liveUrl: 'https://docs.google.com/forms/d/e/legacy/viewform',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/legacy/edit',
})
const legacy = loadBuilder(v21source, {
  stateKey: 'HDL_CLIENT_FORM_V2_STATE',
  stateOverride: legacyRecord,
})
let legacyThrew = false
try {
  legacy.sandbox.createClientFormV2()
} catch (error) {
  legacyThrew = true
}
check('a form made by v2 stops v2.1 from building a second one', legacyThrew)
check('a form made by v2 is not duplicated', legacy.stats().createdForms === 0)
check('a form made by v2 is left in place',
  legacy.properties.get('HDL_CLIENT_FORM_V2_STATE') === legacyRecord)

const legacyCorrupt = loadBuilder(v21source, {
  stateKey: 'HDL_CLIENT_FORM_V2_STATE',
  stateOverride: '{oops',
})
let legacyCorruptThrew = false
try {
  legacyCorrupt.sandbox.createClientFormV2()
} catch (error) {
  legacyCorruptThrew = true
}
check('an unreadable v2 record stops the run', legacyCorruptThrew)
check('an unreadable v2 record creates nothing', legacyCorrupt.stats().createdForms === 0)

// --- High: numeric occupancy ----------------------------------------------
const mainMax21 = asks(q21, /maximum na papayagan sa Main House/i)
const annexMax21 = asks(q21, /maximum na papayagan sa Annex/i)
const campMax21 = asks(q21, /maximum na papayagan sa A-House/i)
check('the three occupancy questions require a number',
  [mainMax21, annexMax21, campMax21].every((q) => q?.validation?.requiresNumber === true))
check('the occupancy questions stay optional, so blank records "not decided"',
  [mainMax21, annexMax21, campMax21].every((q) => q && q.required === false))
check('a fallback rule is asked while the maximum is undecided',
  Boolean(asks(q21, /Habang wala pang desisyon sa maximum/i)))

// --- High: the ambiguous weekend question is gone -------------------------
check('the Friday-to-Sunday question is removed',
  !q21.some((q) => /Biyernes hanggang Linggo/i.test(q.title)))
check('the Thursday-to-Saturday example stays',
  /Huwebes hanggang Sabado/i.test(asks(q21, /paano sisingilin ang bawat gabi/i)?.help ?? ''))

// --- High: save-and-return needs a sign-in --------------------------------
check('the draft promise states the sign-in condition',
  /mag-sign in/i.test(v21.form.description ?? '') && /30 araw/i.test(v21.form.description ?? ''))

// --- High: permission grid has no "none" column ---------------------------
const permGrid = q21.find((q) => q.kind === 'checkboxGrid')
check('the permission grid has no "Wala sa lahat" column',
  permGrid && !permGrid.columns.some((c) => /wala sa lahat/i.test(c)))
check('the permission grid says a blank row means no permission',
  /walang tsek/i.test(permGrid?.help ?? ''))

// --- Iba pa duplication ---------------------------------------------------
const bothIbaPa = q21.filter((q) => q.other && (q.choices ?? []).includes('Iba pa'))
check('no question offers both a literal "Iba pa" and Google’s Other box',
  bothIbaPa.length === 0, bothIbaPa.map((q) => q.title).join(' | '))

// --- Account ownership ----------------------------------------------------
const ownershipGrid = asks(q21, /Kanino nakapangalan ang bawat account/i)
check('ownership is asked as a grid of services',
  ownershipGrid?.kind === 'grid')
const services = (ownershipGrid?.rows ?? []).join(' | ')
check('the grid covers the services this project runs on',
  ['Domain registrar', 'Firebase', 'Supabase', 'Vercel', 'GitHub'].every((svc) => services.includes(svc)),
  services)
check('the registered owner email is asked separately',
  Boolean(asks(q21, /registered owner email/i)))
check('the credential prohibition is still stated on the ownership question',
  /HUWAG ilagay ang password/i.test(ownershipGrid?.help ?? ''))

// --- Refund example arithmetic -------------------------------------------
const refundBase = asks(q21, /refund percentage ay base sa ano/i)
check('the refund example no longer claims 5,000 is greater than 5,000',
  !/mas malaki kaysa sa binayad/i.test(refundBase?.help ?? ''))
check('the refund example states the cap',
  /hindi pwedeng lumampas ang refund sa perang tunay na natanggap/i.test(refundBase?.help ?? ''))

// --- Neutral deposit definition ------------------------------------------
check('the security deposit definition no longer assumes one is collected',
  !/perang hawak muna ng Hacienda/i.test(v21.form.description ?? '')
  && /maaaring kolektahin/i.test(v21.form.description ?? ''))

// --- OTA wording ---------------------------------------------------------
const ota21 = asks(q21, /antas ng koneksyon sa OTA/i)
check('the OTA help no longer quotes a fixed delay in minutes',
  !/15 minuto hanggang ilang oras/i.test(ota21?.help ?? ''))
check('the OTA help still says feeds are delayed and cannot prevent clashes',
  /HINDI real-time/i.test(ota21?.help ?? '') && /kayang garantiyahin/i.test(ota21?.help ?? ''))

// --- Content improvements ------------------------------------------------
const perNight = asks(q21, /Bawat gabi ba ang mga presyo/i)
check('the per-night question names all three accommodations',
  /Main House/.test(perNight?.title ?? '') && /Annex/.test(perNight?.title ?? '')
  && /A-House/.test(perNight?.title ?? ''))
check('the A-House flat rate is confirmed across weekday, weekend and holiday',
  Boolean(asks(q21, /₱1,000 ng A-House/i)))
const receipt = asks(q21, /proseso ng resibo o invoice/i)
check('the receipt question asks for a process, not a yes/no',
  (receipt?.choices ?? []).length >= 4)
check('the smart-lock answers are not treated as hardware confirmation',
  /HINDI kumpirmasyon/i.test(asks(q21, /may totoong smart lock/i)?.help ?? ''))
const requiredCount21 = q21.filter((q) => q.required).length
check('fewer answers are required than in v2 (90)', requiredCount21 < 90, `v2.1 has ${requiredCount21}`)

// --- Answer quality still holds ------------------------------------------
check('every required list question can still be answered "not decided yet"',
  q21.filter((q) => q.required && q.choices && !hasEscape(q)).length === 0,
  q21.filter((q) => q.required && q.choices && !hasEscape(q)).map((q) => q.title).join(' | '))
check('every required grid can still be answered "not decided yet"',
  q21.filter((q) => q.required && q.kind === 'grid'
    && !(q.columns ?? []).some((c) => /napagdesisyunan|hindi ko alam/i.test(c))).length === 0)

// --- Builder behaviour ---------------------------------------------------
const forms21 = v21.stats().createdForms
const items21 = v21.questions.length
v21.sandbox.createClientFormV2()
check('running v2.1 twice does not create a second form', v21.stats().createdForms === forms21)
check('running v2.1 twice does not add questions', v21.questions.length === items21)

const state21 = JSON.parse(v21.properties.get('HDL_CLIENT_FORM_V21_STATE') ?? '{}')
check('v2.1 saves its own record, apart from v2',
  state21.formId === 'FORM-1' && state21.status === 'ready')

// A build that dies halfway must leave an honest record.
const broken21 = loadBuilder(v21source, { failAtItem: 6 })
let brokeDown21 = false
try {
  broken21.sandbox.createClientFormV2()
} catch (error) {
  brokeDown21 = true
}
const brokenState21 = JSON.parse(broken21.properties.get('HDL_CLIENT_FORM_V21_STATE') ?? '{}')
check('a failed v2.1 build throws', brokeDown21)
check('a failed v2.1 build records the form id and is marked incomplete',
  brokenState21.formId === 'FORM-1' && brokenState21.status === 'incomplete')

// The first save now sits inside the try, so it is reachable by the catch.
check('the first saveState sits inside the try block',
  v21source.includes('try {\n    saveState(state)'))

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
const required21 = q21.filter((q) => q.required).length
console.log(`\n  v2.1: ${q21.length} questions (${required21} required, ${q21.length - required21} optional), ${s21.length} sections`)
console.log(`  v2:   ${items.length} questions (${required} required, ${optional} optional), ${sections.length} sections — unchanged`)
console.log(`  v1:   ${v1.questions.filter((q) => q.kind !== 'section').length} questions — unchanged\n`)

if (failures > 0) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log('all checks passed\n')
