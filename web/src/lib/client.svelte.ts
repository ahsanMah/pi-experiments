// Browser side of the branches protocol: one WebSocket, the shared tree index, and live
// views of the conversations this tab is looking at, kept current by applying each
// commit's Chord ops (the same `applyImmutable` pi-durable's watches are built on).
import { applyImmutable } from "@earendil-works/chord/delta";
import type { ClientMessage, ServerMessage, TreeIndex } from "../../../shared/protocol.ts";
import { setBranchOrder } from "./layout.ts";
import type { ConversationView } from "./view.ts";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** The part of WebSocket the client uses, so the demo can swap in an in-page server. */
export type SocketLike = {
	readonly readyState: number;
	send(data: string): void;
	onopen: (() => void) | null;
	onclose: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
};

const OPEN = 1;

export class BranchesClient {
	tree = $state<TreeIndex>({ branches: [], nodes: [], notes: [] });
	views = $state<Record<number, ConversationView>>({});
	models = $state<readonly string[]>([]);
	defaultModel = $state("");
	connected = $state(false);
	errors = $state<string[]>([]);

	#socket: SocketLike | undefined;
	#pending = new Map<string, Pending>();
	#subscribed = new Set<number>();
	#nextId = 0;
	#open: () => SocketLike;

	constructor(open: () => SocketLike) {
		this.#open = open;
		this.#connect();
	}

	#connect(): void {
		const socket = this.#open();
		this.#socket = socket;
		socket.onopen = () => {
			this.connected = true;
			// Resubscribe after a reconnect; the server sends fresh views.
			for (const id of this.#subscribed) this.#send({ t: "subscribe", conversationId: id });
		};
		socket.onclose = () => {
			this.connected = false;
			for (const pending of this.#pending.values()) pending.reject(new Error("Disconnected"));
			this.#pending.clear();
			setTimeout(() => this.#connect(), 1000);
		};
		socket.onmessage = (event) => this.#receive(JSON.parse(String(event.data)) as ServerMessage);
	}

	#receive(message: ServerMessage): void {
		switch (message.t) {
			case "hello":
				this.models = message.models;
				this.defaultModel = message.defaultModel;
				break;
			case "tree":
				setBranchOrder(message.tree.branches.map((branch) => branch.id));
				this.tree = message.tree;
				break;
			case "view":
				this.views[message.conversationId] = message.value as ConversationView;
				break;
			case "ops": {
				// Frames for a conversation this tab no longer watches, still in flight after its unsubscribe.
				if (!this.#subscribed.has(message.conversationId) || this.views[message.conversationId] === undefined) break;
				const current = $state.snapshot(this.views[message.conversationId]) as ConversationView;
				try {
					this.views[message.conversationId] = applyImmutable(current, message.ops as never);
				} catch {
					// Out of step with the server: ask for its current view, which the ops that follow apply to.
					delete this.views[message.conversationId];
					this.#send({ t: "subscribe", conversationId: message.conversationId });
				}
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
				}
				this.errors = [...this.errors.slice(-4), message.message];
				break;
		}
	}

	#send(message: ClientMessage): void {
		if (this.#socket?.readyState === OPEN) this.#socket.send(JSON.stringify(message));
	}

	request<T = unknown>(message: ClientMessage): Promise<T> {
		const requestId = String(++this.#nextId);
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
			if (this.#socket?.readyState !== OPEN) {
				this.#pending.delete(requestId);
				reject(new Error("Not connected"));
				return;
			}
			this.#socket.send(JSON.stringify({ ...message, requestId }));
		});
	}

	/** Keep exactly these conversations live in this tab. */
	watch(ids: readonly number[]): void {
		const wanted = new Set(ids);
		for (const id of this.#subscribed) {
			if (!wanted.has(id)) {
				this.#subscribed.delete(id);
				delete this.views[id];
				void this.request({ t: "unsubscribe", conversationId: id }).catch(() => {});
			}
		}
		for (const id of wanted) {
			if (!this.#subscribed.has(id)) {
				this.#subscribed.add(id);
				void this.request({ t: "subscribe", conversationId: id }).catch(() => {});
			}
		}
	}

	dismissError(index: number): void {
		this.errors = this.errors.filter((_, i) => i !== index);
	}
}
