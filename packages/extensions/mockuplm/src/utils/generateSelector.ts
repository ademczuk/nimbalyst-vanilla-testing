function escapeIdentifier(value: string): string {
  const nativeEscape = globalThis.CSS?.escape;
  if (nativeEscape) return nativeEscape(value);

  if (value === "-") return "\\-";
  return Array.from(value, (character, index) => {
    const codePoint = character.codePointAt(0)!;
    const isControl = codePoint <= 0x1f || codePoint === 0x7f;
    const isLeadingDigit = index === 0 && /[0-9]/.test(character);
    const isSecondDigitAfterDash =
      index === 1 && value[0] === "-" && /[0-9]/.test(character);
    if (isControl || isLeadingDigit || isSecondDigitAfterDash) {
      return `\\${codePoint.toString(16)} `;
    }
    if (codePoint === 0) return "\uFFFD";
    if (codePoint >= 0x80 || /[A-Za-z0-9_-]/.test(character)) return character;
    return `\\${character}`;
  }).join("");
}

function selectsOnly(
  root: ParentNode,
  selector: string,
  element: Element
): boolean {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/**
 * Generate a selector that uniquely identifies `element` inside its document.
 * Stable author-provided identity wins; structural selectors are the fallback.
 */
export function generateSelector(element: Element): string {
  const root = element.ownerDocument;

  if (element.id) {
    const idSelector = `#${escapeIdentifier(element.id)}`;
    if (selectsOnly(root, idSelector, element)) return idSelector;
  }

  const classSelectors = Array.from(
    element.classList,
    (name) => `.${escapeIdentifier(name)}`
  );
  for (const selector of classSelectors) {
    if (selectsOnly(root, selector, element)) return selector;
  }
  if (classSelectors.length > 1) {
    const combined = classSelectors.join("");
    if (selectsOnly(root, combined, element)) return combined;
  }

  const path: string[] = [];
  let current: Element | null = element;
  while (current) {
    const node: Element = current;
    let segment = node.localName;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (sibling) => sibling.localName === node.localName
      );
      if (sameTag.length > 1) {
        segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    path.unshift(segment);
    const selector = path.join(" > ");
    if (selectsOnly(root, selector, element)) return selector;
    current = parent;
  }

  // A document tree always yields a unique full path. Keep the fallback
  // deterministic for unusual detached DOM implementations.
  return path.join(" > ") || element.localName;
}
