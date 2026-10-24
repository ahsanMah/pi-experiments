// The parts of pi-durable's ConversationView the web client reads. Kept structural so the
// browser bundle doesn't import pi-durable itself.

export type ContentBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string }
	| { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
	| { type: "image"; data: string; mimeType: string };

export type ModelMessage =
	| { role: "user"; content: string | ContentBlock[] }
	| { role: "assistant"; content: ContentBlock[]; provider?: string; model?: string; stopReason?: string; errorMessage?: string }
	| { role: "toolResult"; toolCallId: string; toolName: string; content: ContentBlock[]; isError?: boolean }
	| { role: "system"; [key: string]: unknown };

export type ViewEntry = {
	id: number;
	conversationId: number;
	kind: string;
	model?: ModelMessage[];
	data?: unknown;
};

export type ToolSlot = {
	callId: string;
	name: string;
	status: "pending" | "running" | "done";
	output?: string;
};

export type LiveDoc = {
	run?: { taskId: number; inputs: number[] };
	generation?: { attempt: number; message?: { content: ContentBlock[] }; retry?: { at: number; error: string } };
	tools?: ToolSlot[];
};

export type InboxDoc = { items: { id: number; type: string; content?: unknown; whenBusy?: string }[] };

export type ConversationView = {
	conversation: { id: number; parent?: { conversationId: number; at: number } };
	entries: ViewEntry[];
	docs: { "pi.live"?: LiveDoc; "pi.inbox"?: InboxDoc; [kind: string]: unknown };
};

export const textOf = (content: string | ContentBlock[] | undefined): string => {
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("");
};
