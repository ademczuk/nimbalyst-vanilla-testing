/**
 * Knowledge curator settings: the Jev provider credentials the sorter uses.
 *
 * Jev runs on TypeSafe (API key) or Cloudflare Workers AI (account ID, API
 * token, optional AI Gateway). Both are saved to the host's encrypted provider
 * credential store, which is the only place the backend's `getApiKey` broker
 * reads from. The Cloudflare fields are saved together as one JSON credential.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SettingsPanelProps } from '@nimbalyst/runtime';

const TYPESAFE_CREDENTIAL = 'typesafe';
const CLOUDFLARE_CREDENTIAL = 'cloudflare-workers-ai';

interface CuratorStatus {
  keyConfigured?: boolean;
  provider?: 'typesafe' | 'cloudflare' | null;
  typesafeConfigured?: boolean;
  cloudflareConfigured?: boolean;
  cloudflareAccountId?: string | null;
  cloudflareGatewayId?: string | null;
  decisionsLogged?: number;
  decisionLog?: string;
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return (window as unknown as { electronAPI: { invoke(c: string, ...a: unknown[]): Promise<unknown> } }).electronAPI.invoke(
    channel,
    ...args
  );
}

export function KnowledgeCuratorSettings({ callBackendTool }: SettingsPanelProps) {
  const [status, setStatus] = useState<CuratorStatus | null>(null);
  const [draft, setDraft] = useState('');
  const [cf, setCf] = useState({ accountId: '', apiToken: '', gatewayId: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ section: 'typesafe' | 'cloudflare'; text: string } | null>(null);

  const refresh = useCallback(async (): Promise<CuratorStatus | null> => {
    if (!callBackendTool) return null;
    try {
      const next = (await callBackendTool('knowledge.curator_status')) as CuratorStatus;
      setStatus(next);
      // Show the saved, non-secret Cloudflare fields; the token field stays blank.
      setCf({ accountId: next.cloudflareAccountId ?? '', apiToken: '', gatewayId: next.cloudflareGatewayId ?? '' });
      setError(null);
      return next;
    } catch (err) {
      setError(`The knowledge backend is not running: ${(err as Error).message}`);
      return null;
    }
  }, [callBackendTool]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (name: string, value: string) => {
    const section = name === TYPESAFE_CREDENTIAL ? 'typesafe' : 'cloudflare';
    setSaving(true);
    setNotice(null);
    try {
      if (value) await invoke('provider-credentials:set', name, value);
      else await invoke('provider-credentials:delete', name);
      if (section === 'typesafe') setDraft('');
      const next = await refresh();
      const saved = section === 'typesafe' ? next?.typesafeConfigured : next?.cloudflareConfigured;
      if (value && !saved) setError('The credential was written but the curator cannot read it back. Check the main process log.');
      else setNotice({ section, text: value ? 'Saved.' : 'Removed.' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveCloudflare = () =>
    save(
      CLOUDFLARE_CREDENTIAL,
      JSON.stringify({
        accountId: cf.accountId.trim(),
        apiToken: cf.apiToken.trim(),
        ...(cf.gatewayId.trim() ? { gatewayId: cf.gatewayId.trim() } : {}),
      })
    );

  return (
    <div className="knowledge-curator-settings" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4, fontSize: 13 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={HEADING}>
          Jev provider
          <span className="knowledge-curator-alpha-badge" style={ALPHA_BADGE}>
            Alpha
          </span>
        </h3>
        <p className="select-text" style={MUTED}>
          The curator sends each commit, session summary, and tracker change it sorts to TypeSafe's Jev model to decide whether it belongs in the knowledge graph. Jev runs on TypeSafe (api.typesafe.ai) or on your Cloudflare account through Workers AI. Nothing is sent until one of them is saved here. If both are saved, TypeSafe is used.
        </p>
      </section>

      <section className="knowledge-curator-typesafe" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h4 style={SUBHEADING}>TypeSafe API key</h4>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="password"
            className="knowledge-curator-key-input"
            style={INPUT}
            placeholder={status?.typesafeConfigured ? 'Saved. Enter a new key to replace it.' : 'TypeSafe API key'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="knowledge-curator-key-save"
            style={BUTTON_PRIMARY}
            disabled={!draft.trim() || saving}
            onClick={() => void save(TYPESAFE_CREDENTIAL, draft.trim())}
          >
            Save
          </button>
          {status?.typesafeConfigured ? (
            <button type="button" className="knowledge-curator-key-remove" style={BUTTON} disabled={saving} onClick={() => void save(TYPESAFE_CREDENTIAL, '')}>
              Remove
            </button>
          ) : null}
        </div>
        {notice?.section === 'typesafe' ? <span style={SUCCESS}>{notice.text}</span> : null}
      </section>

      <section className="knowledge-curator-cloudflare" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h4 style={SUBHEADING}>Cloudflare Workers AI</h4>
        <p className="select-text" style={MUTED}>
          Runs Jev as <code>typesafe/jev</code>, billed to your Cloudflare account. The API token needs Workers AI permission. Jev is a third-party model, so it draws on prepaid AI Gateway credits (AI Gateway &gt; Credits Available &gt; Manage). An "Insufficient balance" error means those credits are empty. Name an AI Gateway to get its logs, caching, and rate limits. Cloudflare does not let the curator pin the Jev version, so it warns when a different version answers.
        </p>
        {status?.cloudflareConfigured ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="select-text" style={{ flex: 1, ...MUTED }}>
              Saved for account {status.cloudflareAccountId}
              {status.cloudflareGatewayId ? ` through gateway ${status.cloudflareGatewayId}` : ''}. Re-enter the API token to change anything.
            </span>
            <button type="button" className="knowledge-curator-cloudflare-remove" style={BUTTON} disabled={saving} onClick={() => void save(CLOUDFLARE_CREDENTIAL, '')}>
              Remove
            </button>
          </div>
        ) : null}
        <input
          className="knowledge-curator-cloudflare-account"
          style={INPUT}
          placeholder="Account ID"
          value={cf.accountId}
          onChange={(e) => setCf({ ...cf, accountId: e.target.value })}
        />
        <input
          type="password"
          className="knowledge-curator-cloudflare-token"
          style={INPUT}
          placeholder={status?.cloudflareConfigured ? 'API token (saved; enter it again to replace)' : 'API token'}
          value={cf.apiToken}
          onChange={(e) => setCf({ ...cf, apiToken: e.target.value })}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="knowledge-curator-cloudflare-gateway"
            style={INPUT}
            placeholder="AI Gateway ID (optional)"
            value={cf.gatewayId}
            onChange={(e) => setCf({ ...cf, gatewayId: e.target.value })}
          />
          <button
            type="button"
            className="knowledge-curator-cloudflare-save"
            style={BUTTON_PRIMARY}
            disabled={!cf.accountId.trim() || !cf.apiToken.trim() || saving}
            onClick={() => void saveCloudflare()}
          >
            Save
          </button>
        </div>
        {notice?.section === 'cloudflare' ? <span style={SUCCESS}>{notice.text}</span> : null}
      </section>

      <section className="select-text" style={MUTED}>
        {status ? (
          <>
            {status.provider === 'typesafe' ? 'Using TypeSafe.' : status.provider === 'cloudflare' ? 'Using Cloudflare Workers AI.' : 'No provider saved.'}{' '}
            {status.decisionsLogged ?? 0} sorter decision(s) logged
            {status.decisionLog ? ` in ${status.decisionLog}` : ''}.
          </>
        ) : null}
        {error ? <div style={{ color: 'var(--nim-error)' }}>{error}</div> : null}
      </section>
    </div>
  );
}

const HEADING = { margin: 0, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 } as const;
const SUBHEADING = { margin: 0, fontSize: 13, fontWeight: 600 } as const;
const MUTED = { margin: 0, color: 'var(--nim-text-muted)' } as const;
const SUCCESS = { color: 'var(--nim-success)', fontSize: 12 } as const;

const INPUT = {
  flex: 1,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--nim-border)',
  background: 'var(--nim-bg-secondary)',
  color: 'var(--nim-text)',
} as const;

const BUTTON = {
  fontSize: 12,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--nim-border)',
  background: 'transparent',
  color: 'var(--nim-text)',
  cursor: 'pointer',
} as const;

const ALPHA_BADGE = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '1px 6px',
  borderRadius: 999,
  border: '1px solid var(--nim-warning)',
  color: 'var(--nim-warning)',
} as const;

const BUTTON_PRIMARY = {
  ...BUTTON,
  border: '1px solid var(--nim-primary)',
  background: 'var(--nim-primary)',
  color: '#fff',
} as const;
