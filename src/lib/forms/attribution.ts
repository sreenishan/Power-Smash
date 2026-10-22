// Where the visitor came from, for the lead record (spec 8.1: source page and UTM data). The contract keeps only
// `source.path` and the five standard UTM values and drops anything odd; this reads them from the address bar.
// It never reads the referrer, cookies or any identifier.
import { LEAD_LIMITS } from '../contracts/lead-constants';

export interface Attribution {
  path: string;
  utm?: Record<string, string>;
}

const UTM_PARAMS: ReadonlyArray<readonly [param: string, key: string]> = [
  ['utm_source', 'source'],
  ['utm_medium', 'medium'],
  ['utm_campaign', 'campaign'],
  ['utm_term', 'term'],
  ['utm_content', 'content'],
];

export function readAttribution(pathname: string, search: string): Attribution {
  const path = pathname.startsWith('/') ? pathname.slice(0, LEAD_LIMITS.sourcePath.max) : '/';
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { path };
  }
  const utm: Record<string, string> = {};
  for (const [param, key] of UTM_PARAMS) {
    const value = params.get(param);
    if (value === null) continue;
    const trimmed = value.trim().slice(0, LEAD_LIMITS.utmValue.max);
    if (trimmed !== '') utm[key] = trimmed;
  }
  return Object.keys(utm).length > 0 ? { path, utm } : { path };
}
