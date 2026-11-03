// The per-directory identity of a server: a `<slug>.localhost` hostname and a default port,
// both derived from the directory it runs in, so two projects can run at once and the browser
// keeps their localStorage (canvas positions, theme, panel width) apart on separate origins.
//
// Browsers resolve any `*.localhost` name to loopback themselves, with no /etc/hosts entry.
// The OS resolver on Linux and macOS generally does not, so non-browser clients (the terminal
// client, the scripts, curl) use 127.0.0.1 with the same port.

/** FNV-1a over the path: stable across runs and platforms, unlike a seeded or hashed object. */
const hash = (text: string): number => {
	let value = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		value ^= text.charCodeAt(index);
		value = Math.imul(value, 0x01000193) >>> 0;
	}
	return value;
};

/** Lowest port tried, and how many are tried above it when one is taken. */
export const PORT_BASE = 8800;
export const PORT_SPAN = 1000;
export const PORT_PROBES = 10;

/** Drop trailing separators, so `/a/notes` and `/a/notes/` are one directory. */
const normalize = (path: string): string => path.replace(/[/\\]+$/, "") || path.slice(0, 1);
const basename = (path: string): string => path.split(/[/\\]/).pop() ?? "";

/**
 * `{ slug, host, port }` for a directory. The slug ends in 4 hex characters of the full path, so
 * same-named directories (`~/a/notes`, `~/b/notes`) get different origins and different ports.
 */
export const siteForCwd = (cwd: string): { slug: string; host: string; port: number } => {
	const path = normalize(cwd);
	const digest = hash(path);
	const name = basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
	const slug = `${name === "" ? "dir" : name}-${(digest & 0xffff).toString(16).padStart(4, "0")}`;
	return { slug, host: `${slug}.localhost`, port: PORT_BASE + (digest % PORT_SPAN) };
};
