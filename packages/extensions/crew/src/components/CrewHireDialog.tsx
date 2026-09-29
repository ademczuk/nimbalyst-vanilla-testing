/**
 * Hire a crew member: from a starter template, by cloning someone already on
 * the crew, or by describing the job and editing the drafted definition.
 */
import { useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/extension-sdk';
import type { CrewHireRequest, CrewMemberDraft, CrewMemberSnapshot, CrewTemplate } from '../shared/types';
import { CrewAvatar, CrewModal } from './CrewBits';
import { useCrew, useCrewAction, useCrewQuery } from './CrewContext';
import { errorMessage, formatScheduleTiming, formatTokens, freeSlug, slugifyCrewName } from './crewFormat';

type Source = 'template' | 'clone' | 'describe';
type Picked =
  | { source: 'template'; template: CrewTemplate }
  | { source: 'clone'; member: CrewMemberSnapshot }
  | { source: 'describe'; draft: CrewMemberDraft }
  | null;

function rhythmOf(draft: Pick<CrewMemberDraft, 'schedule'>): string {
  const first = draft.schedule?.[0];
  if (!first) return 'On demand';
  const more = draft.schedule.length - 1;
  return more > 0 ? `${formatScheduleTiming(first)} +${more}` : formatScheduleTiming(first);
}

export function CrewHireDialog({ onClose }: { onClose: () => void }) {
  const { client, roster, select } = useCrew();
  const members = roster?.members ?? [];
  const templates = useCrewQuery(() => client.call('templates', {}), []);
  const { busy, error, run } = useCrewAction();
  const [source, setSource] = useState<Source>('template');
  const [picked, setPicked] = useState<Picked>(null);
  const [form, setForm] = useState({ name: '', role: '', personality: '', directive: '' });
  const [description, setDescription] = useState('');
  const [drafting, setDrafting] = useState<{ status: 'idle' | 'running' } | { status: 'error'; error: string }>({ status: 'idle' });

  const takenSlugs = useMemo(() => new Set(members.map((m) => m.definition.slug)), [members]);
  const slug = freeSlug(slugifyCrewName(form.name), takenSlugs);
  const valid = picked !== null && slug.length > 0 && form.name.trim().length > 0 && form.role.trim().length > 0;

  const choose = (next: Picked) => {
    setPicked(next);
    if (!next) return;
    const def = next.source === 'template' ? next.template.definition : next.source === 'clone' ? next.member.definition : next.draft;
    setForm({
      // A clone needs its own name; a template or draft suggests one.
      name: next.source === 'clone' ? '' : next.source === 'template' ? next.template.name : def.name,
      role: def.role,
      personality: def.personality,
      directive: def.directive,
    });
  };

  const switchSource = (next: Source) => {
    setSource(next);
    setPicked(null);
    setForm({ name: '', role: '', personality: '', directive: '' });
  };

  const draftFromDescription = async () => {
    setDrafting({ status: 'running' });
    try {
      const result = await client.call('draftFromDescription', { description: description.trim() });
      if (result.ok) {
        choose({ source: 'describe', draft: result.draft });
        setDrafting({ status: 'idle' });
      } else {
        setDrafting({ status: 'error', error: result.error });
      }
    } catch (err) {
      setDrafting({ status: 'error', error: errorMessage(err) });
    }
  };

  const buildRequest = (): CrewHireRequest | null => {
    const overrides = { name: form.name.trim(), role: form.role.trim(), personality: form.personality.trim() };
    if (picked?.source === 'template') return { source: 'template', templateId: picked.template.id, slug, overrides };
    if (picked?.source === 'clone') return { source: 'clone', sourceSlug: picked.member.definition.slug, slug, overrides };
    if (picked?.source === 'describe') {
      return { source: 'draft', definition: { ...picked.draft, ...overrides, directive: form.directive, slug } };
    }
    return null;
  };

  const hire = async () => {
    const request = buildRequest();
    if (!request || !valid) return;
    const created = await run('hire', () => client.call('hire', request));
    if (created) {
      select(created.definition.slug);
      onClose();
    }
  };

  const hireLabel = busy ? 'Hiring...' : form.name.trim() ? `Hire ${form.name.trim()}` : 'Hire';

  return (
    <CrewModal
      className="crew-hire-dialog"
      title="Hire a crew member"
      subtitle="Each member gets a definition file in nimbalyst-local/crew that you can edit at any time."
      onClose={onClose}
      headerExtra={(
        <div className="crew-segmented" role="tablist">
          {([['template', 'Templates'], ['clone', 'Clone'], ['describe', 'Describe the job']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={source === id}
              data-selected={source === id}
              disabled={id === 'clone' && members.length === 0}
              onClick={() => switchSource(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      footer={(
        <>
          <button type="button" className="crew-btn crew-btn-secondary" onClick={onClose} disabled={busy !== null}>Cancel</button>
          <button type="button" className="crew-btn crew-btn-primary" onClick={() => void hire()} disabled={!valid || busy !== null}>
            {hireLabel}
          </button>
        </>
      )}
    >
      <div
        className="crew-hire-body"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && valid && !busy) {
            e.preventDefault();
            void hire();
          }
        }}
      >
        {source === 'template' && (
          templates.data === null ? (
            templates.error
              ? <div className="crew-empty-note" role="alert">Templates could not be loaded. <span className="crew-selectable crew-faint">{templates.error}</span></div>
              : <div className="crew-empty-note" role="status">Loading templates...</div>
          ) : templates.data.length === 0 ? (
            <div className="crew-empty-note">
              No templates are available.
              <button type="button" className="crew-link-button" onClick={() => switchSource('describe')}>Describe the job instead</button>
            </div>
          ) : (
            <div className="crew-hire-gallery" role="listbox" aria-label="Templates">
              {templates.data.map((template) => (
                <HireCard
                  key={template.id}
                  draft={{ ...template.definition, name: template.name, role: template.role, color: template.color }}
                  blurb={template.description}
                  personality={template.personality}
                  selected={picked?.source === 'template' && picked.template.id === template.id}
                  onSelect={() => choose({ source: 'template', template })}
                />
              ))}
            </div>
          )
        )}

        {source === 'clone' && (
          <div className="crew-hire-gallery" role="listbox" aria-label="Crew members">
            {members.map((member) => (
              <HireCard
                key={member.definition.slug}
                draft={member.definition}
                blurb={`Same job, schedule and limits as ${member.definition.name}.`}
                personality={member.definition.personality}
                selected={picked?.source === 'clone' && picked.member.definition.slug === member.definition.slug}
                onSelect={() => choose({ source: 'clone', member })}
              />
            ))}
          </div>
        )}

        {source === 'describe' && picked === null && (
          <div className="crew-hire-describe">
            <label className="crew-field">
              What should this crew member do?
              <textarea
                className="crew-input crew-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={drafting.status === 'running'}
                placeholder="Every evening, read what merged today and flag anything that duplicates existing code or grows a file past 1,500 lines."
                autoFocus
              />
            </label>
            <div className="crew-row">
              <button
                type="button"
                className="crew-btn crew-btn-primary"
                disabled={description.trim().length === 0 || drafting.status === 'running'}
                onClick={() => void draftFromDescription()}
              >
                <MaterialSymbol icon="edit_note" size={16} />
                {drafting.status === 'running' ? 'Drafting...' : 'Draft the definition'}
              </button>
              <span className="crew-faint crew-small">
                {drafting.status === 'running'
                  ? 'An agent is writing a draft. This can take a few minutes.'
                  : 'An agent drafts the definition; you review and edit it before hiring.'}
              </span>
            </div>
            {drafting.status === 'error' && <p className="crew-error crew-selectable" role="alert">{drafting.error}</p>}
          </div>
        )}

        {picked !== null && (
          <div className="crew-hire-form">
            <div className="crew-hire-form-grid">
              <label className="crew-field">
                Name
                <input className="crew-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ada" autoFocus />
              </label>
              <label className="crew-field">
                Role
                <input className="crew-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Architect" />
              </label>
            </div>
            <label className="crew-field">
              Personality
              <textarea className="crew-input crew-textarea-small" value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })} placeholder="Calm, dry, speaks in short paragraphs." />
            </label>
            {picked.source === 'describe' && (
              <label className="crew-field">
                The job
                <textarea className="crew-input crew-textarea crew-mono" value={form.directive} onChange={(e) => setForm({ ...form, directive: e.target.value })} />
              </label>
            )}
            <p className="crew-faint crew-small">
              {slug ? <>Saved as <span className="crew-mono">nimbalyst-local/crew/{slug}.md</span>. </> : null}
              {picked.source === 'describe'
                ? `Drafted with ${rhythmOf(picked.draft).toLowerCase()} runs. Model, schedule and limits can be changed in the definition file after hiring.`
                : 'Model, schedule and limits come from the source and can be changed in the definition file after hiring.'}
            </p>
          </div>
        )}

        {error && <div className="crew-error-box crew-selectable" role="alert">{error}</div>}
      </div>
    </CrewModal>
  );
}

function HireCard({
  draft,
  blurb,
  personality,
  selected,
  onSelect,
}: {
  draft: Pick<CrewMemberDraft, 'name' | 'role' | 'color' | 'provider' | 'model' | 'schedule' | 'budget'>;
  blurb: string;
  personality: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="option" aria-selected={selected} data-selected={selected} className="crew-hire-card" onClick={onSelect}>
      <span className="crew-row">
        <CrewAvatar definition={draft} />
        <span className="crew-hire-card-names">
          <span className="crew-truncate crew-strong">{draft.name}</span>
          <span className="crew-truncate crew-faint">{draft.role}</span>
        </span>
      </span>
      <span className="crew-hire-card-blurb">{blurb}</span>
      {personality && <span className="crew-hire-card-personality">{personality}</span>}
      <span className="crew-hire-card-meta">
        {draft.model && <span>{draft.model}</span>}
        <span>{rhythmOf(draft)}</span>
        {draft.budget?.tokensPerWeek > 0 && <span>{formatTokens(draft.budget.tokensPerWeek)}/wk</span>}
      </span>
    </button>
  );
}
