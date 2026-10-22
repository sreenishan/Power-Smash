// Page-budget guard (D-009, M2c). One prerendered page is one file in .vercel/output/static (G0 measured about 1.0007 files per page on the
// old Cloudflare build, plus about 10 other files), so the file budget is effectively a page budget: WARN at 10,000 files, FAIL above
// 14,000 (D-009 kept on Vercel as a soft guard: Vercel has no hard output-file cap, the limit is the 45-minute build). `assessBudget` is a pure function; `assertPageBudget` is what the build calls on the loaded archive.
import { PAGE_SIZE, type PublicArchive } from './model';

export const FILE_WARN_AT = 10_000;
export const FILE_FAIL_ABOVE = 14_000;

export type BudgetLevel = 'ok' | 'warn' | 'fail';

export interface BudgetResult {
  level: BudgetLevel;
  files: number;
  message: string;
}

export function assessBudget(files: number, warnAt: number = FILE_WARN_AT, failAbove: number = FILE_FAIL_ABOVE): BudgetResult {
  if (!Number.isFinite(files) || files < 0) return { level: 'fail', files, message: 'The file count is not a valid number.' };
  if (files > failAbove) return { level: 'fail', files, message: `${files} files is above the ${failAbove} limit (Workers Free allows 20,000). Reduce pages before building.` };
  if (files >= warnAt) return { level: 'warn', files, message: `${files} files has reached the ${warnAt} warning line (the limit is ${failAbove}).` };
  return { level: 'ok', files, message: `${files} files, under the ${warnAt} warning line.` };
}

/** Pages this slice adds (plus the fixed ones): lists, match pages, player pages, indexes, sitemaps. Other slices add their own. */
export function estimatePageCount(archive: Pick<PublicArchive, 'matches' | 'grid' | 'players' | 'minimalPlayers'>): number {
  const listPages = Math.max(1, Math.ceil(archive.grid.length / PAGE_SIZE));
  const fixed = 1 /* /players/ */ + 2 /* search + matches JSON */ + 5 /* sitemaps */;
  return listPages + archive.matches.length + archive.players.length + archive.minimalPlayers.length + fixed;
}

/** Throws (fails the build) above the fail line; warns on the console at the warning line. */
export function assertPageBudget(archive: Pick<PublicArchive, 'matches' | 'grid' | 'players' | 'minimalPlayers'>, otherFiles = 60): BudgetResult {
  const result = assessBudget(estimatePageCount(archive) + otherFiles);
  if (result.level === 'fail') throw new Error(`Archive page budget: ${result.message}`);
  if (result.level === 'warn') console.warn(`[archive] page budget warning: ${result.message}`);
  return result;
}
