// FICTIONAL seed for the /international/ page (D-112). Every event name below is invented ("Sample", "Demo", "Mock" names); the links
// point at the home pages of the allowed official sites only, never at a real event. It is the default source of every build that
// is not told to read the database, so no real event list enters a preview; a page built from it is noindex and shows the sample
// notice, and the strict release build refuses it (InternationalSampleNotice prints a Todo).
//
// The dates are written RELATIVE to the build day (an injected "today"), so the page always shows some upcoming and some recent
// sample events. Two rows are deliberately bad (a link that is not https and a link with a port) to prove the page model drops rows
// whose link the view would never have returned.
import { addDays, todayIst } from '../../dates';
import type { InternationalProvider, PublicInternationalEventRow } from './provider';

export function internationalSeedRows(today: string = todayIst()): PublicInternationalEventRow[] {
  const d = (n: number) => addDays(today, n);
  return [
    { id: 'a1000000-0000-4000-8000-000000000001', name: 'Sample World Open 2026', level_text: 'Sample level 1000', start_date: d(12), end_date: d(17), city: 'Sample City', country: 'Demo Country', official_url: 'https://bwfbadminton.com/' },
    { id: 'a1000000-0000-4000-8000-000000000002', name: 'Demo Masters 2026', level_text: 'Sample level 500', start_date: d(40), end_date: d(45), city: null, country: 'Mock Land', official_url: 'https://www.tournamentsoftware.com/' },
    { id: 'a1000000-0000-4000-8000-000000000003', name: 'Mock Team Cup 2026', level_text: null, start_date: d(-1), end_date: d(3), city: 'Mock Town', country: 'Demo Country', official_url: 'https://bwf.tournamentsoftware.com/' },
    { id: 'a1000000-0000-4000-8000-000000000004', name: 'Sample Junior Open 2026', level_text: 'Sample junior level', start_date: d(-20), end_date: d(-15), city: 'Sample Port', country: 'Mock Land', official_url: 'https://bwfbadminton.com/' },
    { id: 'a1000000-0000-4000-8000-000000000005', name: 'Demo Old Classic 2025', level_text: 'Sample level 300', start_date: d(-400), end_date: d(-395), city: 'Demo City', country: 'Demo Country', official_url: 'https://bwfbadminton.com/' },
    // deliberately bad rows: the page model must drop both
    { id: 'a1000000-0000-4000-8000-000000000098', name: 'Mock Plain Http Open', level_text: null, start_date: d(5), end_date: d(6), city: null, country: 'Mock Land', official_url: 'ftp://bwfbadminton.com/' },
    { id: 'a1000000-0000-4000-8000-000000000099', name: 'Mock Port Open', level_text: null, start_date: d(5), end_date: d(6), city: null, country: 'Mock Land', official_url: 'https://bwfbadminton.com:8443/' },
  ];
}

export function createInternationalSeedProvider(today?: () => string): InternationalProvider {
  return { id: 'seed', load: async () => internationalSeedRows(today ? today() : todayIst()) };
}

export const internationalSeedProvider: InternationalProvider = createInternationalSeedProvider();
