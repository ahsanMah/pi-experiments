// Tree layout for the overview canvas. Open WebUI's Overview places each message by
// (depth, index within its depth); here each subtree gets its own band, so a branch's
// nodes stay together under its fork point and edges never cross.
import type { TreeNode } from "../../../shared/protocol.ts";

export type Direction = "vertical" | "horizontal";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 76;
const SIBLING_GAP = 40;
const LEVEL_GAP = 56;

export type Placed = { node: TreeNode; x: number; y: number };

export const layoutTree = (nodes: readonly TreeNode[], direction: Direction): Placed[] => {
	const children = new Map<number | null, TreeNode[]>();
	const ids = new Set(nodes.map((node) => node.id));
	for (const node of nodes) {
		const parent = node.parentId !== null && ids.has(node.parentId) ? node.parentId : null;
		const list = children.get(parent) ?? [];
		list.push(node);
		children.set(parent, list);
	}
	// Siblings in creation order: entry ids grow with time, so the original branch comes first.
	for (const list of children.values()) list.sort((a, b) => a.id - b.id);

	const span = direction === "vertical" ? NODE_WIDTH + SIBLING_GAP : NODE_HEIGHT + SIBLING_GAP;
	const step = direction === "vertical" ? NODE_HEIGHT + LEVEL_GAP : NODE_WIDTH + LEVEL_GAP;

	// Width of each subtree in sibling slots, computed bottom-up without recursion limits.
	const width = new Map<number, number>();
	const order: TreeNode[] = [];
	const stack = [...(children.get(null) ?? [])];
	while (stack.length > 0) {
		const node = stack.pop()!;
		order.push(node);
		stack.push(...(children.get(node.id) ?? []));
	}
	for (let i = order.length - 1; i >= 0; i--) {
		const node = order[i]!;
		const kids = children.get(node.id) ?? [];
		width.set(node.id, Math.max(1, kids.reduce((sum, kid) => sum + width.get(kid.id)!, 0)));
	}

	const placed: Placed[] = [];
	const place = (list: readonly TreeNode[], start: number, depth: number) => {
		const queue: { node: TreeNode; start: number; depth: number }[] = [];
		let offset = start;
		for (const node of list) {
			queue.push({ node, start: offset, depth });
			offset += width.get(node.id)!;
		}
		while (queue.length > 0) {
			const { node, start: from, depth: level } = queue.shift()!;
			const slots = width.get(node.id)!;
			const across = (from + slots / 2 - 0.5) * span;
			const along = level * step;
			placed.push(direction === "vertical" ? { node, x: across, y: along } : { node, x: along, y: across });
			let childStart = from;
			for (const kid of children.get(node.id) ?? []) {
				queue.push({ node: kid, start: childStart, depth: level + 1 });
				childStart += width.get(kid.id)!;
			}
		}
	};
	place(children.get(null) ?? [], 0, 0);
	return placed;
};

/** Ids from the root to `tip`, to highlight the active path like Open WebUI's current thread. */
export const pathTo = (nodes: readonly TreeNode[], tip: number | null): Set<number> => {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const path = new Set<number>();
	let current = tip === null ? undefined : byId.get(tip);
	while (current !== undefined && !path.has(current.id)) {
		path.add(current.id);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return path;
};

/** A stable, distinct hue per branch. */
export const branchHue = (conversationId: number): number => (conversationId * 137.508) % 360;
