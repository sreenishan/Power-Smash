# Integration: removing old registrations and email sign-ups (migration 0025)

**Status (integrator, 2026-10-31): wired.** Registry rows (section 3), the admin actions and the Settings card (sections 4 and 5, `src/lib/admin/retention/`, `src/admin/screens/Settings.tsx`), the anonymised registration row, RUNBOOK section 13, the checklist line and D-127 are done; `notify_unsubscribe_hashes` is `NONE` in RLS_MATRIX as suggested.

Build agent: retention. What is below is for the integrator. The migration, its check script, the TS module and its tests are done.
They are green on their own, except the three registry tests listed in section 3. Those wait for two rows the integrator adds.
Nothing is switched on. Both keep-for periods start EMPTY, and an empty period means nothing is ever removed. How long to keep is an
open lawyer decision (DPDP; D-028 retention schedule). No period is defaulted anywhere: not in SQL, TS, the admin screen or the docs.

## 1. Files

| Area | File |
|---|---|
| Migration | `supabase/migrations/0025_platform_retention.sql` |
| Checks | `supabase/checks/0025_assertions.sql` (rolled back; fictional rows dated 2001, so the restore drill can run it on a populated copy) |
| Owner rules and texts (no zod) | `src/lib/retention/platform.ts`: `KEEP_DAYS_LIMITS`, `NO_PERIODS`, `checkPeriods`, `describePeriod`, `RETENTION_SCREEN_TEXT`, `parseRetentionRun`, `describeRetentionRun` |
| Admin action schemas (zod) | `src/lib/retention/schemas.ts`: `RETENTION_ACTION_SCHEMAS`, `RETENTION_ACTION_KINDS`, `RETENTION_RPCS` |
| Workflow | `.github/workflows/retention.yml`: a second step calls `admin_run_platform_retention`, behind the same `RETENTION_ENABLED` switch, with the same dry-run input |
| Tests | `tests/retention/platform.test.ts`, `platform-parity.test.ts` (SQL, TS and workflow agree), `platform-local-pg.test.ts` (skips unless the local PostgreSQL is up) |

## 2. What the database does

- `public.retention_settings` holds one row with `registration_keep_days` and `subscriber_keep_days`, both null. The owner may type
  registrations 7 to 3650 days and sign-ups 1 to 3650 days. These are only limits on typing, not suggestions.
- `public.notify_unsubscribe_hashes` holds `email_sha256` and `kept_on` (an India date). It has no id, no time and no link to anything.
- `event_registrations` gets `anonymised_at`. `contact_phone` may now be null, but only on an anonymised row (check
  `event_registrations_has_contact`). An anonymised row must have no contact data (`event_registrations_anonymised_clean`).
- `public.admin_run_platform_retention(p_actor, p_dry_run default true)`: service_role only. It calls
  `app.platform_retention(actor, dry_run, now())`. The inner function takes an explicit "now" so the checks can test the exact boundary.
  Nobody can run it directly.
- `public.admin_set_platform_retention(p_actor, {registrationKeepDays, subscriberKeepDays}, p_reason)`: owner only and audited (field
  names and the new numbers). Null is allowed and clears a period.
- `public.admin_platform_retention_summary(p_actor)`: owner only. It returns the two periods, `updatedAt`, `dueNow` (a dry run at
  now(), counts only) and `unsubscribeHashesKept`.

### Rules of the job

**Registrations.** The clock starts at whichever comes LATER:

- the end of the event's last day, India time (the tournament's `end_date`, or `start_date` if there is no end date);
- the moment the registration was closed (`converted_at` or `rejected_at`).

A registration still `submitted` or `payment_verified` when the event is over counts as closed at the end of the event. A
registration whose tournament has no date is never removed. It is counted in `registrations_without_event_date`, so the owner can add
the date.

What happens to a registration that is due:

- **Converted, or with a verified payment: anonymised.** The entry, its players, the fee, the verified amount, the reference, the
  status and the consent evidence stay. The names as typed become `Anonymised` (and `Anonymised partner` for a pair), and the phone,
  email, payment reference and ip hash are cleared. `whatsapp_ok` becomes false, and a reject reason becomes `Removed after the
  keep-for period`. `revision` goes up by one, so an open admin screen gets STALE.
- **Everything else** (rejected or never processed, with no money recorded): **deleted**. Nothing references a registration row.

**Email sign-ups.** Active subscribers are never touched.

