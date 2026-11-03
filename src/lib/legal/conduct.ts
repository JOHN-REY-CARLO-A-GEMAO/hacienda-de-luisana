import type { LegalSection } from './types'

// -----------------------------------------------------------------------------
// Part B — Conduct, safety and property (sections 11–16)
// -----------------------------------------------------------------------------
// The Hacienda is a private home in a rural barangay, not a hotel with a lobby
// and a duty manager. These sections say plainly what is expected of a guest,
// what the Hacienda will do about unsafe or unlawful conduct, and where the
// property's limits lie. They are written to be read by a guest before arrival,
// not only after a problem.
// -----------------------------------------------------------------------------

export const CONDUCT_SECTIONS: LegalSection[] = [
  {
    id: 'conduct',
    title: 'Guest conduct and house rules',
    summary: 'The standard of behaviour the Hacienda asks of every guest, and what happens when it is not met.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'You and everyone in your group must follow the house rules, these terms, the law, and any reasonable safety instruction from the Admin or a public authority. The house rules are on the House rules page and form part of the Agreement.',
      },
      {
        kind: 'p',
        text: 'The Hacienda is a private, family-oriented property. Please behave in a way that respects other guests, the neighbours, the staff and the property.',
      },
      {
        kind: 'list',
        items: [
          'Do not exceed the occupancy limit or allow overnight guests who are not on the booking.',
          'Do not hold a party, event or gathering that the Admin has not approved in writing.',
          'Do not use the property for any commercial activity, including selling goods or services, soliciting or running a business.',
          'Do not make unreasonable noise, especially at night. Do not use sound equipment that disturbs others.',
          'Do not smoke or vape indoors. If the Admin designates an outdoor area, use it and dispose of waste safely.',
          'Do not light fires except in the designated bonfire pit or stove. Never leave a fire unattended. Do not use fireworks or open flames outside the designated area.',
          'Do not bring illegal drugs, controlled substances, or unlicensed firearms or weapons. Do not engage in gambling, human trafficking, child abuse or exploitation, or any other unlawful activity.',
          'Do not damage, remove or misuse property, fixtures, appliances or safety equipment.',
          'Do not harass, threaten, discriminate against or assault any person. Do not engage in hate speech or abusive behaviour.',
          'Do not drive under the influence of alcohol or drugs. Do not serve alcohol to minors.',
          'Do not trespass on neighbouring land, private areas or staff areas.',
          'Do not tamper with the smart lock, access-control system, electrical, gas or water installations.',
          'Do not bring animals other than pets declared and approved under section 12.',
          'Do not use drones, cameras or recording equipment to intrude on the privacy of other guests or staff.',
          'Do not swim or enter water bodies, rivers or natural features unless the Admin has confirmed it is safe and permitted.',
          'Follow the fire-safety, evacuation and emergency instructions.',
        ],
      },
      {
        kind: 'p',
        text: 'The Admin may ask you to stop an activity that is unsafe, unlawful or disruptive. If you do not comply, the Admin may end the stay, ask you to leave, and cancel the booking without refund. The guest is responsible for any damage or loss caused by the breach.',
      },
      {
        kind: 'p',
        text: 'The Hacienda may report suspected unlawful conduct to the Philippine National Police or another authority and cooperate with the investigation. See section 25.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Zero tolerance.',
        text: 'Illegal drugs, firearms without legal authority, gambling, human trafficking, child abuse or exploitation, violence, harassment and fraud are prohibited. The Hacienda will report suspected crimes to the authorities and will not refund a booking that is cancelled for these reasons.',
      },
    ],
  },
  {
    id: 'pets-fire-alcohol',
    title: 'Pets, smoking, fire and alcohol',
    summary: 'The rules for pets, the bonfire, smoking, cooking and alcohol, and who is responsible when something goes wrong.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'Pets are welcome. A sanitation fee of ₱300 per pet applies. Declare every pet when booking and confirm the current charge. The fee is not added automatically to ordinary stays.',
      },
      {
        kind: 'p',
        text: 'You are responsible for your pet at all times. Keep it leashed or contained, do not leave it unattended in the accommodation, and clean up after it. Do not allow it to damage property, disturb other guests, or enter areas where it is not permitted.',
      },
      {
        kind: 'p',
        text: 'You are responsible for any damage, loss or cleaning cost caused by your pet, and for any injury or nuisance it causes. The Hacienda may ask you to remove a pet that is dangerous, aggressive or causing a nuisance.',
      },
      {
        kind: 'p',
        text: 'Smoking and vaping are not permitted indoors. If the Admin designates an outdoor area, use it, keep it clear of children and flammable materials, and dispose of cigarette waste safely. Do not smoke in bed or near the gas stove, grill or bonfire.',
      },
      {
        kind: 'p',
        text: 'Fires are permitted only in the designated bonfire pit or stove, and only with the wood or fuel the Admin provides or approves. Never leave a fire unattended. Keep children and pets away. Extinguish the fire completely before leaving or sleeping. Do not use accelerants, fireworks or open flames outside the designated area.',
      },
      {
        kind: 'p',
        text: 'The bonfire wood set is optional and costs ₱150 per set. Free use of the bonfire pit does not automatically include wood. Confirm the current charge when booking.',
      },
      {
        kind: 'p',
        text: 'Alcohol is permitted for guests of legal drinking age. Do not drink and drive, do not serve alcohol to minors, and do not engage in disorderly or unsafe behaviour. The Admin may end a stay for alcohol-related misconduct.',
      },
      {
        kind: 'p',
        text: 'The gas stove, grill and kitchen appliances must be used according to the instructions. Never leave cooking unattended. Turn off the gas and appliances before leaving or sleeping.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Fire safety.',
        text: 'The property is in a rural area with vegetation. A fire can spread quickly. Follow the fire-safety instructions, keep a clear area around the pit, and call 911 or the Bureau of Fire Protection if a fire gets out of control.',
      },
    ],
  },
  {
    id: 'children',
    title: 'Children, vulnerable guests and supervision',
    summary: 'Who must supervise children, what the property does not provide, and how to raise an accessibility need.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'Children are welcome, but they must be supervised by a parent, guardian or responsible adult at all times. The accompanying adult is responsible for the child’s safety and conduct.',
      },
      {
        kind: 'p',
        text: 'The property has natural features, roads, steps, water bodies and other hazards. Do not allow children to play near roads, water, fires, gas appliances, tools or machinery without supervision.',
      },
      {
        kind: 'p',
        text: 'The accommodation is not a childcare facility. The Hacienda does not provide childcare, babysitting or supervision. Do not leave a child unattended in the accommodation or on the property.',
      },
      {
        kind: 'p',
        text: 'If a child or vulnerable guest needs special assistance, tell the Admin before booking so the Hacienda can advise on the suitability of the unit and the property. The Hacienda will try to accommodate reasonable needs but cannot guarantee a particular level of assistance.',
      },
      {
        kind: 'p',
        text: 'Guests with disabilities or accessibility needs should contact the Admin before booking. The property is rural and some areas may have uneven terrain, steps or limited accessibility. The Hacienda will describe the features honestly and discuss what is possible.',
      },
      {
        kind: 'p',
        text: 'The Hacienda does not provide medical care. If a guest is injured or unwell, contact emergency services and the Admin. The guest is responsible for their own medication and medical needs.',
      },
      {
        kind: 'note',
        tone: 'danger',
        title: 'Child safety.',
        text: 'The Hacienda has zero tolerance for child abuse, exploitation, trafficking or child sexual abuse material. Suspected incidents will be reported to the Philippine National Police, the National Bureau of Investigation and the Department of Social Welfare and Development, and the booking will be cancelled without refund.',
      },
    ],
  },
  {
    id: 'damage',
    title: 'Damage, loss and the security deposit',
    summary: 'Who pays when something is broken or missing, how the deposit is settled, and who carries the risk for your own property.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'You are responsible for the accommodation, its contents and the property during your stay. You must use them reasonably and take reasonable care.',
      },
      {
        kind: 'p',
        text: 'If you or your guests cause damage, loss or a cleaning problem, report it immediately. The Hacienda will assess the damage, obtain a repair or replacement cost where needed, and discuss it with you. The security deposit may be used to cover the cost, and you are responsible for any amount above the deposit.',
      },
      {
        kind: 'p',
        text: 'The security deposit is held against damage, loss and cleaning beyond normal use. It is not a fee and it is not part of the stay total. It is returned after check-out inspection, less any deductions, with an itemized statement.',
      },
      {
        kind: 'p',
        text: 'Your own property is at your own risk. The Hacienda is not responsible for loss, theft or damage to your property, except to the extent caused by the Hacienda’s negligence or as required by law. Use the locks and safes provided, keep valuables with you, and report any theft to the Admin and the police.',
      },
      {
        kind: 'p',
        text: 'Vehicles are parked at the owner’s risk. The Hacienda is not responsible for damage to or theft from a vehicle, except to the extent caused by the Hacienda’s negligence or as required by law. Do not leave valuables in a vehicle.',
      },
      {
        kind: 'p',
        text: 'The Hacienda’s liability is limited as described in section 27. Nothing in these terms limits liability that cannot be limited by law.',
      },
      {
        kind: 'p',
        text: 'If a third party causes damage or loss, the Hacienda will cooperate with you and the authorities, but the guest is responsible for their own property and for pursuing their own claim.',
      },
      {
        kind: 'note',
        tone: 'info',
        title: 'Normal wear and tear.',
        text: 'The Hacienda does not charge for normal wear and tear from ordinary use. Deductions are for damage, loss, missing items or cleaning beyond normal use, and are itemized.',
      },
    ],
  },
  {
    id: 'smart-lock',
    title: 'Smart locks, keys and access control',
    summary: 'How access is granted, what the access log records, and what to do if a credential is lost or the lock fails.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'Access is granted only for a Reserved or in-stay booking on the valid dates, using an RFID credential or the in-app Mobile Key. The system checks the booking status and dates before it unlocks.',
      },
      {
        kind: 'p',
        text: 'Every access attempt is written to the Access log with the timestamp, the result (granted or denied) and the reason. The log is used for security, safety, dispute resolution and legal compliance. It is not a GPS tracker and does not record your location outside the property.',
      },
      {
        kind: 'p',
        text: 'Do not share your Mobile Key, RFID card or access code with anyone. Do not lend, copy or transfer a credential. If a credential is lost or stolen, report it to the Admin immediately so it can be disabled and replaced.',
      },
      {
        kind: 'p',
        text: 'You are responsible for the cost of replacing a lost, stolen or damaged credential, at the amount the Admin confirms. You are responsible for any access made with a credential you shared or failed to report lost.',
      },
      {
        kind: 'p',
        text: 'Do not tamper with the smart lock, access-control system or door hardware. Tampering may be reported to the authorities and may result in the booking being cancelled without refund.',
      },
      {
        kind: 'p',
        text: 'If the system fails or you are locked out, contact the Admin through the official channels. The Hacienda will use reasonable efforts to restore access. The Hacienda is not responsible for a lockout caused by a lost, shared or expired credential, a device you control, or your failure to follow the access instructions.',
      },
      {
        kind: 'p',
        text: 'The Hacienda may disable a credential if the booking is cancelled, expired, rejected or ends, or if the credential is misused. Access after the booking ends is unauthorized.',
      },
      {
        kind: 'p',
        text: 'Access logs and related data are retained for security and legal purposes as described in section 19. The Hacienda may disclose them to the authorities where required by law.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Do not share your key.',
        text: 'A Mobile Key or RFID card is personal to the booking. Sharing it may allow unauthorized access and may make you responsible for what happens.',
      },
    ],
  },
  {
    id: 'safety',
    title: 'Safety, emergencies and natural hazards',
    summary: 'What the Hacienda provides, what it does not, and what to do in an emergency or a natural hazard.',
    part: 'conduct',
    blocks: [
      {
        kind: 'p',
        text: 'The property is in a rural area of Luisiana, Laguna. It is not a hospital, clinic or emergency service. Emergency and medical services are provided by the relevant public authorities.',
      },
      {
        kind: 'p',
        text: 'In an emergency, call 911. For fire, call the Bureau of Fire Protection. For police assistance, call the Philippine National Police. Also notify the Admin through the official channels so the Hacienda can help.',
      },
      {
        kind: 'p',
        text: 'The Hacienda will provide reasonable safety information, such as the location of fire extinguishers, exits and first-aid supplies. You must follow the safety instructions and evacuation procedures.',
      },
      {
        kind: 'p',
        text: 'The property and its surroundings may include natural hazards: uneven ground, steps, slopes, vegetation, insects, wildlife, water bodies, rivers and weather conditions. Take reasonable care, supervise children, and do not enter water or natural features unless the Admin has confirmed it is safe and permitted.',
      },
      {
        kind: 'p',
        text: 'Typhoons, heavy rain, floods, earthquakes, volcanic activity, fires and other natural events can affect the property and the roads. The Hacienda will share relevant warnings and may change or cancel a stay under section 26.',
      },
      {
        kind: 'p',
        text: 'The Hacienda does not provide security guards or a gated community. The property is private, but you should take reasonable precautions to secure your belongings and the accommodation.',
      },
      {
        kind: 'p',
        text: 'The Hacienda may use access-control logs and, where lawfully installed, security cameras for safety and security. Any camera use will be disclosed and will comply with the Data Privacy Act. The Hacienda does not use access logs to track your location outside the property.',
      },
      {
        kind: 'p',
        text: 'If you see a safety hazard, suspicious behaviour or an emergency, tell the Admin and, where appropriate, the authorities. Do not put yourself at risk.',
      },
      {
        kind: 'note',
        tone: 'warning',
        title: 'Your safety is your responsibility.',
        text: 'The Hacienda is not liable for injury, loss or damage caused by natural hazards, your own actions, or the actions of other guests, except to the extent caused by the Hacienda’s negligence or as required by law.',
      },
    ],
  },
]
