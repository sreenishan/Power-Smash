import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALLOWLIST, PLACEHOLDER, formatPlaceholderReport, scanPlaceholders } from '../../scripts/check-placeholders.ts';
import { cleanupTemp, copyFixture, FIXTURES, makeDist, page, runScript } from './helpers';
import { join } from 'node:path';

afterEach(cleanupTemp);
// Some tests start Node child processes (the way npm runs the scripts): allow for a busy PC.
vi.setConfig({ testTimeout: 30_000 });

const MARK = 'TODO(owner)';

describe('placeholder gate: scan', () => {
  it('passes a clean build (the og-default.svg comment is the only marker and it is allowlisted)', () => {
    const report = scanPlaceholders(join(FIXTURES, 'site-clean'));
    expect(report.hits).toEqual([]);
    expect(report.allowed.map((h) => h.file)).toEqual(['brand/og-default.svg']);
    expect(report.htmlPages).toBe(2);
  });

  it('finds a planted marker with file, line and column', () => {
    const report = scanPlaceholders(join(FIXTURES, 'site-planted-todo'));
    expect(report.hits).toHaveLength(1);
    expect(report.hits[0]).toMatchObject({ file: 'index.html', line: 2 });
    expect(report.hits[0]?.column).toBeGreaterThan(1);
    expect(report.hits[0]?.excerpt).toContain(MARK);
  });

  it('finds every occurrence, in HTML, JSON and JavaScript', () => {
    const root = makeDist({
      'index.html': page(`<p>${MARK}: a</p><p>${MARK}: b</p>`),
      'data/x.json': JSON.stringify({ note: `${MARK}: price` }),
      '_astro/app.js': `console.log("${MARK}")`,
    });
    const report = scanPlaceholders(root);
    expect(report.hits.map((h) => `${h.file}:${h.line}`).sort()).toEqual(['_astro/app.js:1', 'data/x.json:1', 'index.html:1', 'index.html:1']);
  });

  it('skips binary files: a marker inside a font, an image or a file with NUL bytes is not read', () => {
    const root = makeDist({
      'index.html': page('<p>clean</p>'),
      '_astro/font.woff2': Buffer.from(`wOF2\u0000${MARK}\u0000`),
      'img/a.png': Buffer.from(`\u0089PNG\u0000${MARK}`),
      'data/blob.bin2': Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(MARK)]), // unknown extension, sniffed as binary
    });
    const report = scanPlaceholders(root);
    expect(report.hits).toEqual([]);
    expect(report.skippedBinary).toBe(3);
  });

  it('the allowlist excuses a marker only inside an XML comment of the named file', () => {
    const root = makeDist({
      'index.html': page('<p>clean</p>'),
      'brand/og-default.svg': `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${MARK}: tagline --><text>${MARK}: visible text</text></svg>`,
    });
    const report = scanPlaceholders(root);
    expect(report.allowed).toHaveLength(1);
    expect(report.hits).toHaveLength(1); // the visible one still fails
    expect(report.hits[0]?.file).toBe('brand/og-default.svg');
  });

  it('the same marker in a comment of any OTHER file is not excused', () => {
    const root = makeDist({ 'index.html': page(`<!-- ${MARK} -->`), 'brand/other.svg': `<svg><!-- ${MARK} --></svg>` });
    const report = scanPlaceholders(root);
    expect(report.hits.map((h) => h.file).sort()).toEqual(['brand/other.svg', 'index.html']);
  });

  it('the allowlist is explicit: one narrow, documented entry', () => {
    expect(ALLOWLIST).toHaveLength(1);
    expect(ALLOWLIST[0]).toMatchObject({ file: 'brand/og-default.svg', scope: 'xml-comment' });
    expect(ALLOWLIST[0]?.reason.length).toBeGreaterThan(20);
    expect(PLACEHOLDER).toBe(MARK);
  });

  it('lists hidden owner sections from the data-owner-hidden marker', () => {
    const root = makeDist({
      'index.html': page('<template data-owner-hidden="whatsapp-channel"></template><span data-owner-hidden="partners-strip"></span>'),
      'support/index.html': page('<template data-owner-hidden="whatsapp-channel"></template><i data-owner-hidden></i>'),
    });
    const report = scanPlaceholders(root);
    expect(report.hiddenSections).toEqual([
      { name: '(unnamed)', pages: ['support/index.html'] },
      { name: 'partners-strip', pages: ['index.html'] },
      { name: 'whatsapp-channel', pages: ['index.html', 'support/index.html'] },
    ]);
    const text = formatPlaceholderReport(report, false, '.vercel/output/static').lines.join('\n');
    expect(text).toContain('whatsapp-channel (2 pages)');
  });
});

