// Cancellation and Refund Policy: STRUCTURE AND HEADINGS ONLY (OT-21). Every amount, percentage, window and timeline is a
// <Todo> for the owner. Nothing numeric is written by us on this page (tests/legal/numbers.test.ts enforces that). These are
// required owner inputs (the page cannot honestly do without them), so they stay Todos and are NOT hidden (finding C-14).
// Sources: spec 15.1, 15.2; VF-D1 (Razorpay website review wants a refund policy), VF-D5 (the gateway fee is not returned on a
// refund), VF-D16 (CA: receipts, credit notes), VF-E10; D-020, D-021, D-037. The owner's decision questions are listed in
// docs/m1/legal-notes.md.
import { grievance, link, p, section, table, todo, ul, type LegalDoc } from './model';

const refundsBase: LegalDoc = {
  key: 'refunds',
  path: '/refunds',
  title: 'Cancellation and Refund Policy',
  description: 'What happens to your payment if you cancel or change a booking with Power Smash, or if something goes wrong.',
  summary: [
    'This page explains what happens if you cancel or change a booking, or if we cannot deliver. It applies to the services you pay for, such as tournament coverage, live streaming, sponsor and partner packages, and player products like match files and highlight reels.',
  ],
  sections: [
    section('how-you-pay', 'How you pay', [
      p(
        todo('whether we ask for an advance, how much it is (an amount or a share of the price), and when the balance is due (OT-21 item 1)'),
        '.',
      ),
      p(
        'You pay through a payment link from our payment provider, or in another way shown in your quote. We give you a receipt or invoice for your payment.',
      ),
    ]),

    section('cancel-by-you', 'If you cancel', [
      p('The refund depends on how early you tell us:'),
      table(
        'Refund if you cancel',
        ['When you tell us', 'What you get back'],
        [
          [todo('early cancellation window, for example how many days before the event (OT-21 item 1)'), todo('refund for an early cancellation (OT-21 item 2)')],
          [todo('late cancellation window, closer to the event (OT-21 item 1)'), todo('refund for a late cancellation (OT-21 item 2)')],
          [
            todo('cut-off after which no refund is given, for example once coverage has started or files have been delivered (OT-21 item 1)'),
            todo('refund after the cut-off (OT-21 item 2)'),
          ],
        ],
      ),
      p('To cancel, write to us on WhatsApp or by email and give your reference code. ', todo('how and from when a cancellation counts (OT-21 item 1)'), '.'),
    ]),

    section('changing-the-date', 'Changing the date or the event', [
      p(todo('rules for changing the date or the event: how often, how much notice, and any extra charge (OT-21 item 1)')),
    ]),

    section('cancel-by-us', 'If we cancel or cannot deliver', [
      p(
        'We may have to cancel or change a service if the event is cancelled, the organiser withdraws permission, or something outside our control stops us. We will tell you as soon as we can. If we do not deliver a service you paid for, ',
        todo('what we offer: a refund of the amount paid for the undelivered part, a new date, or a credit (OT-21 item 2)'),
        '.',
      ),
    ]),

    section('digital-deliverables', 'Digital files (match files, highlight reels, edits)', [
      p(
        'A digital file cannot be taken back once you have it. ',
        todo('refund rule once a digital file has been delivered (OT-21 item 2)'),
        '.',
      ),
      p(
        'If a file is faulty, incomplete or not what we agreed, tell us within ',
        todo('time allowed to report a problem with a delivery (OT-21 item 2)'),
        ' and we will ',
        todo('fix it, replace it or refund it (OT-21 item 2)'),
        '.',
      ),
    ]),

    section('sponsor-packages', 'Sponsor and partner packages', [
      p(todo('cancellation and refund rules for sponsor and partner packages, including a package already partly delivered (OT-21)')),
    ]),

    section('how-refunds-are-paid', 'How refunds are paid', [
      p(
        'A refund for a payment made through our payment provider goes back to the payment method you used, unless we agree something else with you. ',
        todo('how long a refund takes to reach you (OT-21 item 2)'),
        '.',
      ),
      p(
        'Our payment provider does not return its fee to us when a refund is made. ',
        todo('whether that fee is taken off your refund or we bear it (owner decision, OT-21)'),
        '.',
      ),
    ]),

    section('asking-for-a-refund', 'How to ask for a refund', [
      p(
        'Write to us on WhatsApp or by email with your reference code and the reason. We will reply to confirm that we have your request and tell you the next step.',
      ),
      p(
        'If you are not happy with our answer, write to our grievance officer. The details are below, and the response times are in our ',
        link('/terms', 'Terms of Use'),
        '.',
      ),
      grievance(),
    ]),

    section('your-rights', 'Your legal rights', [
      ul(
        ['This policy does not take away any right you have under consumer law.'],
        ['Disputes are handled as set out in our ', link('/terms', 'Terms of Use'), '.'],
      ),
    ]),
  ],
};

// No feature flag changes this page: every unsettled owner input is a Todo or hidden (see the header), so the builder takes no flags.
export const buildRefundsDoc = (): LegalDoc => refundsBase;
export const refundsDoc: LegalDoc = buildRefundsDoc();
