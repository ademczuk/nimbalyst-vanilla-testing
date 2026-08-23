/**
 * Styles injected into the mockup frame for comment mode.
 *
 * Only the crosshair and the hover highlight live inside the frame -- they
 * describe author content, so they have to. Pins themselves render in the
 * overlay above the frame, where author HTML cannot restyle or intercept them.
 *
 * Everything is gated on a class we put on the frame's own <html>, so toggling
 * comment mode never re-renders the mockup.
 */

export const COMMENT_MODE_CLASS = "nimbalyst-comment-mode";
export const COMMENT_TARGET_CLASS = "nimbalyst-comment-target";

export const COMMENT_MODE_STYLES = `
.${COMMENT_MODE_CLASS}, .${COMMENT_MODE_CLASS} * {
  cursor: crosshair !important;
}
.${COMMENT_MODE_CLASS} .${COMMENT_TARGET_CLASS} {
  outline: 2px solid #f5a623 !important;
  outline-offset: 1px !important;
  background-color: rgba(245, 166, 35, 0.08) !important;
}
`;
