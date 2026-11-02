/**
 * Hacienda de LuisAna — Client Decisions form, VERSION 2.1.1
 * ---------------------------------------------------------------------------
 * Builds the owner's questionnaire. Version 1 (../Code.gs), version 2
 * (../v2/Code.gs) and version 2.1 (../v2.1/Code.gs) are kept unchanged for
 * history. This file carries five fixes to v2.1's duplicate protection and
 * error handling, and nothing else: the seven sections and every question are
 * v2.1's, character for character.
 *
 * WHAT v2.1.1 FIXES
 *   1. The confirmation was read, checked and deleted BEFORE the script lock,
 *      so two executions starting together could both see it and both build.
 *      The read, the check and the delete now happen inside the lock, so one
 *      confirmation can only ever be spent once.
 *   2. A record that parsed as JSON but had no formId was accepted as "no form
 *      yet" — {"status":"ready"} read as an empty slot. Both the v2.1 record
 *      and the v2 legacy record now require a usable formId; anything else
 *      stops the run.
 *   3. forgetClientFormV2() called readState(), so a record it was meant to
 *      clear could make it throw. It now reads the raw property, prints what it
 *      can, and clears it — otherwise an unreadable record is a dead end that
 *      the script's own advice ("run forgetClientFormV2") could not open.
 *   4. There was no way to clear the v2 legacy record, so a v2 form deleted by
 *      hand still blocked v2.1.1. forgetLegacyClientFormV2() clears that record
 *      and nothing else — never a Drive file.
 *   5. The recovery save inside buildFormV2()'s catch could throw and hide the
 *      original error. It is now wrapped, and the original error, the links and
 *      the recovery error are all printed before the original is re-thrown.
 *
 * DUPLICATE PROTECTION
 *   - One deliberate path to a second form: confirmNewClientFormV2(), then
 *     createNewClientFormV2() within ten minutes. The confirmation is consumed
 *     under the lock, whether the build succeeds or fails, so a failed build
 *     must be confirmed again.
 *   - A second form also requires the user to see both the v2.1 record and any
 *     v2 legacy record — confirmNewClientFormV2() prints the links of both.
 *   - The check-create-save workflow runs under LockService.
 *   - A saved record that cannot be read, or that has no formId, stops the run.
 *   - The first saveState() sits inside the try, so a failing property write is
 *     reported as a failed build. FormApp.create() still runs before that line:
 *     if the very first save throws, a form exists in Drive with no record. The
 *     recovery save is itself guarded, so the original error is never lost.
 *
 * THE SAME RECORD AS v2.1, ON PURPOSE
 *   STATE_KEY and CONFIRM_KEY are unchanged from v2.1, so a form that v2.1
 *   already built is found and protected rather than duplicated. v2's own key
 *   is still read as a legacy record.
 *
 * ANSWERS (unchanged from v2.1)
 *   - Occupancy is number-validated and optional; blank records "not decided",
 *     and a follow-up asks what the system should use meanwhile.
 *   - The Friday-to-Sunday weekend question is gone; the Thursday-to-Saturday
 *     example stays, and the per-night question names all three
 *     accommodations. A-House's flat rate is confirmed explicitly.
 *   - No question offers both a literal "Iba pa" choice and Google's own Other
 *     box. The permission grid has no "Wala sa lahat" column.
 *   - Account ownership covers domain/DNS, Firebase, Supabase, Vercel and
 *     GitHub, and a paragraph asks for the registered owner email of each.
 *   - The refund example adds up; the security-deposit definition does not
 *     presume a deposit is collected; the iCal wording quotes no fixed delay;
 *     the save-and-return promise states its condition.
 *   - The receipt question asks for the process. Fewer answers are required.
 *
 * HOW TO RUN (about 3 minutes)
 *   1. Open https://script.google.com and click "New project".
 *   2. Delete the sample code, paste this whole file, and press Save.
 *   3. Choose the function `createClientFormV2`, then Run.
 *   4. Approve the permissions. Read the list on Google's own consent screen
 *      rather than trusting this comment.
 *   5. View -> Execution log prints the form link, the edit link and the
 *      response spreadsheet.
 *
 * BEFORE SENDING IT
 *   Fill the form in once yourself with dummy answers, confirm the sheet
 *   receives them, then clear the dummy response. See ../README.md.
 * ---------------------------------------------------------------------------
 */

var FORM_TITLE = 'Hacienda de LuisAna — Mga Desisyon ng May-ari (v2.1)'
var SHEET_TITLE = 'Hacienda de LuisAna — Client Answers (v2.1)'
var STATE_KEY = 'HDL_CLIENT_FORM_V21_STATE'
var CONFIRM_KEY = 'HDL_CLIENT_FORM_V21_CONFIRM'
/** How long a confirmation stays valid, in milliseconds. */
var CONFIRM_WINDOW_MS = 10 * 60 * 1000

/**
 * Where v2 of this script kept its record.
 *
 * v2.1 uses its own key so the two versions cannot overwrite each other, but
 * that would let v2.1 build a form beside one that v2 already made. So a v2
 * record counts as an existing form too: the run stops and lists it instead.
 */
var LEGACY_STATE_KEY = 'HDL_CLIENT_FORM_V2_STATE'

/**
 * Creates the form once. Never makes a second one by accident.
 *
 * The whole check-create-save workflow runs under a script lock: two windows
 * pressing Run at the same moment would otherwise both read an empty record and
 * both build a form.
 */
function createClientFormV2() {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) {
    Logger.log('May ibang tumatakbo pa sa script na ito. Hintayin itong matapos at ulitin.')
    throw new Error('Another execution holds the script lock. Nothing was created.')
  }
  try {
    return createClientFormV2Locked()
  } finally {
    lock.releaseLock()
  }
}

function createClientFormV2Locked() {
  var state = readState()

  if (state && state.formId) {
    // Do not delete the record when the form cannot be opened: a temporary
    // permission or network failure would then create a second form on the
    // next run. Log it and stop instead.
    try {
      FormApp.openById(state.formId)
    } catch (err) {
      Logger.log('HINDI mabuksan ang naunang form (' + state.formId + '): ' + err)
      Logger.log('Hindi na gumawa ng bago para hindi madoble. Suriin muna ang form sa Drive,')
      Logger.log('at kung talagang wala na ito, patakbuhin ang forgetClientFormV2().')
      throw new Error('Could not open the existing form. Nothing was created.')
    }

    logLinks(state)
    if (state.status === 'ready') {
      Logger.log('Kumpleto na ang form na ito — hindi na gumawa ng bago.')
      Logger.log('Kung talagang kailangan ng bagong kopya, patakbuhin ang')
      Logger.log('confirmNewClientFormV2() at pagkatapos ay createNewClientFormV2().')
    } else {
      Logger.log('HINDI KUMPLETO ang form na ito (status: ' + state.status + ').')
      Logger.log('I-delete ito sa Drive, patakbuhin ang forgetClientFormV2(), at saka ulitin.')
    }
    return state
  }

  var legacy = readLegacyState()
  if (legacy && legacy.formId) {
    Logger.log('May form na ginawa ng naunang bersyon ng script na ito (v2):')
    logLinks(legacy)
    Logger.log('Hindi na gumawa ng bago para hindi madoble. Kung talagang kailangan ng')
    Logger.log('bagong form, patakbuhin ang confirmNewClientFormV2() at pagkatapos ay')
    Logger.log('createNewClientFormV2(). Kung luma na ang form na iyon, i-delete ito sa Drive.')
    throw new Error('An earlier version of this script already made a form. Nothing was created.')
  }

  return buildFormV2()
}

/**
 * Reads the v2 record. A damaged legacy record stops the run for the same reason
 * a damaged record of v2.1's own does: the alternative is a second form beside
 * one that still exists.
 */
function readLegacyState() {
  var raw = PropertiesService.getScriptProperties().getProperty(LEGACY_STATE_KEY)
  if (!raw) return null

  var parsed = null
  var problem = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    problem = err
  }
  if (!problem && (!parsed || typeof parsed !== 'object')) problem = new Error('not an object')
  if (!problem && !isFormId(parsed.formId)) problem = new Error('no usable formId')

  if (problem) {
    Logger.log('May record ang naunang bersyon (v2) pero hindi magamit: ' + problem)
    Logger.log('Hindi ito itinuturing na walang form. Suriin ang Drive kung may v2 form pa,')
    Logger.log('at kung wala na, patakbuhin ang forgetLegacyClientFormV2() bago gumawa ng bago.')
    throw new Error('The v2 record is unusable. Nothing was created.')
  }
  return parsed
}

/**
 * Builds a new form even though one exists. This is deliberately TWO steps:
 * run confirmNewClientFormV2() first, then this function within ten minutes.
 * A single function that anyone can run by accident is how duplicate forms
 * happen, so the accident is made impossible rather than documented.
 */
