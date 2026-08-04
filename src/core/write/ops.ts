import {
  BodyLine,
  commonIndent,
  lineMatchesNode,
  MindNode,
} from '../parse/parser';
import {
  CHECKBOX_RE,
  HEADING_SHIFT_RE,
  INDENTED_LIST_RE,
  LIST_PREFIX_RE,
  MARKER_PREFIX_RE,
  TASK_BOX_RE,
} from '../parse/patterns';

export interface InsertResult {
  lines: string[];
  insertedLine: number;
}

function headingPrefix(level: number): string {
  return `${'#'.repeat(Math.min(6, Math.max(1, level)))} `;
}

/** The lines of a node's whole subtree. */
function nodeBlock(lines: string[], node: MindNode): string[] {
  return lines.slice(node.line, node.endLine + 1);
}

/**
 * Where a list item goes under a heading/root parent: at the end of its
 * direct list content, before any sub-heading (a list line after a
 * sub-heading would parse under it).
 */
function listInsertPoint(target: MindNode): number {
  let lastList: MindNode | undefined;
  let firstHeading: MindNode | undefined;

  for (const c of target.children) {
    if (c.type === 'list') {
      lastList = c;
    } else if (!firstHeading) {
      firstHeading = c;
    }
  }
  if (lastList) {
    return lastList.endLine + 1;
  }

  return firstHeading ? firstHeading.line : target.endLine + 1;
}

/**
 * Returns the node's source line, throwing when the file has changed under
 * the map (shifted or edited lines) so the caller aborts instead of writing
 * to the wrong line. applyOp catches the throw, notifies, and re-renders.
 */
function requireNodeLine(lines: string[], node: MindNode): string {
  // The note itself has no line of its own; there is nothing to be stale.
  if (node.type === 'root') {
    return '';
  }
  const line = lines[node.line];

  if (line === undefined || !lineMatchesNode(line, node)) {
    throw new Error(
      `Mindmap: line ${node.line} no longer matches node "${node.text}"`,
    );
  }

  return line;
}

/**
 * Writes an explicit checkbox state instead of flipping the parsed one, so
 * rapid toggles before a re-render converge on what the checkbox shows.
 */
export function setCheckboxOp(
  lines: string[],
  node: MindNode,
  checked: boolean,
): string[] {
  const line = requireNodeLine(lines, node);

  if (!CHECKBOX_RE.test(line)) {
    throw new Error(`Mindmap: line ${node.line} is not a task item`);
  }
  lines[node.line] = line.replace(CHECKBOX_RE, `$1${checked ? 'x' : ' '}$2`);

  return lines;
}

export function setTextOp(
  lines: string[],
  node: MindNode,
  text: string,
): string[] {
  const line = requireNodeLine(lines, node);

  if (node.type === 'heading') {
    lines[node.line] = headingPrefix(node.level) + text;
  } else {
    const m = LIST_PREFIX_RE.exec(line);

    lines[node.line] = `${m?.[1] ?? '- '}${text}`;
  }

  return lines;
}

/**
 * A node's own text, split into consecutive runs. A child sitting between two
 * of them keeps them apart in the file, so each is written back on its own -
 * one rewrite spanning both would move text across the child.
 */
function bodyRuns(node: MindNode): BodyLine[][] {
  const runs: BodyLine[][] = [];

  for (const b of node.body) {
    const last = runs[runs.length - 1];
    const end = last?.[last.length - 1];

    if (last && end && b.line === end.line + 1) {
      last.push(b);
    } else {
      runs.push([b]);
    }
  }

  return runs;
}

/** The run an edit anchored at `line` belongs to; empty for a node with no text. */
export function bodyRunOf(node: MindNode, line: number): BodyLine[] {
  const runs = bodyRuns(node);

  return (
    runs.find(
      (run) => line >= run[0]!.line && line <= run[run.length - 1]!.line,
    ) ??
    runs[0] ??
    []
  );
}

/**
 * Replaces the run of a node's own text holding `anchor`; an empty string
 * removes it. Every body line is checked first, so the edit lands on the text
 * it was made against or not at all.
 */
