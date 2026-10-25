<script lang="ts" module>
	// ⌘K / Ctrl+K command palette: branches, message search and actions, with pages to drill into
	// (pick targets, type a title). After the mission-control variant's palette.
	export type PaletteItem = {
		id: string;
		label: string;
		group: string;
		detail?: string;
		icon?: string;
		hue?: number;
		shortcut?: string;
		keywords?: string;
		/** Only listed once the query is long enough, like message search. */
		searchOnly?: boolean;
		/** Return a page to drill into, or nothing to close the palette. */
		run: () => PalettePage | void | Promise<void>;
		/** ⌘/Ctrl+Enter action. */
		alt?: { label: string; run: () => void | Promise<void> };
	};

	export type Option = { value: number | "*"; label: string; hue?: number; detail?: string };

	export type PalettePage =
		| { kind: "list"; title: string; placeholder: string; items: PaletteItem[] }
		| {
				kind: "multi";
				title: string;
				placeholder: string;
				options: Option[];
				initial: (number | "*")[];
				confirmLabel: (count: number) => string;
				confirm: (values: number[] | "*") => PalettePage | void | Promise<void>;
		  }
		| { kind: "input"; title: string; placeholder: string; initial?: string; confirmLabel: string; submit: (text: string) => PalettePage | void | Promise<void> };
</script>

<script lang="ts">
	import { tick, untrack } from "svelte";
	import { fuzzy, highlight } from "../lib/fuzzy.ts";

	type Props = { items: PaletteItem[]; start?: PalettePage; close: () => void };
	let { items, start, close }: Props = $props();

	// The root page is the live command list; drilled pages stack on top of it.
	let stack = $state<PalettePage[]>([]);
	let query = $state("");
	let cursor = $state(0);
	let picked = $state<Set<number | "*">>(new Set());
	let busy = $state(false);
	let error = $state("");
	let field: HTMLInputElement | undefined = $state();
	let list: HTMLElement | undefined = $state();

	const page = $derived(stack[stack.length - 1]);

	const push = (next: PalettePage) => {
		stack = [...stack, next];
		query = next.kind === "input" ? (next.initial ?? "") : "";
		picked = new Set(next.kind === "multi" ? next.initial : []);
		cursor = 0;
		error = "";
		void tick().then(() => field?.select());
	};
	const pop = () => {
		stack = stack.slice(0, -1);
		query = "";
		cursor = 0;
		error = "";
	};
	$effect(() => {
		untrack(() => start !== undefined && push(start));
		void tick().then(() => field?.focus());
	});

	type Shown = { item: PaletteItem; hits: number[] };
	const shown = $derived.by((): { group: string; rows: Shown[] }[] => {
		const source = page?.kind === "list" ? page.items : page === undefined ? items : [];
		const q = query.trim();
		const scored: (Shown & { score: number })[] = [];
		for (const item of source) {
			if (item.searchOnly && q.length < 2) continue;
			// Long free text (messages) matches by words, or every short query would hit every message.
			if (item.searchOnly && !q.toLowerCase().split(/\s+/).every((word) => item.label.toLowerCase().includes(word))) continue;
			const match = fuzzy(q, `${item.label} ${item.keywords ?? ""} ${item.detail ?? ""}`);
			if (match === null) continue;
			const own = fuzzy(q, item.label);
			scored.push({ item, hits: own?.hits ?? [], score: match.score + (own !== null ? 50 : 0) });
		}
		const groups = new Map<string, (Shown & { score: number })[]>();
		for (const row of scored) groups.set(row.item.group, [...(groups.get(row.item.group) ?? []), row]);
		const out = [...groups.entries()].map(([group, rows]) => {
			if (q !== "") rows.sort((a, b) => b.score - a.score);
			return { group, rows: rows.slice(0, rows[0]?.item.searchOnly ? 8 : 40), best: rows[0]?.score ?? 0 };
		});
		// With a query the best match leads; without one the given order is the menu.
		if (q !== "") out.sort((a, b) => b.best - a.best);
		return out;
	});
	const flat = $derived(shown.flatMap((g) => g.rows.map((r) => r.item)));

	const options = $derived.by(() => {
		if (page?.kind !== "multi") return [];
		const q = query.trim();
		return page.options.filter((o) => fuzzy(q, o.label) !== null);
	});
	const count = $derived(page?.kind === "multi" ? options.length : flat.length);

	$effect(() => {
		void query;
		cursor = 0;
	});
	$effect(() => {
		const index = cursor;
		void tick().then(() => list?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" }));
	});

	const attempt = async (action: () => unknown) => {
		busy = true;
		error = "";
		try {
			const result = await action();
			if (result !== undefined && result !== null && typeof result === "object" && "kind" in result) push(result as PalettePage);
			else close();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	};

	const toggle = (value: number | "*") => {
		const next = new Set(picked);
		if (next.has(value)) next.delete(value);
		else {
			// "Every branch" and specific branches are exclusive choices.
			if (value === "*") next.clear();
			else next.delete("*");
			next.add(value);
		}
		picked = next;
	};

	const confirm = () => {
		if (page?.kind === "multi") {
			if (picked.size === 0) return;
			const values: number[] | "*" = picked.has("*") ? "*" : [...picked].filter((v): v is number => v !== "*");
			void attempt(() => page.confirm(values));
		} else if (page?.kind === "input") {
			if (query.trim() === "") return;
			const text = query.trim();
			void attempt(() => page.submit(text));
		}
	};

	const onKey = (event: KeyboardEvent) => {
		const mod = event.metaKey || event.ctrlKey;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			if (stack.length > (start !== undefined ? 1 : 0)) pop();
			else close();
		} else if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
			event.preventDefault();
			cursor = count === 0 ? 0 : (cursor + 1) % count;
		} else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
			event.preventDefault();
			cursor = count === 0 ? 0 : (cursor - 1 + count) % count;
		} else if (event.key === "Backspace" && query === "" && stack.length > 0 && page?.kind !== "input") {
			event.preventDefault();
			pop();
		} else if (event.key === "Enter" && !event.isComposing) {
			event.preventDefault();
			if (busy) return;
			if (page?.kind === "input" || (page?.kind === "multi" && mod)) return confirm();
			if (page?.kind === "multi") {
				const option = options[cursor];
				if (option !== undefined) toggle(option.value);
				return;
			}
			const item = flat[cursor];
			if (item === undefined) return;
			if (mod && item.alt) void attempt(item.alt.run);
			else void attempt(item.run);
		}
	};

	const current = $derived(flat[cursor]);