function createNewClientFormV2() {
  // The lock comes FIRST. The confirmation is read, checked and consumed
  // inside it: read outside, two executions can both see a valid confirmation,
  // both pass the check, and the second one builds a form after the first
  // releases the lock.
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) {
    Logger.log('May ibang tumatakbo pa sa script na ito. Walang ginawa, at HINDI nagamit')
    Logger.log('ang confirmation — patakbuhin muli ito pagkatapos ng isa pang run.')
    throw new Error('Another execution holds the script lock. Nothing was created.')
  }
  try {
    var props = PropertiesService.getScriptProperties()
    var raw = props.getProperty(CONFIRM_KEY)
    var askedAt = raw ? Number(raw) : 0
    var fresh = isFinite(askedAt) && askedAt > 0 && (Date.now() - askedAt) <= CONFIRM_WINDOW_MS

    if (!fresh) {
      Logger.log('Hindi pa kumpirmado ang paggawa ng bagong form — walang ginawa.')
      Logger.log('Patakbuhin muna ang confirmNewClientFormV2(), at pagkatapos ay ito agad')
      Logger.log('sa loob ng 10 minuto. Ipapakita ng confirmNewClientFormV2() ang links ng')
      Logger.log('kasalukuyang form para makita mo kung bago nga ang kailangan mo.')
      throw new Error('New form not confirmed. Nothing was created.')
    }

    // Consumed here, inside the lock, so exactly one execution can act on it.
    // A build that fails after this point still spends the confirmation: run
    // confirmNewClientFormV2() again instead of trusting a stale one.
    props.deleteProperty(CONFIRM_KEY)

    return buildFormV2()
  } finally {
    lock.releaseLock()
  }
}

/**
 * Step one of making a second form. Prints the links of the form that already
 * exists, then records the confirmation so createNewClientFormV2() will run for
 * the next ten minutes only.
 */
function confirmNewClientFormV2() {
  var state = readState()
  if (state) {
    Logger.log('Ito ang form na mayroon na — tiyakin munang talagang kailangan ang bago:')
    logLinks(state)
  } else {
    Logger.log('Wala pang naka-save na record ng v2.1 sa script na ito.')
  }

  // The legacy v2 form is just as real as this one, so it is shown here too.
  // readLegacyState() throws when that record exists but names no form: the
  // confirmation is not recorded, because the build would refuse anyway.
  var legacy = readLegacyState()
  if (legacy) {
    Logger.log('')
    Logger.log('May form din na ginawa ng lumang bersyon (v2):')
    logLinks(legacy)
    Logger.log('Kung gagawa ka ngayon ng bago, DALAWANG form at DALAWANG sheet ang')
    Logger.log('maiiwan. I-delete muna ang luma sa Drive, o patakbuhin ang')
    Logger.log('forgetLegacyClientFormV2() kung wala na talaga ito.')
  }

  PropertiesService.getScriptProperties().setProperty(CONFIRM_KEY, String(Date.now()))
  Logger.log('')
  Logger.log('Naka-record ang confirmation. Patakbuhin ngayon ang createNewClientFormV2()')
  Logger.log('kung talagang gusto mong gumawa ng bagong form (10 minuto lang ito valid).')
}

/**
 * Clears the record v2 left behind, and nothing else.
 *
 * The links are printed first, and the warning is explicit: this deletes a
 * Script Property. It does not, and cannot, delete the form or the spreadsheet
 * in Drive — deleting those needs Drive access, which this script does not ask
 * for. Clearing the record without deleting the form is how two forms end up
 * side by side, so the order is spelled out.
 */
function forgetLegacyClientFormV2() {
  var props = PropertiesService.getScriptProperties()
  var raw = props.getProperty(LEGACY_STATE_KEY)
  if (!raw) {
    Logger.log('Walang record mula sa lumang bersyon (v2). Wala ring binago.')
    return
  }

  var parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    parsed = null
  }

  if (parsed && typeof parsed === 'object' && isFormId(parsed.formId)) {
    Logger.log('Ito ang form na ginawa ng v2 — tiyaking wala na ito sa Drive bago magpatuloy:')
    logLinks(parsed)
  } else {
    Logger.log('Hindi mabasa nang maayos ang v2 record. Ito ang hilaw na laman:')
    Logger.log(raw)
  }

  Logger.log('')
  Logger.log('BABALA: record lang ng script ang tatanggalin. HINDI nito binubura ang form o')
  Logger.log('spreadsheet sa Drive. Kung may form pa roon, dalawa ang form pagkatapos mong')
  Logger.log('gumawa ng bago — i-delete muna ito nang manu-mano.')

  props.deleteProperty(LEGACY_STATE_KEY)
  Logger.log('Natanggal ang v2 record. Patakbuhin muli ang createClientFormV2() kung wala na')
  Logger.log('talagang form sa Drive.')
}

/** Prints the links of the most recent form this script made. */
function showClientFormV2Links() {
  var state = readState()
  if (!state || !state.formId) {
    Logger.log('Wala pang form. Patakbuhin muna ang createClientFormV2().')
    return
  }
  logLinks(state)
}

/**
 * Clears the saved record WITHOUT deleting anything from Drive, so a form that
 * failed halfway can be abandoned. The links are printed first so the form and
 * the sheet can be deleted by hand — deleting them from the script would need
 * Drive access, which this script does not ask for.
 */
function forgetClientFormV2() {
  // Read the raw property, NOT readState(): a record too damaged to parse is
  // exactly the one this function exists to clear. Calling the strict reader
  // here would leave no way out of the state it refuses to read.
  var props = PropertiesService.getScriptProperties()
  var raw = props.getProperty(STATE_KEY)
  if (!raw) {
    Logger.log('Walang naka-save na record. Wala ring binago.')
    return
  }

  var parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    parsed = null
  }

  if (parsed && typeof parsed === 'object' && isFormId(parsed.formId)) {
    logLinks(parsed)
  } else {
    Logger.log('Hindi mabasa nang maayos ang record. Ito ang hilaw na laman para may makopya ka:')
    Logger.log(raw)
  }

  props.deleteProperty(STATE_KEY)
  Logger.log('Natanggal lang ang RECORD. Hindi ito nag-delete ng form o sheet sa Drive.')
  Logger.log('Manu-manong i-delete sa Drive ang form at sheet (kung may nakita sa itaas),')
  Logger.log('at saka patakbuhin muli ang createClientFormV2().')
}

function readState() {
  var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY)
  if (!raw) return null

  var parsed = null
  var problem = null
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    problem = err
  }
  if (!problem && (!parsed || typeof parsed !== 'object')) problem = new Error('not an object')
  if (!problem && !isFormId(parsed.formId)) problem = new Error('no usable formId')

  if (problem) {
    // Fail closed. Reading a damaged or half-written record as "no form yet" is
    // exactly how a second form gets made while the first one still exists.
    Logger.log('May naka-save na record pero walang valid na formId o hindi ito mabasa: ' + problem)
    Logger.log('Huminto muna — walang ginawang form. Suriin ang Drive kung may existing form,')
    Logger.log('at pagkatapos ay patakbuhin ang forgetClientFormV2() para makapag-umpisa nang malinis.')
    throw new Error('The saved form record is unusable. Nothing was created.')
  }
  return parsed
}

function saveState(state) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state))
}

/**
 * A record is only a record if it names the form it belongs to. `{}`,
 * `{"status":"ready"}` and `{"formId":""}` all describe a form nobody can open,
 * so none of them may be read as "nothing exists yet".
 */
