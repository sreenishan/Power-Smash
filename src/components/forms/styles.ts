// Shared Tailwind class strings for the form kit (tokens from src/styles/tokens.css, docs/BRAND.md).
// Rules: 16 px minimum input text (text-body), 44 px minimum targets (min-h-tap), a strong 2 px edge (border-line-strong,
// never the decorative --ps-border), visible focus comes from the global :focus-visible rule in tokens.css.

export const inputClass =
  'block w-full min-h-[3.25rem] rounded-md border-2 border-line-strong bg-surface px-4 py-3 text-body text-fg shadow-[inset_0_1px_2px_rgb(11_20_22/0.06)] placeholder:text-fg-muted ps-transition hover:border-ps-ink focus-visible:border-ps-court focus-visible:shadow-[0_0_0_3px_var(--ps-court-tint)] disabled:opacity-60';
export const inputErrorClass = 'border-ps-live bg-ps-live-tint/40 hover:border-ps-live focus-visible:border-ps-live';

export const labelClass = 'block text-body font-bold tracking-wide text-fg';
export const optionalTagClass = 'ml-1 text-small font-normal text-fg-muted';
export const hintClass = 'mt-1 text-small leading-snug text-fg-muted';
export const errorClass = 'mt-1.5 flex items-start gap-1.5 rounded-md border-l-4 border-ps-live bg-ps-live-tint px-3 py-1.5 text-small font-semibold text-ps-ink';

export const fieldWrapClass = 'flex flex-col gap-1.5';
export const stackClass = 'flex flex-col gap-6';

export const buttonBase =
  'inline-flex min-h-[3.25rem] items-center justify-center gap-2 rounded-md px-6 py-2 font-[family-name:var(--ps-font-display)] text-[1.125rem] font-bold uppercase tracking-wider shadow-card ps-transition active:translate-y-px aria-disabled:cursor-wait aria-disabled:opacity-70 disabled:cursor-wait disabled:opacity-70';
export const buttonPrimary = `${buttonBase} bg-ps-court text-ps-white hover:bg-ps-court-deep hover:shadow-raised`;
export const buttonQuiet = `${buttonBase} border-2 border-line-strong bg-surface text-fg hover:bg-ps-court-tint`;

export const panelClass = 'rounded-lg border border-line border-t-4 border-t-ps-court bg-surface p-5 shadow-raised sm:p-8';
export const alertPanelClass = 'rounded-lg border-2 border-ps-live border-l-8 bg-ps-live-tint p-5 text-ps-ink';
