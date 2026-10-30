// The notice a person ticks before registering (D-111, D-028). DRAFT wording for the lawyer: registration stays switched off until the
// lawyer has re-read it with the privacy notice (docs/m5/integration/registration.md, G1 checklist). The id and version are stored with
// every registration, and the exact text is kept once per version in public.notice_versions (0002) by registration_submit (0020).
// RULE: bump `version` whenever `text` changes (tests/registration/consent.test.ts pins a hash of the text).
// Never put a price or a fee in this text, and never promise a reply time.
import type { ConsentText } from '../../content/consent';

export const REGISTRATION_CONSENT: ConsentText = {
  id: 'registration-notice',
  version: '2026-10-31-draft2',
  // draft2: no under-18 sentence (registering a child needs a lawyer-approved parental-consent flow, D-109/D-123), no organiser
  // sharing (no organiser can see registrations) and no organiser check (a name is shown only after Power Smash confirms an adult)
  text:
    'I am 18 or over, and every player I register is 18 or over. ' +
    'Power Smash uses these details only to handle this registration and to contact you about this event. A player is named on the ' +
    'website only after Power Smash has confirmed that the player is an adult. We share the details only with the service ' +
    'providers that run this website, and we never sell them. See our Privacy Policy. You can ask us to correct or delete them at ' +
    'any time.',
};
