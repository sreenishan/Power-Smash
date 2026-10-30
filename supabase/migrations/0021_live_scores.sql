-- 0021_live_scores.sql: near-live public scores (platform wave 5, D-113).
--
--   public.match_live_state           one row per match that has been scored rally by rally: the current game score, games won, the
--                                     finished games, the server and the instant of the last point. Written ONLY by the RPCs below
--                                     (a cache of the append-only rally log, public.match_score_events of 0017, rebuilt from it on every
--                                     tap); never by hand. No personal data.
--   competition_settings              gains live_scores_public (default OFF) and live_window_seconds (default 300 = 5 minutes, 60..3600):
--                                     a match is shown as "Live" only while its last point is younger than the window (D-113: "Live"
--                                     only while an authorised scorer is actually sending updates).
--   app.competition_live_replay       the rally log replayed by the scoring rules (mirrors replayScoreEvents in
--                                     src/lib/live-scores/replay.ts and the engine src/lib/competition/scoring: recordPoint, undo).
--   public.admin_live_score           append one tap to the rally log: a rally won by side A or B, an undo (a compensating event: the
--                                     log is never changed, the last effective rally is taken back on replay) or the first server.
--                                     Idempotent on the tap's key (a retry of the same tap is stored once and answers the same state),
--                                     and refused as STALE when the caller's expected sequence is not the last one (another device
--                                     scored in between). Rallies and undos need the match to be live.
--   public.admin_live_match_status    start (scheduled/ready -> live), pause, resume, end. End writes the result from the rally log
--                                     (completed: the log must show the match won; retired: a side retired; abandoned) as an
--                                     UNCONFIRMED result, result_source 'scorer', exactly like admin_record_result: it reaches the
--                                     public only after the owner confirms it on the Results screen.
--   public.admin_set_live_scores      the owner's database switch and the window (owner only, always).
--   app.competition_live_settings     the switch and window for the api view (the api view never reads the settings table directly).
--   api.public_competition_live       live and paused matches of public events with a published draw, only while the switch is on:
--                                     current game score, games won, finished games, the server, last_update and is_live (a point
--                                     within the window). Players are named ONLY through app.competition_entry_faces (0018,
--                                     app.competition_named_players), so a protected player (D-012, D-109, D-116) is never named;
--                                     a missing face counts as protected.
--
-- ACCESS. admin_live_score and admin_live_match_status call app.require_competition_access(p_actor,
-- app.competition_tournament_of('match', p_match), 'score') first (0019, D-108): the owner always; an organizer or scorer only while
-- organizer access is on, the account is not ended and it holds an active assignment to that match's tournament. The settings RPC
-- (admin_set_live_scores) stays app.require_owner.
-- AUDIT. Status changes, undos, the first server and the settings are audited with ids, counts and codes only (never a name). A rally
-- is not written to audit_log one by one: the rally log itself is append-only and records who (recorded_by = the verified actor) and
-- when (recorded_at) for every tap, so it is the audit trail of the score.
-- House rules (0001-0018): RLS on with no policies, everything revoked, service_role select only on base tables; SECURITY DEFINER
-- with search_path = '', the access check first, errors start 'INVALID:', 'NOT_FOUND:' or 'STALE:' (and 'FORBIDDEN:' from the access
-- check); explicit-column security_barrier api view. Apply after 0020 (it needs only 0001-0018), then run
-- supabase/checks/0021_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- Settings: the database switch (off) and the live window (5 minutes)
-- ------------------------------------------------------------------------------------------------------------------
alter table public.competition_settings add column live_scores_public boolean not null default false;
alter table public.competition_settings add column live_window_seconds integer not null default 300
  constraint competition_settings_live_window check (live_window_seconds between 60 and 3600);
