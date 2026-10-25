// Helpers shared by the columns variant: tree order of branches, which notes a branch sees,
// and a small word diff for compare mode.
import type { BranchInfo, ConversationId, SharedNote } from "../../../shared/protocol.ts";
import { textOf, type ConversationView, type ViewEntry } from "../../src/lib/view.ts";

export type Ordered = { branch: BranchInfo; depth: number; index: number };

/**
 * Branches in depth-first tree order, each fork right after the branch it came from. Siblings go
 * newest first, so a fresh fork sits right next to its parent: where its column slides in.
 */
export const treeOrder = (branches: readonly BranchInfo[]): Ordered[] => {
	const ids = new Set(branches.map((b) => b.id));
	const children = new Map<number | undefined, BranchInfo[]>();
	for (const branch of branches) {
		// A parent we don't know about (shouldn't happen) makes the branch a root rather than lost.
		const key = branch.parent !== undefined && ids.has(branch.parent.conversationId) ? branch.parent.conversationId : undefined;
		children.set(key, [...(children.get(key) ?? []), branch]);
	}
	const out: Ordered[] = [];
	const visit = (parent: number | undefined, depth: number) => {
		// Roots stay oldest first: the original thread leads the strip.
		const list = children.get(parent) ?? [];
		for (const branch of parent === undefined ? list : [...list].reverse()) {
			out.push({ branch, depth, index: out.length });
			visit(branch.id, depth + 1);
		}
	};
	visit(undefined, 0);
	return out;
};

/** Notes rendered into this branch's system prompt: the ones aimed at it or at every branch. */
export const notesFor = (notes: readonly SharedNote[], id: ConversationId): SharedNote[] =>
	notes.filter((note) => note.to === "*" || note.to.includes(id));

/** Entries the chat shows as messages (tool results ride along with their calls). */
export const isShown = (entry: ViewEntry): boolean =>
	entry.kind === "pi.user" ||
	entry.kind === "branches.shared" ||
	entry.kind === "pi.compaction" ||
	entry.kind === "pi.reset" ||
	(entry.kind === "pi.assistant" && entry.model?.[0]?.role === "assistant");

/** The newest question and answer of a branch, for compare mode. */
export const lastExchange = (view: ConversationView | undefined): { question?: ViewEntry; answer?: ViewEntry } => {
	const entries = view?.entries ?? [];
	let answer: ViewEntry | undefined;
	let question: ViewEntry | undefined;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		const message = entry.model?.[0];
		if (answer === undefined && entry.kind === "pi.assistant" && message?.role === "assistant" && textOf(message.content).trim() !== "") answer = entry;
		if (entry.kind === "pi.user") {
			question = entry;
			if (answer !== undefined) break;
		}
	}
	return { question, answer };
};

export const entryText = (entry: ViewEntry | undefined): string => {
	const message = entry?.model?.[0];
	if (message === undefined || message.role === "system" || message.role === "toolResult") return "";
	return textOf(message.content);
};

export type DiffPart = { text: string; changed: boolean };

/** Word-level diff of two texts (longest common subsequence), marking words only one side has. */
export const wordDiff = (a: string, b: string): { left: DiffPart[]; right: DiffPart[] } => {
	const split = (text: string) => text.split(/(\s+)/).filter((t) => t !== "");
	// Long answers are compared on their first words only; the quadratic table stays small.
	const x = split(a).slice(0, 1600);
	const y = split(b).slice(0, 1600);
	const table: Uint16Array[] = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
	for (let i = x.length - 1; i >= 0; i--)
		for (let j = y.length - 1; j >= 0; j--)
			table[i]![j] = x[i] === y[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
	const left: DiffPart[] = [];
	const right: DiffPart[] = [];
	const push = (parts: DiffPart[], text: string, changed: boolean) => {
		const last = parts.at(-1);
		// Whitespace between two changed words stays inside the highlight.
		if (last !== undefined && (last.changed === changed || /^\s+$/.test(text))) last.text += text;
		else parts.push({ text, changed });
	};
	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		if (x[i] === y[j]) {
			push(left, x[i]!, false);
			push(right, y[j]!, false);
			i++;
			j++;
		} else if (table[i + 1]![j]! >= table[i]![j + 1]!) push(left, x[i++]!, true);
		else push(right, y[j++]!, true);
	}
	while (i < x.length) push(left, x[i++]!, true);
	while (j < y.length) push(right, y[j++]!, true);
	return { left, right };
};

/** "provider/model" shortened to the model part for tight headers. */
export const shortModel = (model: string | undefined): string => (model === undefined ? "" : (model.split("/").at(-1) ?? model));

export const formatCost = (usd: number): string => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : "");