function isFormId(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function logLinks(state) {
  if (state.editUrl) Logger.log('I-edit:    ' + state.editUrl)
  if (state.publishedUrl) Logger.log('Sagutan:   ' + state.publishedUrl)
  if (state.sheetUrl) Logger.log('Responses: ' + state.sheetUrl)
  if (state.formId) Logger.log('Form id:   ' + state.formId)
}

function buildFormV2() {
  // Created first, so the id can be saved before a single question is added.
  // A build that dies halfway then leaves a record rather than a mystery form.
  var form = FormApp.create(FORM_TITLE)
  var state = {
    formId: form.getId(),
    editUrl: form.getEditUrl(),
    publishedUrl: form.getPublishedUrl(),
    sheetId: null,
    sheetUrl: null,
    status: 'building',
    startedAt: new Date().toISOString(),
  }

  // The save sits INSIDE the try so a failing property write is reported as a
  // failed build instead of escaping before the catch. One narrow window is
  // unavoidable: FormApp.create() runs before this line, so if the very first
  // save throws, a form exists in Drive with no record. Recovery is the same as
  // any other half-build — delete it in Drive, forgetClientFormV2(), run again.
  try {
    saveState(state)

    buildQuestionsV2(form)

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
    var sheet = SpreadsheetApp.create(SHEET_TITLE + ' — ' + stamp)
    state.sheetId = sheet.getId()
    state.sheetUrl = sheet.getUrl()
    saveState(state)

    form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId())

    state.status = 'ready'
    state.finishedAt = new Date().toISOString()
    saveState(state)
  } catch (err) {
    state.status = 'incomplete'
    state.error = String(err)

    // Print the original error FIRST, then the links, then try to save. The
    // recovery save gets its own try: a property write that fails here used to
    // replace the real error with a second, less useful one.
    Logger.log('NABIGO ang paggawa ng form: ' + err)
    logLinks(state)

    var saveProblem = null
    try {
      saveState(state)
    } catch (saveErr) {
      saveProblem = saveErr
    }

    if (saveProblem) {
      Logger.log('NABIGO rin ang pag-save ng status: ' + saveProblem)
      Logger.log('Kopyahin agad ang Form id sa itaas bago mag-refresh — wala itong naka-save')
      Logger.log('na record, kaya walang haharang sa susunod na run. I-delete ang form at sheet')
      Logger.log('sa Drive bago mag-umpisa muli.')
    } else {
      Logger.log('Naka-save ang record bilang incomplete, kaya haharang ito sa susunod na run.')
      Logger.log('Ayusin ang error. Kung hindi na kailangan ang kalahating form na ito,')
      Logger.log('patakbuhin ang forgetClientFormV2() at i-delete ito sa Drive.')
    }
    throw err
  }

  Logger.log('=== READY ===')
  logLinks(state)
  return state
}

