// Delivery Policy (DRAFT for a lawyer, OT-15). It doubles as the payment gateway's "shipping" page (spec 15.1, 15.2; VF-D1 notes
// that Razorpay's official list has no Shipping page, but we keep it). Every REQUIRED timeline is a <Todo> for the owner (OT-20);
// nothing numeric is written by us (tests/legal/numbers.test.ts). Sources: spec 7.9, 8.4, 15.1, 15.2; D-019, D-020, D-037; VF-E10.
//
// Hide rule (review finding C-14): travel for events outside the home district and what we need at a venue for a live stream are
// OPTIONAL owner text, not a Todo. They show only when the owner supplies them in facts.ts (travelPolicy, liveStreamVenueNeeds);
// until then the section is hidden and the build leaves an invisible data-owner-hidden marker. Delivery times and the time allowed
// to report a problem are different: the page cannot honestly do without them, so they stay Todos.
import { fact, grievance, link, p, section, strong, table, todo, whenFact, type LegalDoc } from './model';

const deliveryBase: LegalDoc = {
  key: 'delivery',
  path: '/delivery',
  title: 'Delivery Policy',
  description: 'How and when Power Smash delivers tournament coverage, live streams, digital files and sponsor placements.',
  summary: [
    'We provide services and digital files, not physical goods. This page explains how and when each one is delivered, and what to do if something is late or missing.',
  ],
  sections: [
    section('what-we-deliver', 'What we deliver and how', [
      table(
        'Our services and how each one is delivered',
        ['What you bought', 'How it is delivered', 'When'],
        [
          [
            'Coverage of a tournament',
            'Our team films at the venue on the dates and courts agreed in your booking.',
            'On the dates in your booking confirmation.',
          ],
          [
            'Edited videos published on the Power Smash YouTube channel',
            'We publish on our channel and send you the link.',
            [todo('how long after the event the videos are published (OT-20)')],
          ],
          [
            'A live stream',
            'We stream on the Power Smash YouTube channel and send you the link beforehand.',
            'At the start time agreed in your booking.',
          ],
          [
            'A digital file you buy (match file, highlight reel, season pack or custom edit)',
            'We send it to you on WhatsApp or by email.',
            [todo('delivery time for each product (OT-20)')],
          ],
          [
            'A sponsor or partner placement',
            'We place it on this website or in our videos as set out in your agreed package, and send a report if the package includes one.',
            'From the start date in your agreement.',
          ],
        ],
      ),
    ]),

    section(
      'travel-and-venue',
      'Travel and venue needs',
      [
        whenFact('travelPolicy', p(strong('Events outside our home district. '), fact('travelPolicy'))),
        whenFact('liveStreamVenueNeeds', p(strong('Live streams. '), fact('liveStreamVenueNeeds'))),
      ],
      { showWhenAny: ['travelPolicy', 'liveStreamVenueNeeds'] },
    ),

    section('late-or-missing', 'If something is late or missing', [
      p(
        'If a delivery is late or incomplete, message us with your reference code. We will tell you what happened and when you will get it.',
      ),
      p(
        'Check what you receive as soon as you get it. Tell us within ',
        todo('time allowed to report a problem with a delivery (OT-21 item 2)'),
        ' if anything is wrong. What happens next is in our ',
        link('/refunds', 'Cancellation and Refund Policy'),
        '.',
      ),
    ]),

    section('shipping', 'Shipping of physical goods', [
      p(
        'We do not ship physical goods at present, so there are no shipping charges or shipping times. If we start to sell physical goods, such as merchandise, we will update this page first.',
      ),
    ]),

    section('delivery-charges', 'Delivery and travel charges', [
      p(
        'Any delivery or travel charge is shown in your quote before you pay. There are no hidden charges. See our ',
        link('/pricing', 'Pricing page'),
        '.',
      ),
    ]),

    section('questions', 'Questions and complaints', [
      p('If you have a question about a delivery, write to us. If you are not happy with our answer, write to our grievance officer:'),
      grievance(),
      p('Response times for complaints are in our ', link('/terms', 'Terms of Use'), '.'),
    ]),
  ],
};

// No feature flag changes this page: every unsettled owner input is a Todo or hidden (see the header), so the builder takes no flags.
export const buildDeliveryDoc = (): LegalDoc => deliveryBase;
export const deliveryDoc: LegalDoc = buildDeliveryDoc();
