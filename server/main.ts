// HTTP + WebSocket entry point. Serves the built web client from web/dist and the
// branches protocol on /ws. Every client (web canvas, terminal) talks to this one
// process, which owns the SQLite storage.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, ConversationWatch, EntryId } from "@earendil-works/pi-durable";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { BranchesApp } from "./app.ts";

const port = Number(process.env.PORT ?? 8787);
// No authentication, so only local clients by default.
const host = process.env.HOST ?? "127.0.0.1";
const database = process.env.PI_BRANCHES_DB ?? "./branches.sqlite";
const model = process.env.PI_MODEL ?? "faux/echo";
const cwd = process.env.PI_BRANCHES_CWD;
const webRoot = resolve(import.meta.dirname, "../web/dist");

const context = BACKGROUND_CONTEXT;
const app = await BranchesApp.open({ database, model, ...(cwd !== undefined ? { cwd } : {}) }, context);

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".json": "application/json",
};

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", "http://localhost");
	let file = join(webRoot, url.pathname === "/" ? "index.html" : url.pathname);
	if (!file.startsWith(webRoot) || !existsSync(file) || statSync(file).isDirectory()) file = join(webRoot, "index.html");
	if (!existsSync(file)) {
		response.writeHead(404, { "content-type": "text/plain" });
		response.end("Web client not built. Run `npm run build`, or `npm run web` for the dev server.\n");
		return;
	}
	response.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
	createReadStream(file).pipe(response);
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket: WebSocket) => {
	const watches = new Map<ConversationId, ConversationWatch>();
	const send = (message: ServerMessage) => {
		if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
	};

	send({ t: "hello", models: app.availableModels, defaultModel: app.defaultModel });
	send({ t: "tree", tree: app.tree });
	const offTree = app.onTree((tree) => send({ t: "tree", tree }));

	const subscribe = async (id: ConversationId) => {
		if (watches.has(id)) {
			send({ t: "view", conversationId: id, value: watches.get(id)!.value });
			return;
		}
		const conversation = await app.harness.conversation(id, context);
		if (conversation === undefined) throw new Error(`No branch ${id}`);
		const watch = await conversation.watch(context);
		watches.set(id, watch);
		send({ t: "view", conversationId: id, value: watch.value });
		watch.start(async (_value, ops) => {
			// A watch replaced by an unsubscribe and resubscribe must not interleave its frames with the new one's.
			if (watches.get(id) === watch) send({ t: "ops", conversationId: id, ops });
		});
	};

	const unsubscribe = async (id: ConversationId) => {
		const watch = watches.get(id);
		watches.delete(id);
		await watch?.stop();
	};

	const handle = async (message: ClientMessage): Promise<unknown> => {
		switch (message.t) {
			case "subscribe":
				return subscribe(message.conversationId as ConversationId);
			case "unsubscribe":
				return unsubscribe(message.conversationId as ConversationId);
			case "send":
				return app.send(message.conversationId as ConversationId, message.text, message.whenBusy ?? "followUp", context);
			case "abort":
				return app.abort(message.conversationId as ConversationId, context);
			case "fork":
				return {
					conversationId: await app.fork(
						message.conversationId as ConversationId,
						message.at as EntryId,
						message.title,
						context,
					),
				};
			case "new":
				return { conversationId: await app.create(message.title, context) };
			case "rename":
				return app.rename(message.conversationId as ConversationId, message.title, context);
			case "configure":
				return app.configure(message.conversationId as ConversationId, message.model, context);
			case "share": {
				const note = await app.share(
					{
						mode: message.mode,
						to: message.to as readonly ConversationId[] | "*",
						...(message.from !== undefined
							? {
									from: {
										conversationId: message.from.conversationId as ConversationId,
										...(message.from.at !== undefined ? { at: message.from.at as EntryId } : {}),
									},
								}
							: {}),
						...(message.title !== undefined ? { title: message.title } : {}),
						...(message.text !== undefined ? { text: message.text } : {}),
					},
					context,
				);
				return { noteId: note.id };
			}
			case "unshare":
				return app.removeNote(message.noteId, context);
		}
	};

	socket.on("message", async (raw) => {
		let message: ClientMessage;
		try {
			message = JSON.parse(String(raw)) as ClientMessage;
		} catch {
			send({ t: "error", message: "Malformed message" });
			return;
		}
		try {
			const result = await handle(message);
			if (message.requestId !== undefined) send({ t: "ack", requestId: message.requestId, result });
		} catch (error) {
			send({
				t: "error",
				...(message.requestId !== undefined ? { requestId: message.requestId } : {}),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});

	socket.on("close", () => {
		offTree();
		for (const id of [...watches.keys()]) void unsubscribe(id);
	});
});

server.listen(port, host, () => {
	console.log(`pi-branches on http://${host}:${port} (model ${model}, storage ${database})`);
});

const shutdown = async () => {
	wss.close();
	server.close();
	await app.close(context);
	process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
