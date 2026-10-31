// The active branch's transcript: committed entries of its ConversationView, then the
// live partial answer and tool round from docs["pi.live"]. Entries are immutable, so
// each entry's components are built once and reused across commits.
import { Box, type Component, Container, Markdown, Spacer, Text, TruncatedText } from "@earendil-works/pi-tui";
import type { BranchInfo, BranchSuggestion, SharedNote } from "../shared/protocol.ts";
import type { ConversationView, LiveToolSlot, ViewEntry } from "./client.ts";
import { currentTheme, markdownTheme, style } from "./theme.ts";

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };

const blocksOf = (content: unknown): Block[] =>
	typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? (content as Block[]) : [];

const textOf = (content: unknown): string =>
	blocksOf(content)
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");

const brief = (value: unknown, max = 80): string => {
	const text = (typeof value === "string" ? value : JSON.stringify(value) ?? "").replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** How collapsible parts of the transcript are shown; toggled from the keyboard. */
export type TranscriptOptions = { showThinking: boolean; expandTools: boolean };

const COLLAPSED_TOOL_LINES = 6;
const MAX_TOOL_LINES = 400;

/** Lines of a tool call's arguments: `key: value` per field, values cut short unless expanded. */
const argumentLines = (args: unknown, expanded: boolean): string[] => {
	if (args === undefined || args === null) return [];
	if (typeof args !== "object" || Array.isArray(args)) return (typeof args === "string" ? args : JSON.stringify(args, null, 2)).split("\n");
	const lines: string[] = [];
	for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
		const text = typeof value === "string" ? value : JSON.stringify(value, null, expanded ? 2 : undefined) ?? "";
		const valueLines = text.split("\n");
		if (!expanded) {
			const more = valueLines.length > 1 ? style.dim(` (+${valueLines.length - 1} lines)`) : "";
			lines.push(`${style.cyan(key)}: ${brief(valueLines[0], 100)}${more}`);
		} else if (valueLines.length === 1) {
			lines.push(`${style.cyan(key)}: ${text}`);
		} else {
			lines.push(`${style.cyan(key)}:`, ...valueLines.map((line) => `  ${line}`));
		}
	}
	return lines;
};

/** A boxed block: a header line over body lines, on the tool background. */
const toolBox = (header: string, body: string[], bg: (text: string) => string): Component => {
	const box = new Box(1, 0, bg);
	box.addChild(new TruncatedText(header, 0, 0));
	if (body.length > 0) box.addChild(new Text(body.join("\n"), 0, 0));
	return box;
};

const toolCallBlock = (block: Block, options: TranscriptOptions, status?: string): Component =>
	toolBox(
		`${status ?? style.yellow("⚙")} ${style.bold(style.yellow(block.name ?? "tool"))}`,
		argumentLines(block.arguments, options.expandTools).map((line) => style.gray(line)),
		style.toolBg,
	);

/** A tool's output, its first lines only while collapsed. */
const outputLines = (output: string, expanded: boolean): string[] => {
	const lines = output.replace(/\s+$/, "").split("\n");
	if (lines.length === 1 && lines[0] === "") return [style.dim("(no output)")];
	const keep = expanded ? MAX_TOOL_LINES : COLLAPSED_TOOL_LINES;
	if (lines.length <= keep) return lines;
	const hint = expanded ? "" : " · ctrl+x to expand";
	return [...lines.slice(0, keep), style.dim(`… ${lines.length - keep} more lines${hint}`)];
};

const toolResultBlock = (name: string, output: string, isError: boolean, options: TranscriptOptions): Component =>
	toolBox(
		isError ? style.red(`↳ ${name} failed`) : style.green(`↳ ${name}`),
		outputLines(output, options.expandTools).map((line) => style.gray(line)),
		isError ? style.toolErrorBg : style.toolBg,
	);