function buildQuestionsV2(form) {
  form.setDescription(
    'Para sa mga desisyong kailangan ng Hacienda de LuisAna booking system. ' +
    'Mga 40–50 minuto. Puwedeng sagutan nang paunti-unti: para ma-save ang draft, mag-sign in ' +
    'sa Google Account at gamitin muli ang PAREHONG account at PAREHONG link. Ang draft ay ' +
    'naka-save nang awtomatiko nang hanggang 30 araw. Kung hindi ka naka-sign in, isang upuan ' +
    'lang ang pagsagot. ' +
    'Kung hindi ka sigurado sa isang tanong, piliin ang "Pag-usapan natin" o isulat ang ' +
    '"Hindi pa napagdesisyunan" — mas mabuti iyon kaysa sa hulaan.\n\n' +
    'HINDI nagtatanong ng password, PIN, OTP, recovery code, API key, o anumang login ' +
    'credential ang form na ito. Huwag ilagay ang password, PIN, OTP, recovery code, o API key ' +
    'sa kahit anong sagot. Ang paglilipat ng account ay sa official na "invite" o ' +
    '"transfer ownership" ng bawat serbisyo.\n\n' +
    'May mga tanong na may "(Teknikal)" sa simula. Iyon ay desisyong teknikal — kung hindi ' +
    'ka komportable, piliin lang ang "Pag-usapan natin" at ipapaliwanag ito ng team nang ' +
    'walang jargon.\n\n' +
    'Mga salitang ginagamit dito:\n' +
    '• Standard stay — isang gabi, 2:00 PM ng pagdating hanggang 12:00 NN ng pag-alis. ' +
    'Ang presyo ng isang gabi ay isang standard stay.\n' +
    '• Security deposit — karagdagang halagang maaaring kolektahin bilang panagot sa damage ' +
    'o ibang napagkasunduang singil, at karaniwang ibinabalik pagkatapos ng stay kung walang ' +
    'napanagot. Hiwalay ito sa bayad sa stay, at hindi ito kailangang kolektahin kung ayaw mo.\n' +
    '• OTA — Airbnb, Agoda, Booking.com at iba pang booking site.\n' +
    '• Hold — ang oras na nakareserba ang petsa habang hinihintay ang approval; kapag ' +
    'naubos ito, bumabalik sa kalendaryo ang petsa.\n' +
    '• Force majeure — bagyo, baha, lindol, road closure, o ibang pangyayaring hindi ' +
    'kontrolado ng guest o ng Hacienda.\n' +
    '• Live Location — kung papayag ang guest na ipakita ang lokasyon niya habang ' +
    'naglalakbay papunta sa Hacienda, 15, 30, o 60 minuto lang at may consent.'
  )
  form.setConfirmationMessage(
    'Salamat! Nai-record na ang mga sagot. Ang "Pag-usapan natin" at ' +
    '"Hindi pa napagdesisyunan" ay hindi mali — listahan lang iyon ng mga kailangan pa nating ' +
    'pag-usapan. I-message ang team kung may babaguhin.'
  )
  form.setCollectEmail(false)
  form.setProgressBar(true)
  form.setShuffleQuestions(false)

  // =========================================================================
  // 1. Bago magsimula
  // =========================================================================
  addSection(form, '1. Bago magsimula',
    'Sino ang sumasagot, at gaano katibay ang mga sagot na ibibigay.')

  addText(form, 'Pangalan mo', {
    help: 'Pangalan ng sumasagot sa form na ito.',
    required: true,
  })

  addChoice(form, 'Ano ang role mo sa Hacienda?',
    ['May-ari', 'Kapamilya na tumutulong sa operasyon', 'Caretaker o staff'], {
      required: true,
      other: true,
    })

  addChoice(form, 'Ang mga sagot mo ba ay final na desisyon?', [
    'Oo — aprobado ng may-ari',
    'Ako ang may-ari at ako ang nagdedesisyon',
    'Initial na sagot lang; kailangan pang kumpirmahin ng may-ari',
    'Pag-usapan muna natin',
  ], {
    required: true,
    help:
      'Mahalaga ito para malaman ng team kung puwede nang gawin ang mga sagot o kailangan pa ' +
      'ng approval bago baguhin ang system.',
  })

  form.addDateItem()
    .setTitle('Petsa ng pagsagot')
    .setIncludesYear(true)
    .setRequired(true)

  // =========================================================================
  // 2. Presyo, kasama sa rate, at deposit
  // =========================================================================
  addSection(form, '2. Presyo, kasama sa rate, at deposit',
    'Ang presyo ng isang gabi ay isang "standard stay": 2:00 PM ng pagdating hanggang 12:00 NN ' +
    'ng pag-alis. Ipinapaliwanag dito kung bawat gabi ba ang sisingilin, ilang tao ang kasama, ' +
    'at magkano ang security deposit.')

  addChoice(form, 'Tama ba ang mga published rate?', [
    'Tama lahat',
    'May babaguhin',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Kasalukuyan: Main House ₱5,000 weekday / ₱6,000 weekend-holiday, 10 guests ang kasama. ' +
      'Annex ₱4,000 / ₱5,000, 6 guests ang kasama. A-House ₱1,000 bawat unit, 3 guests ang ' +
      'kasama, 2 units ang buong estate. Bawat gabi ay isang standard stay (2:00 PM–12:00 NN).',
  })

  addParagraph(form, 'Kung may babaguhin, isulat dito', {
    required: false,
    help: 'Halimbawa: "Main House ₱5,500 simula Enero 2027". Isama kung kailan magiging epektibo.',
  })

  addChoice(form, 'Bawat gabi ba ang mga presyo (Main House ₱5,000/₱6,000; Annex ₱4,000/₱5,000; A-House ₱1,000)?', [
    'Oo — bawat gabi, isang standard stay bawat gabi, sa lahat ng accommodation',
    'Hindi — iyon ang presyo ng buong booking kahit ilang gabi',
    'Iba-iba bawat accommodation — isusulat sa susunod',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Kasalukuyang sistema: bawat gabi ay isang standard stay (2:00 PM–12:00 NN), at ang presyo ' +
      'ng gabi ay ang base rate ng accommodation. Kaya ang 3 gabing stay ay 3 × ang presyo ng ' +
      'isang gabi — pareho ito sa Main House, Annex, at A-House. Kung ang ₱5,000 ay para sa ' +
      'buong booking kahit ilang gabi, ibang-iba ang total at kailangang baguhin ang computation.',
  })

  addChoice(form, 'Ang ₱1,000 ng A-House ba ay pareho sa weekday, weekend, at holiday?', [
    'Oo — ₱1,000 sa lahat ng gabi',
    'Hindi — iba ang weekend o holiday',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Sa kasalukuyang rates, ₱1,000 ang A-House sa weekday at weekend-holiday, kaya pareho ang ' +
      'presyo kahit Sabado. Kumpirmahin kung sinasadya ito.',
  })

  addText(form, 'Sino ang nag-a-update ng holiday dates, at gaano kaaga naka-publish ang rates?', {
    required: false,
    help:
      'Halimbawa: "Ako, isang beses sa Disyembre para sa buong taon; naka-publish 3 buwan bago." ' +
      'Isama kung paano nila malalaman ang local holiday at fiesta.',
  })

  addChoice(form, 'Paano sisingilin ang bawat gabi ng stay?', [
    'Bawat gabi ang sariling rate — weekend rate lang sa weekend na gabi',
    'Buong stay sa rate ng araw ng check-in (kasalukuyang sistema)',
    'Buong stay sa pinakamataas na rate na kasama ng stay',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Halimbawa: Huwebes hanggang Sabado, 2 gabi (Huwebes at Biyernes). Sa unang opsyon: ' +
      'Huwebes = weekday ₱5,000 + Biyernes = weekend ₱6,000, total ₱11,000. Sa kasalukuyang ' +
      'sistema: parehong gabi ay rate ng Huwebes (weekday), total ₱10,000. Hindi ito tungkol sa ' +
      'Sabado — ang Sabado ay araw ng pag-alis dito, hindi isang gabi.',
  })

  addChoice(form, 'Anong mga gabi ang weekend rate?', [
    'Biyernes at Sabado (kasalukuyan)',
    'Sabado at Linggo',
    'Biyernes, Sabado, at Linggo',
    'Iba pa',
    'Pag-usapan natin',
  ], { required: true })

  addNumber(form, 'Ilang tao ang maximum na papayagan sa Main House?', {
    required: false,
    help:
      'Numero lang (halimbawa 12). Iwanang blangko kung hindi pa napagdesisyunan — iyon ang ' +
      'paraang tinatanggap ng form para sa "wala pang desisyon". Kasalukuyan: 10 ang KASAMA sa ' +
      'base rate, at wala pang hard maximum; ₱500 lang bawat sobra.',
  })

  addNumber(form, 'Ilang tao ang maximum na papayagan sa Annex?', {
    required: false,
    help:
      'Numero lang. Iwanang blangko kung hindi pa napagdesisyunan. Kasalukuyan: 6 ang kasama sa ' +
      'base rate, wala pang hard maximum.',
  })

  addNumber(form, 'Ilang tao ang maximum na papayagan sa A-House (bawat unit)?', {
    required: false,
    help:
      'Numero lang. Iwanang blangko kung hindi pa napagdesisyunan. Kasalukuyan: 3 bawat unit, at ' +
      'may 2 units ang buong estate.',
  })

  addChoice(form, 'Habang wala pang desisyon sa maximum, ano ang gagamitin ng system?', [
    'Ituring na maximum ang kasamang bilang (10 sa Main House, 6 sa Annex, 3 sa A-House)',
    'Walang maximum muna — payagan ang sobra na may ₱500 dagdag',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kailangan ito para may magamit ang website habang wala pang final na numero. Puwede itong ' +
      'palitan kapag may desisyon na.',
  })

  addText(form, 'Ano ang batayan ng maximum na ito?', {
    required: false,
    help:
      'Halimbawa: "3 kama at 1 sofa bed", "fire safety", "10 lang ang upuan sa dining". ' +
      'Mahalaga ito para alam ng team kung presyo, safety, o kaginhawahan ang basehan.',
  })

  addChoice(form, 'Ano ang tatanggapin ng website — pareho ba sa maximum na ito?', [
    'Pareho — hindi tatanggap ng higit sa maximum',
    'Mas mababa — ang Admin lang ang pwedeng mag-book ng sobra',
    'Walang limitasyon sa website',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Ang "maximum" ay patakaran ng Hacienda; ang "tinatanggap ng website" ay ang numerong ' +
      'pipigilan ng form. Puwedeng mas mababa ang website para ang Admin lang ang humawak ng ' +
      'espesyal na kaso.',
  })

  addChoice(form, 'Pwede bang lumampas sa kasamang bilang ng guest?', [
    'Oo, may dagdag na bayad bawat sobra',
    'Oo, pero kailangan ng approval ng Admin',
    'Hindi — hanggang sa kasama lang',
    'Pag-usapan natin',
  ], { required: true })

  addText(form, 'Magkano ang dagdag sa bawat extra guest?', {
    required: true,
    help:
      'Halimbawa: "Main House ₱500 bawat sobra sa 10; Annex ₱500 bawat sobra sa 6; A-House wala." ' +
      'Kung wala pang desisyon, isulat ang "Hindi pa napagdesisyunan".',
  })

  addChoice(form, 'Kasama ba ang bata at infant sa bilang ng guest, at may bayad ba sila?', [
    'Kasama lahat; walang bayad ang bata',
    'Kasama lahat; may bayad sa edad na ___ pataas',
    'Hindi kasama ang infant sa bilang',
    'Pag-usapan natin',
  ], {
    required: false,
    other: true,
    help: 'Kung may edad na hangganan, isulat sa "Iba pa".',
  })

  addText(form, 'Security deposit bawat accommodation', {
    required: false,
    help:
      'Kung wala pang desisyon, isulat ang "Hindi pa napagdesisyunan" o iwanang blangko. ' +
      'Halimbawa: "Main House ₱3,000; Annex ₱2,000; A-House ₱1,000".',
  })

  addChoice(form, 'Kailan kinokolekta ang security deposit?', [
    'Kasama ng down payment',
    'Sa check-in (cash o GCash)',
    'Hindi kinokolekta',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kailan ibinabalik ang security deposit?', [
    'Pagka-check-out pagkatapos ng inspection',
    'Within 3 araw pagkatapos ng check-out',
    'Within 7 araw pagkatapos ng check-out',
    'Hindi pa napagdesisyunan',
  ], { required: true, other: true })

  addChoice(form, 'Ano ang kailangan bago magbawas sa security deposit?', [
    'Checklist at litrato ng damage, ipapakita sa guest',
    'Checklist lang, may pirma ng guest',
    'Desisyon lang ng Admin, walang litrato',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Kapag may bawas, kailangan ng ebidensya para hindi ito maging hindi pagkakaintindihan.',
  })

  addChoice(form, 'Paano kinukuwenta ang bayad sa damage?', [
    'Aktwal na gastos sa pagpapagawa, may resibo',
    'Nakalistang presyo bawat item (halimbawa: basag na baso ₱150)',
    'Desisyon ng Admin bawat pagkakataon',
    'Pag-usapan natin',
  ], {
    required: false,
    help:
      'Kapag hindi nakalistahan ang presyo, mahirap ipaliwanag sa guest kung bakit ganoon ' +
      'ang bawas sa deposit.',
  })

  addChoice(form, 'Tama ba ang mga optional charge?', [
    'Tama lahat',
    'May babaguhin',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Kasalukuyan: pet sanitation ₱300 bawat pet; bonfire wood ₱150 bawat set; late checkout ' +
      '₱250 bawat oras pagkalipas ng 12:00 NN; wedding-preparation package ₱8,500 (hanggang 10 pax). ' +
      'Walang nakalagay na presyo sa drinking water at special events.',
  })

  addParagraph(form, 'Anong charge ang kulang, sobra, o dapat baguhin?', {
    required: false,
    help: 'Halimbawa: corkage, extra mattress, early check-in fee, shoot fee, o tanggalin ang isang charge.',
  })

  // =========================================================================
  // 3. Cancellation, refund, at bayad
  // =========================================================================
  addSection(form, '3. Cancellation, refund, at bayad',
    'Wala pang final cancellation at refund policy na kailangang kumpirmahin. Piliin ang gusto mo; ' +
    'kung hindi ka sigurado, piliin ang "Pag-usapan natin" — hindi mali ang hindi pa makapagdesisyon.')

  addChoice(form, 'Anong cancellation policy ang gusto mo?', [
    'Flexible — 100% kung 7+ araw bago; 50% kung 3–6 araw; 0% kung 0–2 araw',
    'Standard — 100% kung 15+ araw; 50% kung 7–14 araw; 25% kung 3–6 araw; 0% kung 0–2 araw',
    'Strict — 50% kung 30+ araw; 0% kung mas mababa',
    'Custom — isusulat sa susunod',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kung walang naka-publish na policy, walang refund na mai-compute ang system, kaya ' +
      'kailangan ng desisyon bago magbukas.',
  })

  addParagraph(form, 'Kung Custom, isulat ang porsyento', {
    required: false,
    help: '30+ araw: ___%  /  15–29 araw: ___%  /  7–14 araw: ___%  /  3–6 araw: ___%  /  0–2 araw: ___%',
  })

  addChoice(form, 'Ang refund percentage ay base sa ano?', [
    'Sa natanggap na down payment lang',
    'Sa lahat ng bayad na natanggap (down payment + balanse)',
    'Sa kabuuang presyo ng booking',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Halimbawa: ₱10,000 ang stay, pero ₱5,000 lang ang nabayaran, at 50% ang refund. Kung sa ' +
      'natanggap na bayad: ₱2,500. Kung sa buong presyo: ₱5,000 — doble ng una, at katumbas ng ' +
      'buong binayad, kaya walang natitira sa Hacienda. Anuman ang piliin, may itaas na hangganan: ' +
      'hindi pwedeng lumampas ang refund sa perang tunay na natanggap.',
  })

  addChoice(form, 'Kapag partial payment lang ang nabayaran at nag-cancel?', [
    'Porsyento lang ng nabayad ang ibabalik',
    'Porsyento ng buong presyo, kahit kulang ang bayad',
    'Walang refund hanggang mabuo ang down payment',
    'Case by case',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag full payment na at nag-cancel?', [
    'Pareho ng partial — porsyento lang ng nabayad',
    'Mas mataas na porsyento kapag full payment',
    'Case by case',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kasama ba ang security deposit sa refund kapag nag-cancel?', [
    'Ibabalik buo, kasama ng refund',
    'Ibabalik, pero may kaltas',
    'Hindi ibabalik kapag nag-cancel',
    'Depende sa kung kailan nag-cancel',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kailangan itong malinaw: kung kasama sa refund ang deposit pero hindi pa ito nabayad ng ' +
      'guest, mali ang compute. Kung hindi naman isinama at nabayad na, kulang ang ibinabalik.',
  })

  addChoice(form, 'Pwede bang magpalit ng petsa (reschedule)?', [
    'Oo, libre kung 15+ araw bago ang check-in',
    'Oo, may bayad',
    'Oo, pero isang beses lang',
    'Hindi pwede',
    'Case by case',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag nag-reschedule, mananatili ba ang dating presyo?', [
    'Oo — presyo sa oras ng unang booking',
    'Hindi — bagong rate sa bagong petsa',
    'Kung mas mataas ang bagong rate, iyon ang sisingilin',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag nag-cancel pagkatapos magpalit ng petsa, alin ang basehan ng refund?', [
    'Ang bagong petsa',
    'Ang orihinal na petsa',
    'Case by case',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kapag pinaikli ang stay o umalis nang maaga?', [
    'Walang refund sa hindi nagamit na gabi',
    'Refund sa hindi nagamit na gabi',
    'Case by case',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag ang Hacienda ang magkansela?', [
    'Full refund',
    'Full refund at tulong sa paghahanap ng ibang matutuluyan',
    'Libreng rebook sa ibang petsa',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag no-show?', [
    'Walang refund',
    'Security deposit lang ang ibalik',
    'Isang gabi lang ang sisingilin',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addChoice(form, 'Kapag may bagyo, baha, o lindol SA HACIENDA (hindi makakapasok o hindi safe)?', [
    'Libreng rebook',
    'Full refund',
    'Partial refund',
    'Pipiliin ng guest kung rebook o refund',
    'Case by case',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ito ang pangyayaring nakakaapekto sa mismong Hacienda o sa daan papunta rito.',
  })

  addChoice(form, 'Kapag personal na emergency ng guest (sakit, namatayan, pamilya)?', [
    'Libreng rebook',
    'Full refund',
    'Partial refund',
    'Hindi sakop — susunod sa normal na cancellation policy',
    'Case by case',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Magkaiba ito sa bagyo sa Hacienda. Karaniwang mas maluwag sa bagyo, at mas mahigpit sa ' +
      'personal na dahilan — pero desisyon ito ng may-ari, hindi ng system.',
  })

  addChoice(form, 'Kapag na-reject ang proof of payment, alin ang tama?', [
    'Kung walang natanggap na pera — walang refund, humingi ng tamang proof',
    'Kung may natanggap na pera — ibalik ito, may kaltas',
    'Kung may natanggap na pera — ibalik lahat, walang kaltas',
    'Case by case',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Magkaiba ang "hindi tunay ang proof" at "may natanggap na pera". Ang refund ay para lang sa ' +
      'perang tunay na natanggap.',
  })

  addText(form, 'Sino ang nag-a-approve ng refund, at sino ang nagre-record nito?', {
    required: true,
    help:
      'Pangalan. Kasama rin: gaano katagal bago maibalik ang pera, at paano ito nire-record ' +
      '(resibo, GCash reference, o tala lang).',
  })

  addChoice(form, 'Okay lang bang magbayad muna ang guest bago i-approve?', [
    'Oo, tuloy sa kasalukuyang paraan',
    'Hindi — approval muna bago bayad',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kasalukuyan: 50% down payment bago pa makita ng Admin ang booking, at pagkatapos ng ' +
      'approval ay kumpirmado na ang stay.',
  })

  addChoice(form, 'Ilang porsyento ng stay total ang down payment?', [
    '50% (kasalukuyan at naka-lock sa system)',
    '30%',
    '100% — full payment bago mag-stay',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Ang 50% ay naka-hardcode sa security rules; kung iba ang pipiliin, kailangan itong baguhin ' +
      'ng team sa code, hindi lang sa Admin app.',
  })

  addChecks(form, 'Anong paraan ng bayad ang tinatanggap para sa down payment?', [
    'GCash',
    'BDO',
    'Ibang bank transfer (InstaPay o PESONet)',
    'Palawan o remittance center',
    'Cash sa Hacienda',
  ], {
    required: false,
    other: true,
    help: 'Piliin lahat ng tama. Kung hindi pa napagdesisyunan, laktawan lang ang tanong na ito.',
  })

  addChecks(form, 'Anong paraan ng bayad ang tinatanggap para sa natitirang balanse sa check-in?', [
    'Cash',
    'GCash',
    'BDO',
    'Ibang bank transfer (InstaPay o PESONet)',
  ], {
    required: false,
    other: true,
    help: 'Piliin lahat ng tama. Kung hindi pa napagdesisyunan, laktawan lang ang tanong na ito.',
  })

  addChoice(form, 'Dapat bang i-record sa Admin app na natanggap na ang natitirang balanse?', [
    'Oo, kailangan — may tala kung magkano, kailan, at sino ang tumanggap',
    'Oo, pero sapat na ang simpleng "bayad na" na marka',
    'Hindi kailangan',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Sa ngayon, wala pang paraan sa Admin app para i-record na natanggap ang balanse — ' +
      'nakikita lang ang halagang dapat bayaran. Kung kailangan ng tala (para sa dispute o ' +
      'resibo), idadagdag ito ng team.',
  })

  addChoice(form, 'Ano ang proseso ng resibo o invoice para sa guest?', [
    'Walang resibo — screenshot ng GCash o bank transfer lang ang pinapadala',
    'May simpleng invoice mula sa Admin app',
    'May official receipt (BIR) — may naka-rehistrong resibo',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    other: true,
    help:
      'Kung BIR receipt, isulat sa "Iba pa" ang series o OR number at kung sino ang nag-iisyu. ' +
      'Kung wala pang desisyon, piliin lang ang "Hindi pa napagdesisyunan".',
  })

  addText(form, 'Refund sa loob ng ilang araw, at saan ibinabalik?', {
    required: false,
    help: 'Halimbawa: "5 banking days, GCash" o "Sa susunod na pagbisita, cash".',
  })

  // =========================================================================
  // 4. Kalendaryo, hold, at OTA
  // =========================================================================
  addSection(form, '4. Kalendaryo, hold, at OTA',
    'Dito nakasalalay ang double-booking, last-minute bookings, at kung gaano kabilis dapat ' +
    'mag-block ng petsa. OTA = Airbnb, Agoda, at iba pang booking site.')

  addChoice(form, 'Ilang araw bago dapat mag-book ang guest sa website?', [
    'Walang minimum — kahit same day',
    '7 araw',
    '14 araw',
    '30 araw (kasalukuyan)',
    '60 araw',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ang 30 araw ay naka-enforce ngayon sa server, kaya hindi makakapag-book ng mas malapit.',
  })

  addText(form, 'Sino ang nag-a-approve ng booking, at gaano kabilis?', {
    required: true,
    help:
      'Halimbawa: "Aida, within 12 oras, may backup si Jun sa gabi at weekend." Kasama rin kung ' +
      'paano siya abisuhan kapag may bagong booking.',
  })

  addChoice(form, 'Walk-in (dumating nang walang booking)?', [
    'Tinatanggap kung may bakante',
    'Tinatanggap pero Admin ang magbo-book sa app',
    'Hindi tinatanggap',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Short-notice online booking (halimbawa, bukas na ang check-in)?', [
    'Hindi pinapayagan ng website',
    'Pinapayagan kung may bakante',
    'Admin lang ang pwedeng gumawa',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Same-day booking (mamayang gabi ang stay)?', [
    'Hindi pinapayagan',
    'Pinapayagan kung may bakante',
    'Admin lang',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Ilang gabi ang maximum na sunod-sunod na stay?', [
    '3 gabi',
    '5 gabi',
    '7 gabi',
    '14 gabi',
    '20 gabi (kasalukuyang limitasyon)',
    'Iba pa',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Gaano kalayo sa hinaharap pwedeng mag-book?', [
    '3 buwan',
    '6 buwan',
    '1 taon',
    'Walang limitasyon',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Pwede bang magpalit ng petsa pagkatapos magbayad?', [
    'Hindi pwede',
    'Oo, kung may bakante at walang bayad',
    'Oo, may bayad',
    'Case by case',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Gaano katagal dapat naka-hold ang booking habang Pending o naghihintay ng proof?', [
    '22 oras',
    '24 oras (kasalukuyang sistema)',
    '48 oras',
    '72 oras',
    'Iba pang tagal',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Magkaiba ang 22 oras at 24 oras: 22 oras ang haba ng isang standard stay (2:00 PM–12:00 NN), ' +
      'hindi ang hold. Sa system ngayon, 24 oras ang hold mula sa pag-submit. Kung 22 oras ang ' +
      'tamang patakaran, sasabihin namin sa team na baguhin ito sa code.',
  })

  addChoice(form, 'Kailan nagsisimula ang countdown ng hold?', [
    'Pagka-submit ng booking',
    'Pagka-approve ng Admin',
    'Pagka-request ng bayad',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Kasalukuyan: mula sa pag-submit, bago pa mag-approve ang Admin.',
  })

  addChoice(form, 'Ano ang mangyayari kapag naubos ang hold?', [
    'Nag-e-expire ang booking at bumabalik ang petsa sa kalendaryo',
    'Nag-e-expire, at kailangang i-message ang guest',
    'Ipaalam sa Admin bago mag-expire',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Kasalukuyan: nag-e-expire lang — walang awtomatikong abiso sa guest o sa Admin.',
  })

  addChoice(form, 'Exclusive ba ang Main House at A-House?', [
    'Independyente — tama ang kasalukuyan',
    'Exclusive lagi — i-block ang isa kapag may booking',
    'Depende — Admin ang mag-block',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kasalukuyan: pwedeng may naka-book sa Main House at A-House sa parehong gabi. May review sa ' +
      'website na nagsasabing hindi ito pinapaupahan nang sabay — kailangan itong itama sa isang direksyon.',
  })

  addChoice(form, 'Pwede bang i-book ang dalawang A-House o ang buong estate sa isang booking?', [
    'Hindi — isang unit bawat booking (kasalukuyan)',
    'Gusto ng combined booking',
    'Admin na lang ang gagawa',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Paano i-block ang dates para sa family use, repair, o private event?', [
    'Kailangan ng block-date na button sa Admin app',
    'Okay na ang manual booking',
    'Hindi nangyayari',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kasalukuyan: ang "maintenance" na status sa Rooms ay hindi nagba-block sa website; manual ' +
      'booking lang ang paraan para hindi mabook ang isang petsa.',
  })

  addText(form, 'Sino ang nagba-block ng dates kapag may booking sa Airbnb/Agoda, at gaano kabilis?', {
    required: true,
    help: 'Halimbawa: "Si Aida, within 1 oras pagkatapos ng OTA booking." Walang automatic sync ngayon.',
  })

  addChoice(form, '(Teknikal) Anong antas ng koneksyon sa OTA ang gusto mo?', [
    'Manual lang — walang sync, tao ang nagba-block',
    'Mag-import ng OTA calendar feed papunta sa website (isang direksyon)',
    'I-publish ang availability ng Hacienda para mabasa ng OTA calendar (isang direksyon)',
    'Import at export ng calendar feed, kung sinusuportahan ng OTA',
    'Buong channel-manager integration (may bayad na third-party service)',
    'Pag-usapan natin',
  ], {
    required: false,
    help:
      'Ang calendar feed (iCal) ay HINDI real-time: umaasa ito sa pag-publish at pag-subscribe ng ' +
      'feed, at ang tagal ng pag-update ay depende sa OTA at sa configuration — walang ' +
      'garantisadong agaran ito. Hindi rin nito kayang garantiyahin na walang double booking. ' +
      'Ang manual na pag-block pa rin ang pinaka-tiyak hanggang may channel manager.',
  })

  addChoice(form, 'Kapag may conflict sa OTA at sa website, alin ang masusunod?', [
    'Ang unang nagbayad',
    'Ang website',
    'Ang OTA',
    'Case by case, Admin ang magpapasya',
    'Pag-usapan natin',
  ], { required: false })

  addText(form, 'Kapag nadoble ang booking (may dalawang guest sa isang unit), sino ang aasikaso at paano?', {
    required: true,
    help:
      'Halimbawa: "Ako ang tatawag sa guest, ililipat sa A-House kung bakante, at buong refund ' +
      'kung wala." Kasama rin kung sino ang magpapasya at gaano kabilis.',
  })

  // =========================================================================
  // 5. Guest, check-in, at patakaran sa pamamalagi
  // =========================================================================
  addSection(form, '5. Guest, check-in, at patakaran sa pamamalagi',
    'Sino ang pwedeng mag-book, ano ang kailangan sa check-in, at ano ang mga patakaran sa loob ng Hacienda.')

  addChoice(form, 'Ilang taon ang pinakabatang pwedeng maging responsible sa booking at bayad?', [
    '18 taon',
    '21 taon',
    'Pag-usapan natin',
  ], {
    required: true,
    other: true,
    help:
      'Ito ang taong pipirma sa booking at magbabayad — hindi ang edad ng bawat guest na matutulog. ' +
      'Nakalagay ngayon sa Terms at sign-up: 10 taon, na malamang typo.',
  })

  addChoice(form, 'Pwede bang may kasamang minor (wala pang 18)?', [
    'Oo, basta may kasamang responsible adult',
    'Oo, basta may nakasulat na pangalan ng guardian sa booking',
    'Hindi pinapayagan',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kailangan ba ng ID sa check-in?', [
    'Wala — hindi kailangan',
    'Titingnan lang, hindi itatala',
    'Itatala ang ID type at number (walang litrato)',
    'Kukunin ang litrato o upload ng ID',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Hindi default ang litrato o upload: ang pag-iimbak ng larawan ng ID ay may obligasyon sa ' +
      'Data Privacy Act at kailangang itago nang secure. Kung "titingnan lang" o "itatala ang ' +
      'numero", mas maliit ang risk.',
  })

  addText(form, 'Kung itatala ang ID, anong impormasyon at saan itatago, at gaano katagal?', {
    required: false,
    help:
      'Halimbawa: "Pangalan, ID type, numero — sa Admin app, 1 taon, para sa dispute." Kung wala ' +
      'pang desisyon, isulat ang "Hindi pa napagdesisyunan".',
  })

  addChoice(form, 'Tama ba ang check-in 2:00 PM at check-out 12:00 NN?', [
    'Oo, tama pareho',
    'Iba ang oras',
    'Pag-usapan natin',
  ], {
    required: true,
    other: true,
    help: 'Ang 2:00 PM–12:00 NN ang 22-oras na standard stay. Isulat sa "Iba pa" kung may babaguhin.',
  })

  addChoice(form, 'May early check-in?', [
    'Hindi',
    'Oo, may bayad',
    'Oo, libre kung bakante ang unit',
    'Pag-usapan natin',
  ], { required: false, other: true })

  addChoice(form, 'Gaano katagal ang grace period sa late checkout?', [
    'Wala — may bayad agad',
    '30 minuto',
    '1 oras',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kapag maagang dumating nang walang approval?', [
    'Hintayin sa labas o sa garden',
    'Papasukin sa garden pero hindi sa unit',
    'Papasukin sa unit kung bakante',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kapag late umalis nang walang approval?', [
    'Sisingilin ng late checkout rate',
    'Sisingilin ng isang extra night',
    'Paalalahanan lang',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'May quiet hours?', [
    'Oo — 10:00 PM hanggang 6:00 AM',
    'Oo — 11:00 PM hanggang 7:00 AM',
    'Wala',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addChoice(form, 'Smoking policy', [
    'Bawal sa lahat ng parte',
    'Sa labas lang',
    'May smoking area',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addChoice(form, 'Bawal, pinapayagan, o may approval ang events (kasal, photoshoot, party, team building)?', [
    'Bawal lahat ng events',
    'Pinapayagan kung may approval at bayad',
    'Pinapayagan kung may approval, walang dagdag na bayad',
    'Case by case',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Nasa listing ng Hacienda ang events, pero overnight stay lang ang nabobook sa website ngayon. ' +
      'Kailangan itong malinaw para hindi mag-book ang guest ng event nang hindi alam ng Admin.',
  })

  addText(form, 'Magkano ang event fee, at ano ang kasama?', {
    required: false,
    help: 'Halimbawa: "Wedding prep ₱8,500 bawat gabi, hanggang 10 pax; shoot ₱3,000 kada 4 oras."',
  })

  addChoice(form, 'Saan pinapayagan ang pets?', [
    'Lahat ng accommodation',
    'Main House lang',
    'Annex lang',
    'A-House lang',
    'Walang pets allowed kahit saan',
    'Depende sa accommodation — isusulat sa susunod',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Isang sagot lang ito para hindi magkasabay ang "pinapayagan sa Main House" at ' +
      '"bawal kahit saan".',
  })

  addParagraph(form, 'Kung "Depende", isulat kung saan pwede at saan bawal', { required: false })

  addChoice(form, 'Ang pet fee na ₱300 ay', [
    'Bawat pet, isang beses bawat stay',
    'Bawat pet, bawat gabi',
    'Bawat stay, kahit ilang pet',
    'Walang bayad',
    'Hindi pa napagdesisyunan',
  ], { required: true, other: true })

  addChoice(form, 'May limitasyon ba sa bilang o laki ng pet?', [
    'Walang limitasyon',
    'Maximum 2 pets',
    'Maximum 3 pets',
    'Maliit na aso o pusa lang',
    'Hindi pa napagdesisyunan',
  ], { required: false, other: true })

  addChoice(form, 'May dagdag bang bayad ang bata o infant?', [
    'Walang bayad ang bata',
    'May bayad sa edad na ___ pataas',
    'Depende sa accommodation',
    'Pag-usapan natin',
  ], {
    required: false,
    other: true,
    help: 'Kung may edad na hangganan, isulat sa "Iba pa".',
  })

  addChoice(form, 'Extra beds o mattress', [
    'Walang extra bed',
    'Meron, may bayad',
    'Meron, libre',
    'Pag-usapan natin',
  ], { required: false, other: true })

  addChoice(form, 'Cleaning responsibility', [
    'Clean as you go (kasalukuyan)',
    'May cleaning fee',
    'May staff na naglilinis',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Paano i-enforce ang maximum na tao?', [
    'Paalalahanan lang',
    'May multa sa sobra',
    'Hindi papasukin ang sobra',
    'Pag-usapan natin',
  ], { required: false })

  // =========================================================================
  // 6. Operasyon at access
  // =========================================================================
  addSection(form, '6. Operasyon at access',
    'Sino ang gumagawa ng ano, sino ang may access sa Admin app, at paano gagana ang pinto ' +
    'kung may smart lock. Ang mga tanong na may "(Teknikal)" ay puwedeng sagutan ng ' +
    '"Pag-usapan natin".')

  addText(form, 'Sino ang nag-aasikaso ng check-in, at sino ang tumitingin sa reklamo ng guest?', {
    required: true,
    help: 'Pangalan at paraan ng kontak. Kung magkaiba ang dalawa, isulat pareho.',
  })

  addText(form, 'Sino ang pwedeng mag-confirm ng bayad, mag-approve ng refund, at mag-override ng status?', {
    required: true,
    help: 'Pangalan. Ang "override" ay kapag kailangang baguhin ang status ng booking o kwarto nang manual.',
  })

  addText(form, 'Sino ang tatawagan kapag emergency o kapag wala ang may-ari?', {
    required: true,
    help: 'Pangalan, numero, at oras kung kailan siya available.',
  })

  addChoice(form, 'Anong oras available ang Admin para sumagot sa guest?', [
    '24 oras',
    '8:00 AM–8:00 PM',
    '8:00 AM–5:00 PM',
    'Pag-usapan natin',
  ], { required: false, other: true })

  addText(form, 'Sino-sino ang gagamit ng Admin app, at ano ang role ng bawat isa?', {
    required: true,
    help:
      'Halimbawa: "Aida — may-ari; Mark — manager; Jun — caretaker; developer — para sa support." ' +
      'Pangalan, email, at role. HUWAG isulat ang password.',
  })

  addChoice(form, 'Kailangan ba ng hiwalay na antas ng access sa Admin app?', [
    'Isa lang — lahat ng Admin ay buong access (kasalukuyan)',
    'Oo, magkaiba ang nakikita at nagagawa ng bawat role',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Kasalukuyan: isang role lang ang Admin — walang "staff" o "host". Kung kailangan ng ' +
      'hiwalay na role, idadagdag ito ng team sa code at sa security rules.',
  })

  addCheckboxGrid(
    form,
    '(Teknikal) Ano ang pwedeng gawin ng bawat role?',
    ['May-ari', 'Manager', 'Caretaker', 'Developer', 'Temporary support'],
    [
      'Aprubahan ang booking',
      'I-verify ang bayad',
      'Mag-approve ng refund',
      'Makita ang guest info',
      'Baguhin ang availability',
    ],
    {
      required: false,
      help:
        'Tsekan ang lahat ng tama sa bawat hilera. Walang tsek ang isang role ay nangangahulugang ' +
        'wala siyang permiso. Kung iisa lang ang Admin, laktawan lang ito.',
    },
  )

  addChoice(form, 'Kailangan pa ba ng access ng developer pagkatapos ng turnover?', [
    'Oo',
    'Hindi',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Kumusta ang internet sa Hacienda?', [
    'Malakas at stable',
    'Mahina o pabago-bago',
    'Walang signal sa ilang bahagi',
  ], { required: true, other: true })

  addChoice(form, 'Paano i-install at i-update ang Admin app?', [
    'APK sideload',
    'Play Store internal testing',
    'Play Store production',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'May totoong smart lock na ba?', [
    'Wala pa, at wala pang napiling brand — kailangan pang pag-aralan ng team',
    'May napiling brand pero hindi pa nakakabit',
    'Meron nang nakakabit at gumagana',
    'Hindi ko alam',
  ], {
    required: true,
    help:
      'Kasalukuyan: wala pang hardware sa system — listahan lang ng access events at simulation ang ' +
      'nasa Admin app. Kung wala pa, ang mga susunod na tanong ay para sa plano, at puwede ring ' +
      'sagutan ng "Pag-usapan natin". Ang mga sagot dito ay HINDI kumpirmasyon na kaya ng ' +
      'hardware ang offline code, awtomatikong expiry, o battery alert — kailangang suriin iyon ' +
      'sa aktwal na model bago pangakuan ang guest.',
  })

  addText(form, 'Kung may napili o nakakabit: anong brand at model, ilang pinto, at paano ang kuryente?', {
    required: false,
    help: 'Halimbawa: "Yale YRD-256, 2 pinto, 4 AA batteries kada pinto, may Wi-Fi sa gate."',
  })

  addChoice(form, '(Teknikal) Sino ang gagawa at magpapadala ng access code sa guest?', [
    'Admin app, awtomatiko',
    'Caretaker, manual',
    'May-ari',
    'Hindi pa napagdesisyunan',
  ], { required: false, other: true })

  addChoice(form, '(Teknikal) Kailan magiging active ang access code?', [
    'Sa araw ng check-in lang',
    'Isang araw bago ang check-in',
    'Pagka-approve ng booking',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, '(Teknikal) Kailan mag-e-expire ang access code?', [
    'Awtomatiko sa check-out (12:00 NN)',
    'Sa katapusan ng araw ng check-out',
    'Manual na revoke ng Admin',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, '(Teknikal) Sino ang pwedeng mag-unlock nang manual?', [
    'Admin lang',
    'Caretaker',
    'May-ari at caretaker',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, '(Teknikal) Kapag walang kuryente o internet, paano papasukin ang guest?', [
    'Backup na physical key',
    'Offline na code na gumagana pa rin',
    'Tatawagan ang caretaker',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, '(Teknikal) Kapag naubos ang battery ng lock, ano ang mangyayari?', [
    'May abiso sa Admin app bago maubos',
    'May backup na key o power port',
    'Palenkehin ang battery tuwing may check-out',
    'Pag-usapan natin',
  ], { required: false })

  addChecks(form, 'Sino ang makakatanggap ng access log at alert kapag may nabigong unlock?', [
    'May-ari',
    'Caretaker',
    'Admin sa app',
  ], {
    required: false,
    other: true,
    help: 'Piliin lahat ng tamang tao. Kung walang dapat tumanggap, laktawan lang ang tanong na ito.',
  })

  addChoice(form, 'Dapat bang ituloy ang Live Location?', [
    'Ituloy bilang opsyonal — guest ang pipili',
    'Ituloy, pero mas maikli ang tagal (halimbawa 15 minuto lang)',
    'Alisin muna — hindi kailangan sa operasyon',
    'Ipagpaliban — pag-usapan sa susunod na phase',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Hindi ito required na feature. Kung hindi naman kailangan sa operasyon, mas mabuti pang ' +
      'alisin o ipagpaliban kaysa magpanatili ng feature na may privacy na tanong.',
  })

  addChoice(form, 'Para saan gagamitin ang Live Location?', [
    'Gabay sa guest papunta sa Hacienda',
    'Safety habang naglalakbay',
    'Pag-usapan natin',
  ], { required: false, other: true })

  addChoice(form, '(Teknikal) Kailan dapat mag-umpisa at magtapos ang Live Location?', [
    'Guest ang magsisimula, may expiry na 15/30/60 minuto (kasalukuyan)',
    'Guest ang magsisimula, hanggang i-stop niya',
    'Awtomatikong magsisimula pag-alis ng guest, hanggang makarating sa Hacienda',
    'Pag-usapan natin',
  ], {
    required: false,
    help: 'Hindi nagsisimula ang sharing nang wala ang consent ng guest.',
  })

  addChoice(form, 'Sino ang makakakita ng Live Location?', [
    'Admin lang',
    'Admin at caretaker',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Anong abiso ang gusto mong matanggap ng guest pagkatapos mag-book?', [
    'Email lang',
    'SMS lang',
    'Email at SMS',
    'Wala — sapat na ang chat at Facebook',
    'Pag-usapan natin',
  ], { required: false, other: true, help: 'Kasalukuyan: wala — push notification lang sa Admin ang mayroon.' })

  addChoice(form, 'Paano hahanapin ng guest ang booking sa ibang device?', [
    'Okay lang — i-save ang reference',
    'Gusto ng lookup sa kahit anong device (reference + email)',
    'Require ng account bago mag-book',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Kasalukuyan: makikita lang sa browser na ginamit sa pag-book.',
  })

  // =========================================================================
  // 7. Privacy at go-live
  // =========================================================================
  addSection(form, '7. Privacy at go-live',
    'Ano ang ilalathala, ano ang itatago at gaano katagal, at kanino nakapangalan ang system.')

  addChoice(form, 'Pwede bang ilathala ang review ng guest sa website?', [
    'Oo',
    'Hindi',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ang review ay salita ng guest. Ang paglathala nito ay hiwalay sa paglalabas ng pangalan niya.',
  })

  addChoice(form, 'Kapag ilalathala, anong pagkakakilanlan ang puwede?', [
    'First name at buwan lang',
    'Buong pangalan',
    'Anonymous — walang pangalan',
    'Pag-usapan natin',
  ], {
    required: false,
    help: 'Kailangan ng pahintulot ng guest bago ilabas ang kahit first name.',
  })

  addChoice(form, 'Kailangan ba ng pahintulot ng guest bawat beses bago maglathala?', [
    'Oo — tanungin ang guest bago i-publish',
    'Hindi — sapat na ang checkbox sa review',
    'Pag-usapan natin',
  ], { required: true })

  addGrid(form, 'Gaano katagal itatago ang bawat uri ng record?', [
    'Booking at bayad (resibo, refund)',
    'Guest contact info (CRM)',
    'Chat messages',
    'Smart-lock access log',
    'ID record (kung meron)',
    'Live Location (posisyon ng guest)',
  ], [
    '1 taon',
    '3 taon',
    '5 taon',
    '10 taon',
    'Habang buhay',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Iba-iba ang record, kaya iba-iba rin ang tagal. Ipa-check sa accountant o abogado ang ' +
      'huling desisyon, lalo na sa financial records at Data Privacy Act.',
  })

  addText(form, 'Sino ang kokontakin para sa data privacy requests?', {
    required: true,
    help: 'Pangalan at email o numero. Ito ang ilalagay sa Privacy notice, kasama kung paano mag-request ng kopya o pagtanggal.',
  })

  addGrid(form, 'Kanino nakapangalan ang bawat account?', [
    'Domain registrar at DNS provider',
    'Firebase / Google Cloud',
    'Supabase',
    'Vercel',
    'GitHub',
  ], [
    'Hacienda (nakapangalan sa negosyo)',
    'Indibidwal — may-ari o kapamilya',
    'Indibidwal — developer o iba',
    'Hindi ko alam',
  ], {
    required: true,
    help:
      'Isa lang ang piliin bawat hilera. Tinatanong lang dito kung KANINO nakapangalan ang ' +
      'account — hindi kung sino ang may password. HUWAG ilagay ang password, recovery code, ' +
      'API key, o anumang login credential sa kahit anong sagot. Ang paglilipat ay sa official ' +
      'na "invite" o "transfer ownership" ng bawat serbisyo.',
  })

  addParagraph(form, 'Isulat ang registered owner email ng bawat account, at anong serbisyo ang wala sa listahan', {
    required: false,
    help:
      'Halimbawa: "Domain — owner@gmail.com; Firebase — hacienda@gmail.com; Vercel — ' +
      'dev@gmail.com; Supabase — wala pa." Email lang, walang password.',
  })

  addChoice(form, 'May authorized administrator access na ba ang Hacienda sa mga account?', [
    'Oo',
    'Hindi pa',
    'Pag-usapan natin',
  ], { required: true })

  form.addDateItem()
    .setTitle('Target na go-live')
    .setIncludesYear(true)
    .setRequired(false)

  addChoice(form, 'Ano ang unang bubuksan?', [
    'Isang accommodation muna',
    'Lahat agad',
    'Invitation only muna',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'May i-import bang lumang guest o booking?', [
    'Oo',
    'Wala',
    'Pag-usapan natin',
  ], { required: false, help: 'Halimbawa: mga guest mula sa Airbnb, Agoda, o Facebook.' })

  addParagraph(form, 'May iba ka pang gustong sabihin o itanong?', {
    required: false,
    help: 'Anumang hindi nasakop ng mga tanong sa itaas.',
  })
}

// ---------------------------------------------------------------------------
// Helpers — one line per question above.
// ---------------------------------------------------------------------------

/** A page/section break. */
function addSection(form, title, help) {
  var page = form.addPageBreakItem().setTitle(title)
  if (help) page.setHelpText(help)
  return page
}

/** A short-answer question. */
function addText(form, title, options) {
  options = options || {}
  var item = form.addTextItem().setTitle(title)
  if (typeof options === 'string') {
    item.setHelpText(options)
  } else {
    if (options.help) item.setHelpText(options.help)
    if (options.required) item.setRequired(true)
  }
  return item
}

/**
 * A short-answer question that only accepts digits.
 *
 * Blank is how the form records "not decided", so these stay optional: Google
 * will not accept a number AND a sentence in the same field, and forcing a
 * choice between "no answer" and "a made-up number" is worse than a blank.
 */
function addNumber(form, title, options) {
  options = options || {}
  var item = form.addTextItem().setTitle(title)
  var validation = FormApp.createTextValidation()
    .requireNumber()
    .setHelpText('Numero lang (halimbawa 12). Iwanang blangko kung hindi pa napagdesisyunan.')
    .build()
  item.setValidation(validation)
  if (options.help) item.setHelpText(options.help)
  if (options.required) item.setRequired(true)
  return item
}

/** A paragraph question. */
function addParagraph(form, title, options) {
  options = options || {}
  var item = form.addParagraphTextItem().setTitle(title)
  if (options.help) item.setHelpText(options.help)
  if (options.required) item.setRequired(true)
  return item
}

/** A single-choice question. */
function addChoice(form, title, choices, options) {
  options = options || {}
  var item = form.addMultipleChoiceItem().setTitle(title).setChoiceValues(choices)
  if (options.help) item.setHelpText(options.help)
  if (options.required !== false) item.setRequired(true)
  if (options.other) item.showOtherOption(true)
  return item
}

/** A multiple-answer question. Never carries an "undecided" option. */
function addChecks(form, title, choices, options) {
  options = options || {}
  var item = form.addCheckboxItem().setTitle(title).setChoiceValues(choices)
  if (options.help) item.setHelpText(options.help)
  if (options.required !== false) item.setRequired(true)
  if (options.other) item.showOtherOption(true)
  return item
}

/** A one-answer-per-row grid — used where the same period options apply to many records. */
function addGrid(form, title, rows, columns, options) {
  options = options || {}
  var item = form.addGridItem().setTitle(title).setRows(rows).setColumns(columns)
  if (options.help) item.setHelpText(options.help)
  if (options.required !== false) item.setRequired(true)
  return item
}

/** A tick-every-applicable grid — used for role permissions. */
function addCheckboxGrid(form, title, rows, columns, options) {
  options = options || {}
  var item = form.addCheckboxGridItem().setTitle(title).setRows(rows).setColumns(columns)
  if (options.help) item.setHelpText(options.help)
  if (options.required !== false) item.setRequired(true)
  return item
}
