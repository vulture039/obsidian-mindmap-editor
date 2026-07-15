import { MindNode } from './parser';

export interface LaidNode {
	node: MindNode;
	el: HTMLElement;
	color: string;
	w: number;
	h: number;
	x: number;
	y: number;
	subtreeH: number;
	children: LaidNode[];
}

export function makeLaid(
	node: MindNode,
	el: HTMLElement,
	color: string,
): LaidNode {
	return { node, el, color, w: 0, h: 0, x: 0, y: 0, subtreeH: 0, children: [] };
}

const H_GAP = 48;
const V_GAP = 12;
const PADDING = 40;

/**
 * Left-to-right tidy tree layout for variable-size nodes. Nodes must already
 * be in the DOM so offsetWidth/offsetHeight are measurable.
 */
export function layoutTree(root: LaidNode): { width: number; height: number } {
	measure(root);
	computeSubtreeHeight(root);
	place(root, PADDING, PADDING);
	const bounds = { width: 0, height: 0 };
	collectBounds(root, bounds);
	return { width: bounds.width + PADDING, height: bounds.height + PADDING };
}

function measure(laid: LaidNode): void {
	laid.w = laid.el.offsetWidth;
	laid.h = laid.el.offsetHeight;
	for (const c of laid.children) measure(c);
}

function computeSubtreeHeight(laid: LaidNode): number {
	if (!laid.children.length) {
		laid.subtreeH = laid.h;
		return laid.subtreeH;
	}
	let sum = V_GAP * (laid.children.length - 1);
	for (const c of laid.children) sum += computeSubtreeHeight(c);
	laid.subtreeH = Math.max(laid.h, sum);
	return laid.subtreeH;
}

function place(laid: LaidNode, x: number, top: number): void {
	laid.x = x;
	laid.y = top + (laid.subtreeH - laid.h) / 2;
	if (!laid.children.length) return;
	let childBlock = V_GAP * (laid.children.length - 1);
	for (const c of laid.children) childBlock += c.subtreeH;
	let cy = top + (laid.subtreeH - childBlock) / 2;
	const childX = x + laid.w + H_GAP;
	for (const c of laid.children) {
		place(c, childX, cy);
		cy += c.subtreeH + V_GAP;
	}
}

function collectBounds(
	laid: LaidNode,
	b: { width: number; height: number },
): void {
	b.width = Math.max(b.width, laid.x + laid.w);
	b.height = Math.max(b.height, laid.y + laid.h);
	for (const c of laid.children) collectBounds(c, b);
}
