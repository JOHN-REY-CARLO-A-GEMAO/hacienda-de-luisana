#!/usr/bin/env node
/**
 * Executes the Apps Script form builders against a strict mock of the four Apps
 * Script services they use, so a typo is caught here rather than in the owner's
 * browser.
 *
 * The mock fails on anything the real Forms API would refuse: a help text that
 * is not a string, `setRequired` that is not a boolean, choice values that are
 * not a non-empty array of strings, a grid whose rows or columns are empty.
 *
 * `v2/Code.gs` is the form being sent, and it is held to the review's rules:
 *   - it never asks for a credential, and says so in its own words;
 *   - included guests and maximum occupancy are separate questions;
 *   - the pet question is a single choice, so "Main House" and "no pets
 *     anywhere" cannot both be ticked;
 *   - the cancellation section does not assert that silence means no refund,
 *     and asks what the refund percentage is a percentage *of*;
 *   - the booking-hold question offers both 22 and 24 hours, so the policy is
 *     asked rather than assumed;
 *   - check-in and check-out times are confirmed;
 *   - every required list question can be answered "not decided yet";
 *   - running the builder twice does not create a second form.
 *
 * `v1/Code.gs` is kept for history. It is only checked to still parse and run.
 *
 * Run: node scripts/google-form/build-check.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))

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
 * The mock is strict: a wrong argument type throws where the real API would.
 */
