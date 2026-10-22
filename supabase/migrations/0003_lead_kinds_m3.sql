-- 0003_lead_kinds_m3.sql - M3 (additive): two new lead kinds. Moved from supabase/proposed into the migrations (ADMIN2, docs/m2/admin2-notes.md):
-- nothing had been applied anywhere, so it takes the free number 0003 and the sequence 0001..0008 has no gap.
-- Apply after 0002 (it re-creates a constraint of 0001), then run supabase/checks/0003_assertions.sql.
-- M3 (additive): two new lead kinds from the "send your video" and alerts sign-up forms.
-- Re-creates the type check with the two new members; nothing else changes. Both kinds carry a phone or an email
-- (video_submission: phone required; alerts_signup: email required, no phone), so leads_has_contact still holds.
alter table public.leads drop constraint leads_type_check;
alter table public.leads add constraint leads_type_check check (type in ('coverage', 'sponsorship', 'player_product', 'featured_listing', 'academy_listing', 'general', 'tournament_submission', 'video_submission', 'alerts_signup'));
comment on table public.leads is 'Private. Enquiries from the website forms (coverage, sponsorship, general, player_product, tournament_submission, video_submission, alerts_signup). Written by the Worker with the secret key; read by the owner in Supabase Studio until the M3 admin.';
