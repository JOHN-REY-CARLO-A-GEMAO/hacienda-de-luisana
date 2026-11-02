/**
 * Hacienda de LuisAna — Client Decisions form, VERSION 2 (revised)
 * ---------------------------------------------------------------------------
 * Builds the owner's questionnaire. Version 1 (../Code.gs) is kept unchanged
 * for history. This revision answers the second review of v2:
 *
 *   Money and calendar
 *   - The rate is described as ONE STANDARD STAY PER NIGHT, and a separate
 *     question asks whether the figure is per night or per booking. The broken
 *     Friday-to-Sunday example is replaced with a Thursday-to-Saturday one that
 *     actually distinguishes the two pricing models, and a direct question asks
 *     how many weekend nights a Friday-to-Sunday booking charges.
 *   - Maximum occupancy is a short-answer number per accommodation, with a
 *     place to explain the basis, instead of a menu of preset capacities.
 *   - Cancellation now asks about the security deposit, partial payment, a
 *     rescheduled booking's price, cancelling after a reschedule, and who
 *     approves and records a refund.
 *   - Force majeure is split: a typhoon at the property and a guest's personal
 *     emergency are asked separately, because they can be treated differently.
 *
 *   Guest eligibility and operations
 *   - Minimum age of the person responsible for the booking, minors travelling
 *     with a guardian, and whether ID is required at check-in (inspect only,
 *     record the number, or photograph — with the privacy cost stated).
 *   - Whether the Admin app must record that the balance was received.
 *   - Who resolves a booking that was double-sold, and how the guest is
 *     refunded.
 *   - Smart-lock hardware, battery failure, offline capability, and an explicit
 *     "no lock chosen yet" answer.
 *   - Admin permissions asked as a grid: what each role may do.
 *   - Live Location can be removed, kept optional, or deferred.
 *
 *   Contradictory answers
 *   - No checkbox carries an "undecided" or "nobody" option any more. Those
 *     were free to be ticked alongside a real answer, so the checkboxes are now
 *     plain lists, optional, and an unanswered checkbox means "not decided".
 *
 *   The script itself
 *   - A failed FormApp.openById no longer deletes the saved record, which used
 *     to create a duplicate form on the next run. It logs and stops.
 *   - The form id is saved immediately after creation and rewritten on every
 *     step, so a failed build leaves a record saying exactly what exists.
 *   - A failed build is not silently retried: the next run refuses to make a
 *     second form until forgetClientFormV2() clears the record.
 *
 * HOW TO RUN (about 3 minutes)
 *   1. Open https://script.google.com and click "New project".
 *   2. Delete the sample code, paste this whole file, and press Save.
 *   3. Choose the function `createClientFormV2`, then Run.
 *   4. Approve the permissions. Google shows the exact list on its own consent
 *      screen — read it there rather than trusting this comment. The script uses
 *      Google Forms (create the form), Google Sheets (create the answer sheet)
 *      and the script's own properties (remember the form it made).
 *   5. View -> Execution log prints the form link, the edit link and the
 *      response spreadsheet.
 *
 * BEFORE SENDING IT
 *   Fill the form in once yourself with dummy answers, confirm the sheet
 *   receives them, then clear the dummy response. See ../README.md.
 * ---------------------------------------------------------------------------
 */

var FORM_TITLE = 'Hacienda de LuisAna — Mga Desisyon ng May-ari (v2)'
var SHEET_TITLE = 'Hacienda de LuisAna — Client Answers (v2)'
var STATE_KEY = 'HDL_CLIENT_FORM_V2_STATE'

/** Creates the form once. Never makes a second one by accident. */
function createClientFormV2() {
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
      Logger.log('Para sa bagong kopya, patakbuhin ang createClientFormV2Again().')
    } else {
      Logger.log('HINDI KUMPLETO ang form na ito (status: ' + state.status + ').')
      Logger.log('I-delete ito sa Drive, patakbuhin ang forgetClientFormV2(), at saka ulitin.')
    }
    return state
  }

  return buildFormV2()
}

