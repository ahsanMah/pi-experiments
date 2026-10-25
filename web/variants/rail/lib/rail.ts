// Geometry of the rail: the whole branch tree drawn like `git log --graph` in the chat's gutter.
//
// The active path is the transcript itself, so its dots sit on measured message rows (lane 0,
// next to the text). Everything else hangs off it as compact side lanes: each off-path subtree
// curves out of its fork dot into the first free column further out and runs down at a fixed
// step, one small dot per message, ending in a labeled tip. Columns are handed out greedily by
// start height (interval colouring), so lanes never overlap and nested forks step outwards.
import type { BranchInfo, NodeRole, TreeNode } from "../../../../shared/protocol.ts";
import { pathTo } from "../../../src/lib/layout.ts";

export type RowKind = NodeRole | "live";

/** A transcript row on the active path, measured from the DOM (y relative to the transcript). */
export type Row = { id: number; y: number; conv: number; kind: RowKind };

export type Dot = {
	key: string;
	x: number;
	y: number;
	conv: number;
	kind: RowKind | "ghost";
	/** On the active path (a transcript row). */
	active: boolean;
	node?: TreeNode;
	/** Branch to open when the dot is clicked. */
	open?: number;
	/** The branch's tip, and it is running: the dot pulses. */
	busy: boolean;
	/** Newest message of some branch. */
	tip?: boolean;
};

export type Segment = { key: string; d: string; conv: number; active: boolean; ghost: boolean };

/** A tip's name. Names stand in one right-aligned column left of every lane, like a line map's
 * station list, at their tip's height or pushed down to clear the one above, with a leader to the tip. */
export type Label = { key: string; x: number; y: number; conv: number; branches: BranchInfo[]; busy: boolean; right: number; ly: number };

/** Where other branches leave the active lane: the height of that fork's switcher chip. */
export type Junction = { key: string; x: number; y: number };

export type RailLayout = { dots: Dot[]; segments: Segment[]; labels: Label[]; junctions: Junction[]; height: number };

const LABEL_GAP = 24;

/** One way to continue at a fork point, for the inline switcher. */
export type ForkOption = {
	branch: BranchInfo;
	/** First message of that continuation, when it has one. */
	first?: TreeNode;
	current: boolean;
};

export type Tree = {
	byId: Map<number, TreeNode>;
	children: Map<number, TreeNode[]>;
	/** Forks that have no messages yet, hung off the node they forked at. */
	ghosts: Map<number, BranchInfo[]>;
	/** Branches whose newest message is this node. */
	tips: Map<number, BranchInfo[]>;
	/** Each branch's path from the root, to tell which branch a node continues into. */
	paths: Map<number, Set<number>>;
};

export const indexTree = (nodes: readonly TreeNode[], branches: readonly BranchInfo[]): Tree => {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map<number, TreeNode[]>();
	for (const node of nodes) {
		if (node.parentId === null) continue;
		const list = children.get(node.parentId) ?? [];
		list.push(node);
		children.set(node.parentId, list);
	}
	// Entry ids grow with time, so the original continuation comes first.
	for (const list of children.values()) list.sort((a, b) => a.id - b.id);
	const ghosts = new Map<number, BranchInfo[]>();
	const tips = new Map<number, BranchInfo[]>();
	const paths = new Map<number, Set<number>>();
	for (const branch of branches) {
		if (branch.tip === null) continue;
		paths.set(branch.id, pathTo(nodes, branch.tip));
		const own = byId.get(branch.tip)?.conversationId === branch.id;
		const map = own ? tips : ghosts;
		map.set(branch.tip, [...(map.get(branch.tip) ?? []), branch]);
	}
	return { byId, children, ghosts, tips, paths };
};

/** The branch a click on `node` should open: the most recently visited one that contains it, else its owner. */
export const branchFor = (tree: Tree, node: TreeNode, recent: readonly number[]): number => {
	for (const id of recent) if (tree.paths.get(id)?.has(node.id)) return id;
	return node.conversationId;
};

