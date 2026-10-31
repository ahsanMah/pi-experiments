// The branches application: one pi-durable Harness, plus the operations clients call
// (send, fork, share, ...) and the tree index they watch. Free of Node APIs, so the same
// code runs the server (server/main.ts) and the in-browser demo (web/src/demo.ts).
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import {
	createRegistry,
	Harness,
	type AgentChange,
	type ConversationId,
	type EntryId,
	type EntryRecord,
	type Extension,
	type HarnessOptions,
	type Storage,
} from "@earendil-works/pi-durable";
import type { BranchSuggestion, SharedNote, ShareMode, TreeIndex, TreeNode } from "../shared/protocol.ts";
import { BranchMetaDoc, createBranchesExtension, SHARED_ENTRY, SharedNotesDoc, SuggestionsDoc, type BranchPlace } from "./branches.ts";
import { classify, textOf, TreeIndexer } from "./tree.ts";

export type AppOptions = {
	readonly storage: Storage;
	readonly models: Models;
	/** `provider/modelId` for new conversations. */
	readonly model: string;
	readonly thinkingLevel?: AgentChange["thinkingLevel"];
	/** Extensions installed before the branches extension, such as pi-durable's coding tools. */
	readonly extensions?: readonly Extension[];
	readonly env?: HarnessOptions["env"];
};

export const parseModel = (ref: string): { provider: string; modelId: string } => {
	const slash = ref.indexOf("/");
	if (slash <= 0) throw new Error(`Model must be provider/modelId, got "${ref}"`);
	return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
};

export class BranchesApp {
	readonly harness: Harness;
	readonly indexer: TreeIndexer;
	readonly defaultModel: string;
	readonly availableModels: readonly string[];
	readonly #models: Models;
	readonly #agent: AgentChange;
	readonly #listeners = new Set<(tree: TreeIndex) => void>();
	#tree: TreeIndex = { branches: [], nodes: [], notes: [], suggestions: [] };
	#rebuild: { timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; again?: boolean } = {};

	private constructor(harness: Harness, models: Models, defaultModel: string, agent: AgentChange, available: string[]) {
		this.harness = harness;
		this.indexer = new TreeIndexer(harness, (provider, modelId) => {
			try {
				return models.getModel(provider, modelId)?.contextWindow;
			} catch {
				return undefined;
			}
		});
		this.#models = models;
		this.#agent = agent;
		this.defaultModel = defaultModel;
		this.availableModels = available;
	}

	static async open(options: AppOptions, context: Context = BACKGROUND_CONTEXT): Promise<BranchesApp> {
		const { models } = options;
		let app: BranchesApp | undefined;
		const registry = createRegistry();
		for (const extension of options.extensions ?? []) registry.install(extension);
		registry.install(
			createBranchesExtension({
				harness: () => app!.harness,
				place: (id) => app?.place(id),
				branchTitle: (id) => app?.tree.branches.find((b) => b.id === id)?.title ?? `branch ${id}`,
				describeBranches: (self, ctx) => app!.describeBranches(ctx, self),
				transcript: (id, at, ctx) => app!.transcript(id, at as EntryId | undefined, ctx),
				addNote: (note, ctx) => app!.addNote(note, ctx),
				suggest: (suggestion, ctx) => app!.suggest(suggestion, ctx),
			}),
		);

		const harness = await Harness.open(
			options.storage,
			{
				models,
				registry,
				...(options.env !== undefined ? { env: options.env } : {}),
				conversationCreated: async (tx, conversation) => {
					const meta = await tx.doc(BranchMetaDoc);
					meta.branches[String(conversation.id)] ??= { title: "", createdAt: Date.now() };
				},
			},
			context,
		);

		const available = (await models.getAvailable()).map((model: Model<Api>) => `${model.provider}/${model.id}`);
		const agent: AgentChange = {
			model: parseModel(options.model),
			...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
		};
		app = new BranchesApp(harness, models, options.model, agent, available);
		await harness.root(context, { agent });
		harness.resume();

		// Tasks starting and ending cover every model turn and tool call; client operations schedule their own rebuild.
		const graph = await harness.watchTaskGraph(context);
		graph.start(async () => app!.scheduleRebuild());
		await app.rebuildNow(context);
		return app;
	}

	get tree(): TreeIndex {
		return this.#tree;
	}

