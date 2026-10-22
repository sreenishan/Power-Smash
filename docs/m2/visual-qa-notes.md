# Visual QA notes

Method: non-strict build copied to tmp/vqa-dist, served by a throwaway Node server, Playwright screenshots (tmp/shots/vqa, not committed) of 32 page types at 360, 390, 768, 1024, 1280 px with automatic checks (horizontal overflow, elements past the viewport, small tap targets). A subset was inspected by eye (home, services-type pages, pricing, book, request, matches list and match, player, live, poster, admin dashboard and enquiries); the rest were covered by the automatic checks only.

| Page group | Sizes | Defects found | Fixed |
|---|---|---|---|
| Home, services, pricing, partner, about, support, contact, book, request, alerts, submit-video, tournaments, live, 404, 500, legal pages, matches, match, gone, players, player | all five | No horizontal overflow anywhere. Book/forms: step label showed a stray ": " after the pill | Colon now visually hidden (sr-only); screen reader text unchanged |
| Posters A4/A3 | print emulation | PDF boxes are A4 (595x842 pt) and A3 (842x1191 pt), one page each. No defect | - |
| Admin dashboard and enquiries | 360-1280 | Status badges collapsed (pill only around first letters, overlapping text); card titles at line-height 1 touched content | Badge uses inline-flex (src/admin/ui.tsx); h2/h3 line-height in src/admin/admin.css |
| All pages, forced colours | 1000 px | White wordmark vanished on system canvas | forced-color-adjust none on header and footer (components.css) |
| Tamil | test string | Renders with Noto Sans Tamil, no tofu | - |
| Dark mode, reduced motion | home, book | No defect seen | - |

Gates: contrast script clean, check 0 errors, npm test green, js-budget OK, e2e 152 passed. CSS growth: about 0.3 KB. No JS added.

Remaining known issues: tick-box inputs measure 24 px but sit in 44 px labels; "Watch on YouTube" text link on match pages is 26 px high; pricing grid leaves one orphan card at 768 px; the build leaves dist/ shared with other sessions (copy it before shooting); Open Graph and print screenshots of every page were not all viewed by eye.
