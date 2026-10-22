-- 0004_archive_core.sql - M2: the archive tables (spec section 11.1 as corrected by SPEC_AUDIT PC-01..PC-30).
--
-- Tables: videos, video_title_history, tournaments, tournament_private, tournament_aliases, players, player_aliases, matches,
--         match_participants, slug_redirects, sync_runs.
-- Everything here is PRIVATE (D-005): RLS on, no policies for anon or authenticated, all default grants revoked, explicit
-- privileges for service_role only. Public data leaves the database ONLY through the explicit-column views of migration 0006
-- (schema `api`). Safety machinery (suppression, audit log, settings, dirty flag, protection triggers) is migration 0005.
--
-- Rules baked into the columns (not just into code):
--   * videos.youtube_id is the primary key and the upsert key (D-017); title_raw is stored byte-exact (D-016).
--   * NULL means unknown for category, round, age group, year (PC-23): there is no 'unknown' value in those columns.
--   * NEW parser output starts hidden (videos.visibility defaults to 'hidden', matches.publish_state to 'held'; SA-M31).
--   * Protected players (every age_status except adult_confirmed, D-012) carry no district, photo, bio or handle, are noindex,
--     hidden and have an OPAQUE slug: a check constraint makes any other row impossible, whatever code writes it.
--   * An alias is never the primary key (PC-02): player_aliases rows carry a status, `rejected` makes a split stick.
--   * Organizer phone and email live in tournament_private, never beside the public columns (D-005, D-029).
--   * Rows are never hard-deleted where a takedown tombstone matters: videos, tournaments, players, matches and aliases
--     give service_role NO delete privilege (D-014).
-- Money: none here. Instants are timestamptz (UTC), event dates are plain dates read as Asia/Kolkata (D-030).
-- Apply after 0003 is NOT required (0003 is only proposed); apply after 0002, then run supabase/checks/0004_assertions.sql.

-- ------------------------------------------------------------------------------------------------------------------
-- videos (spec 11.1, PC-15, PC-20, PC-22, D-016, D-018, D-033)
-- ------------------------------------------------------------------------------------------------------------------
create table public.videos (
  youtube_id        text        primary key,
  title_raw         text        not null,
  title_normalized  text        not null default '',
  description       text,
  published_at      timestamptz,
  duration_s        integer,
  views             bigint,
  likes             bigint,
  stats_fetched_at  timestamptz,
  thumbnail_url     text,
  embeddable        boolean,
  type              text        not null default 'other',
  live_status       text        not null default 'none',
  was_live          boolean     not null default false,
  is_international  boolean     not null default false,
  parse_status      text        not null default 'needs_review',
  parser_version    text,
  parse_confidence  smallint,
  hard_flags        text[]      not null default '{}',
  review_reasons    text[]      not null default '{}',
  parse_result      jsonb,
  minor_hold        boolean     not null default false,
  entity_block_reason text,
  visibility        text        not null default 'hidden',
  hidden_reason     text,
  hidden_at         timestamptz,
  manual_override   jsonb       not null default '{}'::jsonb,
  override_stale    boolean     not null default false,
  playlist_source   text,
  last_synced_at    timestamptz,
  etag              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint videos_id_format check (youtube_id ~ '^[A-Za-z0-9_-]{4,40}$'),
  constraint videos_type_check check (type in ('match', 'short', 'live', 'other')),
  constraint videos_live_status_check check (live_status in ('none', 'upcoming', 'live', 'completed')),
  constraint videos_parse_status_check check (parse_status in ('parsed', 'needs_review', 'ignored')),
  constraint videos_visibility_check check (visibility in ('hidden', 'listed_no_player_pages', 'public')),
  constraint videos_confidence_check check (parse_confidence is null or parse_confidence between 0 and 100),
  constraint videos_duration_check check (duration_s is null or duration_s >= 0),
  constraint videos_playlist_check check (playlist_source is null or playlist_source in ('UUSH', 'UULF', 'UULV')),
  constraint videos_block_reason_check check (entity_block_reason is null or entity_block_reason in ('INTERNATIONAL', 'NON_MATCH', 'TEAM_TIE', 'AMBIGUOUS_VS')),
  -- field-level locks (PC-20): an object whose keys are a subset of the lockable fields and whose values are all true
  constraint videos_manual_override_check check (manual_override <@ '{"type": true, "parse_status": true, "is_international": true, "visibility": true}'::jsonb),
  -- a hidden video says why and when (the emergency hide and the pipeline both set these)
  constraint videos_hidden_has_time check (visibility <> 'hidden' or hidden_at is not null or hidden_reason is null)
);
create index videos_published_idx on public.videos (published_at desc);
create index videos_visibility_idx on public.videos (visibility, type);
create index videos_review_idx on public.videos (parse_status, updated_at) where parse_status = 'needs_review';
create index videos_stats_idx on public.videos (stats_fetched_at) where stats_fetched_at is not null;

