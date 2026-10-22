// MANUAL render check (not a Vitest test: the file name has no ".test."). It proves the SUPPLIED side of the hide-section rule and the
// tournament page template by really building the site:
//   node scripts/with-lock.mjs heavy -- node tests/build/verify-supplied.mjs
// What it does: copies src, public and scripts to tmp/verify-shell (git-ignored), fills in FICTIONAL owner data (legal name, story, a
// partner, a FAQ answer, audience figures, three tournaments ...), runs the real build there, then asserts on the built HTML:
// supplied sections show their content and leave no `data-owner-hidden` marker, the tournament pages render (contact only when
// showContact is true, SportsEvent only when upcoming, canonical slash URL in the JSON-LD), and <AudienceFigures /> shows a Todo
// when empty or undated and the dated figures when supplied. Exit code 1 on any failed check. The folder tmp/verify-shell is
// removed afterwards. Needs no network and touches neither dist/ nor any real data.
import { spawnSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dest = join(root, 'tmp', 'verify-shell');
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of ['package.json', 'astro.config.mjs', 'tsconfig.json', 'wrangler.jsonc', '.npmrc']) copyFileSync(join(root, f), join(dest, f));
for (const d of ['src', 'public', 'scripts']) cpSync(join(root, d), join(dest, d), { recursive: true });

function edit(rel, fn) {
  const file = join(dest, rel);
  writeFileSync(file, fn(readFileSync(file, 'utf8')));
}
function rep(s, from, to) {
  if (!s.includes(from)) throw new Error(`verify-supplied: the source changed, cannot find: ${from.slice(0, 70)}`);
  return s.replace(from, () => to);
}

edit('src/content/site.ts', (s) => {
  s = rep(s, 'tagline: null as string | null,', "tagline: 'Sample tagline for the render test' as string | null,");
  s = rep(s, 'legalName: null as string | null,', "legalName: 'Sample Legal Name Pvt Ltd' as string | null,");
  s = rep(s, 'postalAddress: null as string | null,', "postalAddress: '1 Sample Street' as string | null,");
  s = rep(s, 'phone: null as string | null,', "phone: '+91 00000 00000' as string | null,");
  s = rep(s, 'publicEmail: null as string | null,', "publicEmail: 'hello@example.test' as string | null,");
  s = rep(s, 'whatsappChannelUrl: null as string | null,', "whatsappChannelUrl: 'https://example.test/channel' as string | null,");
  s = rep(s, 'paymentNote: null as string | null,', "paymentNote: 'Sample payment sentence from the owner.' as string | null,");
  s = rep(s, 'story: null as string | null,', "story: 'Sample story text.' as string | null,");
  s = rep(s, 'mission: null as string | null,', "mission: 'Sample mission text.' as string | null,");
  s = rep(s, 'team: [] as readonly { readonly name: string; readonly role: string }[],', "team: [{ name: 'Sample Person', role: 'Sample role' }] as readonly { readonly name: string; readonly role: string }[],");
  s = rep(s, 'districts: [] as readonly string[],', "districts: ['Sample District'] as readonly string[],");
  s = rep(
    s,
    '    asOf: null as string | null,\n    /** The same date as ISO (YYYY-MM-DD) so the release check can warn when the figures age. */\n    asOfDate: null as string | null,\n    /** Monthly views, exactly as the owner words it from YouTube Studio. */\n    monthlyViews: null as string | null,\n    topLocations: [] as readonly AudienceShare[],',
    "    asOf: 'Sample Month 2030' as string | null,\n    asOfDate: '2030-01-15' as string | null,\n    monthlyViews: 'sample views text' as string | null,\n    topLocations: [{ label: 'Sample City A', share: 'sample share A' }] as readonly AudienceShare[],",
  );
  return s;
});
edit('src/content/partners.ts', (s) =>
  rep(s, 'export const partners: readonly Partner[] = [];', "export const partners: readonly Partner[] = [{ name: 'Sample Partner', logoPath: '/brand/logo-symbol.svg', logoAlt: 'Sample Partner logo', url: 'https://example.test/partner', permissionRecorded: true }];"),
);
edit('src/content/faq.ts', (s) =>
  rep(s, "{ id: 'travel', question: 'Do you travel outside your home district?', answer: null }", "{ id: 'travel', question: 'Do you travel outside your home district?', answer: 'Sample answer text.' }"),
);
edit('src/content/testimonials.ts', (s) =>
  rep(s, 'export const testimonials: readonly Testimonial[] = [];', "export const testimonials: readonly Testimonial[] = [{ quote: 'Sample quote text.', attribution: 'Sample Person', permissionRecorded: true }];"),
);
edit('src/content/tournaments.ts', (s) =>
  rep(
    s,
    'export const tournaments: readonly TournamentRecord[] = [];',
    `export const tournaments: readonly TournamentRecord[] = [
  { slug: 'sample-open-2030-sample-city', name: 'Sample Open', startDate: '2030-03-09', endDate: '2030-03-10', venue: 'Sample Hall', city: 'Sample City', district: 'Sample District', level: 'Sample level', categories: ['Sample category'], organizerName: 'Sample Association', description: 'A fictional tournament.', status: 'scheduled', coveredByPowerSmash: true, showContact: true, contact: { name: 'Sample Contact Person', registrationUrl: 'https://example.test/register' } },
  { slug: 'hidden-contact-2030-sample-city', name: 'Hidden Contact Cup', startDate: '2030-04-01', endDate: null, venue: null, city: 'Sample City', district: null, level: null, categories: [], organizerName: null, description: null, status: 'postponed', coveredByPowerSmash: false, showContact: false, contact: { name: 'Secret Contact Person', registrationUrl: 'https://example.test/secret-register' } },
  { slug: 'past-cup-2020-sample-city', name: 'Past Cup', startDate: '2020-01-05', endDate: '2020-01-06', venue: null, city: 'Sample City', district: null, level: null, categories: [], organizerName: null, description: null, status: 'scheduled', coveredByPowerSmash: false, showContact: false, contact: null },
];`,
  ),
);
// Put the audience block on the About page of the copy: supplied, empty and undated.
edit('src/pages/about.astro', (s) => {
  s = rep(s, "import { site } from '../content/site';", "import { site } from '../content/site';\nimport AudienceFigures from '../components/site/AudienceFigures.astro';");
  return rep(
    s,
    '  <Section tone="surface" labelledBy="next-title" compact>',
    `  <AudienceFigures />
  <AudienceFigures id="aud-empty" title="Empty case" audience={{ asOf: null, asOfDate: null, monthlyViews: null, topLocations: [], ageGroups: [], genderSplit: [], avgViewDuration: null }} />
  <AudienceFigures id="aud-undated" title="Undated case" audience={{ asOf: null, asOfDate: null, monthlyViews: 'sample views text', topLocations: [], ageGroups: [], genderSplit: [], avgViewDuration: null }} />
  <Section tone="surface" labelledBy="next-title" compact>`,
  );
});

