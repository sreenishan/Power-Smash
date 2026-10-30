// Result checks before the RPC (PURE). The scoring engine (validateMatch) decides whether the games are possible under the event's
// ruleset; the database checks again (app.competition_result_winner). Reasons are plain English for the owner.
import { validateMatch, type Ruleset } from '../../competition/scoring';
import type { Side } from '../../competition/types';
import type { RecordResultRecord } from './types';

export type ResultCheck = { ok: true; winner: Side | null } | { ok: false; reasons: string[] };

export function checkResult(record: RecordResultRecord, ruleset: Readonly<Ruleset>): ResultCheck {
  const reasons: string[] = [];
  if (record.status !== 'walkover' && record.walkoverWinner !== null) reasons.push('Only a walkover names the side that received it.');
  if (record.status !== 'retired' && record.retiringSide !== null) reasons.push('Only a retirement names the side that retired.');
  if (reasons.length > 0) return { ok: false, reasons };
  if (record.status === 'abandoned') {
    // like a retirement without a winner: finished games must be real, the last may be unfinished, and nobody has won yet
    if (record.games.length === 0) return { ok: true, winner: null };
    const check = validateMatch(record.games, ruleset, 'retired', { retiringSide: 'A' });
    if (!check.valid) return { ok: false, reasons: check.reasons.map((r) => r.replace('it cannot end in a retirement', 'it cannot be abandoned').replace('record this as a walkover, not a retirement', 'leave the games empty')) };
    return { ok: true, winner: null };
  }
  const check = validateMatch(record.games, ruleset, record.status, {
    ...(record.walkoverWinner !== null ? { walkoverWinner: record.walkoverWinner } : {}),
    ...(record.retiringSide !== null ? { retiringSide: record.retiringSide } : {}),
  });
  return check.valid ? { ok: true, winner: check.winner } : { ok: false, reasons: check.reasons };
}
