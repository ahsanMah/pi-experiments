// The demo build runs the real branches server inside the page: BranchesApp on pi-durable's
// MemoryStorage with the offline echo model, connected to the client through a local channel
// that behaves like a WebSocket. It seeds a small tree so the overview has something to show.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { MemoryStorage, type ConversationId, type EntryId } from "@earendil-works/pi-durable";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.ts";
import { BranchesApp } from "../../server/app.ts";
import { connect } from "../../server/connection.ts";
import { echoProvider } from "../../server/echo.ts";
import type { SocketLike } from "./lib/client.svelte.ts";

const context = BACKGROUND_CONTEXT;
const LIVE = "demo/echo";
const SEED = "seed/echo";

const open = async (): Promise<BranchesApp> => {
	const models = createModels();
	models.setProvider(echoProvider({ provider: "demo", tokensPerSecond: 30, hint: "In the full app this is any model you have set up in pi." }).provider);
	// Seeding answers instantly; branches switch to the streaming model once seeded.
	models.setProvider(echoProvider({ provider: "seed" }).provider);
	const app = await BranchesApp.open({ storage: new MemoryStorage(), models, model: SEED }, context);
	await seed(app);
	return app;
};

const ask = async (app: BranchesApp, id: ConversationId, text: string) => {
	const conversation = (await app.harness.conversation(id, context))!;
	await (await conversation.submit({ type: "input", content: text }, context)).wait(context);
};

const lastAnswer = (app: BranchesApp, id: ConversationId): EntryId => {
	const branch = app.tree.branches.find((b) => b.id === (id as unknown as number))!;
	return branch.tip as unknown as EntryId;
};

const seed = async (app: BranchesApp) => {
	const main = app.tree.branches[0]!.id as unknown as ConversationId;
	await ask(app, main, "Plan a migration from Postgres to SQLite for our CLI tool");
	await app.rebuildNow(context);
	const firstAnswer = lastAnswer(app, main);
	await ask(app, main, "What are the risks with concurrent writes?");

	const wal = await app.fork(main, firstAnswer, "WAL mode deep-dive", context);
	await ask(app, wal, "How does WAL mode change durability guarantees?");
	const duck = await app.fork(main, firstAnswer, "Alternative: DuckDB", context);
	await ask(app, duck, "Actually, compare against DuckDB instead");

	await app.rebuildNow(context);
	await app.share({ mode: "summary", to: "*", from: { conversationId: main }, title: 'Summary of "Main"' }, context);
	for (const id of [main, wal, duck]) await app.configure(id, LIVE, context);
	await app.rebuildNow(context);
};

/** Start the in-page server and return a socket factory for BranchesClient. */
export const startDemo = (): (() => SocketLike) => {
	const ready = open();
	return () => {
		const socket: SocketLike & { readyState: number } = {
			readyState: 0,
			onopen: null,
			onclose: null,
			onmessage: null,
			send: (data) => void connection.then((c) => c.receive(JSON.parse(data) as ClientMessage)),
		};
		// Deliver asynchronously and as JSON, like a network socket, so the client sees the same shapes.
		const deliver = (message: ServerMessage) => {
			const data = JSON.stringify(message);
			setTimeout(() => socket.onmessage?.({ data }), 0);
		};
		const connection = ready.then((app) => {
			const c = connect(app, deliver, context);
			socket.readyState = 1;
			socket.onopen?.();
			return c;
		});
		ready.catch((error) => console.error("demo failed to start:", error));
		return socket;
	};
};