export function setBodyOp(
  lines: string[],
  node: MindNode,
  text: string,
  anchor: number,
): string[] {
  requireNodeLine(lines, node);
  const indent = requireFreshBody(lines, node);
  const run = bodyRunOf(node, anchor);
  const from = run[0]?.line ?? node.line + 1;

  return spliceRun(
    lines,
    from,
    run.map((b) => lines[b.line] ?? ''),
    text,
    indent,
  );
}

/**
 * Puts `text` where `was` stands, `was` being the lines the run occupies right
 * now - which the caller has either just parsed for, or written itself. It has
 * to still be there: an edit lands where it was aimed or nowhere.
 *
 * Aimed at lines rather than at a node, this is what an editor open on a run
 * writes through as it is typed. The parse can say something quite different
 * from one keystroke to the next - a fence opened and not yet closed swallows
 * everything after it - while the lines themselves sit still.
 */
export function spliceRun(
  lines: string[],
  from: number,
  was: string[],
  text: string,
  indent: string,
): string[] {
  const there = lines.slice(from, from + was.length);

  if (there.join('\n') !== was.join('\n')) {
    throw new Error(`Mindmap: line ${from} no longer says what it did`);
  }
  lines.splice(from, was.length, ...runLines(text, was, indent));

  return lines;
}

/**
 * The lines a run's text becomes: indented as the run was, and holding on to
 * the blank line that sets the run apart from what follows.
 *
 * The editor trims the end of what it hands back, so a blank line the run
 * ended on goes back in. Text that already ends blank says its own last word,
 * and text that is gone entirely takes the gap with it. A run that is nothing
 * but blank lines has no gap to hold: its own lines are the gap, and the text
 * just typed into them stands where they stood.
 */
export function runLines(
  text: string,
  was: string[],
  indent: string,
): string[] {
  // Empty is no lines at all, not one blank one: this is how the text goes.
  const body =
    text === ''
      ? []
      : text.split('\n').map((line) => {
          const trimmed = line.trimEnd();

          return trimmed === '' ? '' : indent + trimmed;
        });
  const gap = was.every((line) => line.trim() === '') ? 0 : blankTail(was);
  const keepsGap = body.length > 0 && body[body.length - 1] !== '';
  const next = keepsGap ? [...body, ...Array<string>(gap).fill('')] : body;

  return keepUntouched(next, was);
}

/** How many blank lines a run ends on. */
function blankTail(was: string[]): number {
  let n = 0;

  for (let i = was.length - 1; i >= 0 && was[i]?.trim() === ''; i--) {
    n++;
  }

  return n;
}

export function deleteBodyLineOp(
  lines: string[],
  node: MindNode,
  line: number,
): string[] {
  requireNodeLine(lines, node);
  requireFreshBody(lines, node);
  if (!node.body.some((b) => b.line === line)) {
    throw new Error(`Mindmap: line ${line} is not text of "${node.text}"`);
  }
  lines.splice(line, 1);

  return lines;
}

/**
 * Swaps one line of a node's own text with the one above or below it, inside
 * the same run: the lines move as they are, indent and all.
 */
export function moveBodyLineOp(
  lines: string[],
  node: MindNode,
  line: number,
  delta: -1 | 1,
): string[] {
  requireNodeLine(lines, node);
  requireFreshBody(lines, node);
  const run = bodyRunOf(node, line);
  const at = run.findIndex((b) => b.line === line);
  const other = run[at + delta];

  if (at < 0 || !other) {
    throw new Error(`Mindmap: line ${line} has nowhere to go`);
  }
  const moved = lines[line] ?? '';

  lines[line] = lines[other.line] ?? '';
  lines[other.line] = moved;

  return lines;
}

/**
 * Proves every body line is still what the map showed, and answers with the
 * indent they carry. A blank line is compared as the empty line it is:
 * `indent + ''` matches nothing, and would refuse every edit to a body with a
 * paragraph break in it.
 */
/**
 * The indent a node's own text is written with, and the check that the file
 * still says what the map thinks it does.
 */