- **Never confirmed:** deleted once the confirmation link has expired AND the last confirmation email is older than the period.
- **Unsubscribed:** deleted once the unsubscribe is older than the period. The SHA-256 of the address is kept.
- A subscriber with an outbox row in `sending` is left for the next run.
- Deleting a subscriber also deletes its old outbox rows (0023 cascade). Those rows hold a subject, a body and the delivery state,
  never an address. The count is `outbox_rows_removed`.

**The hash is behind its own switch (review 2026-10-31).** `retention_settings.keep_unsubscribe_hash`, default false, set by the owner
in the same Settings card ("Remember removed unsubscribed addresses as a code") and audited. While it is false an unsubscribed address is
deleted and NOTHING is kept; `unsubscribe_hashes_kept` stays 0. The lawyer decides whether it may be switched on. A sign-up's action
is decided by its CURRENT status: someone who unsubscribed, then signed up again and did not confirm, is pending (deleted without a
hash). A hash already kept stays even if the person later signs up again and confirms (no trigger removes it); the lawyer should know
this. The real run locks the due rows and their outbox rows, then takes one list that the hash, the counts and the deletes all use.

**Why the hash would be kept, and what it is.** D-028 asks for a suppression list of hashed emails. Deleting an unsubscribed address
entirely would let a later import (a CSV from a tournament, a list from a partner) add it back without the person asking. The hash
lets an import skip it: use `app.notify_email_unsubscribed(email)`. No import path exists yet; any future one must call it.

- The hash does NOT block the person: if they sign up again on the site themselves, they go through double opt-in as usual, because
  that is fresh consent.
- The hash is pseudonymous, not anonymous. Anyone who already knows an address can check it against the list. For that reason it has
  no link to any other row and only a date.
- It is plain SHA-256 of the lower-case, trimmed address. A key held in the database would not make it safer, because a dump would
  hold the key too.
- The hashes are kept with no end date. The lawyer should confirm this, and also confirm whether to keep them at all. If the lawyer
  says no, the owner simply leaves the box unticked. If they want a keyed hash (HMAC with a secret held outside the database), that is a
  later change to `app.notify_email_hash`.

**A cleared registration is frozen.** The trigger `event_registrations_anonymised_frozen` refuses any update of a row whose
`anonymised_at` is set ("INVALID: this registration's details were removed after the keep-for period, so it cannot be changed"), so the
0020 verify, convert and reject RPCs all refuse it. The admin lists it with the closed registrations. The check on anonymised rows also
requires the partner name to be empty or 'Anonymised partner'.

**The answer and the audit hold counts only.** The keys are `dry_run`, `registration_keep_days`, `subscriber_keep_days`,
`registrations_anonymised`, `registrations_deleted`, `registrations_without_event_date`, `subscribers_unconfirmed_deleted`,
`subscribers_unsubscribed_deleted`, `unsubscribe_hashes_kept` and `outbox_rows_removed`.

- A dry run writes nothing, not even an audit row.
- A real run that changed something writes one `platform_retention_run` row: entity `retention`, no entity id, counts and the two
  periods.
- `parseRetentionRun` refuses any other key or any non-number, so a screen built on it can show nothing else.

## 3. Rows the integrator must add (three tests fail until then)

These tests fail now, and only because the two new tables are not in the registries yet:

- `tests/supabase/migrations-structure.test.ts`: "the anon harness lists every one of them"
- `tests/supabase/migration.test.ts`: "lists every private table"
- `tests/admin/rls-matrix-schema.test.ts`: "has a row for every table" and "treats every base table as private"

**`scripts/anon-harness.mjs` (MANIFEST)**, after the 0023 rows (0024 adds its own rows, if any):

```js
  // 0025_platform_retention.sql (D-028): the owner's keep-for periods and the hashes of deleted unsubscribed addresses; both denied
  { name: 'retention_settings', pk: 'id', pkSample: '0' },
  { name: 'notify_unsubscribe_hashes', pk: 'email_sha256', pkSample: '__no_such_hash__' },
```

**`src/lib/admin/policy.ts` (RLS_MATRIX)**, next to the 0023 rows:

```ts
  // 0025_platform_retention.sql (D-028): keep-for periods (owner RPC writes) and unsubscribe hashes (written only by the retention job)
  'retention_settings': { private: true, grants: OWNER_READ_RPC_WRITE },
  'notify_unsubscribe_hashes': { private: true, grants: NONE },
```

(`notify_unsubscribe_hashes` gets `NONE`: the owner never needs to read the hashes; the summary RPC returns their count.)

