// The ONE place that says where the built site lives (Vercel port, area D). The Astro Vercel adapter writes the Build Output API
// folder `.vercel/output`: static files in `static/`, routing (headers, redirects) in `config.json`, functions in `functions/`.
// Every build step and every check takes its default folder from here. Override for a scratch build with PS_OUTPUT_DIR (the
// `.vercel/output`-shaped folder) or pass --dist / --config to a single script.
const slashes = (p) => p.split(String.fromCharCode(92)).join('/');

/** The Build Output API folder. */
export const OUTPUT_DIR = slashes(process.env.PS_OUTPUT_DIR ?? '.vercel/output');
/** Static files served to visitors: what the placeholder gate, privacy scan, release check and JS budget scan. */
export const STATIC_DIR = `${OUTPUT_DIR}/static`;
/** Routing config written by the adapter and finished by scripts/finalize-headers.ts. */
export const CONFIG_PATH = `${OUTPUT_DIR}/config.json`;
/** Archive redirect list written by scripts/write-archive-redirects.mjs, read by finalize-headers. */
export const REDIRECTS_JSON = 'tmp/archive-redirects.json';
