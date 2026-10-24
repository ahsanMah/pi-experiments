// Small modal dialogs shown as pi-tui overlays: a one-line prompt and a pick list.
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	type TUI,
} from "@earendil-works/pi-tui";
import { fill, selectListTheme, style } from "./theme.ts";

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
			this.#list.onCancel?.();
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