export function requireFreshBody(lines: string[], node: MindNode): string {
  const raw = node.body.map((b) => lines[b.line] ?? '');
  const indent = node.body.length
    ? commonIndent(raw)
    : node.type === 'list'
      ? node.indent + detectIndentUnit(lines)
      : '';
  const stale = node.body.find(
    (b, i) =>
      (raw[i] ?? '').trimEnd() !== (b.text === '' ? '' : indent + b.text),
  );

  if (stale) {
    throw new Error(
      `Mindmap: line ${stale.line} no longer matches the text of "${node.text}"`,
    );
  }

  return indent;
}

/**
 * Puts back the line exactly as the file had it wherever the text is the same
 * - trailing spaces are a hard line break in Markdown, and the indent on a
 * blank line is the file's business. Only line for line: once the count has
 * changed, which line is which is no longer a question this can answer.
 */
function keepUntouched(next: string[], was: string[]): string[] {
  if (next.length !== was.length) {
    return next;
  }

  return next.map((line, i) =>
    line.trim() === (was[i] ?? '').trim() ? (was[i] ?? line) : line,
  );
}

function detectIndentUnit(lines: string[]): string {
  let best: string | null = null;

  for (const line of lines) {
    const m = INDENTED_LIST_RE.exec(line);
    const indent = m?.[1];

    if (!indent) {
      continue;
    }
    if (indent.includes('\t')) {
      return '\t';
    }
    if (best === null || indent.length < best.length) {
      best = indent;
    }
  }

  return best ?? '\t';
}

function listPrefix(indent: string, marker: string, isTask: boolean): string {
  return `${indent}${marker} ${isTask ? '[ ] ' : ''}`;
}

/**
 * `task` forces the new item to be (or not be) a task checkbox item;
 * undefined inherits from the sibling/prototype as before.
 */
export function addSiblingOp(
  lines: string[],
  node: MindNode,
  task?: boolean,
): InsertResult {
  requireNodeLine(lines, node);
  const prefix =
    node.type === 'heading'
      ? headingPrefix(node.level)
      : listPrefix(node.indent, node.marker, task ?? node.checked !== null);
  const at = node.endLine + 1;

  lines.splice(at, 0, prefix);

  return { lines, insertedLine: at };
}

export function addChildOp(
  lines: string[],
  node: MindNode,
  task?: boolean,
): InsertResult {
  if (node.type !== 'root') {
    requireNodeLine(lines, node);
  }
  if (node.type === 'root') {
    const hasHeadings = node.children.some((c) => c.type === 'heading');
    let at = lines.length;

    while (at > 0 && (lines[at - 1] ?? '').trim() === '') {
      at--;
    }
    lines.splice(
      at,
      0,
      hasHeadings ? headingPrefix(1) : listPrefix('', '-', task ?? false),
    );

    return { lines, insertedLine: at };
  }
  if (node.type === 'heading') {
    const hasHeadingChild = node.children.some((c) => c.type === 'heading');
    const listChildren = node.children.filter((c) => c.type === 'list');

    // A forced task child is always a list item, never a sub-heading.
    if (!task && hasHeadingChild && listChildren.length === 0) {
      const at = node.endLine + 1;

      lines.splice(at, 0, headingPrefix(node.level + 1));

      return { lines, insertedLine: at };
    }
    const at = listInsertPoint(node);
    const proto = listChildren[0];
    const prefix = proto
      ? listPrefix(proto.indent, proto.marker, task ?? proto.checked !== null)
      : listPrefix('', '-', task ?? false);

    lines.splice(at, 0, prefix);

    return { lines, insertedLine: at };
  }
  const first = node.children[0];
  const indent = first ? first.indent : node.indent + detectIndentUnit(lines);
  const marker = first ? first.marker : node.marker;
  const isTask =
    task ?? (first ? first.checked !== null : node.checked !== null);
  const at = node.endLine + 1;

  lines.splice(at, 0, listPrefix(indent, marker, isTask));

  return { lines, insertedLine: at };
}

