import { BUSINESS, LISTINGS } from '../../config/site'
import type { LegalSection } from './types'

// -----------------------------------------------------------------------------
// Part E — Legal protections and document control (sections 24–31)
// -----------------------------------------------------------------------------
// These are the sections that protect both sides when something goes wrong:
// fraud prevention, the zero-tolerance list, force majeure, the liability cap
// and indemnity, the governing law and forum, how the terms change, and how a
// Guest gives notice. They are written to be enforceable under Philippine law
// and to preserve rights that mandatory law does not allow the Hacienda to
// exclude (the Consumer Act, the Data Privacy Act and the E-Commerce Act).
// -----------------------------------------------------------------------------

export const GENERAL_SECTIONS: LegalSection[] = [
  {
    id: 'official-channels',
    title: 'Official channels and fraud prevention',
    summary: 'The only ways the Hacienda communicates and takes money, and how to check before you pay.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'The Hacienda communicates and accepts payments only through the official channels: the phone number, email address, Facebook page, Messenger and Instagram on the Contact page; the payment step of this website; and the Hacienda’s Airbnb and Agoda listings.',
      },
      {
        kind: 'p',
        text: 'We will never ask for your password, PIN, OTP, banking credential or remote access to your device. We will never ask you to pay to a personal account that is not published on the payment step. We will never ask you to install an app or share a screen to verify a payment.',
      },
      {
        kind: 'p',
        text: 'Before paying, verify the recipient name and QR code against the payment step and the official contact channels. If someone contacts you privately, claims to be the owner or staff, or asks you to pay a different account, stop and contact us through the official channels.',
      },
      {
        kind: 'p',
        text: 'If you suspect fraud or impersonation, report it to the Hacienda and to the platform where it happened, such as Facebook or Messenger. You may also report it to the Philippine National Police Anti-Cybercrime Group or the National Bureau of Investigation.',
      },
      {
        kind: 'p',
        text: 'If you have already sent money to a scammer, contact your bank or e-wallet immediately, report the incident to the authorities, and tell the Hacienda. We will cooperate with the investigation, but we cannot recover money sent to a third party.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is not responsible for any loss caused by a payment to an unofficial channel or to a person who is not authorized by the Hacienda.',
      },
      {
        kind: 'p',
        text: 'We may report suspected fraud, money laundering or other financial crime to the authorities. We do not accept payment in cash to a personal account that is not published, and we do not issue receipts for unofficial payments.',
      },
      {
        kind: 'note',
        tone: 'danger',
        title: 'Verify before you pay.',
        text: 'Call or email the Hacienda using the official contact details before sending any money. A screenshot of a QR code is not proof that it is ours.',
      },
    ],
  },
  {
    id: 'prohibited-conduct',
    title: 'Prohibited conduct and zero tolerance',
    summary: 'The acts that are not permitted, what the Hacienda will do about them, and the guest’s responsibility for their group.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'The following are prohibited at the property and in connection with a booking. This is not an exhaustive list.',
      },
      {
        kind: 'list',
        items: [
          'Illegal drugs and controlled substances, including possession, use, trafficking or manufacture.',
          'Unlicensed firearms, weapons or explosives.',
          'Gambling or betting.',
          'Human trafficking, smuggling or illegal recruitment.',
          'Child abuse, exploitation or child sexual abuse material.',
          'Sexual harassment or assault.',
          'Violence, threats or intimidation.',
          'Hate speech or discrimination.',
          'Theft, vandalism or arson.',
          'Fraud, identity theft or payment fraud.',
          'Trespass.',
          'Illegal logging, wildlife crime or environmental damage.',
          'Driving under the influence of alcohol or drugs.',
          'Serving alcohol to minors.',
          'Unauthorized commercial activity.',
          'Any other act that is unlawful or puts others at risk.',
        ],
      },
      {
        kind: 'p',
        text: 'The Hacienda has zero tolerance for these acts. If we see or reasonably suspect any of them, we may end the stay, ask the person to leave, cancel the booking without refund, and report the matter to the Philippine National Police, the National Bureau of Investigation, the Department of Social Welfare and Development, the Department of Environment and Natural Resources, or another appropriate authority. We will cooperate with the investigation.',
      },
      {
        kind: 'p',
        text: 'The guest is responsible for the acts of everyone in their group and for any damage, loss or harm caused by those acts. The guest is also responsible for any cost the Hacienda incurs as a result, including cleaning, repair, replacement, legal costs and fines, to the extent permitted by law.',
      },
      {
        kind: 'p',
        text: 'If a guest is the victim of a crime, the Hacienda will help them contact the authorities and will preserve relevant records, such as access logs, to the extent permitted by law.',
      },
      {
        kind: 'p',
        text: 'The Hacienda does not tolerate bribery or corruption. Do not offer or give anything of value to the Hacienda’s staff or agents to influence a decision. Staff must not solicit or accept a bribe. Report any such request to the Hacienda.',
      },
      {
        kind: 'p',
        text: 'The Hacienda cooperates with lawful requests from authorities. We do not obstruct justice, destroy evidence or assist anyone in evading the law.',
      },
      {
        kind: 'note',
        tone: 'danger',
        title: 'Zero tolerance.',
        text: 'The Hacienda will report suspected crimes to the authorities. A booking does not give anyone permission to break the law, and a refund is not available for a booking cancelled for prohibited conduct.',
      },
    ],
  },
  {
    id: 'force-majeure',
    title: 'Force majeure and cancellation by the Hacienda',
    summary: 'What happens when a typhoon, a government order or another event outside anyone’s control prevents the stay.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'Force majeure is an event outside a party’s reasonable control that prevents or delays performance, including: typhoon, flood, earthquake, volcanic eruption, fire, landslide, drought or other natural disaster; epidemic, pandemic or a public-health emergency; war, terrorism, civil unrest, riot or armed conflict; a government order, curfew, lockdown, road closure or evacuation; a strike, labour dispute or shortage of essential services; a failure of electricity, water, internet or telecommunications; a cyberattack or a failure of a third-party service; or any other event beyond reasonable control.',
      },
      {
        kind: 'p',
        text: 'If a force majeure event prevents the stay, the Hacienda will contact you as soon as reasonably possible. We will offer a reschedule to another available date or a refund of the amounts paid for the cancelled stay, in accordance with the refund policy and the circumstances. We will not charge a cancellation fee for a force majeure cancellation.',
      },
      {
        kind: 'p',
        text: 'If the Hacienda cancels a confirmed booking for a reason within its control, you may choose a reschedule or a full refund of the amounts paid for the cancelled stay. We will not charge a cancellation fee.',
      },
      {
        kind: 'p',
        text: 'If the Hacienda cannot provide the booked unit for a reason within its control, we will offer a comparable unit or a reschedule or refund. If you accept a comparable unit, we will adjust the rate if it is lower; if it is higher, we will not charge you the difference.',
      },
      {
        kind: 'p',
        text: 'If the Hacienda ends a stay for safety reasons, we will refund the unused portion of the stay, less any amount already refunded or applied, and we will help you find a safe place to stay. We will not refund the portion of the stay already used.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is not liable for indirect or consequential loss caused by a force majeure event, including travel costs, alternative accommodation, lost income or missed events. We recommend travel insurance.',
      },
      {
        kind: 'p',
        text: 'A force majeure event does not excuse a payment that is already due, unless the event prevents the payment and the Hacienda agrees in writing.',
      },
      {
        kind: 'p',
        text: 'If a government order or a public-health emergency closes the property or restricts travel, the Hacienda will follow the order and apply the refund policy. We will keep you informed through the official channels.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Travel insurance.',
        text: 'We recommend that every guest buy travel insurance that covers cancellation, medical expenses, personal property and travel delays. The Hacienda’s refund policy is limited to the amounts paid for the stay.',
      },
    ],
  },
  {
    id: 'liability',
    title: 'Liability, indemnity and insurance',
    summary: 'The cap on the Hacienda’s liability, what is not covered, and the guest’s responsibility for their group.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'To the maximum extent permitted by law, the Hacienda’s total liability to you for a booking is limited to the total amount you actually paid for the stay under that booking, excluding the security deposit. This applies to all claims arising out of or in connection with the booking, the stay or the website.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is not liable for indirect, incidental, special, consequential or punitive damages, or for loss of profit, revenue, data, opportunity or goodwill, even if we were advised of the possibility of such loss.',
      },
      {
        kind: 'p',
        text: 'Nothing in these terms limits the Hacienda’s liability for: death or personal injury caused by negligence; fraud or fraudulent misrepresentation; gross negligence or willful misconduct; or any other liability that cannot be limited or excluded by Philippine law.',
      },
      {
        kind: 'p',
        text: 'Nothing in these terms limits your rights under mandatory Philippine law, including the Consumer Act of the Philippines (Republic Act No. 7394), the Data Privacy Act of 2012 (Republic Act No. 10173) and the Electronic Commerce Act of 2000 (Republic Act No. 8792).',
      },
      {
        kind: 'p',
        text: 'You are responsible for your own property, safety and conduct, and for the property, safety and conduct of everyone in your group. You are responsible for any damage or loss you cause to the property or to another person.',
      },
      {
        kind: 'p',
        text: 'You agree to indemnify the Hacienda, its owners, staff and agents against third-party claims, losses, damages, costs and expenses, including reasonable legal fees, arising from your breach of these terms, your negligence or willful misconduct, or your violation of law, to the extent permitted by law.',
      },
      {
        kind: 'p',
        text: 'The Hacienda will indemnify you against third-party claims arising from the Hacienda’s negligence or willful misconduct, to the extent permitted by law. The indemnity is subject to the liability cap in this section, except where the law does not allow the cap.',
      },
      {
        kind: 'p',
        text: 'The indemnified party must give prompt notice of a claim, allow the indemnifying party to control the defense, and cooperate reasonably. The indemnifying party may not settle a claim in a way that admits fault by the indemnified party without consent.',
      },
      {
        kind: 'p',
        text: 'You are responsible for your own insurance. Any insurance the Hacienda maintains for the property does not cover your personal property or your travel.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is not liable for the acts or omissions of other guests, visitors, contractors or third parties, except to the extent the Hacienda was negligent or as required by law.',
      },
      {
        kind: 'p',
        text: 'The limitations in this section survive the end of the booking and the termination of these terms.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Read this section carefully.',
        text: 'It limits the Hacienda’s liability and requires you to indemnify the Hacienda in certain circumstances. It does not limit liability that cannot be limited by law.',
      },
    ],
  },
  {
    id: 'disputes',
    title: 'Dispute resolution and governing law',
    summary: 'The law that applies, the steps the parties will take before going to court, and where a claim may be filed.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'These terms and any booking are governed by the laws of the Republic of the Philippines, without regard to conflict-of-law rules.',
      },
      {
        kind: 'p',
        text: 'If a dispute arises, the parties will first try to resolve it in good faith through direct negotiation. Please contact the Hacienda through the official channels and describe the issue. We will respond within a reasonable time.',
      },
      {
        kind: 'p',
        text: 'If negotiation does not resolve the dispute within 30 days, the parties may agree to mediation before a mutually acceptable mediator or the Philippine Mediation Center. Mediation is voluntary and does not prevent either party from going to court.',
      },
      {
        kind: 'p',
        text: 'If the dispute is not resolved, it will be brought before the courts of the Province of Laguna, Philippines. Each party submits to the jurisdiction of those courts. Nothing in this section prevents a guest from bringing a claim in a court that has mandatory jurisdiction under Philippine law.',
      },
      {
        kind: 'p',
        text: 'Each party bears its own legal costs, except as awarded by the court. The Hacienda may seek injunctive or other urgent relief to protect the property, guests or staff, without first exhausting the negotiation and mediation steps.',
      },
      {
        kind: 'p',
        text: 'A guest may use the small claims court procedure or another procedure available under Philippine law, if the claim qualifies. Nothing in these terms requires a guest to give up a mandatory right.',
      },
      {
        kind: 'p',
        text: 'If any provision of these terms is found to be invalid or unenforceable, the rest remains in effect, and the invalid provision will be modified to the minimum extent necessary to make it enforceable.',
      },
      {
        kind: 'p',
        text: 'The Hacienda’s failure to enforce a provision is not a waiver of its right to do so later. A waiver is effective only if it is in writing.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Talk to us first.',
        text: 'Most disputes can be resolved by a conversation. Please contact the Hacienda before filing a claim, so we have a chance to fix the problem.',
      },
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    summary: 'How the Hacienda updates the terms, which version applies to an existing booking, and how to see the history.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'We may update these terms from time to time. The current version is always on this page, with the version date and effective date. The version you accepted is recorded on your booking.',
      },
      {
        kind: 'p',
        text: 'If we make a material change, we will post the new version on this page and, where appropriate, notify you by email or in-app message before it takes effect. The new version applies to bookings made after the effective date.',
      },
      {
        kind: 'p',
        text: 'A confirmed booking is governed by the version of these terms in force when the booking was confirmed, except where a change is required by law or a safety rule applies immediately. If a change is required by law, we will apply it to existing bookings to the extent required.',
      },
      {
        kind: 'p',
        text: 'If you do not agree with a change, you may cancel your booking before the effective date, subject to the refund policy. If you continue to use the website or the property after the effective date, you accept the new version.',
      },
      {
        kind: 'p',
        text: 'We may change the published rates, the optional charges, the house rules and the availability of units. Changes to rates apply to new bookings; changes to house rules apply to stays in progress where they are safety rules or required by law.',
      },
      {
        kind: 'p',
        text: 'We will keep a version history on this page so you can see what changed and when.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Version history.',
        text: 'The current version is 2026-11-03. The previous version was 2026-10-30. The version history table at the end of this page lists the changes.',
      },
    ],
  },
  {
    id: 'notices',
    title: 'Notices, general provisions and interpretation',
    summary: 'How formal notices are given, how the Agreement is read, and the general rules that keep the rest of the terms working.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'Notices to you: we may send a notice to the email address or phone number in your account, or through the in-app message system. A notice sent by email is deemed received on the next business day, unless the email bounces. A notice sent by in-app message is deemed received when it is delivered to your inbox.',
      },
      {
        kind: 'p',
        text: `Notices to the Hacienda: email ${BUSINESS.contact.email}, call ${BUSINESS.contact.phoneDisplay}, or write to ${BUSINESS.address.formatted}. A formal legal notice must be in writing and sent by email or registered mail to the address above.`,
      },
      {
        kind: 'p',
        text: 'These terms, the house rules, the published rates and the booking confirmation are the entire agreement between you and the Hacienda about the booking and the stay. They replace any prior discussion, quote or representation, except for a written confirmation from the Admin.',
      },
      {
        kind: 'p',
        text: 'No amendment to these terms is effective unless it is posted on this page by the Admin or agreed in writing by the Admin. An electronic version posted on this page is effective as a written amendment.',
      },
      {
        kind: 'p',
        text: 'No partnership, agency, joint venture or employment relationship is created by these terms. The Hacienda’s staff and agents are not your agents.',
      },
      {
        kind: 'p',
        text: 'A person who is not a party to these terms has no right to enforce them, except for the Hacienda’s owners, staff and agents as indemnitees under section 27.',
      },
      {
        kind: 'p',
        text: 'If any provision is invalid or unenforceable, the rest remains in effect. The invalid provision will be modified to the minimum extent necessary to make it enforceable.',
      },
      {
        kind: 'p',
        text: 'A failure to enforce a provision is not a waiver. A waiver is effective only if it is in writing.',
      },
      {
        kind: 'p',
        text: 'The Hacienda may assign these terms or a booking to a successor in connection with a merger, acquisition or sale of the business. You may not assign them without the Hacienda’s written consent.',
      },
      {
        kind: 'p',
        text: 'Provisions that by their nature should survive the end of the booking or these terms will survive, including payment, refunds, liability, indemnity, privacy, intellectual property, dispute resolution and notices.',
      },
      {
        kind: 'p',
        text: 'Headings are for convenience only and do not affect interpretation. “Including” means “including without limitation”. A reference to a statute includes any amendment or re-enactment. The singular includes the plural.',
      },
      {
        kind: 'p',
        text: 'The time zone for the property is Philippine time (UTC+8). The currency is the Philippine peso (₱). Dates are calendar dates at the property, not in the guest’s time zone.',
      },
      {
        kind: 'p',
        text: 'These terms may be signed electronically. A tick box, an electronic acceptance or an electronic signature is effective under the Electronic Commerce Act of 2000 (Republic Act No. 8792).',
      },
      {
        kind: 'p',
        text: 'The Hacienda may translate these terms for convenience. The English version prevails if there is a conflict.',
      },
      {
        kind: 'p',
        text: 'If you have a question about these terms, contact the Hacienda before booking. We would rather answer a question than have a dispute later.',
      },
    ],
  },
  {
    id: 'contact',
    title: 'Contact, complaints and document control',
    summary: 'How to reach the Hacienda, how a complaint is handled, and the version record for this page.',
    part: 'legal',
    blocks: [
      {
        kind: 'p',
        text: 'Contact the Hacienda using the official channels below. For a booking or stay issue, include your booking reference and dates. For a privacy request, use the subject line “Privacy request”.',
      },
      {
        kind: 'table',
        caption: 'Official contact channels',
        head: ['Channel', 'Details'],
        rows: [
          ['Phone', BUSINESS.contact.phoneDisplay],
          ['Email', BUSINESS.contact.email],
          ['Facebook', BUSINESS.contact.facebook],
          ['Messenger', BUSINESS.contact.messenger],
          ['Instagram', BUSINESS.contact.instagram],
          ['Address', BUSINESS.address.formatted],
          ['Website', 'haciendadeluisana.com'],
          ['Official listings', `${LISTINGS.airbnb.label}: ${LISTINGS.airbnb.url} · ${LISTINGS.agoda.label}: ${LISTINGS.agoda.url}`],
        ],
      },
      {
        kind: 'p',
        text: 'Complaints: tell us as soon as possible through an official channel. We will acknowledge the complaint, investigate it fairly, and respond within a reasonable time. If the complaint is about a stay, we will try to resolve it before you leave or immediately after.',
      },
      {
        kind: 'p',
        text: 'If you are not satisfied with our response, you may raise the matter with the Department of Trade and Industry, your local consumer protection office, or another appropriate authority. For a privacy complaint, you may contact the National Privacy Commission at privacy.gov.ph.',
      },
      {
        kind: 'p',
        text: 'The Hacienda keeps a record of complaints and the steps taken to resolve them. We use this to improve the property and the service.',
      },
      {
        kind: 'p',
        text: 'Document control: this page is the controlled version of the Hacienda’s terms, privacy notice and booking rules. The version, effective date, last reviewed date and review cycle are below. The Admin reviews this page at least once a year and whenever a booking, payment, privacy or access rule changes.',
      },
      {
        kind: 'table',
        caption: 'Document control',
        head: ['Field', 'Detail'],
        rows: [
          ['Document owner', 'The Admin, Hacienda de LuisAna'],
          ['Version', '2026-11-03'],
          ['Effective date', '3 November 2026'],
          ['Last reviewed', '3 November 2026'],
          ['Next review', '3 November 2027, or earlier if a rule changes'],
          ['Scope', 'The website, bookings, stays, payments, access and personal data'],
          ['Related documents', 'House rules, published rates, booking confirmation, privacy notice'],
        ],
      },
      {
        kind: 'table',
        caption: 'Version history',
        head: ['Version', 'Effective', 'Summary of changes'],
        rows: [
          [
            '2026-11-03',
            '3 November 2026',
            'Expanded and reorganized the terms; added a detailed privacy notice, guest conduct, safety, liability, indemnity, dispute resolution, force majeure, fraud prevention and document control; clarified the 30-day booking lead time and the 90-day chat retention.',
          ],
          [
            '2026-10-30',
            '30 October 2026',
            'Core terms, privacy summary, booking rules, cancellation, payment and smart-lock rules.',
          ],
        ],
      },
      {
        kind: 'p',
        text: 'This page is written in plain English for guests. It is not legal advice to any other business. If you need a copy for your records, you can print or save this page.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Print or save.',
        text: 'Use the Print button at the top of this page to print or save a PDF copy. The printed copy includes the version date and the full text.',
      },
    ],
  },
]
