// The branches application: one pi-durable Harness on SQLite, plus the operations clients
// call (send, fork, share, ...) and the tree index they watch.
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import type { Model, Api } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { fauxAssistantMessage, fauxProvider, type FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, type ConversationId, type EntryId, type EntryRecord } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import type { SharedNote, ShareMode, TreeIndex } from "../shared/protocol.ts";
import { BranchMetaDoc, createBranchesExtension, SHARED_ENTRY, SharedNotesDoc } from "./branches.ts";
import { classify, textOf, TreeIndexer } from "./tree.ts";

export type AppOptions = {
	/** SQLite file; the whole tree of conversations lives in it. */
	readonly database: string;
	/** `provider/modelId`, or `faux/echo` for an offline stand-in that echoes. */
	readonly model: string;
	/** Working directory for the coding tools; off when undefined. */
	readonly cwd?: string;
};

const parseModel = (ref: string): { provider: string; modelId: string } => {
	const slash = ref.indexOf("/");
	if (slash <= 0) throw new Error(`Model must be provider/modelId, got "${ref}"`);
	return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
};

/** An offline model that streams a short reply naming what it was asked, so branching works without a key. */
const echoFaux = () => {
	const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }], tokensPerSecond: 40 });
	const step: FauxResponseStep = (context) => {
		faux.appendResponses([step]);
		const last = [...context.messages].reverse().find((message) => message.role === "user");
		const asked = last === undefined ? "" : textOf(last.content as never);
		const system = context.messages.filter((message) => message.role === "system").length;
		return fauxAssistantMessage(
			`(offline echo model) You said: "${asked.slice(0, 200)}". ` +
				`I can see ${context.messages.length} messages of context${system > 0 ? " including system sections" : ""}. ` +
				"Set PI_MODEL to a real provider/model to get real answers.",
		);
	};
	faux.setResponses([step]);
	return faux;
};

export class BranchesApp {
	readonly harness: Harness;
	readonly indexer: TreeIndexer;
	readonly defaultModel: string;
	readonly availableModels: readonly string[];
	readonly #models: ReturnType<typeof builtinModels>;
	readonly #listeners = new Set<(tree: TreeIndex) => void>();
	#tree: TreeIndex = { branches: [], nodes: [], notes: [] };
	#rebuild: { timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; again?: boolean } = {};

	private constructor(harness: Harness, models: ReturnType<typeof builtinModels>, defaultModel: string, available: string[]) {
		this.harness = harness;
		this.indexer = new TreeIndexer(harness);
		this.#models = models;
		this.defaultModel = defaultModel;
		this.availableModels = available;
	}

