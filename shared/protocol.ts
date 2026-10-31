// Wire protocol between the branches server and its clients (web canvas, terminal).
// One WebSocket per client. Every client message may carry a `requestId`; the server
// answers it with `ack` (with a result) or `error`.
//
// Conversation state is not re-encoded here: the server forwards pi-durable's own
// ConversationView snapshot and the Chord ops of each commit, which clients apply
// with `applyImmutable` from `@earendil-works/chord/delta`.

/** pi-durable ids are plain numbers on the wire. */
export type ConversationId = number;
export type EntryId = number;

export type NodeRole = "user" | "assistant" | "shared" | "note" | "compaction" | "reset";

/** One displayed node of the overview: a transcript entry worth showing on the canvas. */
export type TreeNode = {
	/** The entry id; unique across the whole session. */
	readonly id: EntryId;
	/** Conversation that appended this entry. */
	readonly conversationId: ConversationId;
	/** Displayed parent node (previous displayed entry, or the fork point), or null for the first. */
	readonly parentId: EntryId | null;
	readonly role: NodeRole;
	/** Short single-line text for the node. */
	readonly preview: string;
	/** Entry to fork at for "edit and resend" of a user node: the raw entry before it. */
	readonly before?: EntryId;
	/** Assistant model, `provider/modelId`, when known. */
	readonly model?: string;
	/** Assistant turn that only called tools, folded into the next answer when displayed. */
	readonly toolCalls?: number;
};

export type BranchInfo = {
	readonly id: ConversationId;
	readonly title: string;
	/** Fork origin; absent for a root conversation. */
	readonly parent?: { readonly conversationId: ConversationId; readonly at: EntryId };
	/** A run is going (model or tools working). */
	readonly busy: boolean;
	/** Inputs waiting behind the current run. */
	readonly queued: number;
	/** Newest displayed node of this branch, to jump to. */
	readonly tip: EntryId | null;
	/** `provider/modelId`, when set on the branch. */
	readonly model?: string;
	readonly costUsd: number;
	/** Number of shared-context notes this branch's model sees. */
	readonly sharedIn: number;
};

/** A piece of context shared between branches; rendered into the target's system prompt. */
export type SharedNote = {
	readonly id: string;
	readonly title: string;
	readonly text: string;
	/** Where it came from, when it was taken from a branch. */
	readonly from?: { readonly conversationId: ConversationId; readonly at?: EntryId };
	/** Target conversations, or "*" for every branch. */
	readonly to: ConversationId[] | "*";
	readonly createdAt: number;
	/** Who made it: the user from a client, or a model through the post_note tool. */
	readonly author: "user" | "model";
};

/** A branch a model proposed with suggest_branch; it exists only once the user opens it. */
export type BranchSuggestion = {
	readonly id: string;
	/** The branch whose model made the suggestion. */
	readonly conversationId: ConversationId;
	/** Newest entry of that branch when it was made; the branch opens after the answer that follows. */
	readonly after: EntryId;
	readonly title: string;
	/** Opening message for the new branch, put in the composer for the user to edit and send. */
	readonly prompt: string;
	readonly reason: string;
	readonly createdAt: number;
};

export type TreeIndex = {
	readonly branches: readonly BranchInfo[];
	readonly nodes: readonly TreeNode[];
	readonly notes: readonly SharedNote[];
	readonly suggestions: readonly BranchSuggestion[];
};

export type ShareMode =
	/** The server asks a model to summarize the source branch up to `at`. */
	| "summary"
	/** The source branch's transcript up to `at`, as text. */
	| "transcript"
	/** Exactly the text the user typed. */
	| "note";

export type ClientMessage = { readonly requestId?: string } & (
	| { readonly t: "subscribe"; readonly conversationId: ConversationId }
	| { readonly t: "unsubscribe"; readonly conversationId: ConversationId }
	| {
			readonly t: "send";
			readonly conversationId: ConversationId;
			readonly text: string;
			/** While busy: queue after the run (default), or steer the running work. */
			readonly whenBusy?: "followUp" | "steer";
	  }
	| { readonly t: "abort"; readonly conversationId: ConversationId }
	/** New conversation that continues after entry `at` of `conversationId`. Ack result: { conversationId }. */
	| { readonly t: "fork"; readonly conversationId: ConversationId; readonly at: EntryId; readonly title?: string }
	/** A fresh, unrelated root conversation. Ack result: { conversationId }. */
	| { readonly t: "new"; readonly title?: string }
	| { readonly t: "rename"; readonly conversationId: ConversationId; readonly title: string }
	| { readonly t: "configure"; readonly conversationId: ConversationId; readonly model: string }
	/** Share context into other branches. Ack result: { noteId, noteIds }. A summary or
	 * transcript covers only the source's history after its lowest common ancestor with each target; targets with
	 * different LCAs get separate notes (noteIds), noteId is the first. */
	| {
			readonly t: "share";
			readonly mode: ShareMode;
			readonly to: ConversationId[] | "*";
			/** Source branch and point, for summary and transcript. */
			readonly from?: { readonly conversationId: ConversationId; readonly at?: EntryId };
			readonly title?: string;
			/** Note text, or extra instructions for a summary. */
			readonly text?: string;
	  }
	| { readonly t: "unshare"; readonly noteId: string }
	/** Open a suggested branch. Ack result: { conversationId, prompt }; the client puts the prompt in its composer. */
	| { readonly t: "acceptSuggestion"; readonly id: string }
	| { readonly t: "dismissSuggestion"; readonly id: string }
	/** Full text of a user or assistant entry (tree previews are cut short). Ack result: { text }. */
	| { readonly t: "text"; readonly conversationId: ConversationId; readonly entryId: EntryId }
);

export type ServerMessage =
	| { readonly t: "hello"; readonly models: readonly string[]; readonly defaultModel: string }
	| { readonly t: "tree"; readonly tree: TreeIndex }
	/** Full ConversationView of a subscribed conversation, sent on subscribe and after the server falls behind. */
	| { readonly t: "view"; readonly conversationId: ConversationId; readonly value: unknown }
	/** Chord ops of one commit, to apply on top of the last view. */
	| { readonly t: "ops"; readonly conversationId: ConversationId; readonly ops: readonly unknown[] }
	| { readonly t: "ack"; readonly requestId: string; readonly result?: unknown }
	| { readonly t: "error"; readonly requestId?: string; readonly message: string };