/** Every way to continue at `nodeId`, in creation order, with the active one marked. */
export const forkOptions = (
	tree: Tree,
	branches: readonly BranchInfo[],
	nodeId: number,
	activeId: number,
	path: ReadonlySet<number>,
): ForkOption[] => {
	const byBranch = new Map(branches.map((branch) => [branch.id, branch]));
	const options: ForkOption[] = [];
	const seen = new Set<number>();
	const add = (id: number, first: TreeNode | undefined, current: boolean) => {
		const branch = byBranch.get(id);
		if (branch === undefined || seen.has(id)) return;
		seen.add(id);
		options.push({ branch, ...(first !== undefined ? { first } : {}), current });
	};
	for (const kid of tree.children.get(nodeId) ?? []) {
		const onPath = path.has(kid.id);
		// Each continuation is named for the branch that wrote it, so "Main" always means Main's own line.
		add(onPath ? activeId : kid.conversationId, kid, onPath);
	}
	// Branches that end exactly here: the active one (when the transcript ends here), forks
	// with nothing sent yet, and branches whose last message this is.
	for (const branch of [...(tree.tips.get(nodeId) ?? []), ...(tree.ghosts.get(nodeId) ?? [])]) add(branch.id, undefined, branch.id === activeId);
	return options.length >= 2 ? options : [];
};

type Options = {
	tree: Tree;
	branches: readonly BranchInfo[];
	activeId: number;
	rows: readonly Row[];
	/** Measured height of each fork's switcher chip, by the entry it follows; lanes split off there. */
	forks: ReadonlyMap<number, number>;
	recent: readonly number[];
	/** x of the active lane; side lanes step outwards (to the left) from it. */
	x0: number;
	colGap: number;
	step: number;
	/** Narrow gutter: only the active lane, with a short stub where other branches leave it. */
	compact: boolean;
};

