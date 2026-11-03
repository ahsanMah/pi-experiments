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

/** Rough token count of text: about four characters per token. */
export const estimateTokens = (chars: number): number => chars / 4;
