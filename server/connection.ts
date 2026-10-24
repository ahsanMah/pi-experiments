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
					conversationId: await app.fork(message.conversationId as ConversationId, message.at as EntryId, message.title, context),
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

	return {
		async receive(message) {
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
		},
		close() {
			offTree();
			for (const id of [...watches.keys()]) void unsubscribe(id);
		},
	};
};
