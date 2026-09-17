import { MindNode, NodeType, parseMarkdown } from './parse/parser';

export interface NodeAnchor {
  type: NodeType;
  text: string;
  line: number;
  ancestors: string[];
  /** Markdown shape used to label bookmark menus; absent on older saves. */
  level?: number;
  marker?: string;
  checked?: boolean | null;
}

export interface NodeBookmark extends NodeAnchor {
  id: string;
  file: string;
  name: string | null;
  unresolved: boolean;
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNullableBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'boolean';
}

function compatibleAnchorField(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined || left === right;
}

/** Rejects malformed persisted data before it reaches bookmark operations. */
export function isNodeBookmark(value: unknown): value is NodeBookmark {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const bookmark = value as Partial<Record<keyof NodeBookmark, unknown>>;
  const validType = bookmark.type === 'heading' || bookmark.type === 'list';
  const validName = bookmark.name === null || typeof bookmark.name === 'string';
  const validAncestors =
    Array.isArray(bookmark.ancestors) &&
    bookmark.ancestors.every((ancestor) => typeof ancestor === 'string');

  return (
    typeof bookmark.id === 'string' &&
    typeof bookmark.file === 'string' &&
    typeof bookmark.text === 'string' &&
    typeof bookmark.line === 'number' &&
    validType &&
    validName &&
    typeof bookmark.unresolved === 'boolean' &&
    isOptionalNumber(bookmark.level) &&
    isOptionalString(bookmark.marker) &&
    isOptionalNullableBoolean(bookmark.checked) &&
    validAncestors
  );
}

export function nodeBookmarksFrom(value: unknown): NodeBookmark[] {
  return Array.isArray(value) ? value.filter(isNodeBookmark) : [];
}

export function renameBookmarkFiles(
  bookmarks: NodeBookmark[],
  oldPath: string,
  newPath: string,
): boolean {
  const oldPrefix = `${oldPath}/`;
  let renamed = false;

  for (const bookmark of bookmarks) {
    const isRenamedFile = bookmark.file === oldPath;
    const isInsideRenamedFolder = bookmark.file.startsWith(oldPrefix);

    if (isRenamedFile || isInsideRenamedFolder) {
      bookmark.file = `${newPath}${bookmark.file.slice(oldPath.length)}`;
      renamed = true;
    }
  }

  return renamed;
}

export function anchorFor(node: MindNode): NodeAnchor {
  const ancestors: string[] = [];

  for (
    let parent = node.parent;
    parent && parent.type !== 'root';
    parent = parent.parent
  ) {
    ancestors.unshift(parent.text);
  }

  return {
    type: node.type,
    text: node.text,
    line: node.line,
    ancestors,
    level: node.level,
    marker: node.marker,
    checked: node.checked,
  };
}

export function sameAnchor(a: NodeAnchor, b: NodeAnchor): boolean {
  const sameShape =
    compatibleAnchorField(a.level, b.level) &&
    compatibleAnchorField(a.marker, b.marker) &&
    compatibleAnchorField(a.checked, b.checked);

  return (
    a.type === b.type &&
    a.text === b.text &&
    a.line === b.line &&
    sameShape &&
    a.ancestors.length === b.ancestors.length &&
    a.ancestors.every((ancestor, index) => ancestor === b.ancestors[index])
  );
}

interface ChangedLines {
  oldLines: string[];
  newLines: string[];
  from: number;
  oldEnd: number;
  newEnd: number;
}