comment on column public.competition_settings.live_scores_public is 'D-113: near-live scores reach api.public_competition_live only while this is on (owner switch, default off).';
comment on column public.competition_settings.live_window_seconds is 'D-113: a match shows "Live" only while its last point is younger than this many seconds (60 to 3600, default 300).';

-- ------------------------------------------------------------------------------------------------------------------
-- match_live_state: the replayed rally log of one match (a cache; rebuilt on every tap)
-- ------------------------------------------------------------------------------------------------------------------
create table public.match_live_state (
  match_id        uuid        primary key references public.competition_matches (id) on delete restrict,
  last_seq        integer     not null default 0 check (last_seq >= 0),
  first_server    text        check (first_server is null or first_server in ('A', 'B')),
  rallies         integer     not null default 0 check (rallies >= 0),
  game_number     smallint    not null default 1 check (game_number between 1 and 5),
  points_a        smallint    not null default 0 check (points_a between 0 and 30),
  points_b        smallint    not null default 0 check (points_b between 0 and 30),
  games_a         smallint    not null default 0 check (games_a between 0 and 3),
  games_b         smallint    not null default 0 check (games_b between 0 and 3),
  finished_games  jsonb       not null default '[]'::jsonb check (jsonb_typeof(finished_games) = 'array' and jsonb_array_length(finished_games) <= 5),
  server_side     text        check (server_side is null or server_side in ('A', 'B')),
  match_over      boolean     not null default false,
  winner_side     text        check (winner_side is null or winner_side in ('A', 'B')),
  last_point_at   timestamptz,
  updated_at      timestamptz not null default now(),
  constraint match_live_state_winner check (match_over = (winner_side is not null)),
  constraint match_live_state_over_no_server check (not match_over or server_side is null)
);
comment on table public.match_live_state is 'Replayed state of the rally log (match_score_events) of a match: current game, games won, finished games, last point. Written only by admin_live_score and admin_live_match_status.';
create trigger match_live_state_touch_updated_at before update on public.match_live_state for each row execute function app.touch_updated_at();

alter table public.match_live_state enable row level security;
revoke all on table public.match_live_state from public, anon, authenticated, service_role;
grant select on public.match_live_state to service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- app.competition_live_replay: replays the rally log of a match by the event's ruleset (mirrors replayScoreEvents in
-- src/lib/live-scores/replay.ts). first_server only before the first effective rally; rally adds a point (refused once the match is
-- won); undo takes back the last effective rally (refused when there is none). A game ends on the first rally that makes it over
-- (app.competition_game_over); the match ends when a side has won gamesToWin games. Returns the state as jsonb (camelCase, the shape
-- of LiveSnapshot in src/lib/live-scores/types.ts). Read-only.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function app.competition_live_replay(p_match uuid, p_ruleset jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r record;
  v_stack text := '';   -- the effective rally winners in order, one character each ('A' or 'B')
  v_first text;
  v_last_seq integer := 0;
  v_last_point timestamptz;
  v_gtw integer;
  a integer := 0;
  b integer := 0;
  ga integer := 0;
  gb integer := 0;
  v_games jsonb := '[]'::jsonb;
  v_winner text;
  v_side text;
  i integer;
begin
  if app.competition_ruleset_problem(p_ruleset) is not null then
    raise exception 'INVALID: the event ruleset is not usable' using errcode = '22023';
  end if;
  v_gtw := (p_ruleset ->> 'gamesToWin')::integer;
  for r in select e.seq, e.kind, e.side, e.recorded_at from public.match_score_events e where e.match_id = p_match order by e.seq loop
    v_last_seq := r.seq;
    if r.kind = 'first_server' then
      if length(v_stack) > 0 then raise exception 'INVALID: the first server is chosen before the first rally' using errcode = '22023'; end if;
      v_first := r.side;
    elsif r.kind = 'rally' then
      v_stack := v_stack || r.side;
      v_last_point := r.recorded_at;
    else
      if length(v_stack) = 0 then raise exception 'INVALID: nothing to undo; no points have been recorded' using errcode = '22023'; end if;
      v_stack := left(v_stack, length(v_stack) - 1);
      v_last_point := r.recorded_at;
    end if;
  end loop;

  for i in 1 .. length(v_stack) loop
    if v_winner is not null then raise exception 'INVALID: the match is over; no more points can be recorded' using errcode = '22023'; end if;
    v_side := substr(v_stack, i, 1);
    if v_side = 'A' then a := a + 1; else b := b + 1; end if;
    if app.competition_game_over(a, b, p_ruleset) then
      v_games := v_games || jsonb_build_array(jsonb_build_object('a', a, 'b', b));
      if a > b then ga := ga + 1; else gb := gb + 1; end if;
      a := 0;
      b := 0;
      if ga >= v_gtw then v_winner := 'A'; elsif gb >= v_gtw then v_winner := 'B'; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'lastSeq', v_last_seq,
    'firstServer', v_first,
    'rallySides', v_stack,
    'rallies', length(v_stack),
    'gameNumber', case when v_winner is not null then jsonb_array_length(v_games) else jsonb_array_length(v_games) + 1 end,
    'pointsA', a,
    'pointsB', b,
    'gamesA', ga,
    'gamesB', gb,
    'games', v_games,
    'server', case when v_winner is not null then null when length(v_stack) > 0 then right(v_stack, 1) else v_first end,
    'matchOver', v_winner is not null,
    'winnerSide', v_winner,
    'lastPointAt', v_last_point
  );
