// Real testimonials ONLY, each with the person's permission (never fabricate; spec section 0 rule 5, OT-22).
// Empty until the owner supplies real ones. A section that lists testimonials is hidden while this has no showable item.

export interface Testimonial {
  readonly quote: string;
  /** Who said it, as they agreed to be shown (for example a first name and their role or event). */
  readonly attribution: string;
  /** The owner holds the person's permission to publish this quote. */
  readonly permissionRecorded: boolean;
}

export const testimonials: readonly Testimonial[] = [];

export function showableTestimonials(list: readonly Testimonial[] = testimonials): Testimonial[] {
  return list.filter((t) => t.permissionRecorded === true && t.quote.trim() !== '' && t.attribution.trim() !== '');
}
