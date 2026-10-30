import { describe, expect, it } from 'vitest';
import { ADMIN_ACTIONS, DB_OPS, DB_ROLES, isActionAllowed, isAllowedOp, RLS_MATRIX, type AdminActionName, type MatrixTable } from '../../src/lib/admin/policy';

const tables = Object.keys(RLS_MATRIX) as MatrixTable[];
const actions = Object.keys(ADMIN_ACTIONS) as AdminActionName[];

describe('admin action policy', () => {
  it('every action requires aal2 and is owner-only at launch', () => {
    for (const a of actions) {
      expect(ADMIN_ACTIONS[a].requiresAal2).toBe(true);
      expect(ADMIN_ACTIONS[a].roles).toEqual(['owner']);
    }
  });
  it('every write action is audited', () => {
    for (const a of actions) if (ADMIN_ACTIONS[a].kind === 'write') expect(ADMIN_ACTIONS[a].audited, a).toBe(true);
  });
  it('role x action table: owner yes, editor never (even when enabled, D-007), no role never', () => {
    for (const a of actions) {
      expect(isActionAllowed('owner', a, { editorsEnabled: false })).toBe(true);
      expect(isActionAllowed('editor', a, { editorsEnabled: false })).toBe(false);
      expect(isActionAllowed('editor', a, { editorsEnabled: true })).toBe(false);
      expect(isActionAllowed(null, a, { editorsEnabled: true })).toBe(false);
    }
  });
  it('covers the actions the plan names', () => {
    for (const a of ['review.resolve', 'players.merge', 'players.split', 'players.rename', 'players.confirmAdult', 'settings.setProtectedMode', 'emergency.hide', 'site.syncNow', 'site.publishNow'] as const) {
      expect(actions).toContain(a);
    }
  });
});

describe('RLS / grants matrix (pure policy table)', () => {
  it('is complete: every table defines every role', () => {
    for (const t of tables) for (const r of DB_ROLES) expect(Array.isArray(RLS_MATRIX[t].grants[r]), `${t}/${r}`).toBe(true);
  });
  it('anon and signed-in-without-profile can only read the public api views', () => {
    for (const t of tables) {
      for (const role of ['anon', 'authenticated'] as const) {
        for (const op of DB_OPS) {
          const expected = t.startsWith('api.public_') && op === 'select';
          expect(isAllowedOp(t, role, op), `${t} ${role} ${op}`).toBe(expected);
        }
      }
    }
  });
  it('private tables are never reachable by anon', () => {
    for (const t of tables) if (RLS_MATRIX[t].private) for (const op of DB_OPS) expect(isAllowedOp(t, 'anon', op), `${t} ${op}`).toBe(false);
  });
  it('the public views are exactly the api views the archive types list, plus the products view (0011, D-099) and the live views (0013, D-101) and the competition views (0017)', async () => {
    const { API_VIEWS } = await import('../../src/lib/archive/types');
    const { PRODUCT_VIEW } = await import('../../src/lib/products/db');
    const { LIVE_VIEWS } = await import('../../src/lib/live/source');
    const { COMPETITION_VIEW_COLUMNS } = await import('../../src/lib/competition/db');
    const { LIVE_VIEW } = await import('../../src/lib/live-scores/public');
    const { INTERNATIONAL_VIEW } = await import('../../src/lib/international/public/provider');
    // 0020 registration (event ids and fees; the payee payment texts), 0021 live scores, 0022 international links, 0023 site notices and the sign-up switch
    const WAVE5_VIEWS = ['public_registration_events', 'public_registration_payment', LIVE_VIEW, INTERNATIONAL_VIEW, 'public_site_notices', 'public_notify_settings'];
    expect(tables.filter((t) => t.startsWith('api.')).sort()).toEqual([...API_VIEWS, PRODUCT_VIEW, LIVE_VIEWS.settings.name, LIVE_VIEWS.past.name, ...Object.keys(COMPETITION_VIEW_COLUMNS), ...WAVE5_VIEWS].map((v) => `api.${v}`).sort());
  });
  it('audit_log is append-only for everyone: no update, no delete, no direct insert, even for the owner', () => {
    for (const role of DB_ROLES) for (const op of ['insert', 'update', 'delete'] as const) expect(isAllowedOp('audit_log', role, op, { editorsEnabled: true }), `${role} ${op}`).toBe(false);
    expect(isAllowedOp('audit_log', 'owner', 'select')).toBe(true);
  });
  it('editors have no table access at launch and none even if the flag is flipped before the matrix is extended', () => {
    for (const t of tables) {
      if (t.startsWith('api.')) continue;
      for (const op of DB_OPS) {
        expect(isAllowedOp(t, 'editor', op), `${t} ${op}`).toBe(false);
        expect(isAllowedOp(t, 'editor', op, { editorsEnabled: true }), `${t} ${op} enabled`).toBe(false);
      }
    }
  });
  it('the owner never writes archive or business tables directly: writes go through audited RPCs', () => {
    for (const t of tables) for (const op of ['insert', 'update', 'delete'] as const) expect(isAllowedOp(t, 'owner', op), `${t} ${op}`).toBe(false);
  });
  it('private contact data tables are owner-read only', () => {
    for (const t of ['tournament_private', 'leads', 'sponsors', 'profile_requests', 'consent_events'] as const) {
      expect(RLS_MATRIX[t].private).toBe(true);
      expect(isAllowedOp(t, 'owner', 'select')).toBe(true);
      expect(isAllowedOp(t, 'anon', 'select')).toBe(false);
    }
  });
  it('the tables named in the privacy rules are in the matrix', () => {
    for (const t of ['tournament_private', 'leads', 'sponsors', 'profile_requests', 'suppression', 'slug_redirects', 'audit_log', 'profiles'] as const) expect(tables).toContain(t);
  });
});
