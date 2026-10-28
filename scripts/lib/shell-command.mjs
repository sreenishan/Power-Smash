// Builds the ONE command line that scripts/with-lock.mjs hands to the shell. Node's spawn(cmd, args, { shell: true }) only joins the
// arguments with spaces, so an argument with a space came apart: `--grep-invert "on a phone"` ran as `--grep-invert on` plus three file
// filters, and a Playwright run quietly skipped most of its tests. Each argument that is not plainly safe is quoted for the shell that
// runs it: cmd.exe on Windows (npm and npx are .cmd shims, which Node only starts through a shell), sh elsewhere (the CI runners).
// What cmd.exe cannot pass through safely is refused with a clear message instead of being changed silently.

const POSIX_SAFE = /^[\w@%+=:,./-]+$/;
const WINDOWS_SAFE = /^[\w@+=:,./\\-]+$/;

/** Quotes one argument for sh: single quotes, an inner ' becomes '\''. */
function quotePosix(arg) {
  return arg !== '' && POSIX_SAFE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quotes one argument for cmd.exe and the program behind it (node and the npm shims split their command line with the usual Windows
 * rules: inside double quotes, \" is a quote and backslashes are doubled only before a quote or the closing quote).
 */
function quoteWindows(arg) {
  if (arg !== '' && WINDOWS_SAFE.test(arg)) return arg;
  if (arg.includes('%')) throw new Error(`cannot pass ${JSON.stringify(arg)} through cmd.exe: it expands %...% even inside quotes`);
  // cmd.exe knows no \" escape: after an escaped quote it would read & | < > ^ as its own operators
  if (arg.includes('"') && /[&|<>^]/.test(arg)) {
    throw new Error(`cannot pass ${JSON.stringify(arg)} through cmd.exe: it mixes a double quote with one of & | < > ^`);
  }
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
  return `"${escaped}"`;
}

/**
 * The command line for `spawn(line, { shell: true })`: every argument arrives in the program exactly as given.
 * @param {string[]} argv program and arguments
 * @param {string} [platform] defaults to process.platform
 * @returns {string}
 */
export function commandLine(argv, platform = process.platform) {
  if (argv.length === 0) throw new Error('no command given');
  for (const arg of argv) {
    if (/[\r\n\0]/.test(arg)) throw new Error(`cannot pass ${JSON.stringify(arg)} to a shell: it holds a line break or a NUL`);
  }
  return argv.map(platform === 'win32' ? quoteWindows : quotePosix).join(' ');
}
