// Small modal dialogs shown as pi-tui overlays: a one-line prompt and a pick list.
import {
	type Component,
	type Focusable,
	Input,
	isKeyRepeat,
	Key,
	Markdown,
	matchesKey,
	type SelectItem,
	SelectList,
	type TUI,
} from "@earendil-works/pi-tui";
import { fill, markdownTheme, selectListTheme, style } from "./theme.ts";

const frame = (title: string, body: string[], hint: string, width: number): string[] => {
	const border = style.dim("─".repeat(Math.max(1, width)));
	return [border, style.bold(` ${title}`), ...body, style.dim(` ${hint}`), border].map((line) => fill(line, width));
};

class PromptDialog implements Component, Focusable {
	readonly #input = new Input();
	readonly #title: string;
	#focused = false;

	constructor(title: string, initial: string, done: (value: string | undefined) => void) {
		this.#title = title;
		this.#input.setValue(initial);
		this.#input.onSubmit = (value) => done(value);
		this.#input.onEscape = () => done(undefined);
	}

	get focused(): boolean {
		return this.#focused;
	}
	set focused(value: boolean) {
		this.#focused = value;
		this.#input.focused = value;
	}

	render(width: number): string[] {
		return frame(this.#title, this.#input.render(width), "enter confirm · esc cancel", width);
	}

	handleInput(data: string): void {
		this.#input.handleInput(data);
	}

	invalidate(): void {
		this.#input.invalidate();
	}
}

class PickDialog implements Component {
	readonly #list: SelectList;
	readonly #title: string;

	constructor(title: string, items: SelectItem[], done: (value: string | undefined) => void) {
		this.#title = title;
		this.#list = new SelectList(items, Math.min(12, items.length), selectListTheme);
		this.#list.onSelect = (item) => done(item.value);
		this.#list.onCancel = () => done(undefined);
	}

	render(width: number): string[] {
		return frame(this.#title, this.#list.render(width), "↑↓ move · enter choose · esc cancel", width);
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			if (!isKeyRepeat(data)) this.#list.onCancel?.();
			return;
		}
		this.#list.handleInput(data);
	}

	invalidate(): void {
		this.#list.invalidate();
	}
}

/** Ask for one line of text; resolves undefined on escape. */
export const prompt = (tui: TUI, title: string, initial = ""): Promise<string | undefined> =>
	new Promise((resolve) => {
		const dialog: PromptDialog = new PromptDialog(title, initial, (value) => {
			handle.hide();
			resolve(value);
		});
		const handle = tui.showOverlay(dialog, { width: "70%", minWidth: 40, anchor: "center" });
	});

/** Pick one item; resolves undefined on escape. */
export const pick = (tui: TUI, title: string, items: SelectItem[]): Promise<string | undefined> =>
	new Promise((resolve) => {
		const dialog = new PickDialog(title, items, (value) => {
			handle.hide();
			resolve(value);
		});
		const handle = tui.showOverlay(dialog, { width: "70%", minWidth: 40, anchor: "center" });
	});

const READER_LINES = 18;

/** Markdown text with a heading line, scrolled with the arrow keys; actions are single keys. */
class ReaderDialog implements Component {
	readonly #title: string;
	readonly #meta: string;
	readonly #body: Markdown;
	readonly #actions: readonly { key: string; label: string }[];
	readonly #done: (action: string | undefined) => void;
	#top = 0;
	#lines = 0;

	constructor(title: string, meta: string, text: string, actions: readonly { key: string; label: string }[], done: (action: string | undefined) => void) {
		this.#title = title;
		this.#meta = meta;
		this.#body = new Markdown(text, 1, 0, markdownTheme);
		this.#actions = actions;
		this.#done = done;
	}

	render(width: number): string[] {
		const lines = this.#body.render(width);
		this.#lines = lines.length;
		this.#top = Math.max(0, Math.min(this.#top, lines.length - READER_LINES));
		const shown = lines.slice(this.#top, this.#top + READER_LINES);
		const more = lines.length > READER_LINES ? ` · ${this.#top + 1}–${this.#top + shown.length} of ${lines.length} lines, ↑↓ scroll` : "";
		const keys = [...this.#actions.map((action) => `${action.key} ${action.label}`), "esc back"].join(" · ");
		return frame(this.#title, [style.dim(` ${this.#meta}`), "", ...shown], keys + more, width);
	}

	handleInput(data: string): void {
		const once = !isKeyRepeat(data);
		if (once && (matchesKey(data, Key.escape) || data === "q")) this.#done(undefined);
		else if (matchesKey(data, Key.up)) this.#top = Math.max(0, this.#top - 1);
		else if (matchesKey(data, Key.down)) this.#top = Math.min(Math.max(0, this.#lines - READER_LINES), this.#top + 1);
		else if (matchesKey(data, Key.pageUp)) this.#top = Math.max(0, this.#top - READER_LINES);
		else if (matchesKey(data, Key.pageDown)) this.#top = Math.min(Math.max(0, this.#lines - READER_LINES), this.#top + READER_LINES);
		else if (once) {
			const action = this.#actions.find((a) => a.key === data);
			if (action !== undefined) this.#done(action.key);
		}
	}

	invalidate(): void {
		this.#body.invalidate();
	}
}

/** Show text to read; resolves with the action key pressed, or undefined on escape. */
export const read = (
	tui: TUI,
	title: string,
	meta: string,
	text: string,
	actions: readonly { key: string; label: string }[] = [],
): Promise<string | undefined> =>
	new Promise((resolve) => {
		const dialog = new ReaderDialog(title, meta, text, actions, (action) => {
			handle.hide();
			resolve(action);
		});
		const handle = tui.showOverlay(dialog, { width: "80%", minWidth: 40, anchor: "center" });
	});
