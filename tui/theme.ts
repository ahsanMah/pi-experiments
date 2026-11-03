// Terminal styles for the branches TUI, in the shape pi-tui's components take
// (the same theme objects pi-tui's own tests and the coding agent pass).
import { type EditorTheme, type MarkdownTheme, type SelectListTheme, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Pad (or cut) a line to exactly `width`, so an overlay fully covers what is under it. */
export const fill = (line: string, width: number): string => {
	const cut = truncateToWidth(line, width);
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
};

const sgr = (open: string, close: string) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;

/** The colors a theme picks: SGR parameters for each role (foreground or background). */
export type Palette = {
	red: string;
	green: string;
	yellow: string;
	blue: string;
	magenta: string;
	cyan: string;
	gray: string;
	userBg: string;
	selectedBg: string;
	toolBg: string;
	toolErrorBg: string;
};

export const THEMES: Record<string, Palette> = {
	dark: {
		red: "31",
		green: "32",
		yellow: "33",
		blue: "34",
		magenta: "35",
		cyan: "36",
		gray: "90",
		userBg: "48;5;236",
		selectedBg: "48;5;238",
		toolBg: "48;5;234",
		toolErrorBg: "48;5;52",
	},
	light: {
		red: "38;5;160",
		green: "38;5;28",
		yellow: "38;5;130",
		blue: "38;5;25",
		magenta: "38;5;127",
		cyan: "38;5;30",
		gray: "38;5;244",
		userBg: "48;5;254",
		selectedBg: "48;5;252",
		toolBg: "48;5;255",
		toolErrorBg: "48;5;224",
	},
	"high-contrast": {
		red: "91",
		green: "92",
		yellow: "93",
		blue: "94",
		magenta: "95",
		cyan: "96",
		gray: "37",
		userBg: "48;5;238",
		selectedBg: "44",
		toolBg: "48;5;235",
		toolErrorBg: "41",
	},
	mono: {
		red: "1",
		green: "39",
		yellow: "39",
		blue: "4",
		magenta: "39",
		cyan: "1",
		gray: "2",
		userBg: "7",
		selectedBg: "7",
		toolBg: "49",
		toolErrorBg: "49",
	},
};

const CLOSE: Record<keyof Palette, string> = {
	red: "39",
	green: "39",
	yellow: "39",
	blue: "39",
	magenta: "39",
	cyan: "39",
	gray: "39",
	userBg: "49",
	selectedBg: "49",
	toolBg: "49",
	toolErrorBg: "49",
};

let themeName = process.env.PI_BRANCHES_THEME !== undefined && process.env.PI_BRANCHES_THEME in THEMES ? process.env.PI_BRANCHES_THEME : "dark";
let palette: Palette = THEMES[themeName]!;

export const currentTheme = (): string => themeName;

/** Switch the theme; styled text rendered after this uses the new colors. False for an unknown name. */
export const setTheme = (name: string): boolean => {
	const next = THEMES[name];
	if (next === undefined) return false;
	themeName = name;
	palette = next;
	return true;
};

// Mono's "colors" are attributes (bold, reverse…), so close with a full reset of that attribute.
const closeOf = (role: keyof Palette, open: string): string =>
	open === "1" || open === "2" ? "22" : open === "4" ? "24" : open === "7" ? "27" : CLOSE[role];

/** A color role resolved against the current theme at call time. */
const role = (key: keyof Palette) => (text: string) => {
	const open = palette[key];
	return `\x1b[${open}m${text}\x1b[${closeOf(key, open)}m`;
};

export const style = {
	bold: sgr("1", "22"),
	dim: sgr("2", "22"),
	italic: sgr("3", "23"),
	underline: sgr("4", "24"),
	strike: sgr("9", "29"),
	inverse: sgr("7", "27"),
	red: role("red"),
	green: role("green"),
	yellow: role("yellow"),
	blue: role("blue"),
	magenta: role("magenta"),
	cyan: role("cyan"),
	gray: role("gray"),
	userBg: role("userBg"),
	selectedBg: role("selectedBg"),
	toolBg: role("toolBg"),
	toolErrorBg: role("toolErrorBg"),
};

export const selectListTheme: SelectListTheme = {
	selectedPrefix: style.cyan,
	selectedText: style.bold,
	description: style.dim,
	scrollInfo: style.dim,
	noMatch: style.dim,
};

export const markdownTheme: MarkdownTheme = {
	heading: (text) => style.bold(style.cyan(text)),
	link: style.blue,
	linkUrl: style.dim,
	code: style.yellow,
	codeBlock: style.green,
	codeBlockBorder: style.dim,
	quote: style.italic,
	quoteBorder: style.dim,
	hr: style.dim,
	listBullet: style.cyan,
	bold: style.bold,
	italic: style.italic,
	strikethrough: style.strike,
	underline: style.underline,
};

export const editorTheme: EditorTheme = {
	borderColor: style.dim,
	selectList: selectListTheme,
};

export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
