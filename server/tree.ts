// Builds the overview: every conversation of the Session as one tree of displayed nodes.
//
// pi-durable stores a forest of conversations, each with its own entries, where a fork
// records `parent: { conversationId, at }`. The canvas wants one message tree, as Open
// WebUI's Overview draws it from `parentId` links. Each displayed entry's parent is the
// previous displayed entry of its conversation, and a conversation's first one hangs off
// the displayed entry nearest its fork point.
import type { Context } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc, UsageDoc } from "@earendil-works/pi-durable";
import type { ConversationId, ConversationRecord, Cursor, EntryId, EntryRecord, Harness } from "@earendil-works/pi-durable";
import type { BranchInfo, NodeRole, TreeIndex, TreeNode } from "../shared/protocol.ts";
import { BranchMetaDoc, notesFor, SHARED_ENTRY, SharedNotesDoc } from "./branches.ts";

const PREVIEW_CHARS = 160;
const PAGE = 500;

type Content = string | readonly { type: string; text?: string; thinking?: string; name?: string }[];

export const textOf = (content: Content | undefined): string => {
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
};

const oneLine = (text: string): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat;
};

type Classified = { role: NodeRole; preview: string; model?: string; toolCalls?: number } | undefined;

/** Which entries become nodes, and how they read. Tool results and system entries stay hidden. */
export const classify = (entry: EntryRecord): Classified => {
	const message = entry.model?.[0] as
		| { role: string; content?: Content; provider?: string; model?: string }
		| undefined;
	switch (entry.kind) {
		case "pi.user":
			return { role: "user", preview: oneLine(textOf(message?.content)) };
		case "pi.assistant": {
			const blocks = Array.isArray(message?.content) ? message.content : [];
			const toolCalls = blocks.filter((block) => block.type === "toolCall").length;
			const model = message?.provider !== undefined ? `${message.provider}/${message.model}` : undefined;
			const text = textOf(message?.content);
			if (text.trim() === "" && toolCalls > 0) return { role: "assistant", preview: "", model, toolCalls };
			return { role: "assistant", preview: oneLine(text), model };
		}
		case SHARED_ENTRY: {
			const data = entry.data as { title?: string } | undefined;
			return { role: "shared", preview: oneLine(`Shared: ${data?.title ?? "context"}`) };
		}
		case "pi.compaction":
			return { role: "compaction", preview: "Compacted earlier context" };
		case "pi.reset":
			return { role: "reset", preview: "Context reset" };
		default:
			return undefined;
	}
};

type ConversationCache = {
	record: ConversationRecord;
	/** Own entries seen so far, ascending. */
	entries: EntryRecord[];
	lastEntryId: EntryId | undefined;
};

/** Incremental index: entries are immutable, so each rebuild only scans what was appended since the last one. */
export class TreeIndexer {
	readonly #harness: Harness;
	readonly #cache = new Map<ConversationId, ConversationCache>();

	constructor(harness: Harness) {
		this.#harness = harness;
	}

