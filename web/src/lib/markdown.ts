import { Marked } from "marked";

const escape = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Model output is untrusted: raw HTML in it renders as text, never as markup.
const marked = new Marked({
	gfm: true,
	breaks: true,
	renderer: {
		html: ({ text }) => escape(text),
		link: ({ href, text }) =>
			/^(https?:|mailto:)/i.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noreferrer noopener">${text}</a>` : text,
		image: ({ text }) => escape(text),
	},
});

export const renderMarkdown = (text: string): string => marked.parse(text, { async: false });
