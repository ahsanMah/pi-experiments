// WebSocket client for the branches server: requests with acks, the tree index, and
// live ConversationViews kept current by applying each commit's Chord ops.
import { applyImmutable } from "@earendil-works/chord/delta";
import WebSocket from "ws";
import type { ClientMessage, ConversationId, ServerMessage, TreeIndex } from "../shared/protocol.ts";

/** The parts of pi-durable's ConversationView the TUI reads. */
export type ViewEntry = {
	readonly id: number;
	readonly conversationId: number;
	readonly kind: string;
	readonly model?: readonly { role: string; content?: unknown; toolName?: string; isError?: boolean }[];
	readonly data?: unknown;
};

export type LiveToolSlot = {
	readonly callId?: string;
	readonly name?: string;
	readonly arguments?: unknown;
	readonly status?: string;
	readonly output?: unknown;
};

export type ConversationView = {
	readonly entries: readonly ViewEntry[];
	readonly docs: {
		readonly "pi.live"?: {
			readonly run?: unknown;
			readonly generation?: { readonly message?: { readonly content?: unknown }; readonly retry?: { at: number; error: string } };
			readonly tools?: readonly LiveToolSlot[];
		};
		readonly [kind: string]: unknown;
	};
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class BranchesClient {
	tree: TreeIndex = { branches: [], nodes: [], notes: [] };
	models: readonly string[] = [];
	defaultModel = "";
	readonly views = new Map<ConversationId, ConversationView>();

	onTree?: () => void;
	onView?: (conversationId: ConversationId) => void;
	onError?: (message: string) => void;
	onClose?: () => void;

	readonly #socket: WebSocket;
	readonly #pending = new Map<string, Pending>();
	readonly #subscribed = new Set<ConversationId>();
	#nextId = 0;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.on("message", (raw) => this.#receive(JSON.parse(String(raw)) as ServerMessage));
		socket.on("close", () => {
			for (const pending of this.#pending.values()) pending.reject(new Error("Connection closed"));
			this.#pending.clear();
			this.onClose?.();
		});
	}

	static connect(url: string): Promise<BranchesClient> {
		return new Promise((resolve, reject) => {
			const socket = new WebSocket(url);
			const client = new BranchesClient(socket);
			// The server sends hello and the tree right after the upgrade; wait for the tree.
			const first = client.onTree;
			client.onTree = () => {
				client.onTree = first;
				resolve(client);
			};
			socket.once("error", reject);
		});
	}

	#receive(message: ServerMessage): void {
		switch (message.t) {
			case "hello":
				this.models = message.models;
				this.defaultModel = message.defaultModel;
				break;
			case "tree":
				this.tree = message.tree;
				this.onTree?.();
				break;
			case "view":
				this.views.set(message.conversationId, message.value as ConversationView);
				this.onView?.(message.conversationId);
				break;
			case "ops": {
				// Frames still in flight for a conversation this client stopped watching.
				const current = this.views.get(message.conversationId);
				if (!this.#subscribed.has(message.conversationId) || current === undefined) break;
				try {
					this.views.set(message.conversationId, applyImmutable(current, message.ops as never) as ConversationView);
				} catch {
					// Out of step with the server: drop the view and ask for its current one, which later ops apply to.
					this.views.delete(message.conversationId);
					this.#send({ t: "subscribe", conversationId: message.conversationId });
				}
				this.onView?.(message.conversationId);
				break;
			}
			case "ack":
				this.#pending.get(message.requestId)?.resolve(message.result);
				this.#pending.delete(message.requestId);
				break;
			case "error":
				if (message.requestId !== undefined && this.#pending.has(message.requestId)) {
					this.#pending.get(message.requestId)!.reject(new Error(message.message));
					this.#pending.delete(message.requestId);
				} else {
					this.onError?.(message.message);
				}
				break;
		}
	}

	#send(message: ClientMessage): void {
		this.#socket.send(JSON.stringify(message));
	}

	/** Watch a conversation; resolves once its view has arrived. */
	async subscribe(conversationId: ConversationId): Promise<void> {
		this.#subscribed.add(conversationId);
		await this.request({ t: "subscribe", conversationId });
	}

	async unsubscribe(conversationId: ConversationId): Promise<void> {
		this.#subscribed.delete(conversationId);
		this.views.delete(conversationId);
		await this.request({ t: "unsubscribe", conversationId });
	}

	request<T = unknown>(message: ClientMessage): Promise<T> {
		const requestId = String(++this.#nextId);
		this.#send({ ...message, requestId });
		return new Promise<T>((resolve, reject) => this.#pending.set(requestId, { resolve: resolve as Pending["resolve"], reject }));
	}

	close(): void {
		this.#socket.close();
	}
}
