// Small display helpers shared by the web and terminal clients.
import type { BranchInfo } from "./protocol.ts";

/** 950 → "950", 12_345 → "12.3k", 1_000_000 → "1M". */
export const formatTokens = (n: number): string => {
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

/** Share of the model's window in use, 0–1, when the window is known. */
export const contextShare = (branch: BranchInfo): number | undefined =>
	branch.context?.window ? Math.min(1, branch.context.tokens / branch.context.window) : undefined;

/** "12.3k / 200k (6%)", or just "12.3k" without a known window. */
export const formatContext = (branch: BranchInfo): string | undefined => {
	const context = branch.context;
	if (context === undefined) return undefined;
	const share = contextShare(branch);
	return share === undefined
		? `${formatTokens(context.tokens)} tokens`
		: `${formatTokens(context.tokens)} / ${formatTokens(context.window!)} (${Math.round(share * 100)}%)`;
};

export const formatSpeed = (tokensPerSecond: number): string =>
	`${tokensPerSecond.toFixed(tokensPerSecond < 10 ? 1 : 0)} tok/s`;

type PartialBlock = { type: string; text?: string; thinking?: string; arguments?: unknown };
type Generation = { attempt?: number; message?: { content?: unknown; timestamp?: number } } | undefined;

/** Rough token count of text: about four characters per token. */
export const estimateTokens = (chars: number): number => chars / 4;

/** Characters the model has written so far in a partial answer: text, thinking and tool-call arguments. */
export const writtenChars = (content: unknown): number => {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let chars = 0;
	for (const block of content as PartialBlock[]) {
		if (block.type === "text") chars += block.text?.length ?? 0;
		else if (block.type === "thinking") chars += block.thinking?.length ?? 0;
		else if (block.type === "toolCall") chars += JSON.stringify(block.arguments ?? {}).length;
	}
	return chars;
};

/**
 * Output speed of the answer being streamed, from the throttled partial in `pi.live`. The clock starts at the
 * first written character, so time to first token doesn't count; token counts are estimated from characters.
 */
export class LiveSpeed {
	#key: string | undefined;
	#start: { at: number; chars: number } | undefined;

	/** Tokens per second so far, or undefined while nothing is streaming or it is too early to say. */
	update(generation: Generation, now = Date.now()): number | undefined {
		const message = generation?.message;
		if (message === undefined) {
			this.#key = undefined;
			this.#start = undefined;
			return undefined;
		}
		const key = `${message.timestamp ?? ""}:${generation?.attempt ?? ""}`;
		if (key !== this.#key) {
			this.#key = key;
			this.#start = undefined;
		}
		const chars = writtenChars(message.content);
		if (chars === 0) return undefined;
		if (this.#start === undefined) {
			this.#start = { at: now, chars };
			return undefined;
		}
		const seconds = (now - this.#start.at) / 1000;
		if (seconds < 0.5) return undefined;
		return estimateTokens(chars - this.#start.chars) / seconds;
	}
}
