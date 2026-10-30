// The sign-up island's answer handling (pure): one accepted sentence for every address, field sentences from the shared codes.
import { describe, expect, it } from 'vitest';
import { answerText } from '../../src/components/site/notices/SubscribeForm';
import { SUBSCRIBE_ACCEPTED_MESSAGE, SUBSCRIBE_ERROR_MESSAGES } from '../../src/lib/notices/constants';

describe('answerText', () => {
  it('202 with the accepted message is done', () => {
    expect(answerText(202, { ok: true, message: SUBSCRIBE_ACCEPTED_MESSAGE })).toEqual({ done: true, message: SUBSCRIBE_ACCEPTED_MESSAGE });
  });
  it('field codes become the shared sentences; the check is kept for a validation answer', () => {
    const a = answerText(400, { ok: false, code: 'validation', fieldErrors: { email: 'invalid', adult: 'required', consent: 'invalid' } });
    expect(a).toMatchObject({ done: false, message: SUBSCRIBE_ERROR_MESSAGES.validation, resetCheck: false });
    if (!a.done) {
      expect(a.fields.email).toContain('Check the email address');
      expect(a.fields.adult).toBe('You must be 18 or older to sign up.');
      expect(a.fields.consent).toContain('reload the page');
    }
  });
  it('anything unknown is a plain server sentence and resets the spam check', () => {
    expect(answerText(500, null)).toMatchObject({ done: false, message: SUBSCRIBE_ERROR_MESSAGES.server, resetCheck: true });
    expect(answerText(409, { ok: false, code: 'closed' })).toMatchObject({ message: SUBSCRIBE_ERROR_MESSAGES.closed });
  });
});
