// Static D-005 rules for a migration file (C-6). Pure functions over the SQL text: no database. Used by
// migrations-structure.test.ts for the real files AND for deliberately broken samples, so the checks are shown to fail.

/** Remove `--` line comments (outside quotes), then split into statements on `;` outside `$$ ... $$` bodies and quotes. */
export function statementsOf(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inDollar: string | null = null;
  let inString = false;
  const push = () => {
    if (cur.trim()) out.push(cur.trim().replace(/\s+/g, ' '));
    cur = '';
  };
  while (i < sql.length) {
    const ch = sql[i] as string;
    const rest = sql.slice(i);
    if (inDollar) {
      if (rest.startsWith(inDollar)) {
        cur += inDollar;
        i += inDollar.length;
        inDollar = null;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (inString) {
      cur += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          cur += "'";
          i += 2;
          continue;
        }
        inString = false;
      }
      i += 1;
      continue;
    }
    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollar) {
      inDollar = dollar[0];
      cur += dollar[0];
      i += dollar[0].length;
      continue;
    }
    if (ch === "'") {
      inString = true;
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === ';') {
      push();
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  push();
  return out;
}

const names = (s: string): string[] => s.split(',').map((x) => x.trim().replace(/^public\./i, '').replace(/^"|"$/g, '').toLowerCase()).filter(Boolean);

export interface MigrationReport {
  tables: string[];
  problems: string[];
}

/** Every D-005 rule violation in one migration, as plain sentences. An empty `problems` list means the file follows the rules. */
export function checkMigration(sql: string): MigrationReport {
  const statements = statementsOf(sql);
  const problems: string[] = [];
  const tables: Array<{ name: string; at: number }> = [];

  statements.forEach((s, at) => {
    const m = /^create table (?:if not exists )?([a-z_]+)\.([a-z_]+)\b/i.exec(s);
    if (m) {
      if (m[1] !== 'public') problems.push(`table ${m[1]}.${m[2]} is not in schema public: add rules for that schema first`);
      else tables.push({ name: (m[2] as string).toLowerCase(), at });
    } else if (/^create table\b/i.test(s)) {
      problems.push(`create table must be schema-qualified: ${s.slice(0, 60)}`);
    }
  });

  for (const t of tables) {
    const rls = statements.findIndex((s, i) => i > t.at && new RegExp(`^alter table (?:only )?public\\.${t.name} enable row level security$`, 'i').test(s));
    if (rls < 0) problems.push(`public.${t.name} has no "enable row level security" after its create statement`);
    const revoked = statements.some((s, i) => {
      if (i <= t.at) return false;
      const m = /^revoke (?:all(?: privileges)?|[a-z, ]+) on (?:table )?(.+?) from (.+)$/i.exec(s);
      if (!m || /^(?:function|sequence|schema|all )/i.test((m[1] as string).trim())) return false;
      const roles = names(m[2] as string);
      return names(m[1] as string).includes(t.name) && roles.includes('anon') && roles.includes('authenticated');
    });
    if (!revoked) problems.push(`public.${t.name} has no revoke from anon, authenticated after its create statement`);
  }

  for (const s of statements) {
    if (/^grant\b/i.test(s)) {
      const m = /^grant (.+?) on (.+?) to (.+)$/i.exec(s);
      if (!m) {
        problems.push(`cannot parse grant: ${s}`);
        continue;
      }
      const roles = names((m[3] as string).replace(/\s+with grant option$/i, ''));
      // The ONLY grants to the API roles: usage on schema api, and select on a view in schema api (the public read surface, D-005 item 2).
      // Everything else, including every table, stays service_role only.
      const what = (m[1] as string).trim();
      const target = (m[2] as string).trim();
      if ((/^usage$/i.test(what) && /^schema api$/i.test(target)) || (/^select$/i.test(what) && /^api\.[a-z_]+$/i.test(target))) {
        if (!roles.every((r) => r === 'anon' || r === 'authenticated')) problems.push(`api read grant to a role other than anon, authenticated: ${s}`);
        if (/with grant option/i.test(s)) problems.push(`grant with grant option: ${s}`);
        continue;
      }
      if (roles.length !== 1 || roles[0] !== 'service_role') problems.push(`grant to ${roles.join(', ')} (only service_role is allowed): ${s}`);
      if (/with grant option/i.test(s)) problems.push(`grant with grant option: ${s}`);
      if (/^grant all\b/i.test(s)) problems.push(`grant all (list the privileges): ${s}`);
    }
    if (/^create policy\b/i.test(s)) {
      const to = /\bto ([a-z_, ]+?)(?: using| with check|$)/i.exec(s);
      if (!to) problems.push(`a policy needs an explicit "to" clause: ${s}`);
      else for (const bad of ['anon', 'authenticated', 'public']) if (names(to[1] as string).includes(bad)) problems.push(`a policy applies to ${bad}: ${s}`);
    }
    const f = /^create (?:or replace )?function ([a-z_]+\.[a-z_]+)\(([^)]*)\)/i.exec(s);
    if (f) {
      const name = (f[1] as string).toLowerCase();
      if (!/set search_path = ''/i.test(s)) problems.push(`function ${name} has no fixed search_path`);
      const closed = statements.some((x) => {
        const r = /^revoke (?:all(?: privileges)?|execute) on function ([a-z_.]+)\(([^)]*)\) from (.+)$/i.exec(x);
        if (!r || (r[1] as string).toLowerCase() !== name) return false;
        const roles = names(r[3] as string);
        return roles.includes('anon') && roles.includes('authenticated');
      });
      if (!closed) problems.push(`function ${name} is not revoked from anon, authenticated`);
    }
  }
  return { tables: tables.map((t) => t.name), problems };
}