describe('placeholder gate: variants of the marker are found too (B-17, C-5)', () => {
  const variants: Array<[string, string, string]> = [
    ['lower case', 'index.html', page('<p>todo(owner): x</p>')],
    ['mixed case', 'index.html', page('<p>Todo(Owner): x</p>')],
    ['space before the bracket', 'index.html', page('<p>TODO (owner)</p>')],
    ['spaces inside the brackets', 'index.html', page('<p>TODO( owner )</p>')],
    ['no-break space', 'index.html', page('<p>TODO\u00a0(owner)</p>')],
    ['decimal entities for the brackets', 'index.html', page('<p>TODO&#40;owner&#41;</p>')],
    ['named entities for the brackets', 'index.html', page('<p>TODO&lpar;owner&rpar;</p>')],
    ['hex entities for letters', 'index.html', page('<p>&#x54;ODO(owner)</p>')],
    ['markup inside the marker', 'index.html', page('<p>TODO(<b>owner</b>)</p>')],
    ['markup between the words', 'index.html', page('<p><span>TODO(</span><span>owner)</span></p>')],
    ['an HTML comment inside it', 'index.html', page('<p>TODO(<!-- x -->owner)</p>')],
    ['in an attribute with entities', 'index.html', page('<a title="TODO&#40;owner&#41;">x</a>')],
    ['percent-encoded in a link', 'index.html', page('<a href="/x?m=TODO%28owner%29">x</a>')],
    ['JavaScript unicode escapes', '_astro/a.js', 'const m="TODO\\u0028owner\\u0029";'],
    ['JavaScript hex escapes', '_astro/a.js', 'const m="TODO\\x28owner\\x29";'],
    ['JSON unicode escapes', 'data/x.json', '{"note":"TODO\\u0028owner\\u0029"}'],
    ['inline script escapes', 'index.html', page('<script>var m="TODO\\u0028owner\\u0029"</script>')],
    ['full-width letters and brackets', 'index.html', page('<p>ＴＯＤＯ（ｏｗｎｅｒ）</p>')],
    ['zero-width characters', 'index.html', page('<p>TO\u200bDO(ow\u2060ner)</p>')],
    ['a comment in a file that is not allowlisted', 'brand/other.svg', '<svg><!-- todo (Owner) --></svg>'],
  ];

  for (const [name, file, content] of variants) {
    it(`finds: ${name}`, () => {
      const report = scanPlaceholders(makeDist({ 'index.html': page('<p>ok</p>'), [file]: content }));
      expect(report.hits.length, name).toBeGreaterThanOrEqual(1);
      expect(report.hits.every((h) => h.file === file)).toBe(true);
    });
  }

  it('counts every occurrence on a line, plain or disguised, once each', () => {
    const body = `<p>${MARK}</p><p>todo&#40;owner&#41;</p><p>TODO(<b>owner</b>)</p>`;
    const report = scanPlaceholders(makeDist({ 'index.html': page(body) }));
    expect(report.hits).toHaveLength(3);
  });

  it('plain text that merely mentions a to-do is not a marker', () => {
    const report = scanPlaceholders(makeDist({ 'index.html': page('<p>My todo list: the owner will call. TODO: later. todo(me)</p>') }));
    expect(report.hits).toEqual([]);
  });

  it('the allowlisted og-default.svg still excuses a variant inside its XML comment, and fails a variant in its visible text', () => {
    const root = makeDist({
      'index.html': page('<p>clean</p>'),
      'brand/og-default.svg': '<svg xmlns="http://www.w3.org/2000/svg"><!-- todo&#40;owner&#41;: tagline --><text>Todo (Owner): visible</text></svg>',
    });
    const report = scanPlaceholders(root);
    expect(report.allowed).toHaveLength(1);
    expect(report.hits).toHaveLength(1);
  });

  it('the strict command line fails on a disguised marker and names the file', () => {
    const root = makeDist({ 'index.html': page('<p>TODO&#40;owner&#41;: price</p>') });
    const r = runScript('scripts/check-placeholders.ts', ['--dist', root, '--strict']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('index.html:1');
  });
});

describe('placeholder gate: output and exit code', () => {
  it('strict mode lists file:line and fails', () => {
    const { lines, exitCode } = formatPlaceholderReport(scanPlaceholders(join(FIXTURES, 'site-planted-todo')), true, '.vercel/output/static');
    expect(exitCode).toBe(1);
    expect(lines.join('\n')).toMatch(/index\.html:2:\d+/);
  });

  it('non-strict mode prints a summary only and passes', () => {
    const { lines, exitCode } = formatPlaceholderReport(scanPlaceholders(join(FIXTURES, 'site-planted-todo')), false, '.vercel/output/static');
    expect(exitCode).toBe(0);
    expect(lines.join('\n')).toContain('Informational');
    expect(lines.join('\n')).not.toMatch(/index\.html:2/); // no file:line list in a normal build
  });

  it('strict mode fails an empty build (fail closed)', () => {
    const root = makeDist({ 'robots.txt': 'x' });
    expect(formatPlaceholderReport(scanPlaceholders(root), true, '.vercel/output/static').exitCode).toBe(1);
    expect(formatPlaceholderReport(scanPlaceholders(root), false, '.vercel/output/static').exitCode).toBe(0);
  });

  it('a clean build passes in both modes', () => {
    const report = scanPlaceholders(join(FIXTURES, 'site-clean'));
    expect(formatPlaceholderReport(report, true, 'x').exitCode).toBe(0);
    expect(formatPlaceholderReport(report, false, 'x').exitCode).toBe(0);
  });
});

describe('placeholder gate: command line (the way npm runs it, Node strips the types)', () => {
  const script = 'scripts/check-placeholders.ts';

  it('a planted TODO(owner) fails with --strict and with PS_STRICT=1, and passes without', () => {
    const planted = join(FIXTURES, 'site-planted-todo');
    const strictFlag = runScript(script, ['--dist', planted, '--strict']);
    expect(strictFlag.status).toBe(1);
    expect(strictFlag.stdout).toContain('index.html:2');
    expect(runScript(script, ['--dist', planted], { PS_STRICT: '1' }).status).toBe(1);
    const normal = runScript(script, ['--dist', planted]);
    expect(normal.status).toBe(0);
    expect(normal.stdout).toContain('non-strict');
  });

  it('a clean dist passes in strict mode', () => {
    expect(runScript(script, ['--dist', join(FIXTURES, 'site-clean'), '--strict']).status).toBe(0);
  });

  it('a missing folder is a usage error', () => {
    const r = runScript(script, ['--dist', join(FIXTURES, 'nope')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('folder not found');
  });

  it('a build with every owner input missing passes once the sections are hidden, and a section reappears when its input exists', () => {
    // Simulated with fixture HTML: hidden = marker and no placeholder; supplied = real content and no marker.
    const hidden = makeDist({ 'index.html': page('<template data-owner-hidden="whatsapp-channel"></template>') });
    expect(runScript(script, ['--dist', hidden, '--strict']).status).toBe(0);
    const supplied = copyFixture('site-clean');
    expect(runScript(script, ['--dist', supplied, '--strict']).status).toBe(0);
  });
});