export const layoutRail = ({ tree, branches, activeId, rows, forks, recent, x0, colGap, step, compact }: Options): RailLayout => {
	const dots: Dot[] = [];
	const junctions: Junction[] = [];
	const segments: Segment[] = [];
	const labels: Omit<Label, "right" | "ly">[] = [];
	const path = new Set(rows.map((row) => row.id));
	const busy = new Map(branches.map((branch) => [branch.id, branch.busy]));
	const activeBranch = branches.find((branch) => branch.id === activeId);
	let height = 0;

	// The active lane: straight, coloured by the branch that owns each stretch, so the fork
	// point shows as the place the colour changes.
	rows.forEach((row, index) => {
		const previous = rows[index - 1];
		if (previous !== undefined) {
			// The colour changes at the junction, where this branch actually leaves the one it inherits from.
			const split = forks.get(previous.id);
			if (split !== undefined && split > previous.y && split < row.y) {
				segments.push({ key: `a${previous.id}-j`, d: `M${x0} ${previous.y}V${split}`, conv: previous.conv, active: true, ghost: false });
				segments.push({ key: `a${previous.id}-${row.id}`, d: `M${x0} ${split}V${row.y}`, conv: row.conv, active: true, ghost: false });
			} else {
				segments.push({ key: `a${previous.id}-${row.id}`, d: `M${x0} ${previous.y}V${row.y}`, conv: row.conv, active: true, ghost: false });
			}
		}
		const isTip = index === rows.length - 1;
		dots.push({
			key: `a${row.id}`,
			x: x0,
			y: row.y,
			conv: row.conv,
			kind: row.kind,
			active: true,
			...(tree.byId.has(row.id) ? { node: tree.byId.get(row.id)! } : {}),
			open: activeId,
			busy: row.kind === "live" || (isTip && (activeBranch?.busy ?? false)),
		});
		height = Math.max(height, row.y + step);
	});

	type Spawn = { y: number; x: number; col: number; start: TreeNode | BranchInfo };
	const pending: Spawn[] = [];
	const enqueue = (spawn: Spawn) => {
		// Keep the queue sorted by start height: greedy colouring in that order never overlaps.
		let at = pending.length;
		while (at > 0 && pending[at - 1]!.y > spawn.y) at--;
		pending.splice(at, 0, spawn);
	};

	for (const row of rows) {
		const kids = (tree.children.get(row.id) ?? []).filter((kid) => !path.has(kid.id));
		const ghosts = (tree.ghosts.get(row.id) ?? []).filter((branch) => branch.id !== activeId);
		const ended = (tree.tips.get(row.id) ?? []).filter((branch) => branch.id !== activeId);
		if (ended.length > 0 && !compact) {
			labels.push({ key: `e${row.id}`, x: x0, y: row.y, conv: ended[0]!.id, branches: ended, busy: ended.some((b) => b.busy) });
		}
		const at = forks.get(row.id) ?? row.y;
		if (forks.has(row.id)) junctions.push({ key: `j${row.id}`, x: x0, y: at });
		if (compact) {
			// No room for lanes: a short faded stub per departing branch says "something forks here".
			[...kids.map((kid) => kid.conversationId), ...ghosts.map((branch) => branch.id)].forEach((conv, index) => {
				const dx = 7 + index * 3;
				segments.push({ key: `s${row.id}-${conv}`, d: `M${x0} ${at}q0 7 -${dx} 12`, conv, active: false, ghost: false });
			});
			continue;
		}
		for (const kid of kids) enqueue({ y: at, x: x0, col: 0, start: kid });
		for (const branch of ghosts) enqueue({ y: at, x: x0, col: 0, start: branch });
	}

	const taken: [number, number][][] = [];
	const claim = (from: number, top: number, bottom: number): number => {
		for (let col = from; ; col++) {
			const spans = (taken[col] ??= []);
			if (spans.every(([a, b]) => bottom < a || top > b)) {
				spans.push([top, bottom]);
				return col;
			}
		}
	};

	while (pending.length > 0) {
		const spawn = pending.shift()!;
		if (!("role" in spawn.start)) {
			// A fork with nothing sent yet: a dashed stub to a hollow tip.
			const branch = spawn.start;
			const col = claim(spawn.col + 1, spawn.y + 1, spawn.y + step + 8);
			const x = x0 - col * colGap;
			const y = spawn.y + step;
			segments.push({ key: `g${branch.id}`, d: curve(spawn.x, spawn.y, x, y), conv: branch.id, active: false, ghost: true });
			dots.push({ key: `g${branch.id}`, x, y, conv: branch.id, kind: "ghost", active: false, open: branch.id, busy: branch.busy });
			labels.push({ key: `g${branch.id}`, x, y, conv: branch.id, branches: [branch], busy: branch.busy });
			height = Math.max(height, y + step);
			continue;
		}

		// Follow the lane down: the same branch's next message if it has one, else the first fork.
		const chain: TreeNode[] = [spawn.start];
		const later: { at: number; start: TreeNode | BranchInfo }[] = [];
		for (let node = spawn.start; ; ) {
			const kids = tree.children.get(node.id) ?? [];
			const next = kids.find((kid) => kid.conversationId === node.conversationId) ?? kids[0];
			for (const kid of kids) if (kid !== next) later.push({ at: chain.length - 1, start: kid });
			for (const branch of tree.ghosts.get(node.id) ?? []) if (branch.id !== activeId) later.push({ at: chain.length - 1, start: branch });
			if (next === undefined) break;
			chain.push(next);
			node = next;
		}
		const bottom = spawn.y + chain.length * step;
		const col = claim(spawn.col + 1, spawn.y + 1, bottom + 8);
		const x = x0 - col * colGap;
		chain.forEach((node, index) => {
			const y = spawn.y + (index + 1) * step;
			const d = index === 0 ? curve(spawn.x, spawn.y, x, y) : `M${x} ${y - step}V${y}`;
			segments.push({ key: `l${node.id}`, d, conv: node.conversationId, active: false, ghost: false });
			const ending = tree.tips.get(node.id) ?? [];
			const running = ending.some((branch) => branch.busy) || (index === chain.length - 1 && (busy.get(node.conversationId) ?? false));
			dots.push({ key: `l${node.id}`, x, y, conv: node.conversationId, kind: node.role, active: false, node, open: branchFor(tree, node, recent), busy: running, tip: ending.length > 0 });
			if (ending.length > 0) labels.push({ key: `t${node.id}`, x, y, conv: node.conversationId, branches: ending, busy: running });
		});
		for (const { at, start } of later) enqueue({ y: spawn.y + (at + 1) * step, x, col, start });
		height = Math.max(height, bottom + step);
	}

	// Tip names: one column, right-aligned just outside the outermost lane, no two closer than LABEL_GAP.
	const outer = Math.min(x0, ...dots.map((dot) => dot.x));
	const right = Math.max(outer - 14, 64);
	let last = -Infinity;
	const placed = [...labels]
		.sort((a, b) => a.y - b.y || b.x - a.x)
		.map((label) => {
			const ly = Math.max(label.y, last + LABEL_GAP);
			last = ly;
			height = Math.max(height, ly + step);
			return { ...label, right, ly };
		});

	return { dots, segments, labels: placed, junctions, height };
};

/** The lane split: an S-curve from the parent lane into the new column, landing on the first dot. */
const curve = (x1: number, y1: number, x2: number, y2: number): string => {
	const mid = (y2 - y1) / 2;
	return `M${x1} ${y1}C${x1} ${y1 + mid} ${x2} ${y1 + mid} ${x2} ${y2}`;
};
