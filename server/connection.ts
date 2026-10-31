// One client connection speaking the branches protocol, independent of the transport:
// the server wires it to a WebSocket, the in-browser demo to a local channel.
import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, ConversationWatch, EntryId } from "@earendil-works/pi-durable";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import type { BranchesApp } from "./app.ts";

export type Connection = {
	receive(message: ClientMessage): Promise<void>;
	close(): void;
};

export const connect = (app: BranchesApp, send: (message: ServerMessage) => void, context: Context): Connection => {
	const watches = new Map<ConversationId, ConversationWatch>();
	let closed = false;

	send({ t: "hello", models: app.availableModels, defaultModel: app.defaultModel });
	send({ t: "tree", tree: app.tree });
	const offTree = app.onTree((tree) => send({ t: "tree", tree }));

	// Subscription changes for one conversation run one after another, so an unsubscribe can't
	// overtake a subscribe that is still opening its watch and leave that watch running.
	const lanes = new Map<ConversationId, Promise<unknown>>();
	const inLane = <T>(id: ConversationId, run: () => Promise<T>): Promise<T> => {
		const next = (lanes.get(id) ?? Promise.resolve()).then(run, run);
		const settled = next.catch(() => {});
		lanes.set(id, settled);
		void settled.then(() => {
			if (lanes.get(id) === settled) lanes.delete(id);
		});
		return next;
	};

	const subscribe = async (id: ConversationId) => {
		if (watches.has(id)) {
			send({ t: "view", conversationId: id, value: watches.get(id)!.value });
			return;
		}
		const conversation = await app.harness.conversation(id, context);
		if (conversation === undefined) throw new Error(`No branch ${id}`);
		const watch = await conversation.watch(context);
		if (closed) {
			await watch.stop();
			return;
		}
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
			case "subscribe": {
				const id = message.conversationId as ConversationId;
				return inLane(id, () => subscribe(id));
			}
			case "unsubscribe": {
				const id = message.conversationId as ConversationId;
				return inLane(id, () => unsubscribe(id));
			}
			case "send":
				return app.send(message.conversationId as ConversationId, message.text, message.whenBusy ?? "followUp", context);
			case "abort":
				return app.abort(message.conversationId as ConversationId, context);
			case "fork":
				return {
					conversationId: await app.fork(message.conversationId as ConversationId, message.at as EntryId, message.title, context),
				};
			case "new":
				return { conversationId: await app.create(message.title, context) };
			case "rename":
				return app.rename(message.conversationId as ConversationId, message.title, context);
			case "delete":
				return app.remove(message.conversationId as ConversationId, context);
			case "configure":
				return app.configure(message.conversationId as ConversationId, message.model, context);
			case "share": {
				const notes = await app.share(
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
				return { noteId: notes[0]!.id, noteIds: notes.map((note) => note.id) };
			}
			case "unshare":
				return app.removeNote(message.noteId, context);
			case "acceptSuggestion":
				return app.acceptSuggestion(message.id, context);
			case "dismissSuggestion":
				return app.dismissSuggestion(message.id, context);
			case "text":
				return { text: await app.entryText(message.conversationId as ConversationId, message.entryId as EntryId, context) };
			default:
				// A client newer than this server; say so instead of acknowledging a request that did nothing.
				throw new Error(`Unknown request "${(message as { t: string }).t}"; restart the server if it predates the client`);
		}
	};

	return {
		async receive(message) {
			// Decoded JSON can be anything; only objects naming a message type are requests.
			if (typeof message !== "object" || message === null || typeof (message as { t?: unknown }).t !== "string") {
				send({ t: "error", message: "Malformed message" });
				return;
			}
			const requestId = typeof message.requestId === "string" ? message.requestId : undefined;
			try {
				const result = await handle(message);
				if (requestId !== undefined) send({ t: "ack", requestId, result });
			} catch (error) {
				send({
					t: "error",
					...(requestId !== undefined ? { requestId } : {}),
					message: error instanceof Error ? error.message : String(error),
				});
			}
		},
		close() {
			closed = true;
			offTree();
			for (const id of new Set([...watches.keys(), ...lanes.keys()])) void inLane(id, () => unsubscribe(id));
		},
	};
};
