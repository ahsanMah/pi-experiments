// Spatial layout: every branch is a card, every shared note a sticky. Card geometry is fixed
// per row so fork ports (where a child's edge leaves the parent card) sit at known offsets,
// which lets xyflow route edges to the exact message without measuring the DOM.
import type { BranchInfo, TreeIndex, TreeNode } from "../../../../shared/protocol.ts";

export const CARD_W = 360;
export const HEAD_H = 52;
export const ORIGIN_H = 30;
export const ROW_H = 34;
export const GAP_H = 26;
export const ANSWER_H = 132;
export const COMPOSER_H = 58;
export const STICKY_W = 228;
export const STICKY_H = 164;
/** Older rows beyond this fold into one "earlier" row; fork points always stay visible. */
const MAX_ROWS = 5;
const COL_GAP = 140;
const SIB_GAP = 56;
const ROOT_GAP = 140;
const LANE_GAP = 96;

export type CardRow = { kind: "node"; node: TreeNode; y: number } | { kind: "gap"; count: number; y: number };

export type CardModel = {
	branch: BranchInfo;
	/** This branch's own displayed nodes, oldest first. */
	own: TreeNode[];
	rows: CardRow[];
	/** Newest assistant node, shown large at the bottom of the card. */
	answer?: TreeNode;
	answerY: number;
	/** Where it forked: the parent branch's title and the message it continues after. */
	origin?: { title: string; preview: string };
	/** y of each fork port inside the card, by entry id. */
	ports: Map<number, number>;
	height: number;
};

export type ForkLink = { child: number; source: number; at: number | null };

/** The displayed node a branch continues after, or null when it forked before any shown message. */
export const forkNode = (branch: BranchInfo, byId: Map<number, TreeNode>, nodes: readonly TreeNode[]): number | null => {
	if (branch.parent === undefined) return null;
	// Once it has messages, its first node's parent is the displayed fork point.
	const first = nodes.find((n) => n.conversationId === branch.id);
	if (first !== undefined && first.parentId !== null && byId.get(first.parentId)?.conversationId !== branch.id) return first.parentId;
	const at = branch.parent.at;
	if (byId.has(at)) return at;
	// "Edit & branch" forks at the raw entry before a user message; show it after that message's parent.
	return nodes.find((n) => n.before === at)?.parentId ?? null;
};

export const buildCards = (tree: TreeIndex): { cards: Map<number, CardModel>; links: ForkLink[] } => {
	const byId = new Map(tree.nodes.map((n) => [n.id, n]));
	const titles = new Map(tree.branches.map((b) => [b.id, b.title]));
	const links: ForkLink[] = [];
	const portsOf = new Map<number, Set<number>>();
	for (const branch of tree.branches) {
		if (branch.parent === undefined) continue;
		const at = forkNode(branch, byId, tree.nodes);
		// The edge leaves the card that owns the fork message, which may be an ancestor of the parent.
		const source = at === null ? branch.parent.conversationId : (byId.get(at)?.conversationId ?? branch.parent.conversationId);
		links.push({ child: branch.id, source, at });
		if (at !== null) portsOf.set(source, (portsOf.get(source) ?? new Set()).add(at));
	}

	const cards = new Map<number, CardModel>();
	for (const branch of tree.branches) {
		const own = tree.nodes.filter((n) => n.conversationId === branch.id).sort((a, b) => a.id - b.id);
		// The newest exchange decides: an answer after the last question is shown large; markers
		// that arrived after it (shared notes) stay in the list.
		const lastTurn = own.findLast((n) => n.role === "user" || n.role === "assistant");
		const answer = lastTurn?.role === "assistant" ? lastTurn : undefined;
		const listed = answer === undefined ? own : own.filter((n) => n !== answer);
		const forks = portsOf.get(branch.id) ?? new Set<number>();
		const keep = listed.map((n, i) => i >= listed.length - MAX_ROWS || forks.has(n.id));

		const at = forkNode(branch, byId, tree.nodes);
		const origin =
			branch.parent === undefined
				? undefined
				: { title: titles.get(branch.parent.conversationId) ?? `#${branch.parent.conversationId}`, preview: at === null ? "the start" : (byId.get(at)?.preview ?? "") };
		let y = HEAD_H + (origin ? ORIGIN_H : 0);
		const rows: CardRow[] = [];
		const ports = new Map<number, number>();
		let hidden = 0;
		listed.forEach((node, i) => {
			if (!keep[i]) {
				hidden++;
				return;
			}
			if (hidden > 0) {
				rows.push({ kind: "gap", count: hidden, y });
				y += GAP_H;
				hidden = 0;
			}
			rows.push({ kind: "node", node, y });
			if (forks.has(node.id)) ports.set(node.id, y + ROW_H / 2);
			y += ROW_H;
		});
		const answerY = y + (rows.length > 0 ? 6 : 0);
		if (answer !== undefined && forks.has(answer.id)) ports.set(answer.id, answerY + 18);
		cards.set(branch.id, {
			branch,
			own,
			rows,
			...(answer ? { answer } : {}),
			answerY,
			...(origin ? { origin } : {}),
			ports,
			height: answerY + ANSWER_H + COMPOSER_H,
		});
	}
	return { cards, links };
};

