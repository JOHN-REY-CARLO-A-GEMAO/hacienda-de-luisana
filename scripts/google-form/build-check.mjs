#!/usr/bin/env node
/**
 * Executes scripts/google-form/Code.gs against a strict mock of the four Apps
 * Script services it uses, so a typo in the form builder is caught here rather
 * than in the owner's browser.
 *
 * The mock fails on anything the real Forms API would refuse: a help text that
 * is not a string, a `setRequired` that is not a boolean, choice values that are
 * not a non-empty array of strings, a section with no title. It also asserts the
 * things this repository cares about:
 *
 *   - every question has a title, and no two titles collide;
 *   - the six sections exist, so the questions the owner reads are grouped;
 *   - every required question can be answered "we have not decided" — it offers
 *     "Pag-usapan natin", "Hindi ko alam", "Iba pa", or the other-option box;
 *   - running the builder twice does not create a second form;
 *   - the answers land in a spreadsheet and the links come back.
 *
 * Run: node scripts/google-form/build-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'Code.gs'), 'utf8')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

// ---------------------------------------------------------------------------
// Strict mock of the Apps Script surface Code.gs touches
// ---------------------------------------------------------------------------

const questions = []
let createdForms = 0

function item(kind) {
  const record = {
    kind,
    title: '',
    help: null,
    required: false,
    choices: null,
    other: false,
    includesYear: null,
  }
  questions.push(record)

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
      const ok = Array.isArray(values)
        && values.length > 0
        && values.every((v) => typeof v === 'string' && v.trim().length > 0)
      if (!ok) throw new TypeError(`${kind} "${record.title}": setChoiceValues got ${JSON.stringify(values)}`)
      record.choices = values
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
  }
  return chain
}

const form = {
  id: 'FORM-1',
  destination: null,
  setDescription(text) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('setDescription needs a string')
    return form
  },
  setConfirmationMessage(text) {
    if (typeof text !== 'string') throw new TypeError('setConfirmationMessage needs a string')
    return form
  },
  setCollectEmail(value) {
    if (typeof value !== 'boolean') throw new TypeError('setCollectEmail needs a boolean')
    return form
  },
  setProgressBar(value) {
    if (typeof value !== 'boolean') throw new TypeError('setProgressBar needs a boolean')
    return form
  },
  setShuffleQuestions(value) {
    if (typeof value !== 'boolean') throw new TypeError('setShuffleQuestions needs a boolean')
    return form
  },
  addPageBreakItem: () => item('section'),
  addTextItem: () => item('text'),
  addParagraphTextItem: () => item('paragraph'),
  addMultipleChoiceItem: () => item('choice'),
  addCheckboxItem: () => item('checks'),
  addDateItem: () => item('date'),
  setDestination(type, id) {
    if (type !== 'spreadsheet') throw new TypeError(`setDestination got ${type}`)
    if (!id) throw new TypeError('setDestination needs a spreadsheet id')
    form.destination = id
  },
  getId: () => form.id,
  getPublishedUrl: () => 'https://forms.gle/TEST',
  getEditUrl: () => 'https://docs.google.com/forms/d/FORM-1/edit',
}

const FormApp = {
  create(title) {
    if (typeof title !== 'string' || !title.trim()) throw new TypeError('FormApp.create needs a title')
    createdForms += 1
    return form
  },
  openById(id) {
    if (id !== form.id) throw new Error(`FormApp.openById(${id}) — unknown form`)
    return form
  },
  DestinationType: { SPREADSHEET: 'spreadsheet' },
}

const properties = new Map()
const Sheets = { created: 0 }

const sandbox = {
  FormApp,
  SpreadsheetApp: {
    create(name) {
      if (typeof name !== 'string') throw new TypeError('SpreadsheetApp.create needs a name')
      Sheets.created += 1
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

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

console.log('\ngoogle-form builder\n')

let result
try {
  result = sandbox.createClientForm()
} catch (error) {
  console.error('  FAIL the builder threw:', error.message)
  process.exit(1)
}

const asks = questions.filter((q) => q.kind !== 'section')
const sections = questions.filter((q) => q.kind === 'section')

check('every question has a title', asks.every((q) => q.title.trim().length > 0))
const titles = asks.map((q) => q.title)
check('no two questions share a title', new Set(titles).size === titles.length,
  titles.filter((t, i) => titles.indexOf(t) !== i).join(' | '))
check('every section has a title', sections.every((s) => s.title.trim().length > 0))
check('six sections, so the form is grouped', sections.length === 6, `got ${sections.length}`)
check('every choice/checkbox question offers at least two answers',
  asks.filter((q) => q.choices).every((q) => q.choices.length >= 2))

const escapeHatches = ['Pag-usapan natin', 'Hindi ko alam', 'Iba pa', 'Wala pa', 'Meron na']
// A required free-text question can always be answered in words ("Hindi pa
// sigurado"), so the rule only applies where the answers are a fixed list.
const unanswerable = asks.filter((q) => q.required
  && q.choices
  && !q.other
  && !(q.choices ?? []).some((choice) => escapeHatches.includes(choice))
  && !(q.choices ?? []).some((choice) => /^Iba pa/.test(choice)))
check('every required list question can be answered "not decided yet"', unanswerable.length === 0,
  unanswerable.map((q) => q.title).join(' | '))

check('answers are written to a spreadsheet', form.destination === 'SHEET-1')
check('the form link comes back', /^https:\/\/forms\.gle\//.test(result?.formUrl ?? ''))
check('the edit link comes back', /\/edit$/.test(result?.editUrl ?? ''))
check('the sheet link comes back', /spreadsheets/.test(result?.sheetUrl ?? ''))

const firstRunItems = questions.length
const firstRunForms = createdForms
sandbox.createClientForm()
check('a second run does not create a second form', createdForms === firstRunForms)
check('a second run does not add questions', questions.length === firstRunItems)

sandbox.createClientFormAgain()
check('createClientFormAgain() does build a fresh copy', createdForms === firstRunForms + 1)
check('the fresh copy still has six sections',
  questions.filter((q) => q.kind === 'section').length === sections.length * 2)

const required = asks.filter((q) => q.required).length
console.log(`\n  ${asks.length} questions (${required} required), ${sections.length} sections, ${Sheets.created} spreadsheet(s)\n`)

if (failures > 0) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log('all checks passed\n')
