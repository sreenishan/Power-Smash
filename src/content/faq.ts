// FAQ for /services (spec 7.9): travel outside the home district, power and internet for live streams, delivery times,
// cancellations. The QUESTIONS are the spec's topics; every ANSWER is the owner's (OT-20, OT-21) and is null until supplied.
// An item without an answer is hidden (D-034 hide-section rule); with no answered item the whole FAQ section is hidden.
// Never write an answer here that the owner has not given: travel policy, delivery times and cancellation rules are theirs.

export interface FaqItem {
  readonly id: string;
  readonly question: string;
  /** Plain text, owner-supplied. null = not supplied: the item is hidden. */
  readonly answer: string | null;
}

export const faqItems: readonly FaqItem[] = [
  { id: 'travel', question: 'Do you travel outside your home district?', answer: null },
  { id: 'live-stream-needs', question: 'What power and internet do you need for a live stream?', answer: null },
  { id: 'delivery-times', question: 'How long does delivery take?', answer: null },
  { id: 'cancellations', question: 'What happens if I cancel?', answer: null },
];

export function answeredFaq(list: readonly FaqItem[] = faqItems): (FaqItem & { answer: string })[] {
  return list.filter((i): i is FaqItem & { answer: string } => typeof i.answer === 'string' && i.answer.trim() !== '');
}