/** Thinking: a one-line summary while collapsed, the full text while shown. */
const thinkingBlock = (thinking: string, options: TranscriptOptions): Component[] => {
	const lines = thinking.trim().split("\n").length;
	if (!options.showThinking) {
		return [new TruncatedText(style.dim(style.italic(`  ▸ Thinking · ${lines} line${lines === 1 ? "" : "s"} · ctrl+t to show`)), 1, 0)];
	}
	return [
		new TruncatedText(style.dim(style.italic("  ▾ Thinking · ctrl+t to hide")), 1, 0),
		new Markdown(thinking, 3, 0, markdownTheme, { color: style.dim, italic: true }),
	];
};

const thinkingOf = (blocks: Block[]): string =>
	blocks
		.filter((block) => block.type === "thinking")
		.map((block) => block.thinking ?? "")
		.join("");

/** Components for one committed entry; empty for entries the transcript doesn't show. */
const renderEntry = (entry: ViewEntry, options: TranscriptOptions): Component[] => {
	const message = entry.model?.[0];
	switch (entry.kind) {
		case "pi.user":
			return [new Spacer(1), new Markdown(textOf(message?.content), 1, 0, markdownTheme, { bgColor: style.userBg })];
		case "pi.assistant": {
			const parts: Component[] = [];
			const blocks = blocksOf(message?.content);
			const thinking = thinkingOf(blocks);
			if (thinking.trim() !== "") parts.push(new Spacer(1), ...thinkingBlock(thinking, options));
			const text = textOf(message?.content);
			if (text.trim() !== "") parts.push(new Spacer(1), new Markdown(text, 1, 0, markdownTheme));
			for (const block of blocks) if (block.type === "toolCall") parts.push(new Spacer(1), toolCallBlock(block, options));
			return parts;
		}
		case "pi.tool-result":
			return [toolResultBlock(String(message?.toolName ?? "result"), textOf(message?.content), message?.isError === true, options)];
		case "branches.shared":
			return []; // drawn by sharedMarker, since a note can be unshared later
		case "pi.compaction":
			return [new Spacer(1), new TruncatedText(style.dim("  ⋯ earlier context compacted"), 1, 0)];
		case "pi.reset":
			return [new Spacer(1), new TruncatedText(style.dim("  ⟲ context reset"), 1, 0)];
		default:
			return [];
	}
};

const NOTE_PREVIEW_LINES = 6;

/** The marker of a note shared into this branch, with the start of its text. */
const sharedMarker = (entry: ViewEntry, notes: readonly SharedNote[]): Component[] => {
	const data = entry.data as { noteId?: string; title?: string } | undefined;
	const note = notes.find((n) => n.id === data?.noteId);
	const head = new TruncatedText(style.magenta(`  ⇄ Shared into this branch: ${data?.title ?? "context"}${note ? "" : " (unshared)"}`), 1, 0);
	if (note === undefined) return [new Spacer(1), head];
	const lines = note.text.split("\n");
	const preview = lines.slice(0, NOTE_PREVIEW_LINES).join("\n");
	const rest = lines.length > NOTE_PREVIEW_LINES ? `\n\n_${lines.length - NOTE_PREVIEW_LINES} more lines: /notes to read it all_` : "";
	return [new Spacer(1), head, new Markdown(preview + rest, 4, 0, markdownTheme, { color: style.dim })];
};

const liveToolBlock = (slot: LiveToolSlot, spinner: string, options: TranscriptOptions): Component => {
	const icon = slot.status === "done" ? style.green("✓") : style.yellow(spinner);
	const output = typeof slot.output === "string" && slot.output.trim() !== "" ? outputLines(slot.output, options.expandTools) : [];
	// Live output is a stream: while collapsed, its latest lines matter more than its first.
	const tail = options.expandTools || typeof slot.output !== "string" ? output : slot.output.replace(/\s+$/, "").split("\n").slice(-COLLAPSED_TOOL_LINES);
	return toolBox(`${icon} ${style.bold(style.yellow(slot.name ?? "tool"))}`, tail.map((line) => style.gray(line)), style.toolBg);
};