comment on table public.videos is 'Private. One row per YouTube video, keyed on the video id (D-017). title_raw is byte-exact and shown unmodified (D-016). New rows start hidden (SA-M31). Public reads go through api.public_videos.';
comment on column public.videos.title_raw is 'The YouTube title exactly as received. Never altered; displayed unmodified (D-016).';
comment on column public.videos.title_normalized is 'Matching copy only (NFKC, punctuation folded). Never displayed.';
comment on column public.videos.description is 'Private: YouTube descriptions can hold phone numbers (D-029). Not in any view.';
comment on column public.videos.views is 'YouTube API statistic. Refresh or delete before day 30 (D-016): stats_fetched_at proves the age.';
comment on column public.videos.visibility is 'hidden | listed_no_player_pages | public (D-018). Default hidden: parser output is not public by default (SA-M31).';
comment on column public.videos.manual_override is 'Field-level locks (PC-20): {"visibility": true} means the sync and reparse must not change that field. Enforced by trigger in 0005.';
comment on column public.videos.override_stale is 'true when the title changed after a lock was set: the owner must re-confirm (PC-20).';
comment on column public.videos.parse_confidence is 'Integer points 0..100 (ParseResult.confidencePoints), not a probability.';

-- ------------------------------------------------------------------------------------------------------------------
-- video_title_history (PC-22): every title the sync has seen, so a retitle is auditable
-- ------------------------------------------------------------------------------------------------------------------
create table public.video_title_history (
  id         bigint      generated by default as identity primary key,
  youtube_id text        not null references public.videos (youtube_id) on delete restrict,
  title_raw  text        not null,
  seen_at    timestamptz not null default now()
);
create index video_title_history_video_idx on public.video_title_history (youtube_id, seen_at desc);
comment on table public.video_title_history is 'Private. Previous raw titles per video (PC-22). Insert-only by convention; the sync adds a row when the title changes.';

