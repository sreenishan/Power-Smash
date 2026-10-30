// The /live views (migration 0013, D-101) must not drift from src/lib/live/source.ts, the SQL limits must match src/lib/live/rules.ts, and
// the migration must keep the house rules: RLS on, no policies, everything revoked, the RPC locked down, nothing pinned by default.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIVE_LIMITS } from '../../src/lib/live/rules';
import { LIVE_VIEWS } from '../../src/lib/live/source';

const sql = readFileSync('supabase/migrations/0013_live_pin.sql', 'utf8').replace(/\r\n/g, '\n');

const viewColumns = (name: string): string[] => {
  const m = new RegExp(`create view api\\.${name} with \\(security_barrier = true\\) as\\s+select (.*?)\\s+from public\\.`, 's').exec(sql);
  expect(m, name).not.toBeNull();
  return m![1]!.split(',').map((c) => c.trim().replace(/^[a-z]\./, ''));
};

describe('migration 0013 live pin', () => {
  it('the two public views select exactly the columns the build reads', () => {
    expect(viewColumns(LIVE_VIEWS.settings.name)).toEqual([...LIVE_VIEWS.settings.columns]);
    expect(viewColumns(LIVE_VIEWS.past.name)).toEqual([...LIVE_VIEWS.past.columns]);
    expect(sql).toContain(`grant select on api.${LIVE_VIEWS.settings.name} to anon, authenticated;`);
    expect(sql).toContain(`grant select on api.${LIVE_VIEWS.past.name} to anon, authenticated;`);
  });

  it('the SQL limits match the shared rule', () => {
    expect(sql).toContain(`length(title) between 1 and ${LIVE_LIMITS.title}`);
    expect(sql).toContain(`position between 0 and ${LIVE_LIMITS.pastStreams - 1}`);
    expect(sql).toContain(`jsonb_array_length(p_past) > ${LIVE_LIMITS.pastStreams}`);
    expect(sql).toContain(`length(v_title) not between 1 and ${LIVE_LIMITS.title}`);
    expect(sql.match(/\^\[A-Za-z0-9_-\]\{11\}\$/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('turns RLS on, revokes everything, grants the service role select only, and writes only through the locked-down RPC', () => {
    for (const t of ['live_settings', 'live_past_streams']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on table public.${t} from public, anon, authenticated, service_role;`);
      expect(sql).toContain(`grant select on public.${t} to service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]*public\\.${t}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/create or replace function public\.admin_save_live\(p_actor text, p_pinned text, p_past jsonb, p_reason text\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/);
    expect(sql).toMatch(/begin\n {2}perform app\.require_owner\(p_actor\);/);
    expect(sql).toContain('revoke all on function public.admin_save_live(text, text, jsonb, text) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.admin_save_live(text, text, jsonb, text) to service_role;');
  });

  it('pins nothing and lists nothing by default, and never audits a title', () => {
    expect(sql).toContain("insert into public.live_settings (id, pinned_video_id, updated_by) values (1, null, 'migration 0013');");
    expect(sql).not.toMatch(/insert into public\.live_past_streams[^;]*values \('/i);
    const audit = /perform app\.audit\(([\s\S]*?)\);/.exec(sql)?.[1] ?? '';
    expect(audit).not.toMatch(/title/);
    expect(sql).toContain("perform app.mark_dirty('live pin', false);");
  });
});