/** Builds a new form even if one exists. Older forms and answers are untouched. */
function createClientFormV2Again() {
  return buildFormV2()
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
  var state = readState()
  if (!state) {
    Logger.log('Walang naka-save na record. Wala ring binago.')
    return
  }
  logLinks(state)
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY)
  Logger.log('Natanggal ang record. Manu-manong i-delete sa Drive ang form at sheet sa itaas,')
  Logger.log('at saka patakbuhin muli ang createClientFormV2().')
}

function readState() {
  var raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (err) {
    Logger.log('May naka-save na record pero hindi ito mabasa: ' + err)
    return { formId: '', status: 'unreadable' }
  }
}

function saveState(state) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(state))
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
  saveState(state)

  try {
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
    saveState(state)
    Logger.log('NABIGO ang paggawa ng form: ' + err)
    logLinks(state)
    Logger.log('Ayusin ang error. Kung hindi na kailangan ang kalahating form na ito,')
    Logger.log('patakbuhin ang forgetClientFormV2() at i-delete ito sa Drive.')
    throw err
  }

  Logger.log('=== READY ===')
  logLinks(state)
  return state
}

function buildQuestionsV2(form) {
  form.setDescription(
    'Para sa mga desisyong kailangan ng Hacienda de LuisAna booking system. ' +
    'Mga 40–50 minuto; puwedeng sagutan nang paunti-unti at balikan gamit ang parehong link. ' +
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
    '• Security deposit — perang hawak muna ng Hacienda at ibinabalik pagkatapos ng stay ' +
    'kung walang damage; hiwalay ito sa bayad sa stay.\n' +
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

  addChoice(form, 'Bawat gabi ba ang ₱5,000 (Main House) at ₱6,000 (weekend)?', [
    'Oo — bawat gabi, isang standard stay bawat gabi',
    'Hindi — iyon ang presyo ng buong booking kahit ilang gabi',
    'Iba pa',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Kasalukuyang sistema: bawat gabi ay isang standard stay (2:00 PM–12:00 NN), at ang presyo ' +
      'ng gabi ay ang base rate ng accommodation. Kaya ang 3 gabing stay ay 3 × ang presyo ng ' +
      'isang gabi. Kung ang ₱5,000 ay para sa buong booking kahit ilang gabi, ibang-iba ang ' +
      'total at kailangang baguhin ang computation.',
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

  addChoice(form, 'Biyernes hanggang Linggo (2 gabi: Biyernes at Sabado) — ilang gabi ang weekend rate?', [
    '2 gabi — pareho, dahil Biyernes at Sabado ay weekend (kasalukuyan)',
    '1 gabi — Biyernes lang',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Sa kasalukuyang sistema, 2 gabi ang siningil sa weekend rate dahil ang rate ng ' +
      'check-in night ang sinusunod ng lahat ng gabi. Sa "per-night" na modelo, 2 gabi pa rin ' +
      'dahil weekend ang Biyernes at ang Sabado. Malinaw lang dapat kung alin ang tamang intindi.',
  })

  addText(form, 'Ilang tao ang maximum na papayagan sa Main House?', {
    required: true,
    help:
      'Bilang lang. Kasalukuyan: 10 ang KASAMA sa base rate, at wala pang hard maximum — ' +
      '₱500 lang bawat sobra. Isulat ang numero (halimbawa 12), o "Hindi pa napagdesisyunan".',
  })

  addText(form, 'Ilang tao ang maximum na papayagan sa Annex?', {
    required: true,
    help:
      'Bilang lang. Kasalukuyan: 6 ang kasama sa base rate, wala pang hard maximum. ' +
      'Isulat ang numero, o "Hindi pa napagdesisyunan".',
  })

  addText(form, 'Ilang tao ang maximum na papayagan sa A-House (bawat unit)?', {
    required: true,
    help:
      'Bilang lang. Kasalukuyan: 3 bawat unit, at may 2 units ang buong estate. ' +
      'Isulat ang numero, o "Hindi pa napagdesisyunan".',
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
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
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
    'Iba pa',
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
    required: true,
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
      'Halimbawa: ₱10,000 ang stay, ₱5,000 ang nabayaran, 50% ang refund. Natanggap lang: ₱2,500. ' +
      'Buong presyo: ₱5,000 — mas malaki kaysa sa binayad, kaya bihirang tama ito. Kailangan ' +
      'itong malinaw para hindi mali ang compute ng system.',
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
  ], { required: true })

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
  ], { required: true })

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
    'Iba pa',
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

  addChoice(form, 'Kailangan ba ng official receipt (BIR)?', [
    'Oo',
    'Hindi',
    'Pag-usapan natin',
  ], { required: true })

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
    required: true,
    help:
      'Ang calendar feed (iCal) ay HINDI real-time: umaasa ito sa pag-publish at pag-subscribe ng ' +
      'feed, may delay na 15 minuto hanggang ilang oras depende sa OTA, at hindi nito kayang ' +
      'garantiyahin na walang double booking. Ang manual na pag-block pa rin ang pinaka-tiyak ' +
      'hanggang may channel manager.',
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
    'Iba pa',
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
  ], { required: true })

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
  ], { required: true, other: true })

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
    'Iba pa',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addChoice(form, 'Smoking policy', [
    'Bawal sa lahat ng parte',
    'Sa labas lang',
    'May smoking area',
    'Iba pa',
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
    'Iba pa',
    'Hindi pa napagdesisyunan',
  ], { required: true, other: true })

  addChoice(form, 'May limitasyon ba sa bilang o laki ng pet?', [
    'Walang limitasyon',
    'Maximum 2 pets',
    'Maximum 3 pets',
    'Maliit na aso o pusa lang',
    'Iba pa',
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
  ], { required: true, other: true })

  addChoice(form, 'Cleaning responsibility', [
    'Clean as you go (kasalukuyan)',
    'May cleaning fee',
    'May staff na naglilinis',
    'Pag-usapan natin',
  ], { required: true })

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
    'Iba pa',
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
      'Wala sa lahat',
    ],
    {
      required: false,
      help: 'Tsekan ang lahat ng tama sa bawat hilera. Kung iisa lang ang Admin, laktawan lang ito.',
    },
  )

  addChoice(form, 'Kailangan pa ba ng access ng developer pagkatapos ng turnover?', [
    'Oo',
    'Hindi',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kumusta ang internet sa Hacienda?', [
    'Malakas at stable',
    'Mahina o pabago-bago',
    'Walang signal sa ilang bahagi',
    'Iba pa',
  ], { required: true, other: true })

  addChoice(form, 'Paano i-install at i-update ang Admin app?', [
    'APK sideload',
    'Play Store internal testing',
    'Play Store production',
    'Pag-usapan natin',
  ], { required: true })

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
      'sagutan ng "Pag-usapan natin".',
  })

  addText(form, 'Kung may napili o nakakabit: anong brand at model, ilang pinto, at paano ang kuryente?', {
    required: false,
    help: 'Halimbawa: "Yale YRD-256, 2 pinto, 4 AA batteries kada pinto, may Wi-Fi sa gate."',
  })

  addChoice(form, '(Teknikal) Sino ang gagawa at magpapadala ng access code sa guest?', [
    'Admin app, awtomatiko',
    'Caretaker, manual',
    'May-ari',
    'Iba pa',
    'Hindi pa napagdesisyunan',
  ], { required: true, other: true })

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
    'Iba pa',
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
    'Iba pa',
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
    required: true,
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

  addText(form, 'Kanino nakapangalan ang domain, Firebase, Cloudflare, at GitHub?', {
    required: true,
    help:
      'Isulat kung kanino nakapangalan ang bawat account, ang registered owner email, at kung may ' +
      'authorized administrator access na ang Hacienda. HUWAG ilagay ang password, recovery code, ' +
      'API key, o anumang login credential sa form na ito. Ang paglilipat ay sa official na ' +
      '"invite" o "transfer ownership" ng bawat serbisyo.',
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
  ], { required: true })

  addChoice(form, 'May i-import bang lumang guest o booking?', [
    'Oo',
    'Wala',
    'Pag-usapan natin',
  ], { required: true, help: 'Halimbawa: mga guest mula sa Airbnb, Agoda, o Facebook.' })

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