end;
$$;

-- stores a replayed state (the jsonb of app.competition_live_replay) as the match's live row
create or replace function app.competition_live_store(p_match uuid, p jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.match_live_state (match_id, last_seq, first_server, rallies, game_number, points_a, points_b, games_a, games_b,
                                       finished_games, server_side, match_over, winner_side, last_point_at)
  values (p_match, (p ->> 'lastSeq')::integer, p ->> 'firstServer', (p ->> 'rallies')::integer, (p ->> 'gameNumber')::smallint,
          (p ->> 'pointsA')::smallint, (p ->> 'pointsB')::smallint, (p ->> 'gamesA')::smallint, (p ->> 'gamesB')::smallint,
          p -> 'games', p ->> 'server', (p ->> 'matchOver')::boolean, p ->> 'winnerSide', (p ->> 'lastPointAt')::timestamptz)
  on conflict (match_id) do update
     set last_seq = excluded.last_seq, first_server = excluded.first_server, rallies = excluded.rallies, game_number = excluded.game_number,
         points_a = excluded.points_a, points_b = excluded.points_b, games_a = excluded.games_a, games_b = excluded.games_b,
         finished_games = excluded.finished_games, server_side = excluded.server_side, match_over = excluded.match_over,
         winner_side = excluded.winner_side, last_point_at = excluded.last_point_at;
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_live_score: record {kind: 'rally' | 'undo' | 'first_server', side: 'A' | 'B' | null, key, expectedSeq}.
-- key: the tap's idempotency key (8 to 80 of A-Z a-z 0-9 _ -), made on the scorer's device for each tap and sent again on a retry.
-- expectedSeq: the last sequence number the device knows (0 before the first tap).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_live_score(p_actor text, p_match uuid, p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.competition_matches%rowtype;
  ev public.match_score_events%rowtype;
  v_kind text;
  v_side text;
  v_key text;
  v_expected integer;
  v_last integer;
  v_ruleset jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_match), 'score');
  perform app.competition_keys(p_record, array['kind', 'side', 'key', 'expectedSeq'], 'score');
  if jsonb_typeof(p_record -> 'kind') is distinct from 'string' or (p_record ->> 'kind') not in ('rally', 'undo', 'first_server') then
    raise exception 'INVALID: a tap is a rally, an undo or the first server' using errcode = '22023';
  end if;
  v_kind := p_record ->> 'kind';
  if jsonb_typeof(p_record -> 'side') not in ('string', 'null') or (jsonb_typeof(p_record -> 'side') = 'string' and (p_record ->> 'side') not in ('A', 'B')) then
    raise exception 'INVALID: a side is "A", "B" or null' using errcode = '22023';
  end if;
  v_side := p_record ->> 'side';
  if (v_kind = 'undo') <> (v_side is null) then
    raise exception 'INVALID: a rally and the first server name a side; an undo does not' using errcode = '22023';
  end if;
  if jsonb_typeof(p_record -> 'key') is distinct from 'string' or (p_record ->> 'key') !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'INVALID: the tap key must be 8 to 80 letters, digits, - or _' using errcode = '22023';
  end if;
  v_key := p_record ->> 'key';
  v_expected := app.competition_int(p_record -> 'expectedSeq', 'expectedSeq', 0, 1000000);
  if v_expected is null then raise exception 'INVALID: expectedSeq is missing' using errcode = '22023'; end if;

  select * into m from public.competition_matches where id = p_match for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  select e.ruleset into v_ruleset from public.tournament_events e where e.id = m.event_id;

  -- the same tap again (a retry after a lost answer): stored once, the current state is the answer
  select * into ev from public.match_score_events e where e.match_id = m.id and e.idempotency_key = v_key;
  if found then
    if ev.kind <> v_kind or ev.side is distinct from v_side then
      raise exception 'INVALID: this tap key was already used for a different tap' using errcode = '22023';
    end if;
    return jsonb_build_object('matchId', m.id, 'duplicate', true, 'seq', ev.seq, 'status', m.status, 'revision', m.revision,
                              'state', app.competition_live_replay(m.id, v_ruleset));
  end if;

  if m.confirmed then raise exception 'INVALID: the result is confirmed; the score cannot change' using errcode = '22023'; end if;
  select coalesce(max(e.seq), 0) into v_last from public.match_score_events e where e.match_id = m.id;
  if v_expected <> v_last then
    raise exception 'STALE: the score was changed on another device; reload it before scoring' using errcode = '40001';
  end if;
  if v_kind in ('rally', 'undo') and m.status <> 'live' then
    if m.status = 'paused' then raise exception 'INVALID: the match is paused; resume it first' using errcode = '22023'; end if;
    raise exception 'INVALID: start the match before scoring' using errcode = '22023';
  end if;
  if v_kind = 'first_server' and m.status not in ('scheduled', 'ready', 'live') then
    raise exception 'INVALID: the first server is chosen before or at the start of the match' using errcode = '22023';
  end if;

  v_before := app.competition_live_replay(m.id, v_ruleset);
  if v_kind = 'rally' and (v_before ->> 'matchOver')::boolean then
    raise exception 'INVALID: the match is over; end it to record the result' using errcode = '22023';
  end if;
  if v_kind = 'undo' and (v_before ->> 'rallies')::integer = 0 then
    raise exception 'INVALID: nothing to undo; no points have been recorded' using errcode = '22023';
  end if;
  if v_kind = 'first_server' and (v_before ->> 'rallies')::integer > 0 then
    raise exception 'INVALID: the first server is chosen before the first rally' using errcode = '22023';
  end if;

  insert into public.match_score_events (match_id, seq, kind, side, idempotency_key, recorded_by)
    values (m.id, v_last + 1, v_kind, v_side, v_key, p_actor);
  v_after := app.competition_live_replay(m.id, v_ruleset);
  perform app.competition_live_store(m.id, v_after);
  if v_kind <> 'rally' then
    perform app.audit(p_actor, 'live_' || v_kind, 'competition_matches', m.id::text,
      jsonb_build_object('seq', v_last + 1, 'side', v_side, 'rallies', (v_after ->> 'rallies')::integer), null);
  end if;
  return jsonb_build_object('matchId', m.id, 'duplicate', false, 'seq', v_last + 1, 'status', m.status, 'revision', m.revision, 'state', v_after);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_live_match_status: record {action: 'start' | 'pause' | 'resume' | 'end', endStatus: 'completed' | 'retired' | 'abandoned' | null,
-- retiringSide: 'A' | 'B' | null}. p_expected_revision is the match revision the console holds (STALE otherwise).
-- end writes the games from the rally log as an UNCONFIRMED result (result_source 'scorer'); the owner confirms it on the Results
-- screen (admin_confirm_result), only then is it public and does the winner move on.
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_live_match_status(p_actor text, p_match uuid, p_record jsonb, p_expected_revision integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.competition_matches%rowtype;
  v_action text;
  v_end text;
  v_retiring text;
  v_ruleset jsonb;
  v_state jsonb;
  v_games jsonb;
  v_winner text;
  v_new text;
  v_rev integer;
  i integer;
  a integer;
  b integer;
begin
  perform app.require_competition_access(p_actor, app.competition_tournament_of('match', p_match), 'score');
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['action', 'endStatus', 'retiringSide'], 'status change');
  if jsonb_typeof(p_record -> 'action') is distinct from 'string' or (p_record ->> 'action') not in ('start', 'pause', 'resume', 'end') then
    raise exception 'INVALID: the action is start, pause, resume or end' using errcode = '22023';
  end if;
  v_action := p_record ->> 'action';
  if jsonb_typeof(p_record -> 'endStatus') not in ('string', 'null') or jsonb_typeof(p_record -> 'retiringSide') not in ('string', 'null') then
    raise exception 'INVALID: endStatus and retiringSide are text or null' using errcode = '22023';
  end if;
  v_end := p_record ->> 'endStatus';
  v_retiring := p_record ->> 'retiringSide';
  if (v_action = 'end') <> (v_end is not null) then raise exception 'INVALID: only ending a match names how it ended' using errcode = '22023'; end if;
  if v_end is not null and v_end not in ('completed', 'retired', 'abandoned') then
    raise exception 'INVALID: a match ends completed, retired or abandoned (a walkover is recorded on the Results screen)' using errcode = '22023';
  end if;
  if (v_end is not distinct from 'retired') <> (v_retiring is not null) then raise exception 'INVALID: say which side retired, and only for a retirement' using errcode = '22023'; end if;
  if v_retiring is not null and v_retiring not in ('A', 'B') then raise exception 'INVALID: a side is "A" or "B"' using errcode = '22023'; end if;

  select * into m from public.competition_matches where id = p_match for update;
  if not found then raise exception 'NOT_FOUND: match not found' using errcode = 'P0002'; end if;
  if p_expected_revision is distinct from m.revision then raise exception 'STALE: the match changed since the console was opened' using errcode = '40001'; end if;
  if m.confirmed then raise exception 'INVALID: the result is confirmed; the match cannot change' using errcode = '22023'; end if;
  select e.ruleset into v_ruleset from public.tournament_events e where e.id = m.event_id;

  if v_action = 'start' then
    if m.status not in ('scheduled', 'ready') then raise exception 'INVALID: only a scheduled or ready match can start (this one is %)', m.status using errcode = '22023'; end if;
    if m.side_a_entry is null or m.side_b_entry is null then raise exception 'INVALID: both sides must be known before the match starts' using errcode = '22023'; end if;
    if not exists (select 1 from public.draws d where d.event_id = m.event_id and d.status in ('published', 'locked')) then
      raise exception 'INVALID: publish the draw before scoring' using errcode = '22023';
    end if;
    if exists (select 1 from public.event_entries en where en.id in (m.side_a_entry, m.side_b_entry) and en.status <> 'confirmed') then
      raise exception 'INVALID: both sides must be confirmed entries' using errcode = '22023';
    end if;
    v_new := 'live';
  elsif v_action = 'pause' then
    if m.status <> 'live' then raise exception 'INVALID: only a live match can pause' using errcode = '22023'; end if;
    v_new := 'paused';
  elsif v_action = 'resume' then
    if m.status <> 'paused' then raise exception 'INVALID: only a paused match can resume' using errcode = '22023'; end if;
    v_new := 'live';
  else
    if m.status not in ('live', 'paused') then raise exception 'INVALID: only a live or paused match can end here' using errcode = '22023'; end if;
    if exists (select 1 from public.event_entries en where en.id in (m.side_a_entry, m.side_b_entry) and en.status <> 'confirmed') then
      raise exception 'INVALID: both sides must be confirmed entries (record a walkover on the Results screen)' using errcode = '22023';
    end if;
    v_state := app.competition_live_replay(m.id, v_ruleset);
    v_games := v_state -> 'games';
    if v_end = 'completed' then
      if not (v_state ->> 'matchOver')::boolean then
        raise exception 'INVALID: the match is not over yet: nobody has won % games', (v_ruleset ->> 'gamesToWin') using errcode = '22023';
      end if;
    elsif (v_state ->> 'pointsA')::integer + (v_state ->> 'pointsB')::integer > 0 then
      v_games := v_games || jsonb_build_array(jsonb_build_object('a', (v_state ->> 'pointsA')::integer, 'b', (v_state ->> 'pointsB')::integer));
    end if;
    -- the same check as a typed-in result (validateMatch); for completed it must agree with the replay
    v_winner := app.competition_result_winner(v_games, v_ruleset, v_end, null, v_retiring);
    if v_end = 'completed' and v_winner is distinct from v_state ->> 'winnerSide' then
      raise exception 'INVALID: the rally log and the result do not agree; record the result on the Results screen' using errcode = '22023';
    end if;
    delete from public.match_games where match_id = m.id;
    for i in 1 .. jsonb_array_length(v_games) loop
      a := (v_games -> (i - 1) ->> 'a')::integer;
      b := (v_games -> (i - 1) ->> 'b')::integer;
      insert into public.match_games (match_id, game_number, points_a, points_b, finished)
        values (m.id, i, a, b, app.competition_game_problem(a, b, v_ruleset, true) is null);
    end loop;
    v_new := v_end;
  end if;

  if v_action = 'end' then
    update public.competition_matches set status = v_new, winner_side = v_winner, result_source = 'scorer', revision = revision + 1
     where id = m.id returning revision into v_rev;
    update public.draws set status = 'locked' where event_id = m.event_id and status = 'published';
  else
    update public.competition_matches set status = v_new, revision = revision + 1 where id = m.id returning revision into v_rev;
  end if;
  if v_action = 'start' and not exists (select 1 from public.match_live_state s where s.match_id = m.id) then
    perform app.competition_live_store(m.id, app.competition_live_replay(m.id, v_ruleset));
  end if;
  perform app.audit(p_actor, 'live_' || v_action, 'competition_matches', m.id::text,
    jsonb_build_object('old_status', m.status, 'new_status', v_new, 'winner_side', v_winner,
                       'games', case when v_games is null then null else jsonb_array_length(v_games) end, 'revision', v_rev), p_reason);
  if v_action in ('start', 'end') then perform app.mark_dirty('live match ' || v_action, false); end if;
  return jsonb_build_object('id', m.id, 'status', v_new, 'winnerSide', v_winner, 'confirmed', false, 'revision', v_rev);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- admin_set_live_scores: record {public: boolean, windowSeconds: 60..3600}. Owner only (stays owner only after 0019).
