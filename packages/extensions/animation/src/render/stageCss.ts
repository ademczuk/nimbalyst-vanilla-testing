/**
 * The stage stylesheet: where the animation actually lives.
 *
 * Playback sets `data-state` and `data-tone` on parts; every rule here is keyed
 * off those attributes, and `transition` does the interpolation. That is the
 * whole runtime. Adding a new visual state means adding a selector here, not
 * teaching a scheduler about a new property.
 *
 * Theme tokens are injected rather than inherited: the stage renders inside an
 * iframe, so the host's `--nim-*` cascade does not reach it. `ThemeTokens` is
 * read from the host document and written into `:root` here, which is also what
 * makes the eventual standalone export theme-able by find-and-replace.
 */

import { PACKET_TRAVEL_S } from "./scene";

export interface ThemeTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  purple: string;
}

export const FALLBACK_TOKENS: ThemeTokens = {
  bg: "#16181c",
  surface: "#1e2126",
  surfaceRaised: "#22262c",
  border: "#4a4a4a",
  borderStrong: "#5c5c5c",
  text: "#ffffff",
  textMuted: "#b3b3b3",
  textFaint: "#808080",
  accent: "#60a5fa",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#ef4444",
  purple: "#a78bfa",
};

/** Duration of the state-to-state transition, in milliseconds. */
export const TRANSITION_MS = 320;

/**
 * Keep document/theme values inside a CSS declaration and the surrounding
 * `<style>` raw-text element. CSS colors may contain functions and spaces, but
 * never need declaration/selector delimiters, markup, imports, or URLs.
 */
export function safeCssColor(
  value: string | undefined,
  fallback: string
): string {
  const candidate = value?.trim() ?? "";
  if (
    candidate === "" ||
    candidate.length > 256 ||
    /[<>{};@\\]/.test(candidate) ||
    /url\s*\(/i.test(candidate)
  ) {
    return fallback;
  }
  return candidate;
}

/**
 * Custom-property names a document may declare.
 *
 * These are written straight into a `<style>` block, so the *name* needs the
 * same care the *value* already gets from `safeCssColor` -- otherwise a
 * document could close the declaration and open a rule of its own.
 */
const CUSTOM_PROPERTY_NAME = /^--[a-z0-9-]+$/;

/**
 * Split a document's stamped `stage.theme` into stage tokens and pass-through
 * custom properties.
 *
 * Anything unrecognised is dropped rather than guessed at: a key that is
 * neither a known token nor a valid custom-property name has no rendering
 * meaning, and inventing one would make two consumers disagree the first time
 * they guessed differently.
 */
export function resolveStageTheme(
  theme: Record<string, string> | undefined,
  fallback: ThemeTokens = FALLBACK_TOKENS
): { tokens: ThemeTokens; custom: Record<string, string> } {
  const tokens: ThemeTokens = { ...fallback };
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme ?? {})) {
    if (typeof value !== "string") continue;
    if (key in FALLBACK_TOKENS) {
      tokens[key as keyof ThemeTokens] = value;
    } else if (CUSTOM_PROPERTY_NAME.test(key)) {
      custom[key] = value;
    }
  }
  return { tokens, custom };
}

