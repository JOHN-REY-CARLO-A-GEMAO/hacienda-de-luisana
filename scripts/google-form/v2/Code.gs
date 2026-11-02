/**
 * Hacienda de LuisAna — Client Decisions form, VERSION 2
 * ---------------------------------------------------------------------------
 * Builds the owner's questionnaire. Version 1 (../Code.gs) is kept unchanged
 * for history; this file is the one to send. It differs from v1 in five ways
 * the review asked for:
 *
 *   1. It never asks for a password, recovery code, API key or any other login
 *      credential, and says so on the form itself.
 *   2. Included guests, maximum occupancy and the extra-guest charge are three
 *      separate questions, so "10 included" is no longer read as "10 maximum".
 *   3. The cancellation section asks the owner to choose a policy instead of
 *      telling her that silence already means "no refund".
 *   4. The pet question is a single choice, so "Main House" and "not allowed
 *      anywhere" can no longer both be ticked.
 *   5. It adds the rules v1 left out: check-in and check-out, quiet hours,
 *      same-day bookings, date changes, who handles what, and how a smart lock
 *      would be operated if one is installed.
 *
 * HOW TO RUN (about 3 minutes)
 *   1. Open https://script.google.com and click "New project".
 *   2. Delete the sample code, paste this whole file, and press Save.
 *   3. Choose the function `createClientFormV2`, then Run.
 *   4. Approve the permissions (Forms + Sheets). If Google warns that the app is
 *      unverified: Advanced -> Go to project (unsafe) -> Allow. It is your own
 *      script, and its only scopes are Forms and Sheets.
 *   5. View -> Execution log prints the form link, the edit link and the
 *      response spreadsheet.
 *
 * RUNNING IT AGAIN
 *   `createClientFormV2` remembers the form it made and prints the existing
 *   links rather than making a second one. `createClientFormV2Again` builds a
 *   fresh copy and leaves the earlier form (and its answers) untouched.
 *
 * ANSWER MODEL
 *   Every required list question offers "Pag-usapan natin", "Hindi pa
 *   napagdesisyunan" or an "Iba pa" box, so an undecided answer is recorded as
 *   undecided instead of being forced into a guess.
 * ---------------------------------------------------------------------------
 */

var FORM_TITLE = 'Hacienda de LuisAna — Mga Desisyon ng May-ari (v2)'
var SHEET_TITLE = 'Hacienda de LuisAna — Client Answers (v2)'
var PROPERTY_KEY = 'HDL_CLIENT_FORM_V2_ID'

/** Creates the form once; a second run just prints the existing links. */
function createClientFormV2() {
  var props = PropertiesService.getScriptProperties()
  var existingId = props.getProperty(PROPERTY_KEY)

  if (existingId) {
    try {
      var existing = FormApp.openById(existingId)
      Logger.log('May form na (v2) — hindi na gumawa ng bago.')
      Logger.log('Sagutan: ' + existing.getPublishedUrl())
      Logger.log('I-edit:  ' + existing.getEditUrl())
      Logger.log('Para sa bagong kopya, patakbuhin ang createClientFormV2Again().')
      return
    } catch (err) {
      props.deleteProperty(PROPERTY_KEY)
    }
  }

  return buildFormV2()
}

/** Builds a new form even if one exists. Older forms and answers are untouched. */
function createClientFormV2Again() {
  return buildFormV2()
}

/** Prints the links of the most recent form this script made. */
function showClientFormV2Links() {
  var id = PropertiesService.getScriptProperties().getProperty(PROPERTY_KEY)
  if (!id) {
    Logger.log('Wala pang form. Patakbuhin muna ang createClientFormV2().')
    return
  }
  var form = FormApp.openById(id)
  Logger.log('Sagutan: ' + form.getPublishedUrl())
  Logger.log('I-edit:  ' + form.getEditUrl())
}

