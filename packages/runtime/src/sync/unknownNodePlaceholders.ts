/**
 * Stand-in node classes for node types a Y.Doc carries but a headless editor
 * has no class for -- in practice, nodes an extension registered on the
 * desktop that wrote the document (math, for one).
 *
 * `@lexical/yjs` throws "Node <type> is not registered" while materializing
 * such a document, and `HeadlessLexicalYDoc` swallows the error into an empty
 * editor state. Reading then returns '' for a document that is not empty, and
 * a replace clears nothing and writes nothing -- both silently.
 *
 * A placeholder only has to survive being read and being removed. The binding
 * copies every synced property onto whatever node class it finds, so the
 * placeholder holds them without knowing their names; nothing here ever
 * writes one back. Markdown export degrades it to text: a text or element
 * placeholder exports its own text, a decorator its likeliest source string.
 */
import {
  DecoratorNode,
  ElementNode,
  TextNode,
  type Klass,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import { Map as YMap, XmlElement, XmlText, type Doc } from 'yjs';

type PlaceholderKind = 'element' | 'text' | 'decorator-block' | 'decorator-inline';

/** Types every editor registers without being asked. */
const LEXICAL_BUILTIN_TYPES = ['root', 'paragraph', 'text', 'linebreak', 'tab'];

const LEXICAL_INTERNAL_PROPERTIES = new Set(['__type', '__key', '__parent', '__prev', '__next', '__state']);

/** Property names extension decorators use for their source, most likely first. */
const DECORATOR_TEXT_PROPERTIES = ['__source', '__equation', '__text', '__content', '__code', '__src', '__label'];

function collectNodeTypes(root: XmlText, into: Map<string, PlaceholderKind>): void {
  const record = (type: unknown, kind: PlaceholderKind) => {
    if (typeof type !== 'string') return;
    const seen = into.get(type);
    // A decorator seen at the top level anywhere must be allowed there.
    if (!seen || (seen === 'decorator-inline' && kind === 'decorator-block')) into.set(type, kind);
  };
  const walk = (element: XmlText, isRoot: boolean) => {
    if (!isRoot) record(element.getAttribute('__type'), 'element');
    for (const op of element.toDelta() as Array<{ insert: unknown }>) {
      const child = op.insert;
      if (child instanceof YMap) record(child.get('__type'), 'text');
      else if (child instanceof XmlText) walk(child, false);
      else if (child instanceof XmlElement) {
        record(child.getAttribute('__type'), isRoot ? 'decorator-block' : 'decorator-inline');
      }
    }
  };
  walk(root, true);
}

function copyUnknownProperties(from: LexicalNode, to: LexicalNode): void {
  for (const [name, value] of Object.entries(from)) {
    if (!(name in to) && !LEXICAL_INTERNAL_PROPERTIES.has(name)) {
      (to as unknown as Record<string, unknown>)[name] = value;
    }
  }
}

/** A decorator's synced properties; `DecoratorNode` itself adds none beyond the internals. */
function unknownProperties(node: LexicalNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node)) {
    if (!LEXICAL_INTERNAL_PROPERTIES.has(name)) result[name.replace(/^__/, '')] = value;
  }
  return result;
}

function decoratorText(node: LexicalNode): string {
  const properties = node as unknown as Record<string, unknown>;
  for (const name of DECORATOR_TEXT_PROPERTIES) {
    if (typeof properties[name] === 'string') return properties[name] as string;
  }
  return Object.values(unknownProperties(node)).filter((value) => typeof value === 'string').join(' ');
}

function createPlaceholder(type: string, kind: PlaceholderKind): Klass<LexicalNode> {
  const noDom = (): never => {
    throw new Error(`Placeholder for "${type}" has no DOM`);
  };

  if (kind === 'text') {
    return class UnknownTextNode extends TextNode {
      static getType(): string { return type; }
      static clone(node: UnknownTextNode): UnknownTextNode { return new UnknownTextNode(node.__text, node.__key); }
      static importJSON(json: SerializedLexicalNode & { text?: string }): UnknownTextNode {
        return new UnknownTextNode(json.text ?? '');
      }
      afterCloneFrom(prevNode: this): void {
        super.afterCloneFrom(prevNode);
        copyUnknownProperties(prevNode, this);
      }
    };
  }

  if (kind === 'element') {
    return class UnknownElementNode extends ElementNode {
      static getType(): string { return type; }
      static clone(node: UnknownElementNode): UnknownElementNode { return new UnknownElementNode(node.__key); }
      static importJSON(): UnknownElementNode { return new UnknownElementNode(); }
      afterCloneFrom(prevNode: this): void {
        super.afterCloneFrom(prevNode);
        copyUnknownProperties(prevNode, this);
      }
      createDOM(): HTMLElement { return noDom(); }
      updateDOM(): boolean { return false; }
    };
  }

  const inline = kind === 'decorator-inline';
  return class UnknownDecoratorNode extends DecoratorNode<null> {
    static getType(): string { return type; }
    static clone(node: UnknownDecoratorNode): UnknownDecoratorNode { return new UnknownDecoratorNode(node.__key); }
    static importJSON(): UnknownDecoratorNode { return new UnknownDecoratorNode(); }
    constructor(key?: NodeKey) { super(key); }
    afterCloneFrom(prevNode: this): void {
      super.afterCloneFrom(prevNode);
      copyUnknownProperties(prevNode, this);
    }
    exportJSON(): SerializedLexicalNode {
      return { ...unknownProperties(this), ...super.exportJSON() };
    }
    createDOM(): HTMLElement { return noDom(); }
    updateDOM(): boolean { return false; }
    decorate(): null { return null; }
    isInline(): boolean { return inline; }
    getTextContent(): string { return decoratorText(this); }
  };
}

/**
 * `nodes` plus a placeholder for every node type in `doc`'s Lexical tree
 * (shared type `root`) that `nodes` does not register.
 */
export function withUnknownNodePlaceholders(
  doc: Doc,
  nodes: ReadonlyArray<Klass<LexicalNode>>,
): Array<Klass<LexicalNode>> {
  const found = new Map<string, PlaceholderKind>();
  collectNodeTypes(doc.get('root', XmlText), found);
  const known = new Set([...LEXICAL_BUILTIN_TYPES, ...nodes.map((klass) => klass.getType())]);
  const placeholders = Array.from(found)
    .filter(([type]) => !known.has(type))
    .map(([type, kind]) => createPlaceholder(type, kind));
  return [...nodes, ...placeholders];
}