function loadBuilder(source) {
  const questions = []
  let createdForms = 0
  let createdSheets = 0
  const properties = new Map()
  const form = {
    id: 'FORM-1',
    destination: null,
  }

  function item(kind) {
    const record = {
      kind,
      title: '',
      help: null,
      required: false,
      choices: null,
      other: false,
      rows: null,
      columns: null,
      includesYear: null,
    }
    questions.push(record)

    function title(value) {
      if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${kind}: setTitle needs a non-empty string`)
      record.title = value
      return chain
    }
    function help(value) {
      if (typeof value !== 'string') throw new TypeError(`${kind} "${record.title}": setHelpText got ${typeof value}`)
      record.help = value
      return chain
    }
    function required(value) {
      if (typeof value !== 'boolean') throw new TypeError(`${kind} "${record.title}": setRequired got ${typeof value}`)
      record.required = value
      return chain
    }
    function choices(values) {
      const ok = Array.isArray(values)
        && values.length > 0
        && values.every((v) => typeof v === 'string' && v.trim().length > 0)
      if (!ok) throw new TypeError(`${kind} "${record.title}": setChoiceValues got ${JSON.stringify(values)}`)
      record.choices = values
      return chain
    }
    function strings(values, label) {
      const ok = Array.isArray(values)
        && values.length > 0
        && values.every((v) => typeof v === 'string' && v.trim().length > 0)
      if (!ok) throw new TypeError(`${kind} "${record.title}": ${label} got ${JSON.stringify(values)}`)
      return values
    }

    const chain = {
      setTitle: title,
      setHelpText: help,
      setRequired: required,
      setChoiceValues: choices,
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
      form.confirmation = text
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
    addGridItem: () => item('grid'),
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
        if (id !== form.id) throw new Error(`FormApp.openById(${id}) — unknown form`)
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
    stats: () => ({ createdForms, createdSheets }),
  }
}

/** The escape hatches a respondent may use when she has not decided. */
const ESCAPES = ['Pag-usapan natin', 'Hindi pa napagdesisyunan', 'Hindi pa napagdesisyunan.']

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

const asks = v2.questions.filter((q) => q.kind !== 'section')
const sections = v2.questions.filter((q) => q.kind === 'section')
const titles = asks.map((q) => q.title)
const allText = [
  v2.form.description ?? '',
  ...asks.flatMap((q) => [q.title, q.help ?? '', ...(q.choices ?? []), ...(q.rows ?? []), ...(q.columns ?? [])]),
].join('\n')

check('every question has a title', asks.every((q) => q.title.trim().length > 0))
check('no two questions share a title', new Set(titles).size === titles.length,
  titles.filter((t, i) => titles.indexOf(t) !== i).join(' | '))
check('seven sections, so the form is grouped', sections.length === 7, `got ${sections.length}`)
check('answers are written to a spreadsheet', v2.form.destination === 'SHEET-1')
check('the form link comes back', /^https:\/\/forms\.gle\//.test(result?.formUrl ?? ''))
check('the edit link comes back', /\/edit$/.test(result?.editUrl ?? ''))
check('the sheet link comes back', /spreadsheets/.test(result?.sheetUrl ?? ''))

// --- The audit's critical fixes -------------------------------------------

// 1. No credential collection. Every mention of a password must be a
//    prohibition, and no question may ask where a password lives.
// Word boundaries matter here: "pin" also prefixes "pinapayagan" and
// "pinaikli", and PIN is only a credential when it is written as one.
const credentialWords = /\bpassword\b|\bpasscode\b|\bPIN\b|\bOTP\b|api key|recovery code|credential/i
const credentialLines = allText.split('\n').filter((line) => credentialWords.test(line))
check('a credential is never requested — every mention is a prohibition',
  credentialLines.every((line) => /huwag|never|hindi nagtatanong|do not/i.test(line)),
  credentialLines.filter((line) => !/huwag|never|hindi nagtatanong|do not/i.test(line)).join(' | '))
check('the account question asks who owns the account, not who knows the password',
  asks.some((q) => /nakapangalan/i.test(q.title)) && !asks.some((q) => /sino ang may password/i.test(q.title)))
check('the form states the prohibition up front', /huwag ilagay ang password/i.test(v2.form.description ?? ''))

// 2. Occupancy: included guests and maximum are separate questions.
const maximumQuestion = asks.find((q) => /maximum na tao sa main house/i.test(q.title))
const includedIsStated = asks.some((q) => /kasama sa base rate/i.test(q.title))
check('maximum occupancy is asked separately from included guests',
  Boolean(maximumQuestion) && includedIsStated)
check('the maximum-occupancy question offers "no limit" and "not decided"',
  (maximumQuestion?.choices ?? []).includes('Walang limitasyon')
  && hasEscape(maximumQuestion))
check('the extra-guest charge is asked on its own',
  asks.some((q) => /dagdag sa bawat extra guest/i.test(q.title)))

// 3. The cancellation section no longer asserts that silence refunds nothing.
const cancellationSection = v2.questions.find((q) => q.kind === 'section' && /cancellation/i.test(q.title))
check('the cancellation section does not claim that no policy means no refund',
  Boolean(cancellationSection)
  && !/walang refund/i.test(cancellationSection?.help ?? '')
  && /wala pang final/i.test(cancellationSection?.help ?? ''))
check('the refund percentage base is asked (down payment, all received, or total price)',
  asks.some((q) => /refund percentage ay base sa ano/i.test(q.title)))

// 4. The pet question is a single choice with mutually exclusive answers.
const petQuestion = asks.find((q) => /saan pinapayagan ang pets/i.test(q.title))
check('the pet question is a single choice, not checkboxes', petQuestion?.kind === 'choice',
  petQuestion ? petQuestion.kind : 'missing')
check('the pet question offers "no pets anywhere" as one of its single answers',
  (petQuestion?.choices ?? []).includes('Walang pets allowed kahit saan'))
check('the pet fee basis is asked separately (per pet / per stay / per night)',
  asks.some((q) => /pet fee na ₱300/i.test(q.title)))

// 5. The booking hold asks 22 vs 24h instead of assuming one.
const holdQuestion = asks.find((q) => /naka-hold ang booking/i.test(q.title))
check('the booking-hold question offers both 22 and 24 hours',
  (holdQuestion?.choices ?? []).some((c) => /^22 oras/.test(c))
  && (holdQuestion?.choices ?? []).some((c) => /^24 oras/.test(c)))
check('the booking-hold question says when the countdown starts',
  asks.some((q) => /nagsisimula ang countdown/i.test(q.title)))

// 6. Check-in / check-out are confirmed, not assumed.
check('the check-in and check-out times are confirmed with the owner',
  asks.some((q) => /check-in 2:00 PM at check-out 12:00 NN/i.test(q.title)))

// --- Required answer quality ----------------------------------------------

check('every required list question can be answered "not decided yet"',
  asks.filter((q) => q.required && q.choices && !hasEscape(q)).length === 0,
  asks.filter((q) => q.required && q.choices && !hasEscape(q)).map((q) => q.title).join(' | '))
check('every required grid can be answered "not decided yet"',
  asks.filter((q) => q.required && q.kind === 'grid'
    && !(q.columns ?? []).some((c) => /napagdesisyunan/i.test(c))).length === 0)
check('every choice/checkbox/grid offers at least two answers',
  asks.filter((q) => q.choices).every((q) => q.choices.length >= 2)
  && asks.filter((q) => q.kind === 'grid').every((q) => q.columns.length >= 2))
check('the retention grid separates the kinds of record',
  (asks.find((q) => q.kind === 'grid')?.rows ?? []).length >= 4)
check('the form asks whose answers these are', asks.some((q) => /final na desisyon/i.test(q.title)))
check('technical terms are explained in the form', /OTA|Force majeure|Live Location/.test(v2.form.description ?? ''))

// --- Builder behaviour ----------------------------------------------------

const before = v2.questions.length
const formsBefore = v2.stats().createdForms
v2.sandbox.createClientFormV2()
check('a second run does not create a second form', v2.stats().createdForms === formsBefore)
check('a second run does not add questions', v2.questions.length === before)
v2.sandbox.createClientFormV2Again()
check('createClientFormV2Again() does build a fresh copy', v2.stats().createdForms === formsBefore + 1)

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

const required = asks.filter((q) => q.required).length
console.log(`\n  v2: ${asks.length} questions (${required} required), ${sections.length} sections`)
console.log(`  v1: ${v1.questions.filter((q) => q.kind !== 'section').length} questions (left as it was)\n`)

if (failures > 0) {
  console.error(`${failures} check(s) failed\n`)
  process.exit(1)
}
console.log('all checks passed\n')