export type Point = { x: number; y: number };

/**
 * Tidy left-to-right tree of cards: children stack in a column to the right of the card that
 * owns their fork message, each nudged toward its port so edges run nearly level.
 */
export const layoutCards = (tree: TreeIndex, cards: Map<number, CardModel>, links: ForkLink[]): Map<number, Point> => {
	const kids = new Map<number, ForkLink[]>();
	const hasParent = new Set<number>();
	for (const link of links) {
		if (!cards.has(link.source) || link.source === link.child) continue;
		kids.set(link.source, [...(kids.get(link.source) ?? []), link]);
		hasParent.add(link.child);
	}
	const portY = (link: ForkLink) => (link.at === null ? HEAD_H / 2 : (cards.get(link.source)?.ports.get(link.at) ?? HEAD_H / 2));
	for (const list of kids.values()) list.sort((a, b) => portY(a) - portY(b) || a.child - b.child);

	const pos = new Map<number, Point>();
	const place = (id: number, x: number, y: number, seen: Set<number>): number => {
		seen.add(id);
		pos.set(id, { x, y });
		let bottom = y + (cards.get(id)?.height ?? 0);
		let cursor = -Infinity;
		for (const link of kids.get(id) ?? []) {
			if (seen.has(link.child)) continue;
			const want = y + portY(link) - HEAD_H / 2;
			const sub = place(link.child, x + CARD_W + COL_GAP, Math.max(want, cursor), seen);
			cursor = sub + SIB_GAP;
			bottom = Math.max(bottom, sub);
		}
		return bottom;
	};
	let y = 0;
	const seen = new Set<number>();
	for (const branch of tree.branches) {
		if (hasParent.has(branch.id) || seen.has(branch.id)) continue;
		y = place(branch.id, 0, y, seen) + ROOT_GAP;
	}
	// Anything left (a cycle can't happen, but a missing parent can) goes below.
	for (const branch of tree.branches) if (!seen.has(branch.id)) y = place(branch.id, 0, y, seen) + ROOT_GAP;
	return pos;
};

/** Stickies sit in a lane above the cards, each near the card it was taken from. */
export const layoutNotes = (stickies: readonly { id: string; from?: number }[], cardPos: Map<number, Point>): Map<string, Point> => {
	const top = Math.min(0, ...[...cardPos.values()].map((p) => p.y));
	const laneY = top - STICKY_H - LANE_GAP;
	const wanted = stickies
		.map((sticky, index) => ({ id: sticky.id, x: sticky.from !== undefined ? (cardPos.get(sticky.from)?.x ?? 0) + 24 : -STICKY_W - 40, index }))
		.sort((a, b) => a.x - b.x || a.index - b.index);
	const out = new Map<string, Point>();
	let right = -Infinity;
	for (const { id, x } of wanted) {
		const at = Math.max(x, right + 20);
		out.set(id, { x: at, y: laneY });
		right = at + STICKY_W;
	}
	return out;
};