export function buildStageCss(
  tokens: ThemeTokens,
  background?: string,
  custom?: Record<string, string>
): string {
  const safeTokens = Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [
      key,
      safeCssColor(value, FALLBACK_TOKENS[key as keyof ThemeTokens]),
    ])
  ) as unknown as ThemeTokens;
  const safeBackground = safeCssColor(background, safeTokens.bg);

  // A project's own vocabulary, emitted after the stage's own tokens so a
  // document cannot redefine `--anim-*` out from under the rules below.
  const customCss = Object.entries(custom ?? {})
    .filter(([name]) => CUSTOM_PROPERTY_NAME.test(name))
    .map(([name, value]) => {
      const safe = safeCssColor(value, "");
      return safe === "" ? "" : `\n  ${name}: ${safe};`;
    })
    .join("");

  return `
:root {
  --anim-bg: ${safeBackground};
  --anim-surface: ${safeTokens.surface};
  --anim-surface-raised: ${safeTokens.surfaceRaised};
  --anim-border: ${safeTokens.border};
  --anim-border-strong: ${safeTokens.borderStrong};
  --anim-text: ${safeTokens.text};
  --anim-text-muted: ${safeTokens.textMuted};
  --anim-text-faint: ${safeTokens.textFaint};

  --anim-tone-neutral: ${safeTokens.textFaint};
  --anim-tone-accent: ${safeTokens.accent};
  --anim-tone-data: ${safeTokens.purple};
  --anim-tone-success: ${safeTokens.success};
  --anim-tone-warning: ${safeTokens.warning};
  --anim-tone-error: ${safeTokens.error};
  --anim-tone-muted: ${safeTokens.textFaint};

  --anim-mono: ui-monospace, 'SF Mono', Monaco, 'Courier New', monospace;
  --anim-duration: ${TRANSITION_MS}ms;
  --anim-ease: cubic-bezier(0.4, 0, 0.2, 1);${customCss}
}

* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  background: var(--anim-bg);
  overflow: hidden;
}

.anim-stage {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--anim-bg);
  user-select: none;
}

/* ---- tone resolution ---------------------------------------------------- */
.anim-part { --anim-tone: var(--anim-tone-neutral); }
.anim-part[data-tone="accent"]  { --anim-tone: var(--anim-tone-accent); }
.anim-part[data-tone="data"]    { --anim-tone: var(--anim-tone-data); }
.anim-part[data-tone="success"] { --anim-tone: var(--anim-tone-success); }
.anim-part[data-tone="warning"] { --anim-tone: var(--anim-tone-warning); }
.anim-part[data-tone="error"]   { --anim-tone: var(--anim-tone-error); }
.anim-part[data-tone="muted"]   { --anim-tone: var(--anim-tone-muted); }

.anim-part {
  --anim-tone-fill: color-mix(in srgb, var(--anim-tone) 14%, transparent);
}

/* ---- sub-parts ---------------------------------------------------------- */
/*
 * A region a component declared inside one html part, addressed by steps as
 * partId/subId. Playback drives it with the same querySelector + setAttribute
 * it uses for a top-level part, so there is no second mechanism -- only a
 * second set of selectors.
 *
 * The one deliberate difference from .anim-part is what is NOT here: no
 * unconditional "--anim-tone: var(--anim-tone-neutral)". That default would
 * make a nested region *reset* to grey rather than inherit its container's
 * tone, so a window whose chrome is accent-blue would go grey wherever a
 * component happened to declare a region. Sub-parts are "inherit unless
 * overridden", which is also why neutral has no rule: for a sub-part, neutral
 * means "no opinion", and no opinion means take the parent's.
 */
.anim-subpart[data-tone="accent"]  { --anim-tone: var(--anim-tone-accent); }
.anim-subpart[data-tone="data"]    { --anim-tone: var(--anim-tone-data); }
.anim-subpart[data-tone="success"] { --anim-tone: var(--anim-tone-success); }
.anim-subpart[data-tone="warning"] { --anim-tone: var(--anim-tone-warning); }
.anim-subpart[data-tone="error"]   { --anim-tone: var(--anim-tone-error); }
.anim-subpart[data-tone="muted"]   { --anim-tone: var(--anim-tone-muted); }

/*
 * A custom property whose value contains var() is substituted where it is
 * declared, not where it is used, so a sub-part that overrides --anim-tone
 * would otherwise keep inheriting the container's already-resolved fill.
 * Recompute it exactly where the tone was overridden, and nowhere else.
 */
.anim-subpart[data-tone] {
  --anim-tone-fill: color-mix(in srgb, var(--anim-tone) 14%, transparent);
}

/*
 * State treatments mirror .anim-html, so a sub-part is not inert in the
 * states every other part type reacts to. Authored markup overrides any of it
 * by keying off the same attributes.
 */
.anim-subpart { transition: opacity var(--anim-duration) var(--anim-ease); }
.anim-subpart[data-state="hidden"]  { opacity: 0; }
.anim-subpart[data-state="waiting"] { opacity: 0.75; }
.anim-subpart[data-state="offline"] { opacity: 0.4; }

/* ---- nodes -------------------------------------------------------------- */
.anim-node-body {
  fill: var(--anim-surface);
  stroke: var(--anim-border);
  stroke-width: 1.3px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease),
              stroke-width var(--anim-duration) var(--anim-ease);
}
.anim-node-header { fill: var(--anim-surface-raised); }
.anim-node-rule { stroke: var(--anim-border); stroke-width: 1.2px; }
.anim-node-title {
  fill: var(--anim-text);
  font-family: var(--anim-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.8px;
  transition: fill var(--anim-duration) var(--anim-ease);
}
.anim-node-subtitle,
.anim-row-key,
.anim-row-value {
  font-family: var(--anim-mono);
  font-size: 11px;
  transition: fill var(--anim-duration) var(--anim-ease);
}
.anim-node-subtitle { fill: var(--anim-text-faint); }
.anim-row-key { fill: var(--anim-text-muted); }
.anim-row-value { fill: var(--anim-text-faint); }
.anim-row-box {
  fill: var(--anim-surface-raised);
  stroke: var(--anim-border);
  stroke-width: 1.1px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease);
}
.anim-node-dot {
  fill: var(--anim-tone);
  opacity: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              fill var(--anim-duration) var(--anim-ease);
}

/* Node states */
.anim-node[data-state="active"] .anim-node-body {
  fill: color-mix(in srgb, var(--anim-tone) 10%, var(--anim-surface));
  stroke: var(--anim-tone);
  stroke-width: 1.8px;
}
.anim-node[data-state="active"] .anim-node-dot { opacity: 1; }
.anim-node[data-state="active"] .anim-row-box:first-of-type {
  fill: var(--anim-tone-fill);
  stroke: var(--anim-tone);
}
.anim-node[data-state="offline"] .anim-node-body {
  fill: color-mix(in srgb, var(--anim-tone-error) 9%, var(--anim-surface));
  stroke: var(--anim-tone-error);
  stroke-dasharray: 4 3;
}
.anim-node[data-state="offline"] .anim-node-title { fill: var(--anim-text-faint); }
.anim-node[data-state="waiting"] .anim-node-body {
  stroke: var(--anim-tone-warning);
  stroke-dasharray: 5 4;
}
.anim-node[data-state="hidden"] { opacity: 0; }
.anim-node { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- edges -------------------------------------------------------------- */
.anim-edge-line {
  fill: none;
  stroke: var(--anim-border);
  stroke-width: 1.4px;
  stroke-dasharray: 5 4;
}
.anim-edge-flow {
  fill: none;
  stroke: var(--anim-tone);
  stroke-width: 1.7px;
  /* Drawn on top of the dashed baseline and revealed by dash offset, so a
     "flowing" edge reads as the line filling in rather than blinking on. The
     path carries pathLength="1", so these are fractions of the edge, not px. */
  stroke-dasharray: 1 1;
  stroke-dashoffset: 1;
  opacity: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease);
}

/* ---- edge packets ------------------------------------------------------- */
.anim-edge-packet {
  fill: var(--anim-tone);
  stroke: var(--anim-bg);
  stroke-width: 1px;
  opacity: 0;
  offset-rotate: 0deg;
  offset-distance: 0%;
  transition: fill var(--anim-duration) var(--anim-ease);
}

.anim-edge[data-state="flowing"] .anim-edge-packet,
.anim-edge[data-state="active"] .anim-edge-packet {
  animation: anim-packet-travel ${PACKET_TRAVEL_S}s linear infinite;
}

/*
 * A reply travels the same wire the other way. Reversing the packets rather
 * than drawing a second edge keeps the two nodes joined by one line -- two
 * overlapping edges between the same pair read as a rendering fault.
 */
.anim-edge[data-state="returning"] .anim-edge-packet {
  animation: anim-packet-travel ${PACKET_TRAVEL_S}s linear infinite reverse;
}

/*
 * Fading in and out at the ends stops a packet from appearing to burst out of
 * the source node and vanish into the target one; it enters and leaves the
 * wire instead.
 */
@keyframes anim-packet-travel {
  0%   { offset-distance: 0%;   opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

/*
 * A spinner for html parts: a ring with one lit arc, rotating. This is the
 * stage's only self-driven rotation -- the rotational counterpart to the edge
 * packet -- for a running/loading state that has to read as live rather than as
 * a static glyph. Colour is currentColor, so the badge hosting it sets the hue,
 * and the recorder captures it exactly as it captures a packet.
 */
@keyframes anim-spin {
  to { transform: rotate(360deg); }
}
.anim-spin {
  display: inline-block;
  box-sizing: border-box;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  animation: anim-spin 0.8s linear infinite;
}
.anim-edge-arrow path {
  fill: none;
  stroke: var(--anim-border);
  stroke-width: 1.6px;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke var(--anim-duration) var(--anim-ease);
}
.anim-edge-label rect {
  fill: var(--anim-bg);
  stroke: none;
}
.anim-edge-label text {
  fill: var(--anim-text-faint);
  font-family: var(--anim-mono);
  font-size: 12.5px;
  transition: fill var(--anim-duration) var(--anim-ease);
}

.anim-edge[data-state="flowing"] .anim-edge-flow,
.anim-edge[data-state="returning"] .anim-edge-flow,
.anim-edge[data-state="active"] .anim-edge-flow {
  opacity: 1;
  stroke-dashoffset: 0;
  transition: opacity var(--anim-duration) var(--anim-ease),
              stroke-dashoffset var(--anim-duration) var(--anim-ease);
}
.anim-edge[data-state="flowing"] .anim-edge-arrow path,
.anim-edge[data-state="returning"] .anim-edge-arrow path,
.anim-edge[data-state="active"] .anim-edge-arrow path { stroke: var(--anim-tone); }
.anim-edge[data-state="flowing"] .anim-edge-label text,
.anim-edge[data-state="returning"] .anim-edge-label text,
.anim-edge[data-state="active"] .anim-edge-label text { fill: var(--anim-tone); }
.anim-edge[data-state="hidden"] { opacity: 0; }
.anim-edge { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- labels and shapes -------------------------------------------------- */
.anim-label {
  fill: var(--anim-text-muted);
  font-family: var(--anim-mono);
  font-size: 12px;
  transition: fill var(--anim-duration) var(--anim-ease),
              opacity var(--anim-duration) var(--anim-ease);
}
.anim-label-caps {
  fill: var(--anim-text-faint);
  letter-spacing: 1.4px;
}
.anim-label[data-state="active"] { fill: var(--anim-tone); }
.anim-label[data-state="hidden"] { opacity: 0; }

.anim-shape-body {
  fill: var(--anim-tone-fill);
  stroke: var(--anim-tone);
  stroke-width: 1.3px;
  transition: fill var(--anim-duration) var(--anim-ease),
              stroke var(--anim-duration) var(--anim-ease),
              opacity var(--anim-duration) var(--anim-ease);
}
.anim-shape-text {
  fill: var(--anim-text);
  font-family: var(--anim-mono);
  font-size: 11px;
}
.anim-shape[data-state="active"] .anim-shape-body {
  fill: color-mix(in srgb, var(--anim-tone) 65%, transparent);
}
.anim-shape[data-state="hidden"] { opacity: 0; }
.anim-shape { transition: opacity var(--anim-duration) var(--anim-ease); }

/* ---- html parts --------------------------------------------------------- */
/*
 * Authored markup gets the stage's typography and colour as a starting point,
 * then owns everything from there -- including font-size, which is exactly what
 * the primitive part types cannot offer. The --anim-tone property resolves here
 * through normal inheritance, so markup using it animates on step changes free.
 */
/*
 * Proportional by default, unlike the SVG part types, which are mono because
 * they are diagram furniture. An html part is usually prose or UI, and mono
 * headings read as a terminal mock; markup that wants code sets --anim-mono
 * itself, which is what the tool-call rows in the samples do.
 */
.anim-html-body {
  width: 100%;
  height: 100%;
  color: var(--anim-text);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  overflow: hidden;
}

.anim-html-body a { color: var(--anim-tone); }

.anim-html { transition: opacity var(--anim-duration) var(--anim-ease); }
.anim-html[data-state="hidden"] { opacity: 0; }
/*
 * The waiting and offline states get a default treatment so an html part is not
 * inert in the states the other part types react to. Authored markup can
 * override any of it with its own rules keyed off the same attributes.
 */
.anim-html[data-state="waiting"] .anim-html-body { opacity: 0.75; }
.anim-html[data-state="offline"] .anim-html-body { opacity: 0.4; }

/* ---- selection ---------------------------------------------------------- */
.anim-part.anim-selected .anim-node-body,
.anim-part.anim-selected .anim-shape-body {
  stroke: var(--anim-tone-accent);
  stroke-width: 1.8px;
}
.anim-selection-ring {
  fill: none;
  stroke: var(--anim-tone-accent);
  stroke-width: 1.4px;
  stroke-dasharray: 3 3;
  pointer-events: none;
}

/*
 * An html part and a region inside one both outline instead of taking a stroke:
 * neither is an SVG shape, so there is no body element to put one on. An
 * outline rather than a border, because it does not participate in layout -- the markup
 * must not reflow just because someone clicked it -- and the offset is negative
 * so the ring stays inside the foreignObject, which clips at its declared box.
 *
 * Without these the two part types this format is now mostly built from are the
 * only ones with no visible selection at all.
 */
.anim-part.anim-selected .anim-html-body,
.anim-subpart.anim-selected {
  outline: 1.5px dashed var(--anim-tone-accent);
  outline-offset: -2px;
}

.anim-hit { fill: transparent; cursor: pointer; }

/*
 * Scrubbing must land on the destination immediately, not tween toward it --
 * dragging the playhead through five steps should not queue five animations.
 * The scheduler adds this class for the duration of a seek.
 */
.anim-no-transition, .anim-no-transition * {
  transition: none !important;
}

.anim-no-animation .anim-edge-packet,
.anim-no-animation .anim-spin {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .anim-part, .anim-part * {
    transition-duration: 1ms !important;
  }
  /*
   * Packets are the one continuously-moving thing here, so reduced motion has
   * to stop them outright rather than just shorten a transition. The edge still
   * reads as active via its stroke; it just stops carrying traffic.
   */
  .anim-edge-packet {
    animation: none !important;
    opacity: 0 !important;
  }
  /* The spinner stops too, but stays visible -- the ring still reads as a
     running badge; it just stops turning. */
  .anim-spin {
    animation: none !important;
  }
}
`;
}
