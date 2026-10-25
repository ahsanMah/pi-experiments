// Helpers for the Mission Control variant: branch status as a supervisor sees it, tree order,
// a small fuzzy matcher for the command palette, and display formatting.
import type { BranchInfo, TreeNode } from "../../../shared/protocol.ts";
import { textOf, type ConversationView } from "../../src/lib/view.ts";

export type Status = "running" | "errored" | "done" | "idle";

export const STATUS_ORDER: readonly Status[] = ["running", "errored", "done", "idle"];

export const STATUS_LABEL: Record<Status, string> = {
	running: "Running",
	errored: "Needs attention",
	done: "Done · unread",
	idle: "Idle",
};

/** The newest answer of the branch itself failed: inherited errors belong to the parent. */
export const erroredOf = (branch: BranchInfo, view: ConversationView | undefined): boolean => {
	if (view === undefined) return false;
	for (let i = view.entries.length - 1; i >= 0; i--) {
		const entry = view.entries[i]!;
		if (entry.conversationId !== branch.id) return false;
		if (entry.kind === "pi.user") return false;
		const message = entry.model?.[0];
		if (entry.kind === "pi.assistant" && message?.role === "assistant") return message.stopReason === "error";
	}
	return false;
};

export const statusOf = (branch: BranchInfo, view: ConversationView | undefined, seenTip: number | null | undefined): Status => {
	if (branch.busy) return "running";
	if (erroredOf(branch, view)) return "errored";
	// "Done" means new output since this viewer last opened it, like an unread CI result.
	if (seenTip !== undefined && branch.tip !== seenTip) return "done";
	return "idle";
};

/** Branches in tree order with their depth: each fork right under the branch it came from. */
export const treeOrder = (branches: readonly BranchInfo[]): { branch: BranchInfo; depth: number }[] => {
	const ids = new Set(branches.map((b) => b.id));
	const children = new Map<number | undefined, BranchInfo[]>();
	for (const branch of branches) {
		const parent = branch.parent?.conversationId;
		const key = parent !== undefined && ids.has(parent) ? parent : undefined;
		children.set(key, [...(children.get(key) ?? []), branch]);
	}
	const out: { branch: BranchInfo; depth: number }[] = [];
	const visit = (parent: number | undefined, depth: number) => {
		for (const branch of children.get(parent) ?? []) {
			out.push({ branch, depth });
			visit(branch.id, depth + 1);
		}
	};
	visit(undefined, 0);
	return out;
};

/** Root → … → branch, for the breadcrumb. */
export const lineage = (branches: readonly BranchInfo[], id: number): BranchInfo[] => {
	const byId = new Map(branches.map((b) => [b.id, b]));
	const out: BranchInfo[] = [];
	let current = byId.get(id);
	while (current !== undefined && !out.includes(current)) {
		out.unshift(current);
		current = current.parent === undefined ? undefined : byId.get(current.parent.conversationId);
	}
	return out;
};

/** Text streaming right now, or the newest preview the tree has. */
export const liveText = (view: ConversationView | undefined): string => textOf(view?.docs["pi.live"]?.generation?.message?.content);

export const runningTools = (view: ConversationView | undefined): string[] =>
	(view?.docs["pi.live"]?.tools ?? []).filter((t) => t.status !== "done").map((t) => t.name);

/** Newest message on the branch's path, skipping share markers so the board shows real content. */
export const tipPreview = (byId: ReadonlyMap<number, TreeNode>, branch: BranchInfo): { role: string; text: string } | undefined => {
	let node = branch.tip === null ? undefined : byId.get(branch.tip);
	for (let guard = 0; node !== undefined && node.role !== "user" && node.role !== "assistant" && guard < 50; guard++)
		node = node.parentId === null ? undefined : byId.get(node.parentId);
	return node === undefined ? undefined : { role: node.role, text: node.preview };
};

/** Subsequence match: a higher score for runs and word starts. Returns matched indices to highlight. */
export const fuzzy = (query: string, text: string): { score: number; hits: number[] } | null => {
	const q = query.toLowerCase().replace(/\s+/g, " ").trim();
	if (q === "") return { score: 0, hits: [] };
	const t = text.toLowerCase();
	// A plain substring always wins over a scattered match.
	const at = t.indexOf(q);
	if (at >= 0) {
		const boundary = at === 0 || /\W/.test(t[at - 1]!);
		return { score: 1000 - at + (boundary ? 200 : 0) - t.length * 0.1, hits: [...Array(q.length).keys()].map((i) => at + i) };
	}
	const hits: number[] = [];
	let score = 0;
	let ti = 0;
	for (const ch of q) {
		if (ch === " ") continue;
		const found = t.indexOf(ch, ti);
		if (found < 0) return null;
		const prev = hits[hits.length - 1];
		score += prev !== undefined && found === prev + 1 ? 8 : 1;
		if (found === 0 || /\W/.test(t[found - 1]!)) score += 6;
		hits.push(found);
		ti = found + 1;
	}
	return { score: score - t.length * 0.05, hits };
};

/** Split text into highlighted and plain runs for a list of hit indices. */
export const highlight = (text: string, hits: readonly number[]): { text: string; hit: boolean }[] => {
	const set = new Set(hits);
	const out: { text: string; hit: boolean }[] = [];
	for (let i = 0; i < text.length; i++) {
		const hit = set.has(i);
		const last = out[out.length - 1];
		if (last !== undefined && last.hit === hit) last.text += text[i];
		else out.push({ text: text[i]!, hit });
	}
	return out;
};

export const money = (usd: number): string => (usd === 0 ? "—" : usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`);

export const ago = (then: number, now: number): string => {
	const s = Math.max(0, Math.round((now - then) / 1000));
	if (s < 5) return "now";
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	return `${Math.floor(s / 86400)}d`;
};

/** `provider/modelId` → [provider, modelId], to dim the provider. */
export const splitModel = (model: string | undefined): [string, string] => {
	if (model === undefined || model === "") return ["", "default"];
	const slash = model.indexOf("/");
	return slash < 0 ? ["", model] : [model.slice(0, slash), model.slice(slash + 1)];
};

export const isTyping = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** One line of the board, computed once per tree or view change. */
export type Row = {
	branch: BranchInfo;
	status: Status;
	depth: number;
	/** Text streaming right now. */
	live: string;
	tools: string[];
	preview?: { role: string; text: string };
	messages: number;
	/** Title of the branch it forked from. */
	origin?: string;
	hue: number;
	/** 1-9 hotkey, in board order. */
	key?: number;
};

export type FeedEvent = {
	id: number;
	at: number;
	kind: "start" | "finish" | "error" | "fork" | "new" | "note" | "unshare";
	branchId?: number;
	text: string;
};
