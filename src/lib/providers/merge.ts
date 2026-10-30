// The conflict policy for imported records. PURE.
//
// 1. A manually verified field (listed in the record's `verifiedFields`) is NEVER overwritten by the provider. A differing provider
//    value is reported as a conflict for the owner to review; the local value stays.
// 2. A local-only field (for example a player's `ageStatus`, D-012) is written once on create and never by a sync afterwards.
// 3. A field the provider omits (absent, undefined or null) never erases a local value: "never delete local data because the
//    provider omitted it". A provider null over a local null is simply no change.
// 4. Everything else takes the provider's value. A list (draw entries, games, ranking rows) is ONE value: the provider's newer list
//    replaces the older one as a whole; the owner freezes a list by verifying that field.
// Records themselves are never deleted: the sync store interface has no delete at all.

export type RecordData = Readonly<Record<string, unknown>>;

export interface FieldConflict {
  field: string;
  localValue: unknown;
  providerValue: unknown;
}

export interface MergeResult {
  data: Record<string, unknown>;
  changed: boolean;
  conflicts: FieldConflict[];
  /** Fields the provider left empty while a local value exists (kept). */
  keptOmitted: string[];
}

/** Deterministic JSON with sorted keys, for equality and change detection. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function mergeRecord(
  existing: RecordData,
  verifiedFields: readonly string[],
  incoming: RecordData,
  localOnlyFields: readonly string[] = [],
): MergeResult {
  const data: Record<string, unknown> = { ...existing };
  const conflicts: FieldConflict[] = [];
  const keptOmitted: string[] = [];
  const verified = new Set(verifiedFields);
  const localOnly = new Set(localOnlyFields);

  for (const field of Object.keys(incoming).sort()) {
    const providerValue = incoming[field];
    const hasLocal = Object.prototype.hasOwnProperty.call(existing, field);
    const localValue = existing[field];

    if (localOnly.has(field) && hasLocal) continue;

    if (verified.has(field) && hasLocal) {
      if (providerValue !== undefined && providerValue !== null && !deepEqual(localValue, providerValue)) {
        conflicts.push({ field, localValue, providerValue });
      }
      continue;
    }

    if (providerValue === undefined || providerValue === null) {
      if (hasLocal && localValue !== null && localValue !== undefined) keptOmitted.push(field);
      else data[field] = null;
      continue;
    }

    data[field] = providerValue;
  }

  return { data, changed: !deepEqual(data, existing), conflicts, keptOmitted };
}
