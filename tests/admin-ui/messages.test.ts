// The admin's generic sentences stay neutral: the STALE text names no feature (it is shown for players, tournaments, competitions...);
// the video example lives only in the tournament-details form, where new videos are the usual cause.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messageFor, STALE_TOURNAMENT_DETAILS } from '../../src/admin/messages';

describe('admin messages', () => {
  it('the generic STALE sentence is neutral', () => {
    expect(messageFor('STALE')).toBe('This changed since you opened it. Open it again and make your change once more.');
    expect(messageFor('STALE')).not.toMatch(/video|match|categor/i);
  });
  it('the video example is kept for the tournament-details form only', () => {
    expect(STALE_TOURNAMENT_DETAILS).toMatch(/new videos added a category/);
    const tournaments = readFileSync(join(process.cwd(), 'src/admin/screens/Tournaments.tsx'), 'utf8');
    expect(tournaments).toContain("r.code === 'STALE' && !r.errors?.['form'] ? { ...(r.errors ?? {}), form: STALE_TOURNAMENT_DETAILS }");
  });
});
