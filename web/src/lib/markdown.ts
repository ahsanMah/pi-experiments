import katex from "katex";
import "katex/dist/katex.min.css";
import { Marked, type TokenizerAndRendererExtension } from "marked";

const escape = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Math is typeset with KaTeX. Delimiters follow pi-tui's Markdown component ($$…$$ and \[…\] blocks,
// $…$ and \(…\) inline), plus a `[` … `]` block on lines of their own: what a model's \[ … \] turns
// into once something on the way ate the backslashes. That one counts only when it reads as LaTeX.
const tex = (source: string, displayMode: boolean): string => {
	try {
		return katex.renderToString(source, { displayMode, throwOnError: false, output: "htmlAndMathml" });
	} catch {
		return escape(source);
	}
};

type MathToken = { type: string; raw: string; text: string };

const blockPatterns = [
	/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/,
	/^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n|$)/,
	// Bare brackets: `[` and `]` alone on their lines, with a LaTeX command between them.
	/^ {0,3}\[[ \t]*\n([\s\S]*?\\[A-Za-z][\s\S]*?)\n {0,3}\][ \t]*(?:\n|$)/,
];

const mathBlock: TokenizerAndRendererExtension = {
	name: "mathBlock",
	level: "block",
	start: (src) => /(?:^|\n) {0,3}(?:\$\$|\\\[|\[[ \t]*\n)/.exec(src)?.index,
	tokenizer(src) {
		for (const pattern of blockPatterns) {
			const match = pattern.exec(src);
			if (match !== null) return { type: "mathBlock", raw: match[0], text: match[1]!.trim() };
		}
		return undefined;
	},
	renderer: (token) => `<div class="math-block">${tex((token as MathToken).text, true)}</div>\n`,
};

const inlinePatterns: [RegExp, boolean][] = [
	[/^\$\$([^$]+?)\$\$/, true],
	[/^\\\[([\s\S]+?)\\\]/, true],
	[/^\\\(([\s\S]+?)\\\)/, false],
	// $…$ with no space just inside either dollar and no digit right after, so "$5 and $10" stays text.
	[/^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/, false],
];

const mathInline: TokenizerAndRendererExtension = {
	name: "mathInline",
	level: "inline",
	start: (src) => {
		const indices = [src.indexOf("$"), src.indexOf("\\("), src.indexOf("\\[")].filter((index) => index >= 0);
		return indices.length === 0 ? undefined : Math.min(...indices);
	},
	tokenizer(src) {
		for (const [pattern, display] of inlinePatterns) {
			const match = pattern.exec(src);
			if (match !== null) return { type: "mathInline", raw: match[0], text: match[1]!.trim(), display };
		}
		return undefined;
	},
	renderer: (token) => tex((token as MathToken).text, (token as MathToken & { display: boolean }).display),
};

// Model output is untrusted: raw HTML in it renders as text, never as markup.
const marked = new Marked({
	gfm: true,
	breaks: true,
	extensions: [mathBlock, mathInline],
	renderer: {
		html: ({ text }) => escape(text),
		link: ({ href, text }) =>
			/^(https?:|mailto:)/i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noreferrer noopener">${text}</a>` : text,
		image: ({ text }) => escape(text),
	},
});

export const renderMarkdown = (text: string): string => marked.parse(text, { async: false });