const built = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: dest, stdio: 'inherit', env: process.env });
if (built.status !== 0) {
  console.error('verify-supplied: the build of the fictional copy failed');
  process.exit(built.status ?? 1);
}

const dist = join(dest, 'dist', 'client');
const read = (p) => readFileSync(join(dist, p), 'utf8');
const results = [];
const check = (label, ok, extra = '') => results.push({ ok, text: `${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}` });
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const t1 = read('tournaments/sample-open-2030-sample-city/index.html');
const ld1 = ldOf(t1);
const event = ld1.find((x) => x['@type'] === 'SportsEvent');
check('upcoming tournament has a SportsEvent', Boolean(event));
check('its url is the canonical slash URL', event?.url === /<link rel="canonical" href="([^"]*)"/.exec(t1)?.[1] && event.url.endsWith('/'), event?.url);
check('contact person and registration link shown (showContact true)', t1.includes('Sample Contact Person') && t1.includes('href="https://example.test/register"'));
check('breadcrumb link and JSON-LD use the slash form', /<a href="\/tournaments\/"[^>]*>Tournaments<\/a>/.test(t1) && ld1.filter((x) => x['@type'] === 'BreadcrumbList').every((b) => b.itemListElement.every((i) => i.item.endsWith('/'))));
check('no phone or email in the JSON-LD', !/telephone|email/i.test(JSON.stringify(ld1)));
const t2 = read('tournaments/hidden-contact-2030-sample-city/index.html');
check('contact hidden when showContact is false', !t2.includes('Secret Contact Person') && !t2.includes('secret-register'));
check('postponed badge and JSON-LD status', t2.includes('Postponed') && ldOf(t2).some((x) => x.eventStatus === 'https://schema.org/EventPostponed'));
const t3 = read('tournaments/past-cup-2020-sample-city/index.html');
check('past tournament has no SportsEvent', !ldOf(t3).some((x) => x['@type'] === 'SportsEvent') && t3.includes('>Past<'));
const list = read('tournaments/index.html');
check('list page: slash links, Upcoming and Past', list.includes('href="/tournaments/sample-open-2030-sample-city/"') && list.includes('id="upcoming-title"') && list.includes('id="past-title"'));

const home = read('index.html');
const about = read('about/index.html');
check('footer tagline, legal name, address, phone, email shown', ['Sample tagline for the render test', 'Sample Legal Name Pvt Ltd', '1 Sample Street', '+91 00000 00000', 'hello@example.test'].every((t) => home.includes(t)));
check('WhatsApp Channel link shown on home and support', home.includes('https://example.test/channel') && read('support/index.html').includes('Follow on the WhatsApp Channel'));
check('about story, mission, team, districts shown', ['Sample story text.', 'Sample mission text.', 'Sample Person', 'Sample District'].every((t) => about.includes(t)));
const services = read('services/index.html');
check('FAQ answer and testimonial shown', services.includes('Sample answer text.') && services.includes('Sample quote text.'));
check('partners strip shown on home and inner pages', home.includes('Sample Partner logo') && about.includes('Sample Partner logo'));
check('payment note shown on pricing', read('pricing/index.html').includes('Sample payment sentence from the owner.'));
const markers = [];
for (const f of ['index.html', 'about/index.html', 'services/index.html', 'pricing/index.html', 'support/index.html', 'tournaments/index.html', '404.html']) {
  for (const m of read(f).matchAll(/<template data-owner-hidden="?([^">]*)"?[^>]*>/g)) markers.push(`${f}:${m[1]}`);
}
check('no hidden marker is left on the pages once every input is supplied', markers.length === 0, markers.join(', '));
check('audience: dated figures shown with the as-of line', ['sample views text', 'Sample City A', 'sample share A', 'as of Sample Month 2030'].every((t) => about.includes(t)));
check('audience: empty block shows a Todo', /Empty case[\s\S]{0,400}TODO\(owner\): the audience figures from YouTube Studio/.test(about));
const undated = about.slice(about.indexOf('Undated case'));
check('audience: undated block shows the date Todo and never the figure', /TODO\(owner\): the (&#39;|')as of(&#39;|') date for the audience figures/.test(undated.slice(0, 600)) && !undated.slice(0, undated.indexOf('Work with us')).includes('sample views text'));

rmSync(dest, { recursive: true, force: true });
for (const r of results) console.log(r.text);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nverify-supplied: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