-- ------------------------------------------------------------------------------------------------------------------
-- tournaments (spec 11.1, PC-10, PC-11, D-013, D-018)
-- ------------------------------------------------------------------------------------------------------------------
create table public.tournaments (
  id                      uuid        primary key default gen_random_uuid(),
  slug                    text        not null,
  name                    text        not null,
  series_key              text        not null,
  edition_year            smallint,
  edition_no              smallint,
  season_label            text,
  edition_year_source     text,
  level                   text,
  region                  text        not null default 'unknown',
  city                    text,
  district                text,
  venue                   text,
  start_date              date,
  end_date                date,
  categories              text[]      not null default '{}',
  age_groups              text[]      not null default '{}',
  entry_info              text,
  registration_url        text,
  poster_path             text,
  status                  text        not null default 'pending',
  is_featured             boolean     not null default false,
  featured_until          date,
  covered_by_power_smash  boolean     not null default false,
  is_promoted             boolean     not null default false,
  is_minor_signal         boolean     not null default false,
  source                  text        not null default 'parsed',
  visibility              text        not null default 'hidden',
  show_contact_public     boolean     not null default false,
  manual_override         jsonb       not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint tournaments_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,100}$'),
  constraint tournaments_series_key_not_empty check (length(series_key) > 0),
  constraint tournaments_year_check check (edition_year is null or edition_year between 1900 and 2100),
  constraint tournaments_year_source_check check (edition_year_source is null or edition_year_source in ('title', 'published_at_ist')),
  constraint tournaments_level_check check (level is null or level in ('district', 'state', 'zonal', 'national', 'open', 'corporate', 'veterans', 'school_college', 'other')),
  constraint tournaments_region_check check (region in ('tamil_nadu', 'other_india', 'international', 'unknown')),
  constraint tournaments_categories_check check (categories <@ array['MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD']::text[]),
  constraint tournaments_status_check check (status in ('pending', 'published', 'completed', 'cancelled', 'rejected')),
  constraint tournaments_source_check check (source in ('parsed', 'submitted', 'admin')),
  constraint tournaments_visibility_check check (visibility in ('hidden', 'listed_no_player_pages', 'public')),
  constraint tournaments_dates_check check (end_date is null or start_date is null or end_date >= start_date),
  constraint tournaments_manual_override_check check (manual_override <@ '{"name": true, "edition_year": true, "level": true, "region": true, "visibility": true, "city": true, "district": true}'::jsonb),
  -- international events never get tournament pages (D-018): they cannot be anything but hidden
  constraint tournaments_international_hidden check (region <> 'international' or visibility = 'hidden'),
  -- PC-11: the resolution key. NULLS NOT DISTINCT so "no year" is one edition too. Also the idempotent upsert target.
  constraint tournaments_series_edition_unique unique nulls not distinct (series_key, edition_year)
);
create unique index tournaments_slug_key on public.tournaments (slug);
create index tournaments_visibility_idx on public.tournaments (visibility, region, status);
create index tournaments_start_idx on public.tournaments (start_date desc);

comment on table public.tournaments is 'Private. Tournament editions (series_key + edition_year, PC-11). Organizer contact is NOT here: see tournament_private. Public reads go through api.public_tournaments.';
comment on column public.tournaments.region is 'tamil_nadu | other_india | international | unknown (D-018). Non-Tamil-Nadu events are listed but get no tournament page unless archive_settings.non_tn_tournament_pages = on.';
comment on column public.tournaments.is_promoted is 'Owner promotion: a tournament page exists with fewer than 3 matches (D-013).';
comment on column public.tournaments.is_minor_signal is 'School or college events and age-group events are a minor signal for their participants (D-012).';
comment on column public.tournaments.show_contact_public is 'true only after the organizer consented (notice id and version in tournament_private); then the organizer NAME may be shown. Phone and email are never shown by a view.';

