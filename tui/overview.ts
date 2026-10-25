// Overview overlay: every branch of the session as one tree, drawn with the coding agent's
// /tree conventions (flat single-child chains, ├─/└─ connectors and │ gutters only where a
// node has several children, the active branch's path sorted first and marked with •).
// A fork's first node hangs under the node it forked from, so branches nest at their fork points.
import { type Component, isKeyRepeat, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { BranchInfo, TreeIndex, TreeNode } from "../shared/protocol.ts";
import { fill, style } from "./theme.ts";

type Gutter = { position: number; show: boolean };
type FlatRow = {
	node: TreeNode;
	indent: number;
	showConnector: boolean;
	isLast: boolean;
	gutters: Gutter[];
	/** First node of its branch: the row carries the branch label. */
	branchStart: boolean;
};

export type OverviewActions = {
	jump(node: TreeNode): void;
	branch(node: TreeNode): void;
	edit(node: TreeNode): void;
	share(node: TreeNode): void;
	rename(branch: BranchInfo): void;
	close(): void;
};

const ROLE_ICON: Record<TreeNode["role"], string> = {
	user: style.cyan("›"),
	assistant: style.green("◂"),
	shared: style.magenta("⇄"),
	note: style.magenta("✎"),
	compaction: style.dim("⋯"),
	reset: style.dim("⟲"),
};

export class OverviewList implements Component {
	#tree: TreeIndex;
	#active: number;
	#rows: FlatRow[] = [];
	#selected = 0;
	#spinner = "⠋";
	readonly #actions: OverviewActions;
	readonly #maxVisible: () => number;

	constructor(tree: TreeIndex, activeBranch: number, actions: OverviewActions, maxVisible: () => number) {
		this.#tree = tree;
		this.#active = activeBranch;
		this.#actions = actions;
		this.#maxVisible = maxVisible;
		this.#flatten();
		// Start on the active branch's tip.
		const tip = tree.branches.find((b) => b.id === activeBranch)?.tip;
		const index = this.#rows.findIndex((row) => row.node.id === tip);
		this.#selected = index >= 0 ? index : Math.max(0, this.#rows.length - 1);
	}

	setTree(tree: TreeIndex, activeBranch: number): void {
		const selectedId = this.#rows[this.#selected]?.node.id;
		this.#tree = tree;
		this.#active = activeBranch;
		this.#flatten();
		const index = this.#rows.findIndex((row) => row.node.id === selectedId);
		if (index >= 0) this.#selected = index;
		else this.#selected = Math.min(this.#selected, Math.max(0, this.#rows.length - 1));
	}

	setSpinner(frame: string): void {
		this.#spinner = frame;
	}

	get selected(): TreeNode | undefined {
		return this.#rows[this.#selected]?.node;
	}

	#flatten(): void {
		const nodes = this.#tree.nodes;
		const children = new Map<number | null, TreeNode[]>();
		const byId = new Map<number, TreeNode>();
		for (const node of nodes) {
			byId.set(node.id, node);
			const list = children.get(node.parentId) ?? [];
			list.push(node);
			children.set(node.parentId, list);
		}
		// Which subtrees contain the active branch's nodes: they sort first, like /tree's active leaf.
		const containsActive = new Map<number, boolean>();
		const mark = (node: TreeNode): boolean => {
			let has = node.conversationId === this.#active;
			for (const child of children.get(node.id) ?? []) if (mark(child)) has = true;
			containsActive.set(node.id, has);
			return has;
		};
		const roots = children.get(null) ?? [];
		for (const root of roots) mark(root);
		const order = (list: TreeNode[]) =>
			[...list].sort((a, b) => Number(containsActive.get(b.id) ?? false) - Number(containsActive.get(a.id) ?? false));

		const rows: FlatRow[] = [];
		type Item = [TreeNode, number, boolean, boolean, boolean, Gutter[]];
		const stack: Item[] = [];
		// Separate threads (several roots) each start flush left, without a connector.
		const orderedRoots = order(roots);
		for (let i = orderedRoots.length - 1; i >= 0; i--) {
			stack.push([orderedRoots[i]!, 0, false, false, i === orderedRoots.length - 1, []]);
		}
		while (stack.length > 0) {
			const [node, indent, justBranched, showConnector, isLast, gutters] = stack.pop()!;
			const parent = node.parentId === null ? undefined : byId.get(node.parentId);
			rows.push({ node, indent, showConnector, isLast, gutters, branchStart: parent === undefined || parent.conversationId !== node.conversationId });
			const kids = order(children.get(node.id) ?? []);
			const several = kids.length > 1;
			const childIndent = several || (justBranched && indent > 0) ? indent + 1 : indent;
			const childGutters = showConnector ? [...gutters, { position: Math.max(0, indent - 1), show: !isLast }] : gutters;
			for (let i = kids.length - 1; i >= 0; i--) {
				stack.push([kids[i]!, childIndent, several, several, i === kids.length - 1, childGutters]);
			}
		}
		this.#rows = rows;
	}

	#branch(id: number): BranchInfo | undefined {
		return this.#tree.branches.find((b) => b.id === id);
	}

	#renderRow(row: FlatRow, selected: boolean, width: number): string {
		const cursor = selected ? style.cyan("› ") : "  ";
		const total = row.indent * 3;
		const connectorAt = row.showConnector ? row.indent - 1 : -1;
		let prefix = "";
		for (let i = 0; i < total; i++) {
			const level = Math.floor(i / 3);
			const pos = i % 3;
			const gutter = row.gutters.find((g) => g.position === level);
			if (gutter !== undefined && level !== connectorAt) prefix += pos === 0 && gutter.show ? "│" : " ";
			else if (level === connectorAt) prefix += pos === 0 ? (row.isLast ? "└" : "├") : pos === 1 ? "─" : " ";
			else prefix += " ";
		}
		const branch = this.#branch(row.node.conversationId);
		const onActive = row.node.conversationId === this.#active;
		let label = "";
		if ((row.branchStart || row.showConnector) && branch !== undefined) {
			const status = branch.busy ? style.yellow(`${this.#spinner} `) : "";
			const queued = branch.queued > 0 ? style.dim(` +${branch.queued}`) : "";
			const tag = `[${branch.title || "branch"}]`;
			label = `${status}${onActive ? style.bold(style.cyan(tag)) : style.blue(tag)}${queued} `;
		}
		const tip = branch !== undefined && branch.tip === row.node.id ? style.dim(" ◆") : "";
		const tools = row.node.toolCalls !== undefined ? style.dim(` (${row.node.toolCalls} tool call${row.node.toolCalls === 1 ? "" : "s"})`) : "";
		const path = onActive ? style.cyan("• ") : "";
		const text = row.node.preview === "" ? style.dim("(no text)") : row.node.role === "user" ? row.node.preview : style.gray(row.node.preview);
		let line = `${style.dim(prefix)}${path}${label}${ROLE_ICON[row.node.role]} ${text}${tools}${tip}`;
		line = truncateToWidth(cursor + line, width);
		if (selected) line = style.selectedBg(line + " ".repeat(Math.max(0, width - visibleWidth(line))));
		return line;
	}

	render(width: number): string[] {
		if (this.#rows.length === 0) return [style.dim("  No messages yet. Send one, then press ctrl+o again.")];
		const max = Math.max(3, this.#maxVisible());
		const start = Math.max(0, Math.min(this.#selected - Math.floor(max / 2), this.#rows.length - max));
		const end = Math.min(start + max, this.#rows.length);
		const lines: string[] = [];
		for (let i = start; i < end; i++) lines.push(this.#renderRow(this.#rows[i]!, i === this.#selected, width));
		lines.push(style.dim(truncateToWidth(`  (${this.#selected + 1}/${this.#rows.length})`, width)));
		return lines;
	}

	handleInput(data: string): void {
		const node = this.selected;
		if (matchesKey(data, Key.up)) this.#selected = Math.max(0, this.#selected - 1);
		else if (matchesKey(data, Key.down)) this.#selected = Math.min(this.#rows.length - 1, this.#selected + 1);
		else if (matchesKey(data, "pageUp")) this.#selected = Math.max(0, this.#selected - this.#maxVisible());
		else if (matchesKey(data, "pageDown")) this.#selected = Math.min(this.#rows.length - 1, this.#selected + this.#maxVisible());
		else if (matchesKey(data, Key.home)) this.#selected = 0;
		else if (matchesKey(data, Key.end)) this.#selected = Math.max(0, this.#rows.length - 1);
		// Movement may repeat while a key is held; actions and closing happen once per press.
		else if (isKeyRepeat(data)) return;
		else if (matchesKey(data, Key.enter)) {
			if (node !== undefined) this.#actions.jump(node);
		} else if (data === "b") {
			if (node !== undefined) this.#actions.branch(node);
		} else if (data === "e") {
			if (node !== undefined) this.#actions.edit(node);
		} else if (data === "s") {
			if (node !== undefined) this.#actions.share(node);
		} else if (data === "r") {
			const branch = node === undefined ? undefined : this.#branch(node.conversationId);
			if (branch !== undefined) this.#actions.rename(branch);
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("o")) || data === "q") this.#actions.close();
	}

	invalidate(): void {}
}

/** Bordered frame around the list with a header and key hints, as the coding agent frames its selectors. */
export class OverviewPanel implements Component {
	readonly list: OverviewList;
	#tree: TreeIndex;

	constructor(list: OverviewList, tree: TreeIndex) {
		this.list = list;
		this.#tree = tree;
	}

	setTree(tree: TreeIndex, active: number): void {
		this.#tree = tree;
		this.list.setTree(tree, active);
	}

	render(width: number): string[] {
		const busy = this.#tree.branches.filter((b) => b.busy).length;
		const header = `${style.bold(" Branches overview")} ${style.dim(`· ${this.#tree.branches.length} branches · ${busy} working · ${this.#tree.notes.length} shared notes`)}`;
		const hints = style.dim(" ↑↓ move · enter jump · b branch here · e edit & resend · s share · r rename · esc close");
		const border = style.dim("─".repeat(Math.max(1, width)));
		return [border, header, border, ...this.list.render(width), border, hints, border].map((line) => fill(line, width));
	}

	handleInput(data: string): void {
		this.list.handleInput(data);
	}

	invalidate(): void {}
}
