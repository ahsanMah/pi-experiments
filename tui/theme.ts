// Terminal styles for the branches TUI, in the shape pi-tui's components take
// (the same theme objects pi-tui's own tests and the coding agent pass).
import { type EditorTheme, type MarkdownTheme, type SelectListTheme, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Pad (or cut) a line to exactly `width`, so an overlay fully covers what is under it. */
export const fill = (line: string, width: number): string => {
	const cut = truncateToWidth(line, width);
	return cut + " ".repeat(Math.max(0, width - visibleWidth(cut)));
};

const sgr = (open: string, close: string) => (text: string) => `\x1b[${open}m${text}\x1b[${close}m`;

export const style = {
	bold: sgr("1", "22"),
	dim: sgr("2", "22"),
	italic: sgr("3", "23"),
	underline: sgr("4", "24"),
	strike: sgr("9", "29"),
	inverse: sgr("7", "27"),
	red: sgr("31", "39"),
	green: sgr("32", "39"),
	yellow: sgr("33", "39"),
	blue: sgr("34", "39"),
	magenta: sgr("35", "39"),
	cyan: sgr("36", "39"),
	gray: sgr("90", "39"),
	userBg: sgr("48;5;236", "49"),
	selectedBg: sgr("48;5;238", "49"),
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