</script>

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
		<div class="top">
			{#if stack.length > 0}
				<div class="trail">
					{#each stack as p, i (i)}<span class="step">{p.title}</span>{/each}
				</div>
			{/if}
			<div class="search">
				<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" /></svg>
				<input
					bind:this={field}
					bind:value={query}
					onkeydown={onKey}
					placeholder={page?.placeholder ?? "Search branches, messages, and commands…"}
					aria-label="Command"
					spellcheck="false"
					autocomplete="off"
				/>
				{#if busy}<span class="spinner"></span>{/if}
			</div>
		</div>

		<div class="list" bind:this={list} role="listbox" aria-label="Results">
			{#if page?.kind === "input"}
				<div class="input-help">
					{#if error}<span class="error">{error}</span>{:else}Type and press <kbd>↵</kbd> to {page.confirmLabel.toLowerCase()}.{/if}
				</div>
			{:else if page?.kind === "multi"}
				{#each options as option, i (option.value)}
					<button
						class="item"
						class:active={i === cursor}
						data-index={i}
						role="option"
						aria-selected={picked.has(option.value)}
						onmousemove={() => (cursor = i)}
						onclick={() => toggle(option.value)}
					>
						<span class="box" class:on={picked.has(option.value)}></span>
						{#if option.hue !== undefined}<span class="swatch" style="--hue: {option.hue}"></span>{/if}
						<span class="label">{option.label}</span>
						{#if option.detail}<span class="detail">{option.detail}</span>{/if}
					</button>
				{/each}
				{#if error}<div class="input-help error">{error}</div>{/if}
			{:else}
				{#each shown as group (group.group)}
					<div class="group">{group.group}</div>
					{#each group.rows as row (row.item.id)}
						{@const i = flat.indexOf(row.item)}
						<button
							class="item"
							class:active={i === cursor}
							data-index={i}
							role="option"
							aria-selected={i === cursor}
							onmousemove={() => (cursor = i)}
							onclick={() => void attempt(row.item.run)}
						>
							{#if row.item.hue !== undefined}
								<span class="swatch" style="--hue: {row.item.hue}"></span>
							{:else}
								<span class="glyph">{row.item.icon ?? "›"}</span>
							{/if}
							<span class="label">
								{#each highlight(row.item.label, row.hits) as part, j (j)}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}
							</span>
							{#if row.item.detail}<span class="detail">{row.item.detail}</span>{/if}
							{#if row.item.shortcut}<kbd>{row.item.shortcut}</kbd>{/if}
						</button>
					{/each}
				{/each}
				{#if flat.length === 0}<div class="input-help">No matches. Try a branch name, a phrase from a message, or “share”.</div>{/if}
				{#if error}<div class="input-help error">{error}</div>{/if}
			{/if}
		</div>

		<div class="foot" class:hints-only={page?.kind !== "multi" && page?.kind !== "input"}>
			<span><kbd>↑</kbd><kbd>↓</kbd> move</span>
			{#if page?.kind === "multi"}
				<span><kbd>↵</kbd> toggle</span>
				<span class="spacer"></span>
				<button class="primary" disabled={picked.size === 0 || busy} onclick={confirm}>
					{page.confirmLabel(picked.has("*") ? -1 : picked.size)} <kbd class="on-accent">⌘↵</kbd>
				</button>
			{:else if page?.kind === "input"}
				<span class="spacer"></span>
				<button class="primary" disabled={query.trim() === "" || busy} onclick={confirm}>{page.confirmLabel}</button>
			{:else}
				<span><kbd>↵</kbd> run</span>
				{#if current?.alt}<span><kbd>⌘↵</kbd> {current.alt.label}</span>{/if}
				<span class="spacer"></span>
				<span><kbd>esc</kbd> {stack.length > 0 ? "back" : "close"}</span>
			{/if}
		</div>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 12vh 16px 16px;
		background: rgb(0 0 0 / 0.3);
		backdrop-filter: blur(2px);
		animation: fade 0.12s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.palette {
		display: flex;
		flex-direction: column;
		width: min(640px, 100%);
		max-height: min(560px, 76vh);
		border-radius: 14px;
		background: var(--surface);
		box-shadow: 0 24px 60px -12px rgb(0 0 0 / 0.35);
		overflow: hidden;
		animation: rise 0.14s ease-out;
	}
	@keyframes rise {
		from {
			transform: translateY(6px) scale(0.99);
			opacity: 0;
		}
	}
	.top {
		border-bottom: 1px solid var(--border);
	}
	.trail {
		display: flex;
		gap: 4px;
		padding: 10px 14px 0;
	}
	.step {
		padding: 1px 8px;
		border-radius: 5px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11.5px;
		font-weight: 550;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 16px;
	}
	.search svg {
		flex: none;
		width: 16px;
		height: 16px;
		fill: none;
		stroke: var(--text-muted);
		stroke-width: 1.6;
		stroke-linecap: round;
	}
	input {
		flex: 1;
		min-width: 0;
		height: 50px;
		border: none;
		background: none;
		font-size: 15px;
		outline: none;
	}
	input::placeholder {
		color: var(--text-muted);
	}
	.spinner {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}
	.group {
		padding: 8px 10px 4px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
	}
	kbd {
		display: inline-block;
		min-width: 1.4em;
		padding: 0 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--surface);
		font: 11px/16px ui-monospace, monospace;
		text-align: center;
		color: var(--text-muted);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: 8px;
		background: none;
		text-align: left;
		color: var(--text);
		font-size: 13px;
	}
	.item.active {
		background: var(--surface-muted);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.glyph {
		flex: none;
		width: 18px;
		text-align: center;
		color: var(--text-muted);
	}
	.swatch {
		flex: none;
		width: 8px;
		height: 8px;
		margin: 0 5px;
		border-radius: 2px;
		background: hsl(var(--hue) 62% 55%);
	}
	.box {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 4px;
		border: 1.5px solid var(--border);
		box-sizing: border-box;
	}
	.box.on {
		background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.4l2.5 2.4L12 5.4' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100%;
		border-color: var(--accent);
	}
	.label {
		flex: none;
		max-width: 60%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	mark {
		background: none;
		color: var(--accent);
		font-weight: 650;
	}
	.detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-muted);
		font-size: 12px;
	}
	.item kbd {
		margin-left: auto;
	}
	.input-help {
		padding: 14px 12px;
		color: var(--text-muted);
		font-size: 12.5px;
	}
	.error {
		color: var(--danger);
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 40px;
		padding: 0 12px 0 16px;
		border-top: 1px solid var(--border);
		background: var(--surface-muted);
		color: var(--text-muted);
		font-size: 11.5px;
	}
	.foot span {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.spacer {
		flex: 1;
	}
	.foot button {
		font-size: 12px;
		padding: 2px 10px;
	}
	.on-accent {
		background: rgb(255 255 255 / 0.18);
		border-color: rgb(255 255 255 / 0.3);
		color: white;
	}
	@media (max-width: 600px) {
		.scrim {
			padding-top: 8px;
		}
		.palette {
			max-height: 70vh;
		}
		.foot span:not(.spacer),
		.foot.hints-only {
			display: none;
		}
	}
</style>
