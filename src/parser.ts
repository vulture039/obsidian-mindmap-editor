export type NodeType = 'root' | 'heading' | 'list';

export interface MindNode {
	type: NodeType;
	text: string;
	/** 0-based line in the source file; -1 for the root node. */
	line: number;
	/** Last 0-based line of this node's subtree. */
	endLine: number;
	/** Heading level (1-6) or list nesting depth (0-based). 0 for root. */
	level: number;
	/** Leading whitespace (list items only). */
	indent: string;
	/** List bullet: '-', '*', '+', '1.', ... */
	marker: string;
	/** true/false for task items, null for plain nodes. */
	checked: boolean | null;
	children: MindNode[];
	parent: MindNode | null;
}

/** Regex source for a list bullet ('-', '*', '+', '1.', '1)'). Shared with
 *  markdown-ops so parsing and line edits agree on what a list item is. */
export const LIST_MARKER_SRC = String.raw`[-*+]|\d+[.)]`;

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_RE = new RegExp(
	String.raw`^(\s*)(${LIST_MARKER_SRC})\s+(?:\[([ xX])\](?:\s+|$))?(.*)$`,
);
const FENCE_RE = /^\s*(```|~~~)/;

function indentWidth(s: string): number {
	let w = 0;
	for (const ch of s) w += ch === '\t' ? 4 : 1;
	return w;
}

export function parseMarkdown(text: string, rootText: string): MindNode {
	const lines = text.split('\n');
	const lastLine = lines.length - 1;
	const root: MindNode = {
		type: 'root',
		text: rootText,
		line: -1,
		endLine: lastLine,
		level: 0,
		indent: '',
		marker: '',
		checked: null,
		children: [],
		parent: null,
	};
	const headingStack: MindNode[] = [root];
	let listStack: { width: number; node: MindNode }[] = [];
	let inFence = false;
	let start = 0;

	if (lines[0] === '---') {
		for (let j = 1; j < lines.length; j++) {
			const l = lines[j];
			if (l === '---' || l === '...') {
				start = j + 1;
				break;
			}
		}
	}

	for (let i = start; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const h = HEADING_RE.exec(line);
		if (h) {
			const level = (h[1] ?? '').length;
			while (
				headingStack.length > 1 &&
				(headingStack[headingStack.length - 1]?.level ?? 0) >= level
			) {
				headingStack.pop();
			}
			const parent = headingStack[headingStack.length - 1] ?? root;
			const node: MindNode = {
				type: 'heading',
				text: (h[2] ?? '').trim(),
				line: i,
				endLine: i,
				level,
				indent: '',
				marker: '',
				checked: null,
				children: [],
				parent,
			};
			parent.children.push(node);
			headingStack.push(node);
			listStack = [];
			continue;
		}

		const m = LIST_RE.exec(line);
		if (m) {
			const indent = m[1] ?? '';
			const w = indentWidth(indent);
			while (
				listStack.length &&
				(listStack[listStack.length - 1]?.width ?? 0) >= w
			) {
				listStack.pop();
			}
			const parent = listStack.length
				? (listStack[listStack.length - 1]?.node ?? root)
				: (headingStack[headingStack.length - 1] ?? root);
			const node: MindNode = {
				type: 'list',
				text: (m[4] ?? '').trim(),
				line: i,
				endLine: i,
				level: listStack.length,
				indent,
				marker: m[2] ?? '-',
				checked: m[3] === undefined ? null : m[3] !== ' ',
				children: [],
				parent,
			};
			parent.children.push(node);
			listStack.push({ width: w, node });
		}
	}

	computeEndLines(root, lastLine);
	return root;
}

function computeEndLines(root: MindNode, lastLine: number): void {
	// Pre-order traversal yields document order; a heading section ends just
	// before the next heading at an equal or shallower level. A stack over
	// still-open sections closes them in a single O(n) pass.
	const open: MindNode[] = [];
	const visit = (n: MindNode): void => {
		if (n.type === 'heading') {
			while ((open[open.length - 1]?.level ?? 0) >= n.level) {
				const closed = open.pop();
				if (closed) closed.endLine = n.line - 1;
			}
			open.push(n);
		}
		for (const c of n.children) visit(c);
	};
	visit(root);
	for (const h of open) h.endLine = lastLine;
	const fixLists = (n: MindNode): void => {
		for (const c of n.children) fixLists(c);
		if (n.type === 'list') {
			let end = n.line;
			for (const c of n.children) end = Math.max(end, c.endLine);
			n.endLine = end;
		}
	};
	fixLists(root);
}

/**
 * Whether the line still parses to this node (same type, level/indent, text).
 * Checked state is deliberately ignored so a checkbox node still matches its
 * line right after a toggle. Used to detect stale line numbers before an op
 * writes to the file.
 */
export function lineMatchesNode(line: string, node: MindNode): boolean {
	if (node.type === 'root') return true;
	if (node.type === 'heading') {
		const h = HEADING_RE.exec(line);
		return (
			!!h &&
			(h[1] ?? '').length === node.level &&
			(h[2] ?? '').trim() === node.text
		);
	}
	const m = LIST_RE.exec(line);
	return (
		!!m && (m[1] ?? '') === node.indent && (m[4] ?? '').trim() === node.text
	);
}

export function findByLine(root: MindNode, line: number): MindNode | null {
	if (root.line === line) return root;
	for (const c of root.children) {
		const found = findByLine(c, line);
		if (found) return found;
	}
	return null;
}

export function isDescendantOrSelf(
	node: MindNode,
	ancestor: MindNode,
): boolean {
	let cur: MindNode | null = node;
	while (cur) {
		if (cur === ancestor) return true;
		cur = cur.parent;
	}
	return false;
}

export function maxHeadingLevel(node: MindNode): number {
	let max = node.type === 'heading' ? node.level : 0;
	for (const c of node.children) max = Math.max(max, maxHeadingLevel(c));
	return max;
}
