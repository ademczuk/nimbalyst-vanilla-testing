// @vitest-environment node
/**
 * `nim login` and `nim wiki` against a mocked collab server (and a mocked
 * GitHub for the gated GitHub-native mode). The contract pinned here: only our
 * tokens are stored, in a 0600 file under a lock; a 401 refreshes once; every
 * wiki call carries the repo, and the project pin, the skill would have passed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main } from '../../index.js';
import { boundedExpiresMs, boundedIntervalMs } from '../auth.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

type Handler = (call: Call) => { status?: number; json: unknown; delayMs?: number } | undefined;

const ACCESS_JWT = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJnaDo0MiJ9.sig';

let calls: Call[];
let handlers: Handler[];
let tmp: string;
let stdout: string;
let stderr: string;
const savedEnv = { ...process.env };

function mockFetch(): void {
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(input), method: init.method ?? 'GET', headers, body: String(init.body ?? '') };
    calls.push(call);
    for (const h of handlers) {
      const res = h(call);
      if (res) {
        if (res.delayMs) await new Promise((r) => setTimeout(r, res.delayMs));
        return new Response(JSON.stringify(res.json), {
          status: res.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    throw new Error(`unmocked fetch ${call.method} ${call.url}`);
  });
}

function credentialsFile(): string {
  return path.join(tmp, 'config', 'credentials.json');
}

function writeCredentials(accessToken: string, refreshToken = 'refresh-1'): void {
  fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
  fs.writeFileSync(
    credentialsFile(),
    JSON.stringify({
      servers: {
        'https://sync.test': { accessToken, refreshToken, expiresAt: Date.now() + 3_600_000 },
      },
    }),
  );
}

function toolResult(value: unknown) {
  return { json: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(value) }] } } };
}

beforeEach(() => {
  calls = [];
  handlers = [];
  stdout = '';
  stderr = '';
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-cloud-'));
  process.env.NIM_CONFIG_DIR = path.join(tmp, 'config');
  process.env.NIM_SERVER = 'https://sync.test';
  process.env.NIM_GITHUB_CLIENT_ID = 'gh-client';
  process.env.NIM_DEVICE_POLL_FLOOR_MS = '0';
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
    stderr += String(chunk);
    return true;
  });
  mockFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...savedEnv };
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('nim login', () => {
  it('runs the Nimbalyst device flow: pending, slow_down, then tokens, and whoami shows the email', async () => {
    let polls = 0;
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/device/code'
        ? {
            json: {
              device_code: 'dev-1',
              user_code: 'WXYZ-9876',
              verification_uri: 'https://console.test/connect/device',
              verification_uri_complete: 'https://console.test/connect/device?code=WXYZ-9876',
              interval: 0,
              expires_in: 900,
            },
          }
        : undefined,
    );
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/oauth/token') return undefined;
      polls += 1;
      if (polls === 1) return { status: 400, json: { error: 'authorization_pending' } };
      if (polls === 2) return { status: 400, json: { error: 'slow_down', interval: 0 } };
      return { json: { access_token: ACCESS_JWT, refresh_token: 'nim-refresh', expires_in: 3600, token_type: 'Bearer' } };
    });
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/userinfo' && c.headers.authorization === `Bearer ${ACCESS_JWT}`
        ? { json: { sub: 'email:ada@example.com', email: 'ada@example.com' } }
        : undefined,
    );

    expect(await main(['login'])).toBe(0);

    expect(stderr).toContain('https://console.test/connect/device?code=WXYZ-9876');
    expect(stderr).toContain('WXYZ-9876');
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({ client_id: 'nim-cli' });
    const pollBodies = calls.filter((c) => c.url.endsWith('/oauth/token')).map((c) => Object.fromEntries(new URLSearchParams(c.body)));
    expect(pollBodies).toHaveLength(3);
    expect(pollBodies[0]).toEqual({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: 'dev-1', client_id: 'nim-cli' });
    expect(calls.some((c) => c.url.includes('github'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toMatchObject({
      accessToken: ACCESS_JWT,
      refreshToken: 'nim-refresh',
    });
    expect(stdout).toContain('ada@example.com');
    expect(stdout + stderr).not.toContain(ACCESS_JWT);

    stdout = '';
    expect(await main(['whoami', '-q'])).toBe(0);
    expect(stdout.trim()).toBe('ada@example.com');
  });

  it('stops on expired_token without storing anything', async () => {
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/device/code'
        ? { json: { device_code: 'dev-1', user_code: 'U', verification_uri: 'https://console.test/connect/device', interval: 0, expires_in: 900 } }
        : undefined,
    );
    let tokenError = 'expired_token';
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? { status: 400, json: { error: tokenError } } : undefined));
    expect(await main(['login'])).toBe(2);
    expect(stderr).toMatch(/expired/);
    // The server answers a spent or unknown device code with invalid_grant.
    tokenError = 'invalid_grant';
    stderr = '';
    expect(await main(['login'])).toBe(2);
    expect(stderr).toMatch(/expired/);
    expect(fs.existsSync(credentialsFile())).toBe(false);
  });

  it('bounds a hostile device-code interval and lifetime', () => {
    process.env.NIM_DEVICE_POLL_FLOOR_MS = '1000';
    expect(boundedIntervalMs(0, 5)).toBe(1000); // no busy loop
    expect(boundedIntervalMs(-5, 5)).toBe(5000);
    expect(boundedIntervalMs('soon', 7)).toBe(7000);
    expect(boundedIntervalMs(1e9, 5)).toBe(60_000);
    expect(boundedExpiresMs(1e12)).toBe(1_800_000);
    expect(boundedExpiresMs(-1)).toBe(900_000);
    expect(boundedExpiresMs(undefined)).toBe(900_000);
  });
  it('logout revokes the refresh token first, and only warns when revocation fails', async () => {
    writeCredentials('access-1', 'refresh-1');
    handlers.push((c) => (c.url === 'https://sync.test/oauth/revoke' ? { status: 200, json: {} } : undefined));
    expect(await main(['logout'])).toBe(0);
    const revoke = calls.find((c) => c.url === 'https://sync.test/oauth/revoke')!;
    expect(revoke.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(revoke.body))).toEqual({ token: 'refresh-1', token_type_hint: 'refresh_token', client_id: 'nim-cli' });
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toBeUndefined();

    writeCredentials('access-1', 'refresh-1');
    handlers.unshift((c) => (c.url === 'https://sync.test/oauth/revoke' ? { status: 503, json: { error: 'temporarily_unavailable' } } : undefined));
    expect(await main(['logout'])).toBe(0);
    expect(stderr).toMatch(/warning.*revoke/i);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toBeUndefined();
  });

  it('strips control sequences from error messages', async () => {
    writeCredentials('access-1');
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/userinfo' ? { status: 500, json: {} } : undefined,
    );
    process.env.NIM_SERVER = 'https://sync.test';
    handlers.unshift((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      return { json: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'x', message: 'bad \u001b[2J\u001b]0;pwned\u0007 thing' }) }] } } };
    });
    const dir = gitRepo('git@github.com:acme/widgets.git');
    expect(await main(['wiki', 'get', 'i1', '--workspace', dir])).toBe(2);
    expect(stderr).toContain('bad');
    expect(stderr).not.toMatch(/\u001b/);
  });

  it('runs the GitHub device flow only when NIM_GITHUB_NATIVE=on', async () => {
    process.env.NIM_GITHUB_NATIVE = 'on';
    let polls = 0;
    handlers.push((c) =>
      c.url === 'https://github.com/login/device/code'
        ? { json: { device_code: 'dev-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 } }
        : undefined,
    );
    handlers.push((c) => {
      if (c.url !== 'https://github.com/login/oauth/access_token') return undefined;
      polls += 1;
      return polls === 1
        ? { json: { error: 'authorization_pending' } }
        : { json: { access_token: 'gho_secret', token_type: 'bearer', scope: 'read:user,user:email' } };
    });
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/github/exchange'
        ? { json: { access_token: ACCESS_JWT, refresh_token: 'nim-refresh', expires_in: 3600, token_type: 'Bearer', scope: 'mcp' } }
        : undefined,
    );
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/userinfo' && c.headers.authorization === `Bearer ${ACCESS_JWT}`
        ? { json: { sub: 'github:42', githubUserId: 42, login: 'octo' } }
        : undefined,
    );

    const code = await main(['login']);

    expect(code).toBe(0);
    expect(stderr).toContain('ABCD-1234');
    const deviceReq = new URLSearchParams(calls[0].body);
    expect(deviceReq.get('client_id')).toBe('gh-client');
    expect(deviceReq.get('scope')).toBe('read:user user:email');
    expect(polls).toBe(2);

    const exchange = calls.find((c) => c.url.endsWith('/oauth/github/exchange'))!;
    expect(JSON.parse(exchange.body)).toEqual({ github_token: 'gho_secret' });

    const stored = fs.readFileSync(credentialsFile(), 'utf8');
    expect(stored).not.toContain('gho_secret');
    expect(JSON.parse(stored).servers['https://sync.test']).toMatchObject({
      accessToken: ACCESS_JWT,
      refreshToken: 'nim-refresh',
    });
    if (process.platform !== 'win32') {
      expect(fs.statSync(credentialsFile()).mode & 0o777).toBe(0o600);
    }
    expect(stdout + stderr).not.toContain(ACCESS_JWT);
    expect(stdout).toContain('octo');
  });

  it('whoami shows the userinfo login, and falls back to server and expiry on a 404', async () => {
    writeCredentials('access-1');
    handlers.push((c) => (c.url === 'https://sync.test/oauth/userinfo' ? { json: { sub: 'github:42', login: 'octo' } } : undefined));
    expect(await main(['whoami', '-q'])).toBe(0);
    expect(stdout.trim()).toBe('octo');

    handlers.unshift((c) => (c.url === 'https://sync.test/oauth/userinfo' ? { status: 404, json: {} } : undefined));
    stdout = '';
    expect(await main(['whoami'])).toBe(0);
    expect(stdout).toContain('Logged in to https://sync.test');
    expect(stdout).toContain('token expires');
  });

  it('refuses with a clear error when no GitHub client id is configured in GitHub-native mode', async () => {
    process.env.NIM_GITHUB_NATIVE = 'on';
    process.env.NIM_GITHUB_CLIENT_ID = '';
    const code = await main(['login']);
    expect(code).toBe(2);
    expect(stderr).toContain('NIM_GITHUB_CLIENT_ID');
    expect(calls).toHaveLength(0);
  });
});

function gitRepo(remote?: string): string {
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // Sandboxed under os.tmpdir: never let a git test touch the checkout it runs in.
  expect(fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim())).toBe(fs.realpathSync(dir));
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

const BOUND_P1 = { state: 'bound', project: { orgId: 'o1', orgName: 'Acme', projectId: 'p1', projectName: 'Widgets', role: 'member' } };

function rpcCalls(): any[] {
  return calls.filter((c) => c.url === 'https://sync.test/mcp').map((c) => JSON.parse(c.body));
}

describe('nim wiki', () => {
  it('status sends wiki_status with the origin remote as repo and prints unbound, bound, and ambiguous', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    let status: unknown = {
      state: 'unbound',
      teams: [
        { orgId: 'o1', orgName: 'Acme', role: 'admin' },
        { orgId: 'o2', orgName: 'Side', role: 'member' },
      ],
    };
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult(status) : undefined));

    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(rpcCalls()).toEqual([
      { jsonrpc: '2.0', id: expect.any(Number), method: 'tools/call', params: { name: 'wiki_status', arguments: { repo: 'git@github.com:acme/widgets.git' } } },
    ]);
    expect(calls[0].headers.authorization).toBe('Bearer access-1');
    expect(stdout).toMatch(/not connected/);
    expect(stdout).toMatch(/Acme.*o1.*admin/);
    expect(stdout).toContain('nim wiki bind --org o1 --project <projectId>');
    expect(stdout).not.toContain('--org o2');
    expect(stdout).not.toMatch(/join|secret/i);

    status = { state: 'unbound', teams: [{ orgId: 'o1', orgName: 'Acme', role: 'owner', projects: [{ projectId: 'p7', projectName: 'Docs' }] }] };
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/nim wiki bind --org o1 --project p7.*Docs/);
    expect(stdout).not.toContain('<projectId>');

    status = { state: 'unbound', teams: [{ orgId: 'o2', orgName: 'Side', role: 'member' }] };
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(stdout).toContain('Ask a team admin to connect this repo in Nimbalyst');
    expect(stdout).not.toContain('nim wiki bind');

    status = { state: 'bound', project: { orgId: 'o1', orgName: 'Acme', projectId: 'p1', projectName: 'Widgets', role: 'member', url: 'https://console.test/org/acme/project/p1/wiki' } };
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/state\s+bound/);
    expect(stdout).toMatch(/project\s+Widgets \(p1\)/);
    expect(stdout).toContain('https://console.test/org/acme/project/p1/wiki');
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir, '-q'])).toBe(0);
    expect(stdout.trim()).toBe('bound');

    status = {
      state: 'ambiguous',
      projects: [
        { orgId: 'o1', orgName: 'Acme', projectId: 'p1', projectName: 'Widgets', role: 'member' },
        { orgId: 'o2', orgName: 'Side', projectId: 'p2', projectName: 'Widgets fork', role: 'member' },
      ],
    };
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/more than one/);
    expect(stdout).toContain('nim wiki pin --org <orgId> --project <projectId>');
    expect(stdout).toMatch(/Widgets fork.*p2/);
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir, '--json'])).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ state: 'ambiguous' });
  });

  it('pin only accepts a project the repo actually resolves to, and the pin is then sent as project', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    const pinFile = path.join(dir, '.nimbalyst', 'wiki.json');
    let status: unknown = {
      state: 'ambiguous',
      projects: [
        { orgId: 'o1', orgName: 'Acme', projectId: 'p1', projectName: 'Widgets' },
        { orgId: 'o2', orgName: 'Side', projectId: 'p2', projectName: 'Fork' },
      ],
    };
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult(status) : undefined));

    // A project the user can reach but the repo is not connected to is refused, even if the server would accept it as `project`.
    expect(await main(['wiki', 'pin', '--org', 'o9', '--project', 'p9', '--workspace', dir])).toBe(2);
    expect(fs.existsSync(pinFile)).toBe(false);

    expect(await main(['wiki', 'pin', '--org', 'o2', '--project', 'p2', '--workspace', dir])).toBe(0);
    expect(JSON.parse(fs.readFileSync(pinFile, 'utf8'))).toEqual({ orgId: 'o2', projectId: 'p2' });
    expect(stdout).toContain('Fork');

    // The pin lookup never presents the choice as `project`: it asks what the repo resolves to.
    expect(rpcCalls().map((r) => r.params.arguments)).toEqual([
      { repo: 'git@github.com:acme/widgets.git' },
      { repo: 'git@github.com:acme/widgets.git' },
    ]);

    status = { state: 'bound', project: { orgId: 'o2', orgName: 'Side', projectId: 'p2', projectName: 'Fork' } };
    expect(await main(['wiki', 'list', '--workspace', dir, '-q'])).toBe(0);
    expect(rpcCalls().at(-1)).toMatchObject({ params: { name: 'wiki_list', arguments: { repo: 'git@github.com:acme/widgets.git', project: { orgId: 'o2', projectId: 'p2' } } } });

    // Bound: only the bound project can be pinned.
    fs.rmSync(pinFile);
    expect(await main(['wiki', 'pin', '--org', 'o1', '--project', 'p1', '--workspace', dir])).toBe(2);
    expect(fs.existsSync(pinFile)).toBe(false);

    // Unbound: nothing to pin.
    status = { state: 'unbound', teams: [] };
    expect(await main(['wiki', 'pin', '--org', 'o2', '--project', 'p2', '--workspace', dir])).toBe(2);

    // --repo naming another repository is refused rather than pinning this checkout for it.
    status = { state: 'bound', project: { orgId: 'o2', projectId: 'p2' } };
    const before = calls.length;
    expect(await main(['wiki', 'pin', '--org', 'o2', '--project', 'p2', '--repo', 'git@github.com:acme/other.git', '--workspace', dir])).toBe(2);
    expect(stderr).toMatch(/--repo/);
    expect(calls.length).toBe(before);
    expect(fs.existsSync(pinFile)).toBe(false);
  });

  it('pin_mismatch is a usage error that points at nim wiki status', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    handlers.push((c) =>
      c.url === 'https://sync.test/mcp'
        ? { json: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'pin_mismatch', message: 'The pin in .nimbalyst/wiki.json names a project this repository is not connected to' }) }] } } }
        : undefined,
    );
    expect(await main(['wiki', 'list', '--workspace', dir])).toBe(2);
    expect(stderr).toContain("names a project this repository is not connected to (pin_mismatch) Run 'nim wiki status'");
  });
  it('bind calls wiki_bind_repo, and create-project calls wiki_create_project with the repo only on --bind', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      const name = JSON.parse(c.body).params.name;
      if (name === 'wiki_bind_repo') return toolResult({ state: 'bound', project: { orgId: 'o1', projectId: 'p1', projectName: 'Widgets', url: 'https://console.test/p1' } });
      return toolResult({ project: { orgId: 'o1', projectId: 'p-new', projectName: 'Docs', url: 'https://console.test/p-new' } });
    });

    expect(await main(['wiki', 'bind', '--org', 'o1', '--project', 'p1', '--workspace', dir])).toBe(0);
    expect(stdout).toContain('https://console.test/p1');
    expect(await main(['wiki', 'create-project', '--org', 'o1', '--name', 'Docs', '--workspace', dir, '-q'])).toBe(0);
    expect(await main(['wiki', 'create-project', '--org', 'o1', '--name', 'Docs', '--bind', '--workspace', dir, '-q'])).toBe(0);
    expect(stdout.trim().split('\n').slice(-2)).toEqual(['p-new', 'p-new']);

    expect(rpcCalls().map((r) => [r.params.name, r.params.arguments])).toEqual([
      ['wiki_bind_repo', { repo: 'git@github.com:acme/widgets.git', orgId: 'o1', projectId: 'p1' }],
      ['wiki_create_project', { orgId: 'o1', name: 'Docs' }],
      ['wiki_create_project', { orgId: 'o1', name: 'Docs', repo: 'git@github.com:acme/widgets.git' }],
    ]);
    // Binding never writes a pin: the remote is what resolves the project.
    expect(fs.existsSync(path.join(dir, '.nimbalyst', 'wiki.json'))).toBe(false);

    expect(await main(['wiki', 'bind', '--org', 'o1', '--workspace', dir])).toBe(2);
    expect(await main(['wiki', 'create-project', '--name', 'Docs', '--workspace', dir])).toBe(2);
  });

  it('hides and refuses the GitHub-native membership commands unless NIM_GITHUB_NATIVE=on', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('nim wiki bind --org');
    for (const verb of ['wiki create ', 'invite', 'remove-member', 'rotate-secret', 'join-secret']) expect(stdout).not.toContain(verb);
    for (const verb of ['create', 'invite', 'remove-member', 'rotate-secret']) {
      expect(await main(['wiki', verb, 'octo', '--workspace', dir])).toBe(2);
    }
    expect(calls).toHaveLength(0);

    process.env.NIM_GITHUB_NATIVE = 'on';
    stdout = '';
    expect(await main(['--help'])).toBe(0);
    expect(stdout).toContain('nim wiki rotate-secret');
  });

  it('GitHub-native mode: wiki id for a non-GitHub remote, join secret alongside a GitHub remote, joinError in status', async () => {
    process.env.NIM_GITHUB_NATIVE = 'on';
    writeCredentials('access-1');
    const dir = gitRepo('git@gitlab.com:acme/widgets.git');
    fs.mkdirSync(path.join(dir, '.nimbalyst'));
    fs.writeFileSync(path.join(dir, '.nimbalyst', 'wiki.json'), JSON.stringify({ wikiId: 'w9', joinSecret: 'js-1' }));
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult({ state: 'member', wiki: { id: 'w9' } }) : undefined));

    expect(await main(['wiki', 'status', '--workspace', dir, '-q'])).toBe(0);
    execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/acme/widgets.git'], { cwd: dir });
    expect(await main(['wiki', 'status', '--workspace', dir, '-q'])).toBe(0);

    expect(rpcCalls().map((r) => r.params.arguments)).toEqual([
      { repo: 'wiki:w9', joinSecret: 'js-1' },
      { repo: 'https://github.com/acme/widgets.git', joinSecret: 'js-1' },
    ]);

    handlers.unshift((c) =>
      c.url === 'https://sync.test/mcp' ? toolResult({ state: 'not-member', joinError: { code: 'invalid_secret', message: 'rotated' } }) : undefined,
    );
    stdout = '';
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/joinError.*invalid_secret/);
  });

  it('never reads the current directory\'s wiki.json when --repo or --org/--project is given', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    fs.mkdirSync(path.join(dir, '.nimbalyst'));
    fs.writeFileSync(path.join(dir, '.nimbalyst', 'wiki.json'), JSON.stringify({ orgId: 'o-here', projectId: 'p-here' }));
    handlers.push((c) => {
      if (c.url === 'https://sync.test/mcp') {
        return toolResult({ state: 'bound', project: { orgId: 'o-other', projectId: 'p-other', projectName: 'Other' } });
      }
      if (c.url.startsWith('https://sync.test/api/teams/')) return { json: { changesets: [] } };
      return undefined;
    });

    expect(await main(['wiki', 'list', '--repo', 'git@github.com:acme/other.git', '--workspace', dir, '-q'])).toBe(0);
    expect(await main(['wiki', 'list', '--org', 'o-other', '--project', 'p-other', '--workspace', dir, '-q'])).toBe(0);
    expect(await main(['wiki', 'changes', '--repo', 'git@github.com:acme/other.git', '--workspace', dir, '-q'])).toBe(0);

    expect(rpcCalls().map((r) => r.params.arguments)).toEqual([
      { repo: 'git@github.com:acme/other.git' },
      { repo: 'git@github.com:acme/widgets.git', project: { orgId: 'o-other', projectId: 'p-other' } },
      { repo: 'git@github.com:acme/other.git' },
    ]);
    expect(calls.filter((c) => c.url.includes('/api/')).map((c) => c.url)).toEqual([
      'https://sync.test/api/teams/o-other/projects/p-other/wiki/changesets',
    ]);
    expect(await main(['wiki', 'list', '--project', 'p-other', '--workspace', dir])).toBe(2);
  });

  it('refuses a changeset call when the server resolves a different project than the pin', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    fs.mkdirSync(path.join(dir, '.nimbalyst'));
    fs.writeFileSync(path.join(dir, '.nimbalyst', 'wiki.json'), JSON.stringify({ orgId: 'o1', projectId: 'p1' }));
    handlers.push((c) =>
      c.url === 'https://sync.test/mcp' ? toolResult({ state: 'bound', project: { orgId: 'o1', projectId: 'p2' } }) : undefined,
    );
    expect(await main(['wiki', 'changes', 'show', 'cs-1', '--workspace', dir])).not.toBe(0);
    expect(stderr).toMatch(/p1.*p2|p2.*p1/);
    expect(calls.filter((c) => c.url.includes('/api/'))).toHaveLength(0);
  });

  it('refreshes once on a 401 and retries with the new token', async () => {
    writeCredentials('stale', 'refresh-1');
    const dir = gitRepo('https://github.com/acme/widgets');
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      return c.headers.authorization === 'Bearer fresh'
        ? toolResult({ state: 'no-wiki', createOptions: ['invite'] })
        : { status: 401, json: { error: 'invalid_token' } };
    });
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/token'
        ? { json: { access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600, token_type: 'Bearer' } }
        : undefined,
    );

    expect(await main(['wiki', 'status', '--workspace', dir, '--json'])).toBe(0);

    const refresh = calls.find((c) => c.url.endsWith('/oauth/token'))!;
    expect(Object.fromEntries(new URLSearchParams(refresh.body))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'nim-cli',
    });
    expect(calls.filter((c) => c.url.endsWith('/mcp')).map((c) => c.headers.authorization)).toEqual(['Bearer stale', 'Bearer fresh']);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toMatchObject({
      accessToken: 'fresh',
      refreshToken: 'refresh-2',
    });
  });

  it('never sends a refresh token twice, even when the pre-expiry refresh failed', async () => {
    writeCredentials('stale', 'refresh-1');
    const file = JSON.parse(fs.readFileSync(credentialsFile(), 'utf8'));
    file.servers['https://sync.test'].expiresAt = Date.now() - 1000;
    fs.writeFileSync(credentialsFile(), JSON.stringify(file));
    const dir = gitRepo('https://github.com/acme/widgets');
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? { status: 400, json: { error: 'invalid_grant' } } : undefined));
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? { status: 401, json: { error: 'invalid_token' } } : undefined));

    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(2);
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(2);

    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    expect(stderr).toContain("nim login");
  });

  it('serializes concurrent refreshes so a rotated refresh token is sent exactly once', async () => {
    writeCredentials('stale', 'refresh-1');
    const dir = gitRepo('https://github.com/acme/widgets');
    let issued = 0;
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/oauth/token') return undefined;
      issued += 1;
      return { delayMs: 50, json: { access_token: `fresh-${issued}`, refresh_token: `refresh-${issued + 1}`, expires_in: 3600 } };
    });
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      return c.headers.authorization === 'Bearer stale'
        ? { status: 401, json: { error: 'invalid_token' } }
        : toolResult({ state: 'member' });
    });

    const codes = await Promise.all([
      main(['wiki', 'status', '--workspace', dir, '-q']),
      main(['wiki', 'status', '--workspace', dir, '-q']),
    ]);

    expect(codes).toEqual([0, 0]);
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    expect(fs.existsSync(`${credentialsFile()}.lock`)).toBe(false);
  });

  it('define-type, changes begin and changes finish send their wiki_* tools', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    fs.writeFileSync(path.join(tmp, 'claim.yaml'), 'type: claim\nfields:\n  - name: subject\n');
    fs.writeFileSync(path.join(tmp, 'predicates.yaml'), 'predicates:\n  - id: depends-on\n');
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      const name = JSON.parse(c.body).params.name;
      if (name === 'wiki_begin_changeset') return toolResult({ changesetId: 'cs-7', url: 'https://console.test/cs-7' });
      if (name === 'wiki_finish_changeset') return toolResult({ digest: '1 claim added', url: 'https://console.test/cs-7' });
      return toolResult({ type: 'claim' });
    });

    expect(await main(['wiki', 'changes', 'begin', '--title', 'PR 12', '--workspace', dir, '-q'])).toBe(0);
    expect(stdout.trim()).toBe('cs-7');
    expect(await main(['wiki', 'define-type', '-f', path.join(tmp, 'claim.yaml'), '--predicates-file', path.join(tmp, 'predicates.yaml'), '--overwrite', '--changeset', 'cs-7', '--workspace', dir])).toBe(0);
    expect(await main(['wiki', 'changes', 'finish', 'cs-7', '--summary', 'done', '--workspace', dir])).toBe(0);

    const repo = 'git@github.com:acme/widgets.git';
    expect(rpcCalls().map((r) => [r.params.name, r.params.arguments])).toEqual([
      ['wiki_begin_changeset', { repo, title: 'PR 12', source: 'cli' }],
      ['wiki_define_type', { repo, schema: { type: 'claim', fields: [{ name: 'subject' }] }, overwrite: true, predicates: [{ id: 'depends-on' }], changesetId: 'cs-7' }],
      ['wiki_finish_changeset', { repo, changesetId: 'cs-7', summary: 'done' }],
    ]);
    expect(stdout).toContain('1 claim added');
  });

  it('keeps the refresh token on a server error and drops it only on invalid_grant', async () => {
    writeCredentials('stale', 'refresh-1');
    const dir = gitRepo('https://github.com/acme/widgets');
    let tokenReply: { status: number; json: unknown } = { status: 503, json: { error: 'temporarily_unavailable' } };
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? tokenReply : undefined));
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? { status: 401, json: {} } : undefined));
    const stored = () => JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test'];

    expect(await main(['wiki', 'status', '--workspace', dir])).not.toBe(0);
    expect(stored().refreshToken).toBe('refresh-1');

    tokenReply = { status: 400, json: { error: 'invalid_grant' } };
    expect(await main(['wiki', 'status', '--workspace', dir])).toBe(2);
    expect(stored().refreshToken).toBeUndefined();
  });

  it('logout and a token save wait for a lock another process holds', async () => {
    writeCredentials('access-1');
    const lock = `${credentialsFile()}.lock`;
    fs.writeFileSync(lock, 'other:1');
    let done = false;
    const logout = main(['logout']).then((code) => ((done = true), code));
    await new Promise((r) => setTimeout(r, 150));
    expect(done).toBe(false);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toBeDefined();
    fs.unlinkSync(lock);
    expect(await logout).toBe(0);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toBeUndefined();

    // Login's save goes through the same lock.
    fs.writeFileSync(lock, 'other:2');
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/device/code'
        ? { json: { device_code: 'd', user_code: 'U', verification_uri: 'https://console.test/connect/device', interval: 0, expires_in: 900 } }
        : undefined,
    );
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? { json: { access_token: 'a2', refresh_token: 'r2' } } : undefined));
    handlers.push((c) => (c.url === 'https://sync.test/oauth/userinfo' ? { json: { sub: 'email:a@b.c', email: 'a@b.c' } } : undefined));
    done = false;
    const login = main(['login']).then((code) => ((done = true), code));
    await new Promise((r) => setTimeout(r, 150));
    expect(done).toBe(false);
    fs.unlinkSync(lock);
    expect(await login).toBe(0);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test'].accessToken).toBe('a2');
  });

  it('tightens an existing config dir to 0700 and refuses a plain-http server that is not localhost', async () => {
    if (process.platform !== 'win32') {
      fs.mkdirSync(path.join(tmp, 'config'), { recursive: true, mode: 0o755 });
      fs.chmodSync(path.join(tmp, 'config'), 0o755);
      expect(await main(['logout'])).toBe(0);
      expect(fs.statSync(path.join(tmp, 'config')).mode & 0o777).toBe(0o700);
    }
    process.env.NIM_SERVER = 'http://sync.example.com';
    expect(await main(['whoami'])).toBe(2);
    expect(stderr).toMatch(/https/);
    expect(calls).toHaveLength(0);
    process.env.NIM_SERVER = 'http://localhost:8787';
    expect(await main(['logout'])).toBe(0);
  });

  it('gives up on a lock held past the deadline, and takes over a lock dated in the future', async () => {
    writeCredentials('access-1');
    process.env.NIM_CREDENTIALS_LOCK_TIMEOUT_MS = '200';
    const lock = `${credentialsFile()}.lock`;
    fs.writeFileSync(lock, 'other:1');
    const started = Date.now();
    expect(await main(['logout'])).toBe(3);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(stderr).toMatch(/lock/);
    expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test']).toBeDefined();

    const future = new Date(Date.now() + 3_600_000);
    fs.utimesSync(lock, future, future);
    expect(await main(['logout'])).toBe(0);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it('refuses to save over a credentials file it cannot read or parse', async () => {
    fs.mkdirSync(path.dirname(credentialsFile()), { recursive: true });
    fs.writeFileSync(credentialsFile(), '{ not json');
    handlers.push((c) =>
      c.url === 'https://sync.test/oauth/device/code'
        ? { json: { device_code: 'd', user_code: 'U', verification_uri: 'https://console.test/connect/device', interval: 0, expires_in: 900 } }
        : undefined,
    );
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? { json: { access_token: 'a2', refresh_token: 'r2' } } : undefined));
    expect(await main(['login'])).not.toBe(0);
    expect(fs.readFileSync(credentialsFile(), 'utf8')).toBe('{ not json');
    expect(stderr).toContain(credentialsFile());

    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      fs.writeFileSync(credentialsFile(), JSON.stringify({ servers: { 'https://sync.test': { accessToken: 'keep' } } }));
      fs.chmodSync(credentialsFile(), 0o000);
      try {
        expect(await main(['logout'])).not.toBe(0);
      } finally {
        fs.chmodSync(credentialsFile(), 0o600);
      }
      expect(JSON.parse(fs.readFileSync(credentialsFile(), 'utf8')).servers['https://sync.test'].accessToken).toBe('keep');
    }
  });

  it('takes over a stale lock left by a dead process', async () => {
    writeCredentials('stale', 'refresh-1');
    const lock = `${credentialsFile()}.lock`;
    fs.writeFileSync(lock, 'dead:1');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    const dir = gitRepo('https://github.com/acme/widgets');
    handlers.push((c) => (c.url === 'https://sync.test/oauth/token' ? { json: { access_token: 'fresh', refresh_token: 'refresh-2' } } : undefined));
    handlers.push((c) =>
      c.url === 'https://sync.test/mcp'
        ? c.headers.authorization === 'Bearer fresh' ? toolResult({ state: 'member' }) : { status: 401, json: {} }
        : undefined,
    );

    expect(await main(['wiki', 'status', '--workspace', dir, '-q'])).toBe(0);
    expect(fs.readdirSync(path.dirname(lock)).filter((f) => f.includes('.lock'))).toEqual([]);
  });

  it('maps server tool error codes to exit codes', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    let code = 'not_a_member';
    handlers.push((c) =>
      c.url === 'https://sync.test/mcp'
        ? { json: { jsonrpc: '2.0', id: 1, result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, message: 'no' }) }] } } }
        : undefined,
    );
    const exits: number[] = [];
    for (const c of ['not_a_member', 'changeset_not_yours', 'changeset_required', 'revision_conflict', 'repo_not_bound', 'ambiguous_project', 'project_not_accessible', 'admin_required']) {
      code = c;
      exits.push(await main(['wiki', 'get', 'i1', '--workspace', dir]));
    }
    expect(exits).toEqual([5, 5, 2, 2, 2, 2, 5, 5]);
    expect(stderr).toContain("repo_not_bound) Run 'nim wiki status'");
  });

  it('GitHub-native mode: create in a repo with no remote asks for wiki:new and records the id in wiki.json', async () => {
    process.env.NIM_GITHUB_NATIVE = 'on';
    writeCredentials('access-1');
    const dir = gitRepo();
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult({ wiki: { id: 'w-new', policy: 'invite' } }) : undefined));

    expect(await main(['wiki', 'create', '--workspace', dir, '-q'])).toBe(0);

    expect(rpcCalls()[0].params.arguments).toEqual({ repo: 'wiki:new', policy: 'invite' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.nimbalyst', 'wiki.json'), 'utf8'))).toEqual({ wikiId: 'w-new' });
  });

  it('create-item and update-item report what happened to the page text', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      return JSON.parse(c.body).params.name === 'wiki_create_item'
        ? toolResult({ id: 'i1', url: 'https://console.test/i1', body: { status: 'written' } })
        : toolResult({ id: 'i1', body: { status: 'refused', code: 'body_edited', message: 'Someone edited the page' } });
    });

    expect(await main(['wiki', 'create-item', 'claim', 'X', '--body', 'text', '--changeset', 'cs-1', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/body\s+written/);
    stdout = '';
    expect(await main(['wiki', 'update-item', 'i1', '--body', 'new', '--changeset', 'cs-1', '--workspace', dir])).toBe(0);
    expect(stdout).toMatch(/body\s+refused \(body_edited\): Someone edited the page/);
  });

  it('a refused or failed page-text outcome always goes to stderr, and failed exits with the partial-write code', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    let body: unknown = { status: 'refused', code: 'body_edited', message: 'Someone edited the page' };
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult({ id: 'i1', body }) : undefined));

    expect(await main(['wiki', 'update-item', 'i1', '--body', 'new', '--changeset', 'cs-1', '--workspace', dir, '-q'])).toBe(0);
    expect(stdout.trim()).toBe('i1');
    expect(stderr).toMatch(/i1.*refused \(body_edited\): Someone edited the page/);

    body = { status: 'failed', code: 'convert_error', message: 'bad markdown' };
    stderr = '';
    expect(await main(['wiki', 'create-item', 'claim', 'X', '--body', 'x', '--changeset', 'cs-1', '--workspace', dir, '-q'])).toBe(6);
    expect(stderr).toMatch(/i1.*failed \(convert_error\): bad markdown/);
    expect(stderr).toMatch(/item was written/);

    // Not only in quiet mode: JSON and human output get the stderr line too.
    stderr = '';
    expect(await main(['wiki', 'update-item', 'i1', '--body', 'x', '--changeset', 'cs-1', '--workspace', dir, '--json'])).toBe(6);
    expect(JSON.parse(stdout.slice(stdout.indexOf('{')))).toMatchObject({ body: { status: 'failed' } });
    expect(stderr).toMatch(/i1.*failed/);
    stdout = '';

    body = { status: 'written' };
    stderr = '';
    expect(await main(['wiki', 'update-item', 'i1', '--body', 'new', '--changeset', 'cs-1', '--workspace', dir, '-q'])).toBe(0);
    expect(stderr).toBe('');
  });

  it('changes lists the author email and show links the console page by org id, not slug', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    handlers.push((c) => (c.url === 'https://sync.test/mcp' ? toolResult({ ...BOUND_P1, project: { ...BOUND_P1.project, orgSlug: 'team-5f1c' } }) : undefined));
    handlers.push((c) => {
      if (c.url === 'https://sync.test/api/teams/o1/projects/p1/wiki/changesets') {
        return { json: { changesets: [{ id: 'cs-1', source: 'cli', principal: { kind: 'stytch', id: 'member-1', email: 'ada@example.com' }, title: 'PR 12' }] } };
      }
      if (c.url === 'https://sync.test/api/teams/o1/projects/p1/wiki/changesets/cs-1') return { json: { changeset: { id: 'cs-1', title: 'PR 12' }, entries: [] } };
      return undefined;
    });

    expect(await main(['wiki', 'changes', '--workspace', dir])).toBe(0);
    expect(stdout).toContain('ada@example.com');
    expect(stdout).not.toContain('member-1');
    expect(await main(['wiki', 'changes', 'show', 'cs-1', '--workspace', dir])).toBe(0);
    // The console resolves the org segment by id; a Stytch slug lands on its no-access screen.
    expect(stdout).toContain('https://console.nimbalyst.com/org/o1/project/p1/wiki/changes/cs-1');
    expect(stdout).not.toContain('team-5f1c');
  });

  it('wikiApi reports error_description, and JSON-RPC errors map to their own exit codes', async () => {
    writeCredentials('access-1');
    const dir = gitRepo('git@github.com:acme/widgets.git');
    let rpc: unknown = { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool: wiki_x' } };
    handlers.push((c) => {
      if (c.url !== 'https://sync.test/mcp') return undefined;
      return JSON.parse(c.body).params.name === 'wiki_status' ? toolResult(BOUND_P1) : { json: rpc };
    });
    handlers.push((c) =>
      c.url.includes('/api/teams/') ? { status: 403, json: { error: 'forbidden', error_description: 'Not a member of this project' } } : undefined,
    );

    expect(await main(['wiki', 'get', 'i1', '--workspace', dir])).toBe(2);
    rpc = { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } };
    expect(await main(['wiki', 'get', 'i1', '--workspace', dir])).toBe(3);
    expect(await main(['wiki', 'changes', '--workspace', dir])).toBe(5);
    expect(stderr).toContain('Not a member of this project');
  });
});
