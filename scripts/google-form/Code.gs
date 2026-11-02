/**
 * Hacienda de LuisAna — Client Decisions form builder
 * ---------------------------------------------------------------------------
 * Google Forms has no file format to import, so this script builds the form
 * for you: every section, question, choice and help text below becomes a real
 * Google Form owned by the account that runs it, plus a linked spreadsheet for
 * the answers.
 *
 * HOW TO RUN (about 3 minutes)
 *   1. Open https://script.google.com and click "New project".
 *   2. Delete the sample code, paste this whole file, and press Save.
 *   3. In the toolbar choose the function `createClientForm`, then Run.
 *   4. Approve the permissions (Forms + Sheets). If Google says the app is not
 *      verified: Advanced -> Go to project (unsafe) -> Allow. It is your own
 *      script; the only scopes it needs are Forms and Sheets.
 *   5. Open View -> Execution log. It prints the form link, the edit link and
 *      the response spreadsheet.
 *
 * RUNNING IT AGAIN
 *   `createClientForm` remembers the form it made and refuses to make a second
 *   one by accident. `createClientFormAgain` builds a fresh copy and leaves the
 *   old form (and its answers) untouched.
 *
 * EDITING THE QUESTIONS
 *   Everything is in buildForm(). Add, remove or reword a question there and
 *   run `createClientFormAgain`. Questions marked `true` are required; the ones
 *   marked `false` are optional and are the first to delete if the form feels
 *   long.
 * ---------------------------------------------------------------------------
 */

/** Title shown at the top of the form. */
var FORM_TITLE = 'Hacienda de LuisAna — Mga Desisyon ng May-ari'

/** Name of the spreadsheet that will hold the answers. */
var SHEET_TITLE = 'Hacienda de LuisAna — Client Answers'

/** Where the created form's id is remembered between runs. */
var PROPERTY_KEY = 'HDL_CLIENT_FORM_ID'

/**
 * Creates the form once. If one was already created by this script, it just
 * prints the existing links instead of making a duplicate.
 */
function createClientForm() {
  var props = PropertiesService.getScriptProperties()
  var existingId = props.getProperty(PROPERTY_KEY)

  if (existingId) {
    try {
      var existing = FormApp.openById(existingId)
      Logger.log('May form na — hindi na gumawa ng bago.')
      Logger.log('Sagutan: ' + existing.getPublishedUrl())
      Logger.log('I-edit:  ' + existing.getEditUrl())
      Logger.log('Kung gusto mo talaga ng bagong form, patakbuhin ang createClientFormAgain().')
      return
    } catch (err) {
      props.deleteProperty(PROPERTY_KEY)
    }
  }

  return buildForm()
}

/**
 * Builds a new form even if one already exists. The old form and its answers
 * are left alone.
 */
function createClientFormAgain() {
  return buildForm()
}

/**
 * Writes the links of the form this script created last.
 */
function showClientFormLinks() {
  var props = PropertiesService.getScriptProperties()
  var id = props.getProperty(PROPERTY_KEY)
  if (!id) {
    Logger.log('Wala pang form. Patakbuhin muna ang createClientForm().')
    return
  }
  var form = FormApp.openById(id)
  Logger.log('Sagutan: ' + form.getPublishedUrl())
  Logger.log('I-edit:  ' + form.getEditUrl())
}