-- Private organizer contact (D-005, D-029): its own table so no view or select-list can pick it up by accident.
create table public.tournament_private (
  tournament_id          uuid        primary key references public.tournaments (id) on delete cascade,
  organizer_name         text,
  organizer_phone        text,
  organizer_email        text,
  consent_notice_id      text,
  consent_notice_version text,
  consent_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.tournament_private is 'Private. Organizer contact for a tournament (D-005, D-029). Never in a view, never in the static build. Retained per D-028; deleted on an erasure request.';
comment on column public.tournament_private.organizer_phone is 'Personal data. Never selected by any api view.';
comment on column public.tournament_private.organizer_email is 'Personal data. Never selected by any api view.';

create table public.tournament_aliases (
  id               uuid        primary key default gen_random_uuid(),
  alias_normalized text        not null,
  tournament_id    uuid        not null references public.tournaments (id) on delete restrict,
  created_at       timestamptz not null default now(),
  constraint tournament_aliases_not_empty check (length(alias_normalized) > 0),
  constraint tournament_aliases_unique unique (alias_normalized, tournament_id)
);
create index tournament_aliases_alias_idx on public.tournament_aliases (alias_normalized);
comment on table public.tournament_aliases is 'Private. Spelling variants of a series (PC-11). Not unique on the alias alone: one name can span editions.';

-- ------------------------------------------------------------------------------------------------------------------
-- players (spec 11.1, PC-01, PC-02, PC-05, PC-14, D-012, D-013)
-- ------------------------------------------------------------------------------------------------------------------
create table public.players (
  id                       uuid        primary key default gen_random_uuid(),
  slug                     text        not null default ('p-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  slug_kind                text        not null default 'opaque',
  display_name             text        not null,
  name_normalized          text        not null,
  name_key                 text,
  latin_key                text,
  disambiguator            text,
  identity_tier            text        not null default 'multi_token',
  age_status               text        not null default 'unknown',
  age_signal               text[]      not null default '{}',
  age_confirmed_by         text,
  age_confirmed_at         timestamptz,
  age_confirmed_evidence   text,
  district                 text,
  photo_path               text,
  bio                      text,
  instagram_handle         text,
  claimed                  boolean     not null default false,
  noindex                  boolean     not null default true,
  visibility               text        not null default 'hidden',
  is_provisional           boolean     not null default true,
  provisional_tournament_id uuid       references public.tournaments (id) on delete restrict,
  merged_into              uuid        references public.players (id) on delete restrict,
  created_source           text        not null default 'parsed',
  manual_override          jsonb       not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint players_name_normalized_not_empty check (length(name_normalized) > 0),
  constraint players_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  constraint players_slug_kind_check check (slug_kind in ('named', 'opaque')),
  -- an opaque slug is exactly "p-" plus 16 hex digits, and nothing else may look like one (PC-14)
  constraint players_slug_kind_matches check ((slug_kind = 'opaque') = (slug ~ '^p-[0-9a-f]{16}$')),
  constraint players_identity_tier_check check (identity_tier in ('multi_token', 'single_token', 'initials_only')),
  constraint players_age_status_check check (age_status in ('adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown')),
  constraint players_visibility_check check (visibility in ('hidden', 'public')),
  constraint players_created_source_check check (created_source in ('parsed', 'admin', 'claim')),
  constraint players_not_self_merged check (merged_into is null or merged_into <> id),
  constraint players_manual_override_check check (manual_override <@ '{"display_name": true, "district": true, "disambiguator": true, "slug": true}'::jsonb),
  -- D-012: only an admin review or a verified claim sets adult_confirmed, and it leaves evidence of who and when
  constraint players_adult_has_evidence check (age_status <> 'adult_confirmed' or (age_confirmed_by is not null and age_confirmed_at is not null)),
  -- D-012 PROTECTED TREATMENT as a table rule: a protected player has no profile data, is noindex and hidden, and has an opaque slug.
  constraint players_protected_rules check (
    age_status = 'adult_confirmed'
    or (district is null and photo_path is null and bio is null and instagram_handle is null
        and noindex and visibility = 'hidden' and slug_kind = 'opaque')
  ),
  -- only identities that may be linked become player rows with a page: single-token and initials-only are never public
  constraint players_public_needs_adult check (visibility <> 'public' or (age_status = 'adult_confirmed' and not is_provisional and merged_into is null))
);
create unique index players_slug_key on public.players (slug);
create index players_name_normalized_idx on public.players (name_normalized);
create index players_name_key_idx on public.players (name_key) where name_key is not null;
create index players_latin_key_idx on public.players (latin_key) where latin_key is not null;
create index players_age_status_idx on public.players (age_status);
create index players_public_idx on public.players (visibility) where visibility = 'public';

comment on table public.players is 'Private. Players with the D-012 age_status. Protected = every status except adult_confirmed: no profile data, noindex, hidden, opaque slug (table check players_protected_rules). Public reads go through api.public_players (adults only).';
comment on column public.players.age_status is 'adult_confirmed | minor_confirmed | minor_suspected | unknown (default unknown). Only an admin review or a verified claim sets adult_confirmed (RPC admin_set_age_status); a self-claim never does (D-012).';
comment on column public.players.age_signal is 'Which rules fired (age_token:U13, junior_category:BS, unknown_age_word:xyz, tournament level) - evidence for review, never public.';
comment on column public.players.slug is 'Named slug only for adult_confirmed; opaque (p- plus 16 hex) otherwise. Persisted once assigned (PC-14).';
comment on column public.players.is_provisional is 'A parser-created player scoped to a tournament edition (PC-01); never public until promoted by a confirmed alias or enough evidence (D-013).';
comment on column public.players.name_normalized is 'PC-05 key. Display and matching only; never a primary key.';

create table public.player_aliases (
  id                  uuid        primary key default gen_random_uuid(),
  alias_normalized    text        not null,
  player_id           uuid        not null references public.players (id) on delete restrict,
  status              text        not null default 'provisional',
  scope_tournament_id uuid        references public.tournaments (id) on delete restrict,
  scope_district      text,
  created_by          text,
  created_at          timestamptz not null default now(),
  constraint player_aliases_not_empty check (length(alias_normalized) > 0),
  constraint player_aliases_status_check check (status in ('confirmed', 'provisional', 'rejected')),
  constraint player_aliases_unique unique (alias_normalized, player_id)
);
create index player_aliases_alias_idx on public.player_aliases (alias_normalized);
create index player_aliases_player_idx on public.player_aliases (player_id);
comment on table public.player_aliases is 'Private (PC-02). The alias is NOT unique: more than one candidate in scope is AMBIGUOUS_ALIAS. A rejected row makes a split stick. Never deleted (no delete privilege).';

-- ------------------------------------------------------------------------------------------------------------------
-- matches and match_participants (PC-18, PC-19, PC-23)
-- ------------------------------------------------------------------------------------------------------------------
create table public.matches (
  id              uuid        primary key default gen_random_uuid(),
  video_id        text        not null references public.videos (youtube_id) on delete restrict,
  slug            text        not null default '',
  slug_kind       text        not null default 'opaque',
  tournament_id   uuid        references public.tournaments (id) on delete restrict,
  category        text,
  age_group       text,
  round           text,
  format          text        not null default 'unknown',
  played_on       date,
  match_key       text,
  duplicate_of    uuid        references public.matches (id) on delete restrict,
  winner_side     text,
  score_text      text,
  publish_state   text        not null default 'held',
  minor_hold      boolean     not null default false,
  manual_override jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint matches_video_unique unique (video_id),
  constraint matches_slug_format check (slug = '' or slug ~ '^[a-z0-9][a-z0-9-]{0,120}$'),
  constraint matches_slug_kind_check check (slug_kind in ('named', 'opaque')),
  -- a persisted match slug (PC-14): opaque is exactly 'match-' + 16 hex and nothing else may look like it; named slugs carry player names and exist only while every participant is adult_confirmed (the api view masks, the players guard re-slugs)
  constraint matches_slug_kind_matches check (slug = '' or ((slug_kind = 'opaque') = (slug ~ '^match-[0-9a-f]{16}$'))),
  constraint matches_category_check check (category is null or category in ('MS', 'WS', 'MD', 'WD', 'XD', 'BS', 'GS', 'BD', 'GD')),
  constraint matches_age_group_check check (age_group is null or age_group ~ '^(U[0-9]{1,2}|[0-9]{2}\+|senior|open|veterans|masters|sub_junior|junior|youth|cadet|mini)$'),
  constraint matches_round_check check (round is null or round in ('R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', '3P', 'league', 'group')),
  constraint matches_format_check check (format in ('singles', 'doubles', 'unknown')),
  constraint matches_winner_check check (winner_side is null or winner_side in ('A', 'B')),
  constraint matches_publish_state_check check (publish_state in ('held', 'published')),
  constraint matches_not_own_duplicate check (duplicate_of is null or duplicate_of <> id),
  -- a match with a real minor signal can only be published by an explicit admin step that clears minor_hold (D-012)
  constraint matches_minor_hold_not_published check (not (minor_hold and publish_state = 'published')),
  constraint matches_manual_override_check check (manual_override <@ '{"tournament_id": true, "category": true, "age_group": true, "round": true, "format": true, "played_on": true, "participants": true}'::jsonb)
);
create unique index matches_slug_key on public.matches (slug) where slug <> '';
create index matches_tournament_idx on public.matches (tournament_id) where tournament_id is not null;
create index matches_match_key_idx on public.matches (match_key) where match_key is not null;
create index matches_publish_idx on public.matches (publish_state);
comment on table public.matches is 'Private. One row per match video (video_id unique, PC-19). NULL category/round/age_group = unknown (PC-23). Held by default; a minor-signal match cannot be published without clearing minor_hold.';
comment on column public.matches.duplicate_of is 'Same match in another video (PC-19). Excluded from counts and from public views.';

create table public.match_participants (
  id               uuid        primary key default gen_random_uuid(),
  match_id         uuid        not null references public.matches (id) on delete cascade,
  side             text        not null,
  position         smallint    not null,
  raw_name         text        not null,
  player_id        uuid        references public.players (id) on delete restrict,
  resolution       text        not null default 'plain_text',
  identity_tier    text        not null default 'multi_token',
  link_policy      text        not null default 'plain_text_only',
  truncated        boolean     not null default false,
  age_status       text        not null default 'unknown',
  age_signal       text[]      not null default '{}',
  seed             smallint,
  country          text,
  district_hint    text,
  affiliation_hint text,
  created_at       timestamptz not null default now(),
  constraint match_participants_position_unique unique (match_id, side, position),
  constraint match_participants_side_check check (side in ('A', 'B')),
  constraint match_participants_position_check check (position between 1 and 4),
  constraint match_participants_resolution_check check (resolution in ('exact_alias', 'provisional', 'plain_text', 'blocked', 'suppressed', 'manual')),
  constraint match_participants_tier_check check (identity_tier in ('multi_token', 'single_token', 'initials_only')),
  constraint match_participants_link_policy_check check (link_policy in ('provisional_ok', 'plain_text_only', 'blocked')),
  constraint match_participants_age_check check (age_status in ('adult_confirmed', 'minor_confirmed', 'minor_suspected', 'unknown')),
  constraint match_participants_country_check check (country is null or country ~ '^[A-Z]{3}$'),
  -- the link is present exactly when the resolution says so (PC-18)
  constraint match_participants_link_matches_resolution check ((resolution in ('exact_alias', 'provisional', 'manual')) = (player_id is not null)),
  -- PC-01 as a table rule: a single-token, initials-only, blocked or truncated name never gets a player link unless an admin linked it by hand
  constraint match_participants_tier_rule check (resolution = 'manual' or player_id is null or (link_policy = 'provisional_ok' and identity_tier = 'multi_token' and not truncated))
);
create index match_participants_player_idx on public.match_participants (player_id) where player_id is not null;
create index match_participants_age_idx on public.match_participants (match_id, age_status);
comment on table public.match_participants is 'Private. Participants of a match (PC-18): unique on (match, side, position); player_id is NULL for plain-text names. age_status is per participation and is combined with the player status by app.effective_age_status.';

-- ------------------------------------------------------------------------------------------------------------------
-- slug_redirects (spec 11.1, PC-14, D-014 step 4)
-- ------------------------------------------------------------------------------------------------------------------
create table public.slug_redirects (
  from_path   text        primary key,
  to_path     text,
  http_status smallint    not null default 301,
  entity_type text        not null default 'other',
  entity_id   text,
  created_at  timestamptz not null default now(),
  constraint slug_redirects_status_check check (http_status in (301, 410)),
  constraint slug_redirects_shape_check check ((http_status = 301 and to_path is not null) or (http_status = 410 and to_path is null)),
  constraint slug_redirects_entity_check check (entity_type in ('player', 'tournament', 'match', 'video', 'other')),
  constraint slug_redirects_path_check check (from_path ~ '^/[^ ]*/$' and (to_path is null or to_path ~ '^/[^ ]*/$')),
  constraint slug_redirects_no_self check (to_path is null or to_path <> from_path)
);
create index slug_redirects_to_idx on public.slug_redirects (to_path) where to_path is not null;
create index slug_redirects_entity_idx on public.slug_redirects (entity_type, entity_id);
comment on table public.slug_redirects is 'Private. 301 rows redirect an old path; 410 rows record an emergency hide (D-014). Chains are flattened by the RPCs. Only 301 rows to public targets are readable through api.public_slug_redirects.';

-- ------------------------------------------------------------------------------------------------------------------
-- sync_runs (spec 11.3, D-008, D-033)
-- ------------------------------------------------------------------------------------------------------------------
create table public.sync_runs (
  id          uuid        primary key default gen_random_uuid(),
  mode        text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text        not null default 'running',
  counts      jsonb       not null default '{}'::jsonb,
  quota_units integer,
  error       text,
  trigger     text,
  constraint sync_runs_mode_check check (mode in ('full', 'incremental', 'backfill', 'reparse', 'weekly_check', 'live_status')),
  constraint sync_runs_status_check check (status in ('running', 'ok', 'partial', 'failed')),
  constraint sync_runs_quota_check check (quota_units is null or quota_units >= 0),
  constraint sync_runs_counts_object check (jsonb_typeof(counts) = 'object'),
  constraint sync_runs_finished_check check (finished_at is null or finished_at >= started_at)
);
create index sync_runs_started_idx on public.sync_runs (started_at desc);
comment on table public.sync_runs is 'Private. One row per sync, backfill or reparse run with the quota units spent (D-033). The error text never holds a key.';

-- ------------------------------------------------------------------------------------------------------------------
-- updated_at triggers (app.touch_updated_at from 0001)
-- ------------------------------------------------------------------------------------------------------------------
create trigger videos_touch_updated_at before update on public.videos for each row execute function app.touch_updated_at();
create trigger tournaments_touch_updated_at before update on public.tournaments for each row execute function app.touch_updated_at();
create trigger tournament_private_touch_updated_at before update on public.tournament_private for each row execute function app.touch_updated_at();
create trigger players_touch_updated_at before update on public.players for each row execute function app.touch_updated_at();
create trigger matches_touch_updated_at before update on public.matches for each row execute function app.touch_updated_at();

-- ------------------------------------------------------------------------------------------------------------------
-- Row level security, privileges (D-005): RLS on, NO policies, nothing for the API roles, explicit service_role grants
-- ------------------------------------------------------------------------------------------------------------------
alter table public.videos              enable row level security;
alter table public.video_title_history enable row level security;
alter table public.tournaments         enable row level security;
alter table public.tournament_private  enable row level security;
alter table public.tournament_aliases  enable row level security;
alter table public.players             enable row level security;
alter table public.player_aliases      enable row level security;
alter table public.matches             enable row level security;
alter table public.match_participants  enable row level security;
alter table public.slug_redirects      enable row level security;
alter table public.sync_runs           enable row level security;

revoke all on table public.videos, public.video_title_history, public.tournaments, public.tournament_private, public.tournament_aliases,
  public.players, public.player_aliases, public.matches, public.match_participants, public.slug_redirects, public.sync_runs
  from public, anon, authenticated, service_role;  -- service_role too: its default grants are replaced by the explicit list below (see 0001)

-- No delete on videos, tournaments, players, matches, player_aliases: hiding is a tombstone, never a hard delete (D-014).
grant select, insert, update on public.videos              to service_role;
grant select, insert         on public.video_title_history to service_role;
grant select, insert, update on public.tournaments         to service_role;
grant select, insert, update, delete on public.tournament_private to service_role;  -- delete: erasure request (D-028)
grant select, insert, update, delete on public.tournament_aliases to service_role;
grant select, insert, update on public.players             to service_role;
grant select, insert, update on public.player_aliases      to service_role;
grant select, insert, update on public.matches             to service_role;
grant select, insert, update, delete on public.match_participants to service_role;  -- a reparse rewrites participants
grant select, insert, update, delete on public.slug_redirects to service_role;      -- the RPCs flatten chains and drop rows on an emergency hide
grant select, insert, update on public.sync_runs           to service_role;