function changedLines(before: string, after: string): ChangedLines {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  let from = 0;

  while (
    from < oldLines.length &&
    from < newLines.length &&
    oldLines[from] === newLines[from]
  ) {
    from++;
  }
  let suffix = 0;

  while (
    suffix < oldLines.length - from &&
    suffix < newLines.length - from &&
    oldLines[oldLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    oldLines,
    newLines,
    from,
    oldEnd: oldLines.length - suffix,
    newEnd: newLines.length - suffix,
  };
}

function nodesOf(root: MindNode): MindNode[] {
  const found: MindNode[] = [];
  const visit = (node: MindNode): void => {
    if (node.type !== 'root') {
      found.push(node);
    }
    node.children.forEach(visit);
  };

  visit(root);

  return found;
}

function sameAncestors(node: MindNode, anchor: NodeAnchor): boolean {
  const current = anchorFor(node).ancestors;

  return (
    current.length === anchor.ancestors.length &&
    current.every((text, i) => text === anchor.ancestors[i])
  );
}

/** Resolves only evidence that identifies one node; a bookmark must not guess. */
export function resolveAnchor(
  root: MindNode,
  anchor: NodeAnchor,
): MindNode | null {
  const nodes = nodesOf(root).filter((node) => node.type === anchor.type);
  const exact = nodes.filter(
    (node) => node.text === anchor.text && sameAncestors(node, anchor),
  );

  if (exact.length === 1) {
    return exact[0]!;
  }
  const exactAtLine = exact.find((node) => node.line === anchor.line);

  if (exactAtLine) {
    return exactAtLine;
  }
  const sameText = nodes.filter((node) => node.text === anchor.text);

  if (sameText.length === 1) {
    return sameText[0]!;
  }

  return null;
}

/** Maps a line through one contiguous edit when both sides keep their shape. */
function mappedChangedLine(
  before: string,
  after: string,
  line: number,
): { line: number; changed: boolean; from: number; to: number } | null {
  const change = changedLines(before, after);

  if (line < change.from) {
    return { line, changed: false, from: change.from, to: change.from };
  }
  if (line >= change.oldEnd) {
    return {
      line: line + change.newLines.length - change.oldLines.length,
      changed: false,
      from: change.oldEnd,
      to: change.oldEnd,
    };
  }
  const oldChanged = change.oldEnd - change.from;
  const newChanged = change.newEnd - change.from;

  if (oldChanged !== newChanged) {
    return null;
  }

  return { line, changed: true, from: change.from, to: change.oldEnd };
}

/** Keeps a missing bookmark's expected line aligned with unrelated edits. */
export function shiftedMissingLine(
  anchor: NodeAnchor,
  before: string,
  after: string,
): number | null {
  const mapped = mappedChangedLine(before, after, anchor.line);

  return mapped && !mapped.changed ? mapped.line : null;
}

/** True only when one contiguous edit removed the bookmarked source lines. */
export function wasAnchorDeleted(
  anchor: NodeAnchor,
  before: string,
  after: string,
): boolean {
  const beforeNode = resolveAnchor(parseMarkdown(before, ''), anchor);

  if (!beforeNode) {
    return false;
  }
  const change = changedLines(before, after);
  const newChangedLines = change.newEnd - change.from;

  return (
    newChangedLines === 0 &&
    beforeNode.line >= change.from &&
    beforeNode.line < change.oldEnd
  );
}

export type BookmarkTrackingResult = 'unchanged' | 'changed' | 'deleted';

/** Applies one observed Markdown revision to a persisted bookmark. */
export function updateBookmarkAnchor(
  bookmark: NodeBookmark,
  root: MindNode,
  before: string,
  after: string,
): BookmarkTrackingResult {
  const resolved = resolveAnchor(root, bookmark);
  let restored: MindNode | null = null;

  if (
    bookmark.unresolved &&
    resolved &&
    sameAnchor(anchorFor(resolved), bookmark)
  ) {
    restored = resolved;
  }
  let shiftedLine: number | null = null;

  if (bookmark.unresolved && !restored) {
    shiftedLine = shiftedMissingLine(bookmark, before, after);
  }
  let changed = false;

  if (shiftedLine !== null && shiftedLine !== bookmark.line) {
    bookmark.line = shiftedLine;
    changed = true;
  }
  let found = restored;

  if (!bookmark.unresolved) {
    found = trackAnchor(root, bookmark, before, after);
  }

  if (!found) {
    if (!bookmark.unresolved && wasAnchorDeleted(bookmark, before, after)) {
      return 'deleted';
    }
    if (!bookmark.unresolved) {
      bookmark.unresolved = true;
      changed = true;
    }

    return changed ? 'changed' : 'unchanged';
  }
  const next = anchorFor(found);

  if (bookmark.unresolved || !sameAnchor(bookmark, next)) {
    Object.assign(bookmark, next);
    bookmark.unresolved = false;

    return 'changed';
  }

  return changed ? 'changed' : 'unchanged';
}

/** Follows one observed Markdown change without treating a shifted node as a rename. */
export function trackAnchor(
  root: MindNode,
  anchor: NodeAnchor,
  before: string,
  after: string,
): MindNode | null {
  const beforeRoot = parseMarkdown(before, '');
  const beforeNode = resolveAnchor(beforeRoot, anchor);

  if (!beforeNode) {
    return null;
  }
  const beforeMatches = nodesOf(beforeRoot).filter(
    (node) => node.type === anchor.type && node.text === anchor.text,
  );
  const beforeExact = beforeMatches.filter((node) =>
    sameAncestors(node, anchor),
  );
  const afterNodes = nodesOf(root).filter((node) => node.type === anchor.type);
  const mapped = mappedChangedLine(before, after, beforeNode.line);
  const atMapped = mapped
    ? afterNodes.find((node) => node.line === mapped.line)
    : null;
  const change = changedLines(before, after);
  const beforeChangedNodes = nodesOf(beforeRoot).filter(
    (node) => node.line >= change.from && node.line < change.oldEnd,
  );
  const afterChangedNodes = nodesOf(root).filter(
    (node) => node.line >= change.from && node.line < change.newEnd,
  );
  const changedAlone =
    beforeChangedNodes.length === 1 &&
    beforeChangedNodes[0] === beforeNode &&
    afterChangedNodes.length === 1;
  const lineCountChanged =
    before.split(/\r?\n/).length !== after.split(/\r?\n/).length;

  if (beforeExact.length > 1 && lineCountChanged) {
    return null;
  }
  if (mapped?.changed) {
    if (!changedAlone) {
      return null;
    }
    const changedNode = afterChangedNodes[0]!;

    const belongedToAnotherNode = nodesOf(beforeRoot).some(
      (node) =>
        node !== beforeNode &&
        node.type === changedNode.type &&
        node.text === changedNode.text,
    );

    if (belongedToAnotherNode) {
      return null;
    }

    return changedNode;
  }
  if (!mapped && changedAlone) {
    return afterChangedNodes[0]!;
  }
  const exact = afterNodes.filter(
    (node) => node.text === anchor.text && sameAncestors(node, anchor),
  );

  if (beforeExact.length === 1 && exact.length === 1) {
    return exact[0]!;
  }
  const sameText = afterNodes.filter((node) => node.text === anchor.text);

  if (beforeMatches.length === 1 && sameText.length === 1) {
    return sameText[0]!;
  }

  return atMapped ?? null;
}