-- ------------------------------------------------------------------------------------------------------------------
create or replace function public.admin_set_live_scores(p_actor text, p_record jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public boolean;
  v_window integer;
  v_old boolean;
begin
  perform app.require_owner(p_actor);
  perform app.competition_reason(p_reason);
  perform app.competition_keys(p_record, array['public', 'windowSeconds'], 'live scores setting');
  if jsonb_typeof(p_record -> 'public') is distinct from 'boolean' then raise exception 'INVALID: public must be true or false' using errcode = '22023'; end if;
  v_public := (p_record ->> 'public')::boolean;
  v_window := app.competition_int(p_record -> 'windowSeconds', 'windowSeconds', 60, 3600);
  if v_window is null then raise exception 'INVALID: windowSeconds is missing' using errcode = '22023'; end if;
  select cs.live_scores_public into v_old from public.competition_settings cs where cs.id = 1 for update;
  update public.competition_settings set live_scores_public = v_public, live_window_seconds = v_window where id = 1;
  perform app.audit(p_actor, 'set_live_scores', 'competition_settings', '1',
    jsonb_build_object('old_public', v_old, 'new_public', v_public, 'window_seconds', v_window), p_reason);
  return jsonb_build_object('public', v_public, 'windowSeconds', v_window);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- The public view (schema api, publishable key). Explicit columns; names only through app.competition_entry_faces.
-- ------------------------------------------------------------------------------------------------------------------
create view app.competition_live_settings as
select cs.live_scores_public as on_now, cs.live_window_seconds as window_seconds
from public.competition_settings cs
where cs.id = 1;
revoke all on app.competition_live_settings from public, anon, authenticated;

-- is_live: the match is live AND its last point is younger than the window (and not more than a minute in the future: clock skew).
-- A paused match, or a live one whose scorer has stopped sending, is listed with is_live = false.
create view api.public_competition_live with (security_barrier = true) as
select
  m.id as match_id,
  m.event_id,
  e.category,
  e.age_group,
  coalesce(pe.is_junior, true) as is_junior,
  m.round_code,
  m.match_number,
  m.group_label,
  c.label as court_label,
  m.status,
  (m.status = 'live' and ls.last_point_at is not null
    and ls.last_point_at >= now() - make_interval(secs => s.window_seconds)
    and ls.last_point_at <= now() + interval '1 minute') as is_live,
  s.window_seconds as live_window_seconds,
  ls.game_number,
  ls.points_a,
  ls.points_b,
  ls.games_a,
  ls.games_b,
  ls.finished_games,
  ls.server_side,
  ls.last_point_at as last_update,
  fa.player1_name as side_a_player1_name,
  fa.player2_name as side_a_player2_name,
  coalesce(fa.is_protected, true) as side_a_protected,
  fb.player1_name as side_b_player1_name,
  fb.player2_name as side_b_player2_name,
  coalesce(fb.is_protected, true) as side_b_protected
from public.competition_matches m
join app.competition_public_match_ids pm on pm.id = m.id
join app.competition_public_events pe on pe.id = m.event_id
join public.tournament_events e on e.id = m.event_id
join public.match_live_state ls on ls.match_id = m.id
cross join app.competition_live_settings s
left join public.courts c on c.id = m.court_id
left join app.competition_entry_faces fa on fa.entry_id = m.side_a_entry
left join app.competition_entry_faces fb on fb.entry_id = m.side_b_entry
where m.status in ('live', 'paused')
  and not m.confirmed
  and s.on_now;
grant select on api.public_competition_live to anon, authenticated;

-- ------------------------------------------------------------------------------------------------------------------
-- Privileges: the helpers for nobody; the RPCs for service_role only
-- ------------------------------------------------------------------------------------------------------------------
revoke all on function app.competition_live_replay(uuid, jsonb) from public, anon, authenticated;
revoke all on function app.competition_live_store(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_live_score(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_live_match_status(text, uuid, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.admin_set_live_scores(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_live_score(text, uuid, jsonb) to service_role;
grant execute on function public.admin_live_match_status(text, uuid, jsonb, integer, text) to service_role;
grant execute on function public.admin_set_live_scores(text, jsonb, text) to service_role;
