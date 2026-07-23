import { App, Editor, MarkdownView, TFile } from 'obsidian';
import { lineMatchesNode, MindNode } from './parser';
import {
  CHECKBOX_RE,
  HEADING_SHIFT_RE,
  INDENTED_LIST_RE,
  LIST_PREFIX_RE,
  MARKER_PREFIX_RE,
  TASK_BOX_RE,
} from './patterns';

export interface InsertResult {
  lines: string[];
  insertedLine: number;
}

export function findMarkdownView(app: App, file: TFile): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file?.path === file.path) {
      return view;
    }
  }
  return null;
}

/**
 * Applies a line-based mutation to the file. When the file is open in an
 * editor, the change goes through the editor (minimal replaceRange, so undo
 * history is preserved); otherwise it is written via vault.process.
 */
export async function updateFileLines(
  app: App,
  file: TFile,
  mutate: (lines: string[]) => string[],
): Promise<void> {
  const mdView = findMarkdownView(app, file);
  if (mdView) {
    const oldLines = mdView.editor.getValue().split('\n');
    const newLines = mutate(oldLines.slice());
    applyLineDiff(mdView.editor, oldLines, newLines);
  } else {
    await app.vault.process(file, (data) =>
      mutate(data.split('\n')).join('\n'),
    );
  }
}

function applyLineDiff(
  editor: Editor,
  oldLines: string[],
  newLines: string[],
): void {
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;
  while (
    endOld >= start &&
    endNew >= start &&
    oldLines[endOld] === newLines[endNew]
  ) {
    endOld--;
    endNew--;
  }
  if (endOld < start && endNew < start) return;

  const segment = newLines.slice(start, endNew + 1);
  const lineLen = (i: number): number => (oldLines[i] ?? '').length;

  // Replacement: swap the changed old lines for the new segment.
  if (endOld >= start && segment.length > 0) {
    editor.replaceRange(
      segment.join('\n'),
      { line: start, ch: 0 },
      { line: endOld, ch: lineLen(endOld) },
    );
    return;
  }

  // Pure deletion: remove the lines plus one adjacent newline.
  if (endOld >= start) {
    if (start > 0) {
      editor.replaceRange(
        '',
        { line: start - 1, ch: lineLen(start - 1) },
        { line: endOld, ch: lineLen(endOld) },
      );
      return;
    }
    if (endOld < oldLines.length - 1) {
      editor.replaceRange('', { line: 0, ch: 0 }, { line: endOld + 1, ch: 0 });
      return;
    }
    editor.replaceRange(
      '',
      { line: 0, ch: 0 },
      { line: endOld, ch: lineLen(endOld) },
    );
    return;
  }

  // Pure insertion before line `start`.
  if (start < oldLines.length) {
    editor.replaceRange(segment.map((l) => `${l}\n`).join(''), {
      line: start,
      ch: 0,
    });
    return;
  }

  // Append past the last line.
  editor.replaceRange(`\n${segment.join('\n')}`, {
    line: oldLines.length - 1,
    ch: lineLen(oldLines.length - 1),
  });
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
    if (c.type === 'list') lastList = c;
    else if (!firstHeading) firstHeading = c;
  }
  if (lastList) return lastList.endLine + 1;
  return firstHeading ? firstHeading.line : target.endLine + 1;
}

/**
 * Returns the node's source line, throwing when the file has changed under
 * the map (shifted or edited lines) so the caller aborts instead of writing
 * to the wrong line. applyOp catches the throw, notifies, and re-renders.
 */
function requireNodeLine(lines: string[], node: MindNode): string {
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

function detectIndentUnit(lines: string[]): string {
  let best: string | null = null;
  for (const line of lines) {
    const m = INDENTED_LIST_RE.exec(line);
    const indent = m?.[1];
    if (!indent) continue;
    if (indent.includes('\t')) return '\t';
    if (best === null || indent.length < best.length) best = indent;
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
  if (node.type !== 'root') requireNodeLine(lines, node);
  if (node.type === 'root') {
    const hasHeadings = node.children.some((c) => c.type === 'heading');
    let at = lines.length;
    while (at > 0 && (lines[at - 1] ?? '').trim() === '') at--;
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
  if (node.type !== 'list') return lines;
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
  if (target.type !== 'root') requireNodeLine(lines, target);
  if (before) requireNodeLine(lines, before);
  const segment = nodeBlock(lines, source);
  let newSegment: string[];

  if (source.type === 'list') {
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
    newSegment = segment.map((l) =>
      l.trim() !== '' && l.startsWith(oldIndent)
        ? newIndent + l.slice(oldIndent.length)
        : l,
    );
  } else {
    const targetLevel = target.type === 'root' ? 0 : target.level;
    const delta = targetLevel + 1 - source.level;
    newSegment =
      delta === 0
        ? segment.slice()
        : segment.map((l) => {
            const m = HEADING_SHIFT_RE.exec(l);
            if (!m) return l;
            const level = Math.min(6, Math.max(1, (m[1] ?? '').length + delta));
            return '#'.repeat(level) + (m[2] ?? '');
          });
  }

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
  if (at > source.line) at -= segment.length;
  lines.splice(at, 0, ...newSegment);
  return lines;
}