	async conversations(context: Context): Promise<ConversationRecord[]> {
		const records: ConversationRecord[] = [];
		let cursor: Cursor | undefined;
		for (;;) {
			const page = await this.#harness.commit(
				(tx) => tx.scanConversations({ order: "ascending" }, PAGE, cursor),
				context,
			);
			records.push(...page.items);
			if (page.next === undefined) break;
			cursor = page.next;
		}
		return records;
	}

	async #refresh(record: ConversationRecord, context: Context): Promise<ConversationCache> {
		let cache = this.#cache.get(record.id);
		if (cache === undefined) {
			cache = { record, entries: [], lastEntryId: undefined };
			this.#cache.set(record.id, cache);
		}
		const conversation = await this.#harness.conversation(record.id, context);
		if (conversation === undefined) return cache;
		let cursor: Cursor | undefined;
		for (;;) {
			const query =
				cache.lastEntryId === undefined
					? { order: "ascending" as const }
					: { order: "ascending" as const, minEntryId: (cache.lastEntryId + 1) as EntryId };
			const page = await conversation.entries(query, PAGE, cursor, context);
			for (const entry of page.items) {
				if (entry.conversationId !== record.id) continue; // inherited from the fork parent
				cache.entries.push(entry);
			}
			const last = page.items.at(-1);
			if (last !== undefined) cache.lastEntryId = last.id;
			if (page.next === undefined) break;
			cursor = page.next;
		}
		return cache;
	}

	/** Raw entries of a conversation as the fork-aware history shows them, ascending, through `at` when given. */
	async history(conversationId: ConversationId, at: EntryId | undefined, context: Context): Promise<EntryRecord[]> {
		const conversation = await this.#harness.conversation(conversationId, context);
		if (conversation === undefined) throw new Error(`No branch ${conversationId}`);
		const entries: EntryRecord[] = [];
		let cursor: Cursor | undefined;
		for (;;) {
			const query = at === undefined ? { order: "ascending" as const } : { order: "ascending" as const, maxEntryId: at };
			const page = await conversation.entries(query, PAGE, cursor, context);
			entries.push(...page.items);
			if (page.next === undefined) break;
			cursor = page.next;
		}
		return entries;
	}

	async build(context: Context): Promise<TreeIndex> {
		const records = await this.conversations(context);
		const meta = (await this.#harness.snapshot(BranchMetaDoc, context))?.branches ?? {};
		const board = (await this.#harness.snapshot(SharedNotesDoc, context))?.notes ?? [];

		// Parents sort before their forks: a fork's id is minted after its parent exists.
		const caches: ConversationCache[] = [];
		for (const record of records) caches.push(await this.#refresh(record, context));

		const nodes: TreeNode[] = [];
		/** Every raw entry id seen, to the displayed node at or before it. */
		const displayedAt = new Map<EntryId, EntryId | null>();
		const branches: BranchInfo[] = [];

		for (const cache of caches) {
			const { record } = cache;
			let previousDisplayed: EntryId | null =
				record.parent === undefined ? null : (displayedAt.get(record.parent.at) ?? null);
			let previousRaw: EntryId | undefined = record.parent?.at;
			let pendingToolCalls = 0;
			for (const entry of cache.entries) {
				const shown = classify(entry);
				if (shown !== undefined && shown.toolCalls !== undefined && shown.preview === "") {
					// A tool-calling step: fold it into the answer that follows.
					pendingToolCalls += shown.toolCalls;
					displayedAt.set(entry.id, previousDisplayed);
					previousRaw = entry.id;
					continue;
				}
				if (shown !== undefined) {
					nodes.push({
						id: entry.id,
						conversationId: record.id,
						parentId: previousDisplayed,
						role: shown.role,
						preview: shown.preview,
						...(shown.role === "user" && previousRaw !== undefined ? { before: previousRaw } : {}),
						...(shown.model !== undefined ? { model: shown.model } : {}),
						...(shown.role === "assistant" && pendingToolCalls > 0 ? { toolCalls: pendingToolCalls } : {}),
					});
					if (shown.role === "assistant") pendingToolCalls = 0;
					previousDisplayed = entry.id;
				}
				displayedAt.set(entry.id, previousDisplayed);
				previousRaw = entry.id;
			}

			const [live, inbox, usage] = await Promise.all([
				this.#harness.snapshot(LiveDoc, record.id, context),
				this.#harness.snapshot(InboxDoc, record.id, context),
				this.#harness.snapshot(UsageDoc, record.id, context),
			]);
			const conversation = await this.#harness.conversation(record.id, context);
			const agent = conversation === undefined ? undefined : await conversation.agent(context);
			const costUsd = Object.values(usage?.models ?? {}).reduce(
				(sum, entry) => sum + ((entry as { cost?: { total?: number } }).cost?.total ?? 0),
				0,
			);
			branches.push({
				id: record.id,
				title: meta[String(record.id)]?.title ?? (record.parent === undefined ? "Main" : `Branch ${record.id}`),
				...(record.parent !== undefined ? { parent: record.parent } : {}),
				busy: live?.run !== undefined,
				queued: inbox?.items.length ?? 0,
				tip: previousDisplayed,
				...(agent?.model !== undefined ? { model: `${agent.model.provider}/${agent.model.modelId}` } : {}),
				costUsd,
				sharedIn: notesFor(board, record.id).length,
			});
		}
		return { branches, nodes, notes: board };
	}
}