function buildFormV2() {
  var form = FormApp.create(FORM_TITLE)

  form.setDescription(
    'Para sa mga desisyong kailangan ng Hacienda de LuisAna booking system. ' +
    'Mga 30–45 minuto (100 tanong); puwedeng sagutan nang paunti-unti at balikan gamit ang parehong link. ' +
    'Kung hindi ka sigurado sa isang tanong, piliin ang "Pag-usapan natin" o isulat ang ' +
    '"Hindi pa napagdesisyunan" — mas mabuti iyon kaysa sa hulaan.\n\n' +
    'HINDI nagtatanong ng password, PIN, OTP, recovery code, API key, o anumang login ' +
    'credential ang form na ito. Huwag ilagay ang password, PIN, OTP, recovery code, o API key ' +
    'sa kahit anong sagot. ' +
    'Ang paglilipat ng account ay ginagawa sa official na "invite" o "transfer ownership" ' +
    'ng bawat serbisyo, hindi sa pamamagitan ng form.\n\n' +
    'Mga salitang ginagamit dito:\n' +
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
    'Tatlong magkaibang bagay ang pinaghihiwalay dito: (1) ilang guest ang kasama sa base rate, ' +
    '(2) ilan ang maximum na tao, at (3) magkano ang dagdag sa bawat sobra.')

  addChoice(form, 'Tama ba ang mga published rate?', [
    'Tama lahat',
    'May babaguhin',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Kasalukuyan: Main House ₱5,000 weekday / ₱6,000 weekend-holiday, 10 guests ang kasama. ' +
      'Annex ₱4,000 / ₱5,000, 6 guests ang kasama. A-House ₱1,000 bawat unit, 3 guests ang kasama, ' +
      '2 units ang buong estate. Bawat gabi ay isang standard stay (2:00 PM–12:00 NN).',
  })

  addParagraph(form, 'Kung may babaguhin, isulat dito', {
    required: false,
    help: 'Halimbawa: "Main House ₱5,500 simula Enero 2027". Isama kung kailan magiging epektibo.',
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
      'Halimbawa ng kasalukuyan: Biyernes hanggang Linggo, 2 gabi — dalawang gabi parehong ' +
      'weekend rate. Sa unang opsyon, ang Biyernes lang ang weekend rate at ang Sabado ay weekday ' +
      'kung Sabado ang check-in. Malaki ang pinagkaiba sa presyo, kaya kailangan itong malinaw.',
  })

  addChoice(form, 'Anong mga gabi ang weekend rate?', [
    'Biyernes at Sabado (kasalukuyan)',
    'Sabado at Linggo',
    'Biyernes, Sabado, at Linggo',
    'Iba pa',
    'Pag-usapan natin',
  ], { required: true })

  addText(form, 'Sino ang nag-a-update ng holiday dates, at gaano kaaga naka-publish ang rates?', {
    required: false,
    help:
      'Halimbawa: "Ako, isang beses sa Disyembre para sa buong taon; naka-publish 3 buwan bago." ' +
      'Isama kung paano nila malalaman ang local holiday at fiesta.',
  })

  addChoice(form, 'Maximum na tao sa Main House (10 ang kasama sa base rate)', [
    '10 — hanggang sa kasama lang',
    '12',
    '15',
    '20',
    '25 o higit pa',
    'Walang limitasyon',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    help:
      'Ang "kasama" at "maximum" ay magkaiba. Ang 10 ay bilang na saklaw ng base rate; ang ' +
      'maximum ay ang pinakamaraming taong papayagang pumasok, safety at kaginhawahan na desisyon ito.',
  })

  addChoice(form, 'Maximum na tao sa Annex (6 ang kasama sa base rate)', [
    '6 — hanggang sa kasama lang',
    '8',
    '10',
    '12',
    'Walang limitasyon',
    'Hindi pa napagdesisyunan',
  ], { required: true })

  addChoice(form, 'Maximum na tao sa A-House (3 ang kasama bawat unit, 2 units)', [
    '3 bawat unit',
    '4 bawat unit',
    'Iba pa',
    'Hindi pa napagdesisyunan',
  ], { required: true })

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
    required: false,
    help: 'Kapag may bawas, kailangan ng ebidensya para hindi ito maging hindi pagkakaintindihan.',
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
      'Ang porsyento ay ng natanggap na bayad, hindi ng buong presyo — malinaw ito sa susunod na ' +
      'tanong. Kung walang naka-publish na policy, walang refund na mai-compute ang system, kaya ' +
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
      'Kabuuang presyo: ₱5,000 — mas malaki kaysa sa binayad, kaya bihirang tama ito. ' +
      'Kailangan itong malinaw para hindi mali ang compute ng system.',
  })

  addChoice(form, 'Pwede bang magpalit ng petsa (reschedule)?', [
    'Oo, libre kung 15+ araw bago ang check-in',
    'Oo, may bayad',
    'Oo, pero isang beses lang',
    'Hindi pwede',
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

  addChecks(form, 'Ano ang tinuturing na force majeure?', [
    'Bagyo na may signal',
    'Baha sa daan papunta sa Hacienda',
    'Lindol',
    'Road closure o landslide',
    'Sakit o emergency sa pamilya ng guest',
  ], {
    required: true,
    other: true,
    help: 'Piliin lahat ng dapat tanggapin. Ang "Iba pa" ay para sa hindi nakalista.',
  })

  addChoice(form, 'Kapag force majeure, ano ang gagawin?', [
    'Libreng rebook',
    'Full refund',
    'Partial refund',
    'Pipiliin ng guest kung rebook o refund',
    'Case by case',
    'Pag-usapan natin',
  ], { required: true })

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
  ], { required: true, other: true })

  addChecks(form, 'Anong paraan ng bayad ang tinatanggap para sa natitirang balanse sa check-in?', [
    'Cash',
    'GCash',
    'BDO',
    'Ibang bank transfer (InstaPay o PESONet)',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    other: true,
    help: 'Kung hindi pa desidido, piliin lang ang "Hindi pa napagdesisyunan".',
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

  addChoice(form, 'Anong antas ng OTA sync ang gusto mo?', [
    'Manual lang — walang sync',
    'Calendar feed (iCal) — awtomatikong nakikita ang OTA dates sa website at vice versa',
    'Buong API integration — direktang konektado sa channel manager',
    'Pag-usapan natin',
  ], {
    required: true,
    help:
      'Ang iCal ay isang link ng kalendaryo na nag-a-update ng sarili, mga 15–60 minuto ang delay. ' +
      'Ang buong API ay mas mabilis pero may bayad na channel manager.',
  })

  addChoice(form, 'Kapag may conflict sa OTA at sa website, alin ang masusunod?', [
    'Ang unang nagbayad',
    'Ang website',
    'Ang OTA',
    'Case by case, Admin ang magpapasya',
    'Pag-usapan natin',
  ], { required: false })

  // =========================================================================
  // 5. Check-in, check-out, at patakaran sa pamamalagi
  // =========================================================================
  addSection(form, '5. Check-in, check-out, at patakaran sa pamamalagi',
    'Kumpirmahin ang oras at ang mga patakaran sa loob ng Hacienda.')

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

  addChoice(form, 'Parties at bisita', [
    'Bawal ang bisita',
    'Day visitors lang, may approval',
    'Bisita allowed kung may approval',
    'Events ay kailangan ng approval at bayad',
    'Pag-usapan natin',
  ], { required: true })

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
      '"bawal kahit saan". Kung iba-iba bawat accommodation, piliin ang "Depende" at isulat sa susunod.',
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
    required: true,
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

  addChoice(form, 'Paano sisingilin ang damage?', [
    'Mula sa security deposit',
    'Hiwalay na singil pagkatapos ng inspection',
    'Case by case',
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
    'Sino ang gumagawa ng ano, at paano gagana ang access sa pinto kung may smart lock.')

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

  addChoice(form, 'May totoong smart lock na ba?', [
    'Wala pa',
    'Meron na',
    'Nakaplano pa lang',
    'Hindi ko alam',
  ], {
    required: true,
    help:
      'Kasalukuyan: wala pang hardware sa system — listahan lang ng access events at simulation ang ' +
      'nasa Admin app. Kung "wala pa" o "nakaplano", sagutan pa rin ang susunod na tanong bilang plano.',
  })

  addChoice(form, 'Sino ang gagawa at magpapadala ng access code sa guest?', [
    'Admin app, awtomatiko',
    'Caretaker, manual',
    'May-ari',
    'Iba pa',
    'Hindi pa napagdesisyunan',
  ], { required: true, other: true })

  addChoice(form, 'Kailan magiging active ang access code?', [
    'Sa araw ng check-in lang',
    'Isang araw bago ang check-in',
    'Pagka-approve ng booking',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kailan mag-e-expire ang access code?', [
    'Awtomatiko sa check-out (12:00 NN)',
    'Sa katapusan ng araw ng check-out',
    'Manual na revoke ng Admin',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Sino ang pwedeng mag-unlock nang manual?', [
    'Admin lang',
    'Caretaker',
    'May-ari at caretaker',
    'Pag-usapan natin',
  ], { required: true })

  addChoice(form, 'Kapag walang kuryente o internet, paano papasukin ang guest?', [
    'Backup na physical key',
    'Offline na code na gumagana pa rin',
    'Tatawagan ang caretaker',
    'Pag-usapan natin',
  ], { required: true })

  addChecks(form, 'Sino ang makakatanggap ng access log at alert kapag may nabigong unlock?', [
    'May-ari',
    'Caretaker',
    'Admin sa app',
    'Walang tumatanggap',
    'Hindi pa napagdesisyunan',
  ], {
    required: true,
    other: true,
    help: 'Kung walang dapat tumanggap, piliin lang ang "Walang tumatanggap".',
  })

  addChoice(form, 'Para saan ang Live Location (kung gagamitin)?', [
    'Gabay sa guest papunta sa Hacienda',
    'Safety habang naglalakbay',
    'Hindi kailangan — huwag gamitin',
    'Iba pa',
    'Pag-usapan natin',
  ], { required: true, other: true })

  addChoice(form, 'Kailan dapat mag-umpisa at magtapos ang Live Location?', [
    'Guest ang magsisimula, may expiry na 15/30/60 minuto (kasalukuyan)',
    'Guest ang magsisimula, hanggang i-stop niya',
    'Awtomatikong magsisimula pag-alis ng guest, hanggang makarating sa Hacienda',
    'Hindi na kailangan',
    'Pag-usapan natin',
  ], {
    required: true,
    help: 'Hindi nagsisimula ang sharing nang wala ang consent ng guest — siya ang pipindot at siya rin ang makakapag-stop.',
  })

  addChoice(form, 'Sino ang makakakita ng Live Location?', [
    'Admin lang',
    'Admin at caretaker',
    'Walang makakakita — huwag paganahin',
    'Pag-usapan natin',
  ], { required: false })

  addChoice(form, 'Anong abiso ang gusto mong matanggap ng guest pagkatapos mag-book?', [
    'Email lang',
    'SMS lang',
    'Email at SMS',
    'Wala — sapat na ang chat at Facebook',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: false,
    other: true,
    help: 'Kasalukuyan: wala — push notification lang sa Admin ang mayroon.',
  })

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
  // 7. Admin, privacy, at go-live
  // =========================================================================
  addSection(form, '7. Admin, privacy, at go-live',
    'Sino ang may access, ano ang itatago at gaano katagal, at kailan bubuksan ang system.')

  addText(form, 'Sino-sino ang gagamit ng Admin app?', {
    required: true,
    help:
      'Pangalan at email ng bawat isa. Sa ngayon, lahat ng Admin ay may buong access: revenue, ' +
      'refund, guest data, at chat.',
  })

  addChoice(form, 'Kailangan ba ng hiwalay na antas ng access?', [
    'Isa lang — lahat ng Admin ay buong access (kasalukuyan)',
    'May-ari at Manager',
    'May-ari, Manager, at Caretaker',
    'May-ari at Caretaker',
    'Iba pa',
    'Pag-usapan natin',
  ], {
    required: true,
    other: true,
    help:
      'Kasalukuyan: isang role lang ang Admin — walang "staff" o "host". Kung iba-iba ang dapat ' +
      'makita ng bawat tao, kailangan itong idagdag sa system.',
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
    help: 'Kailangan ng pahintulot ng guest bago ilabas ang kahit first name — ito ang tatanungin sa susunod.',
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

  // =========================================================================
  // Answers sheet
  // =========================================================================
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  var sheet = SpreadsheetApp.create(SHEET_TITLE + ' — ' + stamp)
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId())

  PropertiesService.getScriptProperties().setProperty(PROPERTY_KEY, form.getId())

  Logger.log('=== READY (v2) ===')
  Logger.log('Sagutan:   ' + form.getPublishedUrl())
  Logger.log('I-edit:    ' + form.getEditUrl())
  Logger.log('Responses: ' + sheet.getUrl())

  return {
    formUrl: form.getPublishedUrl(),
    editUrl: form.getEditUrl(),
    sheetUrl: sheet.getUrl(),
  }
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

/** A multiple-answer question. */
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