function buildForm() {
  var form = FormApp.create(FORM_TITLE)

  form.setDescription(
    'Para sa mga desisyon na kailangan ng Hacienda de LuisAna booking system. ' +
    'Mga 15 minuto. Sagutin ang alam mo lang — kung hindi ka sigurado, piliin ang ' +
    '"Pag-usapan natin", isulat ang "Hindi pa sigurado", o iwanan ang mga tanong na walang asterisk (*). ' +
    'Ang mga sagot dito ang magiging basehan ng huling ayos ng system bago ito buksan sa mga guest.'
  )
  form.setConfirmationMessage(
    'Salamat! Nai-record na ang mga sagot. Kung may babaguhin ka, i-message lang ang team ' +
    'o sagutan muli ang form gamit ang parehong link.'
  )
  form.setCollectEmail(false)
  form.setProgressBar(true)
  form.setShuffleQuestions(false)

  // -------------------------------------------------------------------------
  // 0. Bago magsimula
  // -------------------------------------------------------------------------
  addText(form, 'Pangalan mo', { help: 'Sino ang sumasagot sa form na ito.', required: true })

  addChoice(form, 'Ano ang role mo sa Hacienda?',
    ['May-ari', 'Kapamilya na tumutulong sa operasyon', 'Caretaker / staff'], {
      required: true,
      other: true,
    })

  form.addDateItem()
    .setTitle('Petsa ng pagsagot')
    .setIncludesYear(true)
    .setRequired(true)

  // -------------------------------------------------------------------------
  // 1. Presyo, tao, at deposit
  // -------------------------------------------------------------------------
  addSection(form, '1. Presyo, tao, at deposit',
    'Mga 4 na minuto. Ang mga numerong ito ang gagamitin sa lahat ng quote sa website.')

  addChoice(form, 'Tama ba ang mga published rate?', [
    'Tama lahat',
    'May babaguhin',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Main House: ₱5,000 weekday / ₱6,000 weekend-holiday, hanggang 10 tao, ' +
      '+₱500 bawat dagdag. Annex: ₱4,000 / ₱5,000, hanggang 6. ' +
      'A-House: ₱1,000 bawat unit, hanggang 3 bawat unit.',
  })

  addParagraph(form, 'Kung may babaguhin, isulat dito', {
    help: 'Halimbawa: Main House ₱5,500 simula Enero 2027. Isama ang petsa kung kailan magiging epektibo.',
    required: false,
  })

  addChoice(form, 'Paano sisingilin ang weekend at holiday?', [
    'Buong stay sa rate ng araw ng check-in (ngayon)',
    'Bawat gabi ang sariling rate',
    'Iba pa — ipaliwanag sa susunod',
  ], {
    required: true,
    help:
      'Ngayon: ang rate ng check-in day ang sinusunod ng lahat ng gabi. ' +
      'Halimbawa: Biyernes hanggang Linggo, 2 gabi = 2 × weekend rate.',
  })

  addParagraph(form, 'Kung "Iba pa", ipaliwanag', { required: false })

  addParagraph(form, 'Mga holiday date na dapat weekend rate (2026–2027)', {
    help: 'Halimbawa: Disyembre 24, 25, 30, 31; Holy Week; fiesta ng Luisiana. Pwede ring iwanang blangko at ipaubaya sa Admin app.',
    required: false,
  })

  addParagraph(form, 'Maximum na tao bawat accommodation', {
    required: true,
    help:
      'Ngayon: walang hard cap ang Main House at Annex — ₱500 lang bawat sobra sa 10 at 6. ' +
      'A-House: 3 bawat unit. Isulat: Main House ___ / Annex ___ / A-House ___',
  })

  addChoice(form, 'Kasama ba sa bilang ng guest ang bata at pets?', [
    'Bata lang',
    'Bata at pets',
    'Hindi — adults lang',
    'Iba pa',
  ], { required: true, other: true })

  addParagraph(form, 'Security deposit bawat accommodation', {
    required: true,
    help:
      'Walang naka-set na halaga ngayon. Hiwalay ito sa amount na ipinapadala ng guest sa website. ' +
      'Isulat: Main House ₱___ / Annex ₱___ / A-House ₱___',
  })

  addChoice(form, 'Kailan kinokolekta ang security deposit?', [
    'Kasama ng down payment',
    'Sa check-in (cash o GCash)',
    'Hindi kinokolekta',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kailan ibinabalik ang security deposit?', [
    'Pagka-check-out, pagkatapos ng inspection',
    'Within 3 araw pagkatapos ng check-out',
    'Within 7 araw pagkatapos ng check-out',
    'Iba pa',
  ], {
    required: true,
    other: true,
    help: 'Kung may bawas para sa damage, isulat sa "Iba pa" ang rule.',
  })

  // -------------------------------------------------------------------------
  // 2. Cancellation, refund, at bayad
  // -------------------------------------------------------------------------
  addSection(form, '2. Cancellation, refund, at bayad',
    'Mga 4 na minuto. Kung walang naka-publish na policy, ₱0 ang refund sa cancellation — ito ang pinakamahalagang sagot sa seksyong ito.')

  addChoice(form, 'Anong cancellation policy ang gusto mo?', [
    'Flexible — 100% kung 7+ araw bago; 50% kung 3–6 araw; 0% kung 0–2 araw',
    'Standard — 100% kung 15+ araw; 50% kung 7–14 araw; 25% kung 3–6 araw; 0% kung 0–2 araw',
    'Strict — 50% kung 30+ araw; 0% kung mas mababa',
    'Custom — isusulat sa susunod',
    'Pag-usapan natin',
  ], { required: true })

  addParagraph(form, 'Kung Custom, isulat ang porsyento', {
    help: '30+ araw: ___%  /  15–29 araw: ___%  /  7–14 araw: ___%  /  3–6 araw: ___%  /  0–2 araw: ___%',
    required: false,
  })

  addChoice(form, 'Kapag no-show?', [
    'Walang refund',
    'Security deposit lang ang ibalik',
    'Iba pa',
  ], { required: true, other: true })

  addChoice(form, 'Kapag bagyo o force majeure?', [
    'Libreng rebook',
    'Full refund',
    'Iba pa',
  ], { required: true, other: true })

  addText(form, 'Refund sa loob ng ilang araw, at saan?', {
    required: true,
    help: 'Halimbawa: 5 araw, GCash. Kung cash, isulat kung saan ibinibigay.',
  })

  addChoice(form, 'Okay lang bang magbayad muna ang guest bago i-approve?', [
    'Oo, tuloy sa ngayon',
    'Hindi — approval muna bago bayad',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Ngayon: 50% down payment bago pa makita ng Admin ang booking, at ang 50% ay fixed sa system ' +
      '(kailangan ng code change kung ibang porsyento).',
  })

  addChoice(form, 'Kapag na-reject ang proof, paano ibabalik ang pera?', [
    'Full refund, lagi',
    'May kaltas',
    'Case by case',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ngayon: walang refund record kapag Rejected — manual na pagbabalik ang nangyayari.',
  })

  addChecks(form, 'Paano kinokolekta ang natitirang 50% sa check-in?', [
    'Cash',
    'GCash',
    'BDO',
    'Iba pa',
  ], { required: true, other: true })

  addChoice(form, 'Kailangan ba ng official receipt (BIR)?', [
    'Oo',
    'Hindi',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Tama ba ang extra charges?', [
    'Tama lahat',
    'May babaguhin',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Pet ₱300 bawat pet; bonfire wood ₱150 bawat set; late checkout ₱250 bawat oras; ' +
      'wedding package ₱8,500 (hanggang 10 pax).',
  })

  addParagraph(form, 'Kung may babaguhin o idadagdag', {
    help: 'Halimbawa: corkage, extra mattress, early check-in, shoot fee, o pag-alis ng isang charge.',
    required: false,
  })

  // -------------------------------------------------------------------------
  // 3. Kalendaryo at availability
  // -------------------------------------------------------------------------
  addSection(form, '3. Kalendaryo at availability',
    'Mga 3 minuto. Dito nakasalalay ang double-booking at ang last-minute bookings.')

  addText(form, 'Ilang araw bago dapat mag-book ang guest?', {
    required: true,
    help: 'Ngayon: 30 araw. Pwedeng baguhin sa Admin app nang walang deploy, pero kailangan ng desisyon.',
  })

  addChoice(form, 'Last-minute at walk-in', [
    'Tinatanggap; Admin ang magbo-book',
    'Buksan ang website kahit ilang araw bago',
    'Hindi tinatanggap',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addParagraph(form, 'Sino ang nag-a-approve ng booking, at gaano kabilis?', {
    required: true,
    help: 'Halimbawa: Aida, within 12 oras, may backup si ___ sa gabi at weekend.',
  })

  addChoice(form, 'Gaano katagal dapat hawakan ang petsa habang Pending?', [
    '24 oras (ngayon)',
    '48 oras',
    '72 oras',
    'Iba pa',
  ], { required: true, other: true })

  addChoice(form, 'Exclusive ba ang Main House at A-House?', [
    'Independyente — tama ang ngayon',
    'Exclusive lagi — i-block ang isa kapag may booking',
    'Depende — Admin ang mag-block',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Independyente ngayon: pwedeng may naka-book sa Main House at A-House sa parehong gabi. ' +
      'May review sa website na nagsasabing hindi ito pinapaupahan nang sabay.',
  })

  addChoice(form, 'Pwede bang i-book ang dalawang A-House o ang buong estate sa isang booking?', [
    'Hindi — isang unit per booking (ngayon)',
    'Gusto ng combined booking',
    'Admin na lang ang gagawa',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Paano i-block ang dates para sa family use, repair, o private event?', [
    'Kailangan ng block-date button',
    'Okay na ang manual booking',
    'Hindi nangyayari',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ngayon: ang Rooms status (maintenance) ay hindi nagba-block sa website. Manual booking lang ang paraan.',
  })

  addParagraph(form, 'Sino ang nagba-block ng dates dito kapag may booking sa Airbnb/Agoda, at gaano kabilis?', {
    required: true,
    help: 'Walang automatic sync ngayon. Halimbawa: "Si Aida, within 1 oras pagkatapos ng OTA booking."',
  })

  addChoice(form, 'Gusto ba ng automatic sync sa Airbnb/Agoda?', [
    'Hindi',
    'Oo, import lang (OTA papunta sa website)',
    'Oo, import at export',
    'Pag-usapan natin',
  ], { required: true })

  // -------------------------------------------------------------------------
  // 4. Guest, ID, at abiso
  // -------------------------------------------------------------------------
  addSection(form, '4. Guest, ID, at abiso',
    'Mga 2 minuto. Tungkol sa pagtanggap at pag-abiso sa guest.')

  addChoice(form, 'Kailangan ba ng ID sa check-in?', [
    'Wala',
    'Itatala lang ang ID number (walang picture)',
    'Picture o upload ng ID',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Wala nang ID verification sa system. Kung ID ang gusto, ang ligtas na paraan ay itala lang ' +
      'ang numero — ang pag-iimbak ng picture ay may Data Privacy Act na obligasyon.',
  })

  addChoice(form, 'Minimum age na pwedeng mag-book?', [
    '18',
    '21',
    'Iba pa',
  ], {
    required: true,
    other: true,
    help: 'Nakalagay ngayon sa Terms at sign-up: 10 taong gulang — malamang typo.',
  })

  addChecks(form, 'Saan pwedeng mag-pet?', [
    'Main House',
    'Annex',
    'A-House',
    'Hindi allowed sa lahat',
  ], { required: true, other: true })

  addChoice(form, 'Ang pet fee ay', [
    'Bawat stay',
    'Bawat gabi',
    'Iba pa',
  ], { required: true, other: true, help: 'Ngayon: ₱300 bawat pet, isang beses kada stay.' })

  addChecks(form, 'Anong abiso ang gusto mong matanggap ng guest pagkatapos mag-book?', [
    'Email confirmation',
    'SMS',
    'Wala — sapat na ang chat at Facebook',
    'Iba pa',
  ], {
    required: true,
    other: true,
    help: 'Ngayon: wala — push notification lang sa Admin ang mayroon.',
  })

  addChoice(form, 'Paano hahanapin ng guest ang booking sa ibang device?', [
    'Okay lang — i-save ang reference',
    'Gusto ng lookup sa kahit anong device (reference + email)',
    'Require ng account bago mag-book',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Ngayon: makikita lang sa browser na ginamit sa pag-book.',
  })

  addChoice(form, 'Events, shoot, at day use', [
    'Manual lang (ngayon)',
    'Gusto ng online booking',
    'Pag-usapan natin',
  ], { required: true })

  // -------------------------------------------------------------------------
  // 5. Admin, access, at privacy
  // -------------------------------------------------------------------------
  addSection(form, '5. Admin, access, at privacy',
    'Mga 2 minuto. Sino ang may access, paano i-install ang app, at ano ang gagamitin.')

  addParagraph(form, 'Sino-sino ang gagamit ng Admin app?', {
    required: true,
    help:
      'Pangalan at email ng bawat isa. Lahat ng Admin ay may buong access: revenue, refunds, ' +
      'guest data, at chat.',
  })

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

  addChoice(form, 'Pwede bang ilathala sa website ang review na may first name?', [
    'Oo, magtanong muna sa guest',
    'Oo, first name at buwan lang',
    'Hindi',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'May totoong smart lock na ba?', [
    'Wala pa',
    'Meron na',
    'Nakaplano pa lang',
    'Hindi ko alam',
  ], {
    required: true,
    help: 'Wala pang hardware sa system; access log at simulation lang ang nasa Admin app.',
  })

  addParagraph(form, 'Kung meron: brand, ilang pinto, kuryente, Wi-Fi', {
    required: false,
    help: 'Halimbawa: "Yale smart lock, 1 pinto, 4 AA batteries, may Wi-Fi sa gate."',
  })

  addChoice(form, 'Gagamitin ba ang Live Location?', [
    'Oo',
    'Hindi',
    'Paminsan-minsan lang',
    'Pag-usapan natin',
  ], {
    required: true,
    help: '15, 30, o 60 minuto, may consent ang guest. Walang naka-save na ruta.',
  })

  addText(form, 'Sino ang kokontakin para sa data privacy requests?', {
    required: true,
    help: 'Pangalan at email o numero. Ito ang ilalagay sa Privacy notice.',
  })

  addChoice(form, 'Gaano katagal itatago ang booking at guest records?', [
    'Forever',
    '2 taon',
    '5 taon',
    'Iba pa',
  ], { required: true, other: true })

  // -------------------------------------------------------------------------
  // 6. Accounts at go-live
  // -------------------------------------------------------------------------
  addSection(form, '6. Accounts at go-live',
    'Huling bahagi. Sino ang may-ari ng system, at kailan ito bubuksan.')

  addParagraph(form, 'Kanino nakapangalan ang domain, Firebase, Cloudflare, at GitHub?', {
    required: true,
    help:
      'Kung sa student account nakapangalan, kailangan ng transfer bago mag-hiwalay ng team. ' +
      'Isama kung sino ang may password sa bawat isa.',
  })

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

  // -------------------------------------------------------------------------
  // Answers sheet
  // -------------------------------------------------------------------------
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  var sheet = SpreadsheetApp.create(SHEET_TITLE + ' — ' + stamp)
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId())

  PropertiesService.getScriptProperties().setProperty(PROPERTY_KEY, form.getId())

  Logger.log('=== READY ===')
  Logger.log('Sagutan:  ' + form.getPublishedUrl())
  Logger.log('I-edit:   ' + form.getEditUrl())
  Logger.log('Responses: ' + sheet.getUrl())

  return {
    formUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    sheetUrl: sheet.getUrl(),
  }
}

// ---------------------------------------------------------------------------
// Small helpers — one line per question in buildForm() above.
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

/** A multiple-answer (checkbox) question. */
function addChecks(form, title, choices, options) {
  options = options || {}
  var item = form.addCheckboxItem().setTitle(title).setChoiceValues(choices)
  if (options.help) item.setHelpText(options.help)
  if (options.required !== false) item.setRequired(true)
  if (options.other) item.showOtherOption(true)
  return item
}
