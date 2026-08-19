// @vitest-environment jsdom
/**
 * Contract tests for the page-info serializer injected into agent-driven pages.
 *
 * These run the real injected source (`PAGE_INFO_SCRIPT`) against a jsdom
 * document rather than re-implementing it, so the thing under test is the thing
 * that ships.
 *
 * The load-bearing assertion is #1212: no form-control value may appear
 * anywhere in the serialized response. The tool result is written verbatim into
 * the agent transcript, so a leak here is a credential in durable storage.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PAGE_INFO_SCRIPT } from '../browserPageInfoScript';

const PASSWORD = 'SENTINEL-PW-9f3a71';
const EMAIL = 'SENTINEL-EMAIL-4c2b@example.com';
const NOTE = 'SENTINEL-NOTE-77de';
const TOGGLED = 'SENTINEL-TOGGLED-1a5f';

interface InteractiveEntry {
  index: number;
  tag: string;
  type?: string;
  text: string;
  filled?: boolean;
  checked?: boolean;
}

interface PageInfo {
  text: string;
  interactive: InteractiveEntry[];
  truncated: boolean;
}

const runScript = (): PageInfo =>
  new Function(`return ${PAGE_INFO_SCRIPT}`)() as PageInfo;

const byId = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

beforeAll(() => {
  // jsdom lays nothing out, so every rect is zero and the script's visibility
  // filter would drop the whole document.
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 30 }) as DOMRect;
  // jsdom does not implement innerText; the script reads it for non-form
  // elements (buttons, links) and for the whole-page text dump.
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? '';
    },
  });
});

beforeEach(() => {
  document.body.innerHTML = `
    <form>
      <label for="email">Email address</label>
      <input id="email" name="email" type="text" placeholder="you@example.com">
      <input id="pw" type="password" autocomplete="current-password"
             placeholder="Password" aria-label="Password">
      <input id="toggled" type="password" aria-label="Passphrase">
      <textarea id="note" aria-label="Notes"></textarea>
      <input id="remember" type="checkbox">
      <select id="plan" aria-label="Plan">
        <option value="free">Free</option>
        <option value="pro" selected>Pro plan</option>
      </select>
      <input id="submit" type="submit" value="Sign in">
      <button id="cancel" type="button">Cancel</button>
    </form>
  `;
  // Values are assigned rather than written as attributes so they mirror what a
  // user (or a framework-controlled input) actually puts in the field.
  byId<HTMLInputElement>('email').value = EMAIL;
  byId<HTMLInputElement>('pw').value = PASSWORD;
  byId<HTMLTextAreaElement>('note').value = NOTE;
  byId<HTMLInputElement>('remember').checked = true;

  const toggled = byId<HTMLInputElement>('toggled');
  toggled.value = TOGGLED;
  // A "show password" toggle flips the type to text, which is exactly what
  // defeats a naive `type === 'password'` redaction check.
  toggled.type = 'text';
});

describe('PAGE_INFO_SCRIPT value redaction', () => {
  it('leaks no form-control value anywhere in the serialized response', () => {
    const serialized = JSON.stringify(runScript());

    for (const secret of [PASSWORD, TOGGLED, NOTE, EMAIL]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('reports whether a field is filled without reporting what is in it', () => {
    const { interactive } = runScript();
    const entry = (index: number) => interactive[index];

    // Password field: identified by its aria-label, not its contents.
    expect(entry(1)).toMatchObject({ tag: 'input', type: 'password', text: 'Password', filled: true });
    // Same, after a show-password toggle has rewritten the type to `text`.
    expect(entry(2)).toMatchObject({ tag: 'input', type: 'text', text: 'Passphrase', filled: true });
    // A textarea's content is its value, so it gets the same treatment.
    expect(entry(3)).toMatchObject({ tag: 'textarea', text: 'Notes', filled: true });
  });

  it('keeps the labels and state an agent needs to drive the page', () => {
    const { interactive } = runScript();

    // Ordinary text input: still fully described, just without its value.
    expect(interactive[0]).toMatchObject({
      index: 0,
      tag: 'input',
      type: 'text',
      text: 'Email address', // from the associated <label>
      filled: true,
      rect: { x: 10, y: 20, w: 100, h: 30 },
    });
    expect(interactive[4]).toMatchObject({ type: 'checkbox', checked: true });
    expect(interactive[4]).not.toHaveProperty('filled');
    // A select is labelled by its selected option -- author-written page text.
    expect(interactive[5]).toMatchObject({ tag: 'select', text: 'Pro plan' });
    // A submit button's caption lives in `value` and is the only label it has.
    expect(interactive[6]).toMatchObject({ type: 'submit', text: 'Sign in' });
    expect(interactive[6]).not.toHaveProperty('filled');
    expect(interactive[7]).toMatchObject({ tag: 'button', text: 'Cancel' });
  });
});