	static async open(options: AppOptions, context: Context = BACKGROUND_CONTEXT): Promise<BranchesApp> {
		const models = builtinModels();
		models.setProvider(echoFaux().provider);

		let app: BranchesApp | undefined;
		const registry = createRegistry();
		if (options.cwd !== undefined) registry.install(CodingTools);
		registry.install(
			createBranchesExtension({
				harness: () => app!.harness,
				describeBranches: (ctx) => app!.describeBranches(ctx),
				transcript: (id, at, ctx) => app!.transcript(id, at as EntryId | undefined, ctx),
				addNote: (note, ctx) => app!.addNote(note, ctx),
			}),
		);

		const storage = await openNodeSqliteStorage(options.database);
		const cwd = options.cwd;
		const harness = await Harness.open(
			storage,
			{
				models,
				registry,
				...(cwd !== undefined ? { env: ({ cwd: agentCwd }) => new NodeExecutionEnv({ cwd: agentCwd ?? cwd }) } : {}),
				conversationCreated: async (tx, conversation) => {
					const meta = await tx.doc(BranchMetaDoc);
					meta.branches[String(conversation.id)] ??= { title: "", createdAt: Date.now() };
				},
			},
			context,
		);

		const available = (await models.getAvailable()).map((model: Model<Api>) => `${model.provider}/${model.id}`);
		app = new BranchesApp(harness, models, options.model, available);
		await harness.root(context, { agent: { model: parseModel(options.model) } });
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
			{ ownership: { kind: "ownerless" }, agent: { model: parseModel(this.defaultModel) } },
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

	async describeBranches(context: Context): Promise<string> {
		const tree = await this.indexer.build(context);
		return tree.branches
			.map((branch) => {
				const origin = branch.parent === undefined ? "root" : `forked from ${branch.parent.conversationId}`;
				const status = branch.busy ? "working" : "idle";
				const tip = tree.nodes.find((node) => node.id === branch.tip);
				return `${branch.id}: "${branch.title}" (${origin}, ${status})${tip ? ` — last: ${tip.preview}` : ""}`;
			})
			.join("\n");
	}

	/** A branch's history through `at` as readable text, for summaries, read_branch, and transcript shares. */
	async transcript(id: ConversationId, at: EntryId | undefined, context: Context): Promise<string> {
		const entries = await this.indexer.history(id, at, context);
		return entries.map(renderEntry).filter((line) => line !== "").join("\n\n");
	}

	async addNote(note: Omit<SharedNote, "id" | "createdAt">, context: Context): Promise<SharedNote> {
		const stored: SharedNote = { ...note, id: crypto.randomUUID(), createdAt: Date.now() };
		await this.harness.commit(async (tx) => {
			(await tx.doc(SharedNotesDoc)).notes.push(stored as never);
		}, context);
		// A display-only marker in each named target, so the share shows on the canvas where it landed.
		if (stored.to !== "*") {
			for (const target of stored.to) {
				const conversation = await this.harness.conversation(target as ConversationId, context);
				await conversation?.submit(
					{ type: "write", entry: { kind: SHARED_ENTRY, data: { noteId: stored.id, title: stored.title } } },
					context,
				);
			}
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
	): Promise<SharedNote> {
		const { mode, from } = request;
		let text: string;
		if (mode === "note") {
			if (request.text === undefined || request.text.trim() === "") throw new Error("A note needs text");
			text = request.text;
		} else {
			if (from === undefined) throw new Error(`A ${mode} share needs a source branch`);
			const transcript = await this.transcript(from.conversationId, from.at, context);
			text = mode === "transcript" ? transcript : await this.summarize(from.conversationId, transcript, request.text, context);
		}
		const sourceTitle = from === undefined ? undefined : this.#tree.branches.find((b) => b.id === from.conversationId)?.title;
		return this.addNote(
			{
				title: request.title?.trim() || (sourceTitle !== undefined ? `${mode === "summary" ? "Summary" : "Transcript"} of "${sourceTitle}"` : "Note"),
				text,
				to: request.to as SharedNote["to"],
				...(from !== undefined ? { from: { conversationId: from.conversationId as unknown as number, ...(from.at !== undefined ? { at: from.at as unknown as number } : {}) } } : {}),
				author: "user",
			},
			context,
		);
	}

	/** Summarize with the source branch's own model, outside any conversation, so nothing is added to the tree. */
	async summarize(id: ConversationId, transcript: string, instructions: string | undefined, context: Context): Promise<string> {
		const agent = await (await this.#conversation(id, context)).agent(context);
		const ref = agent.model ?? parseModel(this.defaultModel);
		const model = this.#models.getModel(ref.provider, ref.modelId);
		if (model === undefined) throw new Error(`Unknown model ${ref.provider}/${ref.modelId}`);
		const answer = await this.#models.completeSimple(model, {
			systemPrompt:
				"You summarize one branch of a conversation so another branch can use it. Keep facts, decisions, " +
				"open questions, and file or code references. Be concise; use bullet points.",
			messages: [
				{
					role: "user",
					content: `${instructions ? `Focus: ${instructions}\n\n` : ""}<branch>\n${transcript}\n</branch>`,
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