	onTree(listener: (tree: TreeIndex) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	scheduleRebuild(): void {
		if (this.#rebuild.timer !== undefined) return;
		this.#rebuild.timer = setTimeout(() => {
			this.#rebuild.timer = undefined;
			void this.rebuildNow(BACKGROUND_CONTEXT);
		}, 60);
	}

	async rebuildNow(context: Context): Promise<void> {
		if (this.#rebuild.running !== undefined) {
			this.#rebuild.again = true;
			return this.#rebuild.running;
		}
		this.#rebuild.running = (async () => {
			try {
				do {
					this.#rebuild.again = false;
					this.#tree = await this.indexer.build(context);
					for (const listener of this.#listeners) listener(this.#tree);
				} while (this.#rebuild.again);
			} catch (error) {
				console.error("tree rebuild failed:", error);
			} finally {
				this.#rebuild.running = undefined;
			}
		})();
		return this.#rebuild.running;
	}

	async #conversation(id: ConversationId, context: Context) {
		const conversation = await this.harness.conversation(id, context);
		if (conversation === undefined) throw new Error(`No branch ${id}`);
		return conversation;
	}

	async send(id: ConversationId, text: string, whenBusy: "followUp" | "steer", context: Context): Promise<void> {
		const conversation = await this.#conversation(id, context);
		await conversation.submit({ type: "input", content: text, whenBusy }, context);
		this.scheduleRebuild();
	}

	async abort(id: ConversationId, context: Context): Promise<void> {
		await (await this.#conversation(id, context)).abort(context);
		this.scheduleRebuild();
	}

	async #setTitle(id: ConversationId, title: string, context: Context): Promise<void> {
		await this.harness.commit(async (tx) => {
			const meta = await tx.doc(BranchMetaDoc);
			const existing = meta.branches[String(id)];
			if (existing === undefined) meta.branches[String(id)] = { title, createdAt: Date.now() };
			else existing.title = title;
		}, context);
	}

	async rename(id: ConversationId, title: string, context: Context): Promise<void> {
		await this.#setTitle(id, title, context);
		await this.rebuildNow(context);
	}

	/** A new branch continuing after entry `at`. The source keeps running if it is busy. */
	async fork(id: ConversationId, at: EntryId, title: string | undefined, context: Context): Promise<ConversationId> {
		const source = await this.#conversation(id, context);
		const fork = await source.fork(at, { ownership: { kind: "ownerless" } }, context);
		if (title !== undefined && title.trim() !== "") await this.#setTitle(fork.id, title.trim(), context);
		await this.rebuildNow(context);
		return fork.id;
	}

	async create(title: string | undefined, context: Context): Promise<ConversationId> {
		const conversation = await this.harness.createConversation(
			{ ownership: { kind: "ownerless" }, agent: this.#agent },
			context,
		);
		await this.#setTitle(conversation.id, title?.trim() || `Thread ${conversation.id}`, context);
		await this.rebuildNow(context);
		return conversation.id;
	}

	async configure(id: ConversationId, model: string, context: Context): Promise<void> {
		await (await this.#conversation(id, context)).configure({ model: parseModel(model) }, context);
		await this.rebuildNow(context);
	}

	/** Full text of one entry, as its conversation sees it. */
	async entryText(id: ConversationId, entryId: EntryId, context: Context): Promise<string> {
		const conversation = await this.#conversation(id, context);
		const page = await conversation.entries({ minEntryId: entryId, maxEntryId: entryId }, 1, undefined, context);
		const entry = page.items[0];
		if (entry === undefined) throw new Error(`No message ${entryId} in branch ${id}`);
		return textOf(entry.model?.[0]?.content as never);
	}

	/** The displayed node a branch's first own node hangs off: where it forked, as the overview shows it. */
	#forkNode(tree: TreeIndex, id: number): TreeNode | undefined {
		const first = tree.nodes.find((node) => node.conversationId === id);
		return first?.parentId == null ? undefined : tree.nodes.find((node) => node.id === first.parentId);
	}

	/** Where a branch sits in the tree, from the latest index. */
	place(id: ConversationId): BranchPlace | undefined {
		const tree = this.#tree;
		const branch = tree.branches.find((b) => b.id === (id as unknown as number));
		if (branch === undefined) return undefined;
		if (branch.parent === undefined) return { id: branch.id, title: branch.title };
		const parent = tree.branches.find((b) => b.id === branch.parent!.conversationId);
		const at = this.#forkNode(tree, branch.id);
		return {
			id: branch.id,
			title: branch.title,
			parent: { id: branch.parent.conversationId, title: parent?.title ?? `branch ${branch.parent.conversationId}`, after: at?.preview ?? "(the start)" },
		};
	}

	async describeBranches(context: Context, self?: ConversationId): Promise<string> {
		const tree = await this.indexer.build(context);
		const quote = (text: string) => `"${text}"`;
		return tree.branches
			.map((branch) => {
				const parent = branch.parent === undefined ? undefined : tree.branches.find((b) => b.id === branch.parent!.conversationId);
				const forkedAfter = this.#forkNode(tree, branch.id);
				const origin =
					branch.parent === undefined
						? "where the conversation started"
						: `forked from ${branch.parent.conversationId} ${quote(parent?.title ?? "")}${forkedAfter ? ` after ${quote(forkedAfter.preview)}` : ""}`;
				const own = tree.nodes.filter((node) => node.conversationId === branch.id);
				const started = own.find((node) => node.role === "user");
				const tip = tree.nodes.find((node) => node.id === branch.tip);
				return [
					`${branch.id}: ${quote(branch.title)}${branch.id === (self as unknown as number) ? " (this branch)" : ""}`,
					`  origin: ${origin}`,
					`  status: ${branch.busy ? "working" : "idle"}${branch.model ? `, model ${branch.model}` : ""}`,
					...(started ? [`  started with: ${quote(started.preview)}`] : []),
					...(tip && tip !== started ? [`  last message: ${quote(tip.preview)}`] : []),
				].join("\n");
			})
			.join("\n");
	}

	/** Record a branch a model proposed; it becomes a branch only when the user opens it. */
	async suggest(suggestion: Omit<BranchSuggestion, "id" | "createdAt" | "after">, context: Context): Promise<BranchSuggestion> {
		const conversation = await this.#conversation(suggestion.conversationId as unknown as ConversationId, context);
		// The newest entry is the answer that called the tool; the branch opens after the answer that follows it.
		const newest = (await conversation.entries({}, 1, undefined, context)).items[0];
		if (newest === undefined) throw new Error("This branch has no messages yet");
		const stored: BranchSuggestion = { ...suggestion, id: crypto.randomUUID(), createdAt: Date.now(), after: newest.id as unknown as number };
		await this.harness.commit(async (tx) => {
			(await tx.doc(SuggestionsDoc)).suggestions.push(stored as never);
		}, context);
		this.scheduleRebuild();
		return stored;
	}

	/** Open a suggestion as a branch after the answer it came with; the client puts its prompt in the composer. */
	async acceptSuggestion(id: string, context: Context): Promise<{ conversationId: ConversationId; prompt: string }> {
		const suggestion = this.#tree.suggestions.find((s) => s.id === id);
		if (suggestion === undefined) throw new Error("That suggestion was already opened or dismissed");
		await this.rebuildNow(context);
		const answer = this.#tree.nodes.find(
			(node) => node.conversationId === suggestion.conversationId && node.role === "assistant" && node.id > suggestion.after,
		);
		if (answer === undefined) throw new Error("The branch that suggested this is still answering; open it once the answer is done");
		const conversationId = await this.fork(suggestion.conversationId as unknown as ConversationId, answer.id as unknown as EntryId, suggestion.title, context);
		await this.dismissSuggestion(id, context);
		return { conversationId, prompt: suggestion.prompt };
	}

	async dismissSuggestion(id: string, context: Context): Promise<void> {
		await this.harness.commit(async (tx) => {
			const doc = await tx.doc(SuggestionsDoc);
			const index = doc.suggestions.findIndex((s) => s.id === id);
			if (index >= 0) doc.suggestions.splice(index, 1);
		}, context);
		await this.rebuildNow(context);
	}

	/** A branch's history through `at` as readable text, for summaries, read_branch, and transcript shares. */
	async transcript(id: ConversationId, at: EntryId | undefined, context: Context): Promise<string> {
		return renderEntries(await this.indexer.history(id, at, context));
	}

	async addNote(note: Omit<SharedNote, "id" | "createdAt">, context: Context): Promise<SharedNote> {
		const stored: SharedNote = { ...note, id: crypto.randomUUID(), createdAt: Date.now() };
		await this.harness.commit(async (tx) => {
			(await tx.doc(SharedNotesDoc)).notes.push(stored as never);
		}, context);
		// A display-only marker in each target, so the share shows on the canvas where it landed. A share with
		// every branch marks the branches that exist now; later branches still see it in their prompt.
		const targets =
			stored.to === "*"
				? (await this.indexer.conversations(context)).map((record) => record.id)
				: stored.to.map((target) => target as ConversationId);
		for (const target of targets) {
			const conversation = await this.harness.conversation(target, context);
			await conversation?.submit(
				{ type: "write", entry: { kind: SHARED_ENTRY, data: { noteId: stored.id, title: stored.title } } },
				context,
			);
		}
		this.scheduleRebuild();
		return stored;
	}

	async removeNote(noteId: string, context: Context): Promise<void> {
		await this.harness.commit(async (tx) => {
			const board = await tx.doc(SharedNotesDoc);
			const index = board.notes.findIndex((note) => note.id === noteId);
			if (index >= 0) board.notes.splice(index, 1);
		}, context);
		await this.rebuildNow(context);
	}

	async share(
		request: {
			mode: ShareMode;
			to: readonly ConversationId[] | "*";
			from?: { conversationId: ConversationId; at?: EntryId };
			title?: string;
			text?: string;
		},
		context: Context,
	): Promise<SharedNote[]> {
		const { mode, from } = request;
		const sourceTitle = from === undefined ? undefined : this.#tree.branches.find((b) => b.id === from.conversationId)?.title;
		const note = (text: string, to: SharedNote["to"]) =>
			this.addNote(
				{
					title: request.title?.trim() || (sourceTitle !== undefined ? `${mode === "summary" ? "Summary" : "Transcript"} of "${sourceTitle}"` : "Note"),
					text,
					to,
					...(from !== undefined ? { from: { conversationId: from.conversationId as unknown as number, ...(from.at !== undefined ? { at: from.at as unknown as number } : {}) } } : {}),
					author: "user",
				},
				context,
			);
		if (mode === "note") {
			if (request.text === undefined || request.text.trim() === "") throw new Error("A note needs text");
			return [await note(request.text, request.to as SharedNote["to"])];
		}
		if (from === undefined) throw new Error(`A ${mode} share needs a source branch`);
		// A summary or transcript covers only what the source has that each target doesn't: its history
		// after their lowest common ancestor. Targets with the same LCA share one note. A share with every
		// branch also reaches branches made later, which may fork anywhere, so it takes the whole history.
		const history = await this.indexer.history(from.conversationId, from.at, context);
		const textAfter = (shared: number) =>
			mode === "transcript"
				? this.transcriptAfter(from.conversationId, history, shared)
				: this.summarizeAfter(from.conversationId, history, shared, request.text, context);
		if (request.to === "*") return [await note(await textAfter(0), "*")];
		const groups = new Map<number, ConversationId[]>();
		for (const target of request.to) {
			const shared = await this.#sharedPrefix(history, target, context);
			if (shared === history.length) continue; // the target already has all of it
			groups.set(shared, [...(groups.get(shared) ?? []), target]);
		}
		if (groups.size === 0) throw new Error(`Those branches already have this history; there is nothing to ${mode === "summary" ? "summarize" : "share"}`);
		const notes: SharedNote[] = [];
		for (const [shared, targets] of groups) {
			const text = await textAfter(shared);
			notes.push(await note(text, targets as unknown as SharedNote["to"]));
		}
		return notes;
	}

	/** How many leading entries of `history` the target branch also has: the path to their lowest common ancestor. */
	async #sharedPrefix(history: readonly EntryRecord[], target: ConversationId, context: Context): Promise<number> {
		const theirs = new Set((await this.indexer.history(target, undefined, context)).map((entry) => `${entry.conversationId}:${entry.id}`));
		let shared = 0;
		while (shared < history.length && theirs.has(`${history[shared]!.conversationId}:${history[shared]!.id}`)) shared++;
		return shared;
	}

	/**
	 * The line that stands in for the first `shared` entries of `history`, which the reader already has:
	 * it names the last message both sides share. Undefined when they share nothing shown.
	 */
	#sharedLine(id: ConversationId, history: readonly EntryRecord[], shared: number): string | undefined {
		const last = history
			.slice(0, shared)
			.reverse()
			.find((entry) => renderEntry(entry) !== "");
		if (last === undefined) return undefined;
		const quote = (text: string) => `"${text.replace(/\s+/g, " ").trim()}"`;
		const preview = this.#tree.nodes.find((node) => node.id === (last.id as unknown as number))?.preview ?? clip(renderEntry(last), 120);
		const title = this.#tree.branches.find((b) => b.id === (id as unknown as number))?.title;
		return `Branch ${id}${title !== undefined ? `, ${quote(title)},` : ""} shares your history up to ${quote(preview)}; this covers what it added after that.`;
	}

	/** `history` after its first `shared` entries as readable text, under the shared-history line. */
	transcriptAfter(id: ConversationId, history: readonly EntryRecord[], shared: number): string {
		const origin = this.#sharedLine(id, history, shared);
		const text = renderEntries(origin === undefined ? history : history.slice(shared));
		return origin === undefined ? text : `${origin}\n\n${text}`;
	}

	/** Summarize `history` after its first `shared` entries, under the shared-history line. */
	async summarizeAfter(
		id: ConversationId,
		history: readonly EntryRecord[],
		shared: number,
		instructions: string | undefined,
		context: Context,
	): Promise<string> {
		const origin = this.#sharedLine(id, history, shared);
		if (origin === undefined) return this.summarize(id, renderEntries(history), instructions, context);
		const summary = await this.summarize(id, renderEntries(history.slice(shared)), instructions, context, origin);
		return `${origin}\n\n${summary}`;
	}

	/** Summarize with the source branch's own model, outside any conversation, so nothing is added to the tree. */
	async summarize(
		id: ConversationId,
		transcript: string,
		instructions: string | undefined,
		context: Context,
		origin?: string,
	): Promise<string> {
		const agent = await (await this.#conversation(id, context)).agent(context);
		const ref = agent.model ?? parseModel(this.defaultModel);
		const model = this.#models.getModel(ref.provider, ref.modelId);
		if (model === undefined) throw new Error(`Unknown model ${ref.provider}/${ref.modelId}`);
		const answer = await this.#models.completeSimple(model, {
			systemPrompt:
				"You summarize one branch of a conversation so another branch can use it. Keep facts, decisions, " +
				"open questions, and file or code references. Be concise; use bullet points." +
				(origin === undefined
					? ""
					: " The transcript holds only what this branch added after the history it shares with the reader; " +
						"that shared part is already known to the reader and is noted in a line above your summary. " +
						"Summarize only what this branch added; do not restate the shared point or reconstruct what came before it."),
			messages: [
				{
					role: "user",
					content: `${origin ? `${origin} The transcript below starts after that.\n\n` : ""}${instructions ? `Focus: ${instructions}\n\n` : ""}<branch>\n${transcript}\n</branch>`,
					timestamp: Date.now(),
				},
			],
		}, context.abortSignal === undefined ? undefined : { signal: context.abortSignal });
		if (answer.stopReason === "error") throw new Error(answer.errorMessage ?? "Summary failed");
		return textOf(answer.content as never);
	}

	async close(context: Context = BACKGROUND_CONTEXT): Promise<void> {
		await this.harness.close(context);
	}
}

