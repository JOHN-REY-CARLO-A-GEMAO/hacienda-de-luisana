import type { LegalSection } from './types'

// -----------------------------------------------------------------------------
// Part D — Content, intellectual property and third parties (sections 21–23)
// -----------------------------------------------------------------------------
// A Guest sends messages, uploads a payment screenshot, writes a review and
// takes photographs. These sections separate what the Guest keeps, what the
// Hacienda may do with it, and what belongs to someone else. They also draw the
// line between the Hacienda's own booking and a transaction on Airbnb or Agoda.
// -----------------------------------------------------------------------------

export const CONTENT_SECTIONS: LegalSection[] = [
  {
    id: 'content',
    title: 'Your content, reviews and media',
    summary: 'Who owns the messages, photos and reviews you send, and what the Hacienda may do with them.',
    part: 'content',
    blocks: [
      {
        kind: 'p',
        text: 'You may send us messages, photos, documents, reviews and other content. You keep ownership of your content. By sending it, you grant the Hacienda a non-exclusive, royalty-free, worldwide licence to use, store, copy, display and process it for the purposes of the stay, the booking, safety, support, dispute resolution and legal compliance.',
      },
      {
        kind: 'p',
        text: 'If you consent to the Hacienda using your content in marketing, such as a review or a photo, we will ask for that consent separately. You can withdraw it at any time by contacting us, and we will stop using the content for marketing, without affecting the stay or the booking.',
      },
      {
        kind: 'p',
        text: 'You must not send content that is unlawful, defamatory, obscene, hateful, harassing, discriminatory, infringing, misleading, or that contains another person’s personal data without their permission. We may remove or refuse to publish such content.',
      },
      {
        kind: 'p',
        text: 'Reviews must be honest and based on your own experience. We welcome critical reviews. We do not edit or delete a review because it is critical. We may remove a review that is unlawful, abusive, contains personal data, or is not based on a real stay.',
      },
      {
        kind: 'p',
        text: 'You may take personal photos and videos at the property for your own use. Do not photograph or record other guests or staff without their consent. Commercial photography, filming, drone use and live streaming require the Admin’s written permission.',
      },
      {
        kind: 'p',
        text: 'If you appear in the Hacienda’s marketing, we will ask for your consent and explain how the content will be used. You can withdraw consent for future use.',
      },
      {
        kind: 'p',
        text: 'We may use aggregated, anonymized data about stays to improve the property and the website. This is not personal data if it cannot identify you.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Your review.',
        text: 'If you had a problem, tell us first through the official channels. We would rather fix it than have you leave without a solution. We still welcome honest reviews.',
      },
    ],
  },
  {
    id: 'ip',
    title: 'Intellectual property',
    summary: 'What the Hacienda owns, what you may use, and how third-party brands are treated.',
    part: 'content',
    blocks: [
      {
        kind: 'p',
        text: 'The website, its text, design, graphics, logos, photographs, videos, software and other content are owned by the Hacienda or used under licence. They are protected by Philippine and international intellectual property laws.',
      },
      {
        kind: 'p',
        text: 'You may view, download and print pages for your own personal, non-commercial use, provided you keep the copyright and ownership notices. You may not copy, reproduce, publish, distribute, modify, create derivative works from, sell or scrape the content without the Hacienda’s written permission.',
      },
      {
        kind: 'p',
        text: 'The Hacienda’s name, logo and branding are the Hacienda’s intellectual property and branding. You may not use them in a way that suggests endorsement or affiliation without written permission.',
      },
      {
        kind: 'p',
        text: 'Third-party names, logos and trademarks, such as Airbnb, Agoda, GCash, BDO, Google, Firebase and Facebook, belong to their owners. The Hacienda is not affiliated with or endorsed by them, except as an official listing or service provider.',
      },
      {
        kind: 'p',
        text: 'If you believe content on the website infringes your intellectual property, contact us with the details and we will review it.',
      },
      {
        kind: 'p',
        text: 'Your content remains yours. The licence you grant to the Hacienda is limited to the purposes described in section 21.',
      },
    ],
  },
  {
    id: 'third-parties',
    title: 'Third-party platforms and links',
    summary: 'How Airbnb and Agoda bookings interact with these terms, and what the Hacienda is not responsible for.',
    part: 'content',
    blocks: [
      {
        kind: 'p',
        text: 'The Hacienda’s official listings are on Airbnb and Agoda. A booking made through those platforms is governed by the platform’s terms, including its payment, cancellation and refund terms, as well as the Hacienda’s stay rules. Contact the platform for issues with the transaction; contact the Hacienda for issues with the stay.',
      },
      {
        kind: 'p',
        text: 'The website may link to third-party websites, such as Google Maps, Facebook, Instagram, Airbnb, Agoda, GCash and BDO. We do not control those websites and are not responsible for their content, terms, privacy practices or availability. A link does not mean we endorse them.',
      },
      {
        kind: 'p',
        text: 'The website uses Google Maps for directions. The pin is approximate. Confirm the exact location and access with the Hacienda before travelling.',
      },
      {
        kind: 'p',
        text: 'Payment services are provided by GCash and BDO under their own terms. The Hacienda is not responsible for a payment provider’s outage, delay or error, but we will help you resolve the issue.',
      },
      {
        kind: 'p',
        text: 'If you use a third-party service to communicate with the Hacienda, such as Facebook Messenger, the service’s terms and privacy notice apply. For a binding notice or a privacy request, use the email address or phone number on the Contact page.',
      },
      {
        kind: 'p',
        text: 'The Hacienda does not arrange transport, tours, travel insurance or other travel services through third parties unless it agrees in writing. Any third-party service you book is between you and that provider.',
      },
    ],
  },
]
