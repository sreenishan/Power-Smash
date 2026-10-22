// "Sync now" and "Publish now" (D-008): GitHub `workflow_dispatch`, which needs only an Actions: write token on ONE repository
// (REBUILD_DISPATCH_TOKEN, a Worker secret). Never `repository_dispatch` (that needs Contents: write). The token is never logged
// or returned; the response body of GitHub is never returned either.
export type DispatchKind = 'sync' | 'publish';

export type DispatchOutcome = { ok: true } | { ok: false; reason: 'not_configured' | 'rejected' | 'network' };

export type DispatchFn = (kind: DispatchKind) => Promise<DispatchOutcome>;

export interface GithubDispatchConfig {
  token: string;
  /** `owner/name` */
  repo: string;
  /** Workflow FILE names (not secrets): publish = deploy.yml; sync = the sync workflow file. */
  workflows: { sync: string; publish: string };
  ref: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const FILE = /^[A-Za-z0-9_.-]{1,100}\.ya?ml$/;
const REF = /^[A-Za-z0-9_./-]{1,100}$/;

export function createGithubDispatch(cfg: GithubDispatchConfig): DispatchFn {
  const valid = cfg.token.trim() !== '' && REPO.test(cfg.repo) && FILE.test(cfg.workflows.sync) && FILE.test(cfg.workflows.publish) && REF.test(cfg.ref) && !cfg.ref.includes('..');
  return async (kind) => {
    if (!valid) return { ok: false, reason: 'not_configured' };
    const file = kind === 'sync' ? cfg.workflows.sync : cfg.workflows.publish;
    try {
      const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(cfg.timeoutMs ?? 8000) : undefined;
      const res = await cfg.fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${file}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'power-smash-admin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref: cfg.ref }),
        signal,
      });
      return res.status === 204 ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch {
      return { ok: false, reason: 'network' };
    }
  };
}
