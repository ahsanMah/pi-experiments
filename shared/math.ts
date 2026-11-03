/**
 * `[` … `]` on lines of their own around LaTeX is a display-math block whose backslashes were lost
 * (`\[` … `\]`); put them back so Markdown renderers that know `\[` typeset it. Only blocks holding a
 * LaTeX command count, so an ordinary bracketed list stays as written.
 */
export const restoreMathBrackets = (text: string): string =>
	text.replace(/(^|\n)( {0,3})\[[ \t]*\n([^\n]*\\[A-Za-z][\s\S]*?)\n {0,3}\][ \t]*(?=\n|$)/g, (_, start: string, indent: string, body: string) => `${start}${indent}\\[\n${body}\n\\]`);
