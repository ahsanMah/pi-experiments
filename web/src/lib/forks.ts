// Fork points along the open branch, for the chat's inline switcher: at each message other
// branches continue from, the ways to go on from there (after the rail variant's switcher).
import type { BranchInfo, TreeNode } from "../../../shared/protocol.ts";

/** One way to continue at a fork point. */
export type ForkOption = {
	branch: BranchInfo;
	/** First message of that continuation, when it has one. */
	first?: TreeNode;
	current: boolean;
};

export type ForkIndex = {
	children: Map<number, TreeNode[]>;
	/** Branches whose newest message is this node: their own, or an inherited one (nothing sent yet). */
	ends: Map<number, BranchInfo[]>;
};

export const indexForks = (nodes: readonly TreeNode[], branches: readonly BranchInfo[]): ForkIndex => {
	const children = new Map<number, TreeNode[]>();
	for (const node of nodes) {
		if (node.parentId === null) continue;
		children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
	}
	// Entry ids grow with time, so the original continuation comes first.
	for (const list of children.values()) list.sort((a, b) => a.id - b.id);
	const ends = new Map<number, BranchInfo[]>();
	for (const branch of branches) if (branch.tip !== null) ends.set(branch.tip, [...(ends.get(branch.tip) ?? []), branch]);
	return { children, ends };
};

/**
 * Every way to continue at `nodeId` in creation order, with the open branch's marked; empty
 * when there is only one. `path` holds the entries the open branch shows.
 */
export const forkOptions = (index: ForkIndex, branches: readonly BranchInfo[], nodeId: number, activeId: number, path: ReadonlySet<number>): ForkOption[] => {
	const byId = new Map(branches.map((branch) => [branch.id, branch]));
	const options: ForkOption[] = [];
	const seen = new Set<number>();
	const add = (id: number, first: TreeNode | undefined, current: boolean) => {
		const branch = byId.get(id);
		if (branch === undefined || seen.has(id)) return;
		seen.add(id);
		options.push({ branch, ...(first !== undefined ? { first } : {}), current });
	};
	// Each continuation is named for the branch that wrote it, so "Main" always means Main's own line.
	for (const kid of index.children.get(nodeId) ?? []) add(path.has(kid.id) ? activeId : kid.conversationId, kid, path.has(kid.id));
	// Branches that end right here: the open one when its transcript ends here, and forks with nothing sent yet.
	for (const branch of index.ends.get(nodeId) ?? []) add(branch.id, undefined, branch.id === activeId);
	return options.length >= 2 ? options : [];
};
