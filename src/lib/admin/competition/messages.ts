// Plain-English sentences shared by the competition service and the memory backend, and mirrored word for word by the SQL owner RPCs
// (tests/competition/db.test.ts checks the SQL text against these).

/**
 * Why a ranking cannot be published: `count` of its rows are protected NOW (the player's profile changed after the ranking was worked
 * out, or it is a junior ranking). The same sentence as admin_publish_ranking_snapshot in 0018_competition_admin.sql.
 */
export function rankingProtectedMessage(count: number): string {
  const who = count === 1 ? '1 player in this ranking is' : `${count} players in this ranking are`;
  return `${who} now protected (age not confirmed, hidden, provisional, merged or removed on request), so it cannot be published. Work the ranking out again.`;
}
