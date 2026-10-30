// Provider registry: fail closed. Missing credentials => 'awaiting_credentials', never a fake success; values never reported.
import { describe, expect, it } from 'vitest';
import { ProviderRegistry, createProductionRegistry, type ProviderDefinition } from '../../src/lib/providers/registry';
import { FAKE_PROVIDER_ID, FakeProvider } from './fake-provider';

// Secret-shaped fake value built at run time (CLAUDE.md: keeps gitleaks quiet).
const FAKE_KEY = ['fake', 'key', 'FICTIONAL'].join('_');

function def(over: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: FAKE_PROVIDER_ID,
    displayName: 'Fictional test source',
    requiredCredentials: ['apiKey', 'clientId'],
    licence: { status: 'signed', reference: 'fictional-test-reference' },
    create: () => new FakeProvider(),
    ...over,
  };
}

const okConfig = { enabled: true, credentials: { apiKey: FAKE_KEY, clientId: 'client-1' } };

describe('ProviderRegistry', () => {
  it('the production registry is empty: no licensed source exists yet', () => {
    const r = createProductionRegistry();
    expect(r.ids()).toEqual([]);
    const s = r.status('any-source', okConfig);
    expect(s.status).toBe('not_registered');
    expect(r.get('any-source', okConfig).ok).toBe(false);
  });

  it('is ready only with the switch exactly true, a signed licence and every credential', () => {
    const r = new ProviderRegistry();
    r.register(def());
    const got = r.get(FAKE_PROVIDER_ID, okConfig);
    expect(got.ok).toBe(true);
    expect(got.report.status).toBe('ready');
  });

  it('a switch that is not exactly true is disabled', () => {
    const r = new ProviderRegistry();
    r.register(def());
    for (const enabled of [undefined, false, 'true', 1, 'yes']) {
      const got = r.get(FAKE_PROVIDER_ID, { ...okConfig, enabled });
      expect(got.ok).toBe(false);
      expect(got.report.status).toBe('disabled');
    }
    expect(r.status(FAKE_PROVIDER_ID, undefined).status).toBe('disabled');
  });

  it('an unsigned or unverified licence is awaiting_licence, even with credentials', () => {
    for (const status of ['none', 'unverified'] as const) {
      const r = new ProviderRegistry();
      r.register(def({ licence: { status, reference: null } }));
      const got = r.get(FAKE_PROVIDER_ID, okConfig);
      expect(got.ok).toBe(false);
      expect(got.report.status).toBe('awaiting_licence');
    }
  });

  it('missing or blank credentials => awaiting_credentials, reporting NAMES only, never values', () => {
    const r = new ProviderRegistry();
    let created = 0;
    r.register(
      def({
        create: () => {
          created++;
          return new FakeProvider();
        },
      }),
    );
    const got = r.get(FAKE_PROVIDER_ID, { enabled: true, credentials: { apiKey: FAKE_KEY, clientId: '   ' } });
    expect(got.ok).toBe(false);
    expect(got.report.status).toBe('awaiting_credentials');
    expect(got.report.missingCredentials).toEqual(['clientId']);
    expect(JSON.stringify(got.report)).not.toContain(FAKE_KEY);
    expect(created).toBe(0);

    const none = r.get(FAKE_PROVIDER_ID, { enabled: true });
    expect(none.report.missingCredentials).toEqual(['apiKey', 'clientId']);
    const nul = r.get(FAKE_PROVIDER_ID, { enabled: true, credentials: { apiKey: null, clientId: undefined } });
    expect(nul.report.status).toBe('awaiting_credentials');
  });

  it('runs the definition option validation', () => {
    const r = new ProviderRegistry();
    r.register(def({ validateOptions: (o) => (typeof o['region'] === 'string' ? [] : ['region is required']) }));
    expect(r.status(FAKE_PROVIDER_ID, okConfig)).toMatchObject({ status: 'invalid_config', messages: ['region is required'] });
    expect(r.status(FAKE_PROVIDER_ID, { ...okConfig, options: { region: 'test' } }).status).toBe('ready');
  });

  it('passes only the required credentials, frozen, to the adapter', () => {
    const r = new ProviderRegistry();
    let seen: Readonly<Record<string, string>> | null = null;
    r.register(
      def({
        create: (cfg) => {
          seen = cfg.credentials;
          return new FakeProvider();
        },
      }),
    );
    r.get(FAKE_PROVIDER_ID, { ...okConfig, credentials: { ...okConfig.credentials, extra: 'unused' } });
    expect(Object.keys(seen ?? {}).sort()).toEqual(['apiKey', 'clientId']);
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it('rejects bad ids, duplicates and an adapter that lies about its id', () => {
    const r = new ProviderRegistry();
    expect(() => r.register(def({ id: 'Bad Id' }))).toThrow();
    r.register(def());
    expect(() => r.register(def())).toThrow(/already registered/);
    const r2 = new ProviderRegistry();
    r2.register(def({ create: () => new FakeProvider('other-id') }));
    expect(() => r2.get(FAKE_PROVIDER_ID, okConfig)).toThrow(/returned a provider/);
  });
});