export class TranscriptView extends Container {
	readonly #cache = new Map<number, Component[]>();
	#conversationId: number | undefined;
	#options: TranscriptOptions = { showThinking: false, expandTools: false };
	#theme = currentTheme();

	get options(): TranscriptOptions {
		return this.#options;
	}

	/** Change what is collapsed; committed entries are rebuilt on the next update. */
	setOptions(options: Partial<TranscriptOptions>): void {
		this.#options = { ...this.#options, ...options };
		this.#cache.clear();
	}

	/** Rebuild from the view; `branches` names the parent at the fork boundary. */
	update(
		conversationId: number,
		view: ConversationView | undefined,
		branches: readonly BranchInfo[],
		notes: readonly SharedNote[],
		suggestions: readonly BranchSuggestion[],
		spinner: string,
	): void {
		if (conversationId !== this.#conversationId || this.#theme !== currentTheme()) {
			this.#theme = currentTheme();
			this.#cache.clear();
			this.#conversationId = conversationId;
		}
		this.clear();
		if (view === undefined) {
			this.addChild(new Text(style.dim("Loading branch…"), 1, 1));
			return;
		}
		const branch = branches.find((b) => b.id === conversationId);
		let inherited = false;
		let crossedFork = false;
		for (const entry of view.entries) {
			const own = entry.conversationId === conversationId;
			if (!own && !inherited) inherited = true;
			if (own && inherited && !crossedFork) {
				crossedFork = true;
				const parent = branches.find((b) => b.id === branch?.parent?.conversationId);
				this.addChild(new Spacer(1));
				this.addChild(
					new TruncatedText(style.cyan(`── ⑂ branched from "${parent?.title || "another branch"}" — "${branch?.title || "this branch"}" continues here ──`), 1, 0),
				);
			}
			if (entry.kind === "branches.shared") {
				for (const part of sharedMarker(entry, notes)) this.addChild(part);
				continue;
			}
			let parts = this.#cache.get(entry.id);
			if (parts === undefined) {
				parts = renderEntry(entry, this.#options);
				this.#cache.set(entry.id, parts);
			}
			for (const part of parts) this.addChild(part);
		}

		const live = view.docs["pi.live"];
		const partial = live?.generation?.message?.content;
		if (partial !== undefined) {
			const thinking = thinkingOf(blocksOf(partial));
			if (thinking.trim() !== "") {
				this.addChild(new Spacer(1));
				for (const part of thinkingBlock(thinking, this.#options)) this.addChild(part);
			}
			const text = textOf(partial);
			if (text.trim() !== "") {
				this.addChild(new Spacer(1));
				this.addChild(new Markdown(text, 1, 0, markdownTheme));
			}
			for (const block of blocksOf(partial)) {
				if (block.type !== "toolCall") continue;
				this.addChild(new Spacer(1));
				this.addChild(toolCallBlock(block, this.#options));
			}
		}
		for (const slot of live?.tools ?? []) if (slot.status !== "done") this.addChild(liveToolBlock(slot, spinner, this.#options));
		if (live?.generation?.retry !== undefined) {
			this.addChild(new TruncatedText(style.red(`  retrying: ${brief(live.generation.retry.error, 100)}`), 1, 0));
		}
		if (live?.run !== undefined) this.addChild(new TruncatedText(style.cyan(`  ${spinner} working…`), 1, 0));
		for (const suggestion of suggestions.filter((s) => s.conversationId === conversationId)) {
			this.addChild(new Spacer(1));
			this.addChild(new TruncatedText(style.yellow(`  ✦ Suggested branch: ${suggestion.title}`) + style.dim(" · /suggestions to open or dismiss"), 1, 0));
			this.addChild(new TruncatedText(style.dim(`    ${suggestion.reason}`), 1, 0));
		}
		this.addChild(new Spacer(1));
	}
}
