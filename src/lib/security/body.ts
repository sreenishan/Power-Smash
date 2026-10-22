// Read a request body with a hard byte limit (S-3). The limit is enforced WHILE reading the stream, so a chunked upload with
// no (or a false) Content-Length is cut off as soon as it passes the cap instead of being buffered in full. A declared
// Content-Length above the cap is refused before anything is read. Used by POST /api/lead and POST /api/event.

export type CappedBody = { ok: true; text: string } | { ok: false; tooLarge: boolean };

export async function readBodyCapped(request: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(all) };
  } catch {
    return { ok: false, tooLarge: false }; // not valid UTF-8
  }
}
