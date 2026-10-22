# Third-party licences for the brand kit

Texts are copied unchanged from the installed packages (D-002: "keep the OFL licence files in `docs/licenses`").
Re-copy them if a package is upgraded.

| Asset | Version installed | Licence | Copyright line | Text kept here | Where it ships |
|---|---|---|---|---|---|
| Barlow Condensed (headings) | `@fontsource/barlow-condensed` 5.3.0 | SIL OFL-1.1 | The Barlow Project Authors | `OFL-Barlow-Condensed.txt` | `.woff2` files in the site build |
| Inter (body, UI) | `@fontsource-variable/inter` 5.3.0 | SIL OFL-1.1 | The Inter Project Authors | `OFL-Inter.txt` | `.woff2` file in the site build |
| Noto Sans Tamil (Tamil, rupee sign) | `@fontsource/noto-sans-tamil` 5.3.0 | SIL OFL-1.1 | The Noto Project Authors | `OFL-Noto-Sans-Tamil.txt` | `.woff2` files in the site build |
| Lucide icons | `@lucide/astro` 1.56.0 (VERIFIED_FACTS VF-F14 lists 1.60.0, the newest in the 7-day window) | ISC, plus MIT for the icons derived from Feather | Lucide Icons and Contributors; Cole Bemis (Feather icons) | `LICENSE-Lucide-ISC-and-MIT.txt` | inline SVG in pages |

## Notes

- **Reserved Font Names.** None of the three OFL texts declares a Reserved Font Name.
- **The logo.** The wordmark is outlined from the Barlow Condensed Black Italic cut (`scripts/brand-logo.mjs`). OFL-1.1 allows
  using a font's shapes in a logo or any other artwork; the outlines are artwork, not the Font Software. The shuttle-trail
  symbol is drawn in code and uses no third-party artwork.
- **Lucide has two notices.** VERIFIED_FACTS records Lucide as ISC. The installed licence file adds an MIT notice for the
  Feather-derived icons (115 are listed in the file, including `search`, `x`, `calendar`, `clock`, `share`, `check` and `download`).
  Keep both notices in the third-party notices page. This is a small correction to VF-F14.
- **Attribution on the live site.** OFL-1.1 and ISC ask that the notice travels with the files. Plan one plain-text
  "third-party notices" page or file in M1 (generated from this folder by the licence checker in CI, D-002); it is not built in M0.
- **Not shipped.** `opentype.js` (MIT) is a dev dependency used only by `scripts/brand-logo.mjs`; nothing from it reaches the site.