## 4. Admin actions (owner only, aal2)

| Action | Kind | Input (zod, strict) | RPC |
|---|---|---|---|
| `retention.summary` | read | `{}` | `admin_platform_retention_summary(p_actor)` |
| `retention.save` | write | `{ registrationKeepDays: int 7..3650 \| null, subscriberKeepDays: int 1..3650 \| null, reason }` | `admin_set_platform_retention(p_actor, {registrationKeepDays, subscriberKeepDays}, p_reason)` |

- `src/lib/admin/handler.ts`: spread `RETENTION_ACTION_SCHEMAS` into the action table. Dispatch to two new store methods,
  `retentionSummary()` and `retentionSave(actor, input)`.
- `src/lib/admin/policy.ts`: add `retention.summary` as `ownerRead` and `retention.save` as `ownerWrite` (`RETENTION_ACTION_KINDS`).
- `src/lib/admin/types.ts`: add the two methods to `AdminStore`.
- `supabase-store.ts`: call the two RPCs, and add `RETENTION_RPCS` to the list of RPCs whose `INVALID:` sentences reach the owner as
  they are.
- `memory-store.ts`: keep the periods in memory (both null to start). Return a summary with zero counts.
- `http-store.ts`: one POST per action.
- Do not offer a "run now" button. The job runs from the workflow only. The summary's `dueNow` is the preview.

## 5. Settings screen (fields and text)

Put it under More, then "Privacy clean-up" (or inside the existing settings screen). All text comes from `RETENTION_SCREEN_TEXT`:

- The title, then the intro, which says "Your lawyer decides these periods. Leave a box empty to keep everything of that kind...".
- Two number boxes (digits only, `inputmode="numeric"`). Each has its `label` and `help`, plus a "The lawyer decides" note. An empty
  box saves null. Check the input with `checkPeriods()`, which gives one plain sentence per box. The reason box works the same as the
  other owner forms.
- Under each box, show the current value with `describePeriod()`. An empty period reads "Now: not set, so nothing is removed".
- A "What the next clean-up would remove" panel: `describeRetentionRun(parseRetentionRun(summary.dueNow))`. Show counts only.
- Never put a number in a placeholder or a hint. Placeholders stay empty.
- The registrations admin list must handle an anonymised row. It has `phone: null`, and `player1Name` is `Anonymised`. Today
  `src/lib/admin/registration/supabase-backend.ts` types `contact_phone` as `string`. Make it `string | null`, add `anonymised_at` to
  its select, and show "Contact details removed after the keep-for period" in place of the phone and email.

## 6. Runbook text (docs/RUNBOOK.md section 13, new row)

| Job | State | Rule |
|---|---|---|
| Closed registrations (anonymised if they became entries or a payment was recorded, deleted otherwise) and unconfirmed or unsubscribed email sign-ups (deleted; a hash of an unsubscribed address is kept so an import never re-adds it) | **[built, off]** `admin_run_platform_retention` (migration 0025), second step of `retention.yml`, weekly when `RETENTION_ENABLED=true`. Does nothing until the owner sets a period in the admin. | D-028; periods are owner settings with no default, decided by the lawyer |

Operator note. Before the first real run:

1. Start the Retention workflow by hand with `dry_run` ticked (the default), and read the counts in the log.
2. `registrations_without_event_date` greater than 0 means some tournaments have no dates. Those registrations are never removed until
   a date is added.

## 7. Checklist line (docs/PLATFORM_CHECKLIST.md)

- [ ] Keep-for periods for registrations and email sign-ups decided by the lawyer and entered by the owner in the admin (Privacy
  clean-up). Both are empty until then, so nothing is removed. The lawyer also confirmed that a hash of a deleted unsubscribed address
  may be kept. One dry run of the Retention workflow was read. `RETENTION_ENABLED` is on before the first registration or sign-up
  reaches its period.

## 8. Decision record (for the lead to write in docs/DECISIONS.md)

Suggested next number: "Registration and email sign-up retention". It records:

- the periods are owner settings with no default (null = never);
- converted or paid registrations are anonymised and the rest are deleted, with the clock starting at the later of the event's end and
  the closing time;
- an undated tournament blocks removal;
- unconfirmed sign-ups are deleted after the link expires and the period passes;
- unsubscribed sign-ups are deleted; a SHA-256 hash is kept for imports only while the owner's separate switch is on (off by default; pseudonymous; lawyer to decide);
- the job extends the existing weekly retention workflow.
