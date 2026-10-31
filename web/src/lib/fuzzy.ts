// Fuzzy matching for the command palette (from the mission-control variant).

/** Subsequence match: a higher score for runs and word starts. Returns matched indices to highlight. */
export const fuzzy = (query: string, text: string): { score: number; hits: number[] } | null => {
	const q = query.toLowerCase().replace(/\s+/g, " ").trim();
	if (q === "") return { score: 0, hits: [] };
	const t = text.toLowerCase();
	// A plain substring always wins over a scattered match.
	const at = t.indexOf(q);
	if (at >= 0) {
		const boundary = at === 0 || /\W/.test(t[at - 1]!);
		return { score: 1000 - at + (boundary ? 200 : 0) - t.length * 0.1, hits: [...Array(q.length).keys()].map((i) => at + i) };
	}
	const hits: number[] = [];
	let score = 0;
	let ti = 0;
	for (const ch of q) {
		if (ch === " ") continue;
		const found = t.indexOf(ch, ti);
		if (found < 0) return null;
		const prev = hits[hits.length - 1];
		score += prev !== undefined && found === prev + 1 ? 8 : 1;
		if (found === 0 || /\W/.test(t[found - 1]!)) score += 6;
		hits.push(found);
		ti = found + 1;
	}
	return { score: score - t.length * 0.05, hits };
};

/** Split text into highlighted and plain runs for a list of hit indices. */
export const highlight = (text: string, hits: readonly number[]): { text: string; hit: boolean }[] => {
	const set = new Set(hits);
	const out: { text: string; hit: boolean }[] = [];
	for (let i = 0; i < text.length; i++) {
		const hit = set.has(i);
		const last = out[out.length - 1];
		if (last !== undefined && last.hit === hit) last.text += text[i];
		else out.push({ text: text[i]!, hit });
	}
	return out;
};
