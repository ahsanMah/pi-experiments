// What fills a branch's context: an estimate per part, from the entries of its view.
//
// pi-durable records the system prompt as `pi.system` entries: each carries changed prompt
// sections by key and tools added or removed, replayed in order. Everything else in context
// is model messages. Sizes are estimated from characters; when the real size of the last
// request is known, the estimates are scaled so they add up to it.
import { estimateTokens } from "../../../shared/format.ts";
import type { ContentBlock, ConversationView, ModelMessage } from "./view.ts";

export type ContextPart = { label: string; tokens: number; detail?: { label: string; tokens: number }[] };

const SECTION_NAMES: Record<string, string> = {
	branches: "Branch info",
	"shared-context": "Shared notes",
};

const charsOf = (content: string | ContentBlock[] | undefined, include: (block: ContentBlock) => number): number =>
	content === undefined ? 0 : typeof content === "string" ? content.length : content.reduce((sum, b) => sum + include(b), 0);

const textChars = (b: ContentBlock) => (b.type === "text" ? b.text.length : b.type === "image" ? 4800 : 0);

type SystemMessage = {
	role: "system";
	sections?: Record<string, string | null>;
	toolsAdded?: { name: string; description?: string; parameters?: unknown }[];
	toolsRemoved?: string[];
};

export const contextBreakdown = (view: ConversationView, actualTokens?: number): ContextPart[] => {
	const sections = new Map<string, number>();
	const tools = new Map<string, number>();
	let user = 0;
	let assistant = 0;
	let thinking = 0;
	let toolCalls = 0;
	let toolResults = 0;
	let summaries = 0;

	for (const entry of view.entries) {
		for (const message of entry.model ?? []) {
			switch (message.role) {
				case "system": {
					const system = message as SystemMessage;
					for (const [key, value] of Object.entries(system.sections ?? {})) {
						sections.delete(key); // re-adding appends
						if (value !== null) sections.set(key, value.length);
					}
					for (const name of system.toolsRemoved ?? []) tools.delete(name);
					for (const tool of system.toolsAdded ?? []) tools.set(tool.name, JSON.stringify(tool).length);
					break;
				}
				case "user": {
					const chars = charsOf(message.content, textChars);
					if (entry.kind === "pi.compaction") summaries += chars;
					else user += chars;
					break;
				}
				case "assistant":
					assistant += charsOf(message.content, textChars);
					thinking += charsOf(message.content, (b) => (b.type === "thinking" ? b.thinking.length : 0));
					toolCalls += charsOf(message.content, (b) =>
						b.type === "toolCall" ? b.name.length + JSON.stringify(b.arguments ?? {}).length : 0,
					);
					break;
				case "toolResult":
					toolResults += charsOf((message as Extract<ModelMessage, { role: "toolResult" }>).content, textChars);
					break;
				default:
					summaries += JSON.stringify((message as { content?: unknown }).content ?? "").length;
			}
		}
	}

	const sectionDetail = [...sections].map(([key, chars]) => ({ label: SECTION_NAMES[key] ?? key, tokens: chars }));
	const toolDetail = [...tools].map(([name, chars]) => ({ label: name, tokens: chars })).sort((a, b) => b.tokens - a.tokens);
	const parts: ContextPart[] = [
		{ label: "System prompt", tokens: sectionDetail.reduce((s, d) => s + d.tokens, 0), detail: sectionDetail },
		{ label: "Tool definitions", tokens: toolDetail.reduce((s, d) => s + d.tokens, 0), detail: toolDetail },
		{ label: "Your messages", tokens: user },
		{ label: "Replies", tokens: assistant },
		{ label: "Thinking", tokens: thinking },
		{ label: "Tool calls", tokens: toolCalls },
		{ label: "Tool results", tokens: toolResults },
		{ label: "Summaries", tokens: summaries },
	].filter((part) => part.tokens > 0);

	const estimated = parts.reduce((sum, p) => sum + estimateTokens(p.tokens), 0);
	const scale = actualTokens !== undefined && estimated > 0 ? actualTokens / estimated : 1;
	const size = (chars: number) => estimateTokens(chars) * scale;
	return parts.map((part) => ({
		label: part.label,
		tokens: size(part.tokens),
		...(part.detail && part.detail.length > 0
			? { detail: part.detail.map((d) => ({ label: d.label, tokens: size(d.tokens) })) }
			: {}),
	}));
};