/** Adds or removes the task checkbox on a list item, keeping its text. */
export function toggleTaskOp(lines: string[], node: MindNode): string[] {
  const line = requireNodeLine(lines, node);

  if (node.type !== 'list') {
    return lines;
  }
  if (node.checked === null) {
    const m = MARKER_PREFIX_RE.exec(line);
    const prefix = m?.[1];

    if (prefix) {
      lines[node.line] = `${prefix}[ ] ${line.slice(prefix.length)}`;
    }
  } else {
    lines[node.line] = line.replace(TASK_BOX_RE, '$1');
  }

  return lines;
}

/**
 * Swaps a node's whole block (subtree lines) with an adjacent sibling's
 * block, reordering them under the same parent. The caller must pass true
 * siblings of the same node type — a list item hopping over a sub-heading
 * would reparse under it.
 */
export function reorderSiblingOp(
  lines: string[],
  nodeA: MindNode,
  nodeB: MindNode,
): string[] {
  requireNodeLine(lines, nodeA);
  requireNodeLine(lines, nodeB);
  const [first, second] =
    nodeA.line < nodeB.line ? [nodeA, nodeB] : [nodeB, nodeA];
  const firstBlock = nodeBlock(lines, first);
  const gap = lines.slice(first.endLine + 1, second.line);
  const secondBlock = nodeBlock(lines, second);

  lines.splice(
    first.line,
    second.endLine - first.line + 1,
    ...secondBlock,
    ...gap,
    ...firstBlock,
  );

  return lines;
}

export function deleteNodeOp(lines: string[], node: MindNode): string[] {
  requireNodeLine(lines, node);
  lines.splice(node.line, node.endLine - node.line + 1);

  return lines;
}

/** Re-indents a moved list subtree from its old indent to sit under target. */
function reindentListSegment(
  segment: string[],
  source: MindNode,
  target: MindNode,
  lines: string[],
): string[] {
  let newIndent: string;

  if (target.type === 'list') {
    const firstChild = target.children[0];

    newIndent = firstChild
      ? firstChild.indent
      : target.indent + detectIndentUnit(lines);
  } else {
    newIndent = '';
  }
  const oldIndent = source.indent;

  return segment.map((l) =>
    l.trim() !== '' && l.startsWith(oldIndent)
      ? newIndent + l.slice(oldIndent.length)
      : l,
  );
}

/** Shifts a moved heading subtree's levels so source sits under target. */
function shiftHeadingSegment(
  segment: string[],
  source: MindNode,
  target: MindNode,
): string[] {
  const targetLevel = target.type === 'root' ? 0 : target.level;
  const delta = targetLevel + 1 - source.level;

  if (delta === 0) {
    return segment.slice();
  }

  return segment.map((l) => {
    const m = HEADING_SHIFT_RE.exec(l);

    if (!m) {
      return l;
    }
    const level = Math.min(6, Math.max(1, (m[1] ?? '').length + delta));

    return '#'.repeat(level) + (m[2] ?? '');
  });
}

/**
 * Moves the source subtree to become a child of the target: before the
 * `before` sibling when given (same-type reorder/insert), else as the last
 * child. List moves are saved as indent changes; heading moves shift
 * heading levels. The caller must validate the move (no descendant targets,
 * no heading onto list, no heading-level overflow) before calling.
 */
export function moveNodeOp(
  lines: string[],
  source: MindNode,
  target: MindNode,
  before: MindNode | null = null,
): string[] {
  requireNodeLine(lines, source);
  if (target.type !== 'root') {
    requireNodeLine(lines, target);
  }
  if (before) {
    requireNodeLine(lines, before);
  }
  const segment = nodeBlock(lines, source);
  const newSegment =
    source.type === 'list'
      ? reindentListSegment(segment, source, target, lines)
      : shiftHeadingSegment(segment, source, target);

  let at: number;

  if (before) {
    at = before.line;
  } else if (target.type === 'list' || source.type === 'heading') {
    at = target.endLine + 1;
  } else {
    // List dropped onto a heading/root.
    at = listInsertPoint(target);
  }

  lines.splice(source.line, segment.length);
  if (at > source.line) {
    at -= segment.length;
  }
  lines.splice(at, 0, ...newSegment);

  return lines;
}