const renderEntries = (entries: readonly EntryRecord[]): string => entries.map(renderEntry).filter((line) => line !== "").join("\n\n");

const clip = (text: string, length: number): string => {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > length ? `${flat.slice(0, length)}…` : flat;
};

const renderEntry = (entry: EntryRecord): string => {
	const shown = classify(entry);
	const message = entry.model?.[0] as { role: string; content?: unknown; toolName?: string } | undefined;
	if (entry.kind === "pi.tool-result") {
		const text = textOf(message?.content as never);
		return `[tool result${message?.toolName ? ` ${message.toolName}` : ""}] ${text.length > 800 ? `${text.slice(0, 800)}…` : text}`;
	}
	if (shown === undefined) return "";
	switch (shown.role) {
		case "user":
			return `User: ${textOf(message?.content as never)}`;
		case "assistant": {
			const blocks = Array.isArray(message?.content) ? (message.content as { type: string; name?: string; arguments?: unknown }[]) : [];
			const calls = blocks
				.filter((block) => block.type === "toolCall")
				.map((block) => `[tool call ${block.name} ${JSON.stringify(block.arguments).slice(0, 300)}]`);
			return [`Assistant: ${textOf(message?.content as never)}`, ...calls].join("\n");
		}
		case "compaction":
			return `[Summary of earlier context] ${(entry.data as { summary?: string } | undefined)?.summary ?? ""}`;
		default:
			return `[${shown.preview}]`;
	}
};
