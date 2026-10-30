// The provider registry: which licensed sources the code knows, and whether each is usable with the configuration it was given.
//
// FAIL CLOSED. A provider is handed out ONLY when its status is 'ready':
//   not_registered       no adapter with that id (the production registry is EMPTY today: no licensed source exists, see
//                        docs/m5/international-data.md);
//   disabled             the switch is not exactly `true` (CLAUDE.md: every switch is off unless it is exactly true);
//   awaiting_licence     the definition does not record a signed licence/agreement (owner + lawyer decision, never assumed);
//   awaiting_credentials one or more required credentials are missing or blank (we report the NAMES only, never values);
//   invalid_config       an option failed the definition's own validation.
// Configuration values are passed in by the caller. Reading them from the environment belongs in src/lib/runtime-env.ts
// (TODO(lead): add the variable names there when a licensed provider exists; secret values never live in the repo).
import type { DataProvider, ProviderId } from './types';

export type LicenceStatus = 'none' | 'unverified' | 'signed';

export interface ProviderDefinition {
  id: ProviderId;
  /** Plain-English name for the admin. */
  displayName: string;
  /** Names of the credentials the adapter needs (for example `apiKey`). Values are never stored on the definition. */
  requiredCredentials: readonly string[];
  /** 'signed' only when a real agreement exists and is recorded (reference = where the signed copy is kept, not its contents). */
  licence: { status: LicenceStatus; reference: string | null };
  /** Optional extra checks on non-secret options; returns problems (empty = fine). */
  validateOptions?(options: Readonly<Record<string, unknown>>): string[];
  create(config: ResolvedProviderConfig): DataProvider;
}

export interface ProviderConfig {
  /** Must be exactly `true` (a string 'true' from the environment is converted by the caller, never guessed here). */
  enabled?: unknown;
  credentials?: Readonly<Record<string, string | undefined | null>>;
  options?: Readonly<Record<string, unknown>>;
}

export interface ResolvedProviderConfig {
  credentials: Readonly<Record<string, string>>;
  options: Readonly<Record<string, unknown>>;
}

export type ProviderStatus = 'not_registered' | 'disabled' | 'awaiting_licence' | 'awaiting_credentials' | 'invalid_config' | 'ready';

export interface ProviderStatusReport {
  id: ProviderId;
  status: ProviderStatus;
  /** Credential NAMES that are missing (never values). */
  missingCredentials: string[];
  /** Plain-English reasons for the admin. Never contain a credential value. */
  messages: string[];
}

export type ProviderLookup = { ok: true; provider: DataProvider; report: ProviderStatusReport } | { ok: false; report: ProviderStatusReport };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export class ProviderRegistry {
  readonly #defs = new Map<ProviderId, ProviderDefinition>();

  register(def: ProviderDefinition): void {
    if (!ID_RE.test(def.id)) throw new Error(`Provider id "${def.id}" must be a lower-case slug (a-z, 0-9, -), at most 40 characters`);
    if (this.#defs.has(def.id)) throw new Error(`Provider "${def.id}" is already registered`);
    this.#defs.set(def.id, def);
  }

  ids(): ProviderId[] {
    return [...this.#defs.keys()].sort();
  }

  status(id: ProviderId, config: ProviderConfig | undefined): ProviderStatusReport {
    const def = this.#defs.get(id);
    if (!def) return { id, status: 'not_registered', missingCredentials: [], messages: ['No adapter for this source. International data waits for a licensed source.'] };
    if (config?.enabled !== true) return { id, status: 'disabled', missingCredentials: [], messages: ['Switched off.'] };
    if (def.licence.status !== 'signed') {
      return { id, status: 'awaiting_licence', missingCredentials: [], messages: ['No signed data licence is recorded for this source.'] };
    }
    const creds = config.credentials ?? {};
    const missing = def.requiredCredentials.filter((name) => {
      const v = creds[name];
      return typeof v !== 'string' || v.trim() === '';
    });
    if (missing.length > 0) {
      return { id, status: 'awaiting_credentials', missingCredentials: missing, messages: [`Awaiting credentials: ${missing.join(', ')}.`] };
    }
    const optionProblems = def.validateOptions?.(config.options ?? {}) ?? [];
    if (optionProblems.length > 0) return { id, status: 'invalid_config', missingCredentials: [], messages: optionProblems };
    return { id, status: 'ready', missingCredentials: [], messages: [] };
  }

  /** The provider, only when ready. Anything else returns the report and NO provider (never a fake success). */
  get(id: ProviderId, config: ProviderConfig | undefined): ProviderLookup {
    const report = this.status(id, config);
    if (report.status !== 'ready') return { ok: false, report };
    const def = this.#defs.get(id) as ProviderDefinition;
    const credentials: Record<string, string> = {};
    for (const name of def.requiredCredentials) credentials[name] = String(config?.credentials?.[name]);
    const provider = def.create({ credentials: Object.freeze(credentials), options: Object.freeze({ ...(config?.options ?? {}) }) });
    if (provider.id !== id) throw new Error(`Adapter "${id}" returned a provider with id "${provider.id}"`);
    return { ok: true, provider, report };
  }
}

/**
 * The production registry. EMPTY on purpose: no licensed international data source exists yet (docs/m5/international-data.md).
 * Scraping adapters (bwfbadminton.com, tournamentsoftware.com or any other site) must never be registered here.
 */
export function createProductionRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}
