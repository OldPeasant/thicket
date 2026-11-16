/**
 * A tiny pretty-printer: language printers build a tree of `Node`s, `layout` prints each group
 * on one line when it fits into `WIDTH` columns and breaks it into one item per line otherwise.
 */

export const WIDTH = 80;

export type Node =
  | string
  | { readonly kind: 'concat'; readonly parts: readonly Node[] }
  | {
      /** `open item, item close`; broken: one item per line, indented. */
      readonly kind: 'list';
      readonly open: string;
      readonly items: readonly Node[];
      readonly close: string;
      /** Spaces inside the brackets on one line (`{ a: 1 }`). */
      readonly padded: boolean;
    }
  | {
      /** `head.tail.tail`; broken: every tail on its own, indented line (Java `.append`). */
      readonly kind: 'chain';
      readonly head: Node;
      readonly tails: readonly Node[];
    };

export const concat = (...parts: Node[]): Node => ({ kind: 'concat', parts });

export function list(open: string, items: readonly Node[], close: string, padded = false): Node {
  return { kind: 'list', open, items, close, padded };
}

export function chain(head: Node, tails: readonly Node[]): Node {
  return tails.length === 0 ? head : { kind: 'chain', head, tails };
}

/** One-line form. */
export function flat(node: Node): string {
  if (typeof node === 'string') return node;
  switch (node.kind) {
    case 'concat':
      return node.parts.map(flat).join('');
    case 'list': {
      if (node.items.length === 0) return node.open + node.close;
      const inner = node.items.map(flat).join(', ');
      return node.padded ? `${node.open} ${inner} ${node.close}` : node.open + inner + node.close;
    }
    case 'chain':
      return flat(node.head) + node.tails.map(flat).join('');
  }
}

/**
 * Length of the shortest first line `node` can print, and whether it can break at all: a
 * non-empty list can break right after `open`, a chain right after its head.
 */
function firstLine(node: Node): { length: number; breaks: boolean } {
  if (typeof node === 'string') return { length: node.length, breaks: false };
  switch (node.kind) {
    case 'concat':
      return prefix(node.parts);
    case 'list':
      return node.items.length === 0
        ? { length: flat(node).length, breaks: false }
        : { length: node.open.length, breaks: true };
    case 'chain': {
      const head = firstLine(node.head);
      return head.breaks ? head : { length: head.length, breaks: true };
    }
  }
}

function prefix(parts: readonly Node[]): { length: number; breaks: boolean } {
  let length = 0;
  for (const part of parts) {
    const first = firstLine(part);
    length += first.length;
    if (first.breaks) return { length, breaks: true };
  }
  return { length, breaks: false };
}

/** What must still fit on the line after a concat part: the later parts up to their first break. */
function restOfLine(later: readonly Node[], trailing: number): number {
  const rest = prefix(later);
  return rest.breaks ? rest.length : rest.length + trailing;
}

/**
 * Prints `node` starting at column `column` of a line whose indentation is `indent`; `step` is
 * one indentation level. `trailing` is the length of what follows on the same line (`,`, `)`).
 */
export function layout(
  node: Node,
  indent: string,
  step: string,
  column = indent.length,
  trailing = 0,
): string {
  const one = flat(node);
  if (typeof node === 'string' || column + one.length + trailing <= WIDTH) return one;
  switch (node.kind) {
    case 'concat': {
      let out = '';
      let col = column;
      node.parts.forEach((part, i) => {
        const rest = restOfLine(node.parts.slice(i + 1), trailing);
        const text = layout(part, indent, step, col, rest);
        out += text;
        const nl = text.lastIndexOf('\n');
        col = nl < 0 ? col + text.length : text.length - nl - 1;
      });
      return out;
    }
    case 'list': {
      if (node.items.length === 0) return one;
      const inner = indent + step;
      const items = node.items.map(
        (item, i) =>
          inner + layout(item, inner, step, inner.length, i < node.items.length - 1 ? 1 : 0),
      );
      return `${node.open}\n${items.join(',\n')}\n${indent}${node.close}`;
    }
    case 'chain': {
      const inner = indent + step;
      const head = layout(node.head, indent, step, column);
      const tails = node.tails.map(
        (t, i) =>
          `\n${inner}${layout(t, inner, step, inner.length, i === node.tails.length - 1 ? trailing : 0)}`,
      );
      return head + tails.join('');
    }
  }
}
