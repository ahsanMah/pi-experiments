<script lang="ts">
	import { contextShare, formatSpeed, formatTokens } from "../../../shared/format.ts";
	import { contextBreakdown } from "../lib/context.ts";
	import type { ConversationView } from "../lib/view.ts";
	import type { BranchInfo, SharedNote, TreeIndex } from "../../../shared/protocol.ts";
	import { branchHue } from "../lib/layout.ts";
	import NoteCard from "./NoteCard.svelte";
	import SuggestionCard from "./SuggestionCard.svelte";

	type Props = {
		tree: TreeIndex;
		activeId: number | undefined;
		/** The open branch's view, for the context breakdown. */
		view: ConversationView | undefined;
		select: (id: number) => void;
		create: () => void;
		forkTip: () => void;
		newNote: () => void;
		unshare: (noteId: string) => void;
		accept: (id: string) => Promise<void>;
		dismiss: (id: string) => void;
		/** Open the command palette. */
		commands: () => void;
		theme: "system" | "light" | "dark";
		cycleTheme: () => void;
	};
	let { tree, activeId, view, select, create, forkTip, newNote, unshare, accept, dismiss, commands, theme, cycleTheme }: Props = $props();

	/** Branches in tree order: each fork listed under the branch it came from. */
	const ordered = $derived.by(() => {
		const children = new Map<number | undefined, BranchInfo[]>();
		for (const branch of tree.branches) {
			const key = branch.parent?.conversationId;
			children.set(key, [...(children.get(key) ?? []), branch]);
		}
		const out: { branch: BranchInfo; depth: number }[] = [];
		const visit = (parent: number | undefined, depth: number) => {
			for (const branch of children.get(parent) ?? []) {
				out.push({ branch, depth });
				visit(branch.id, depth + 1);
			}
		};
		visit(undefined, 0);
		return out;
	});

	// The list drawn as a line map (after the rail variant): each branch is a stop in its own
	// column, and its parent's lane runs down from the parent's stop and curves into each fork.
	// Lanes on the way from the root to the open branch are drawn bold.
	const ROW = 30;
	const col = (depth: number) => 10 + depth * 14;
	type Lane = { d: string; hue: number; onPath: boolean };
	const lanes = $derived.by(() => {
		const rowOf = new Map(ordered.map((o, i) => [o.branch.id, i]));
		const byId = new Map(tree.branches.map((b) => [b.id, b]));
		// The open branch and its ancestors, each mapped to the child the path continues into.
		const pathChild = new Map<number, number>();
		for (let b = activeId === undefined ? undefined : byId.get(activeId); b?.parent !== undefined; b = byId.get(b.parent.conversationId))
			pathChild.set(b.parent.conversationId, b.id);
		const perRow: Lane[][] = ordered.map(() => []);
		for (const [p, { branch: parent, depth }] of ordered.entries()) {
			const kids = ordered.flatMap((o, i) => (o.branch.parent?.conversationId === parent.id ? [i] : []));
			if (kids.length === 0) continue;
			const last = kids.at(-1)!;
			const x = col(depth);
			const hue = branchHue(parent.id);
			const pathRow = pathChild.has(parent.id) ? (rowOf.get(pathChild.get(parent.id)!) ?? -1) : -1;
			const add = (row: number, d: string, onPath: boolean) => perRow[row]!.push({ d, hue, onPath });
			add(p, `M${x} ${ROW / 2 + 5}V${ROW}`, pathRow >= 0);
			for (let r = p + 1; r <= last; r++) {
				// The path leaves this lane at its fork, so the lane is bold only down to there.
				if (r < last) add(r, `M${x} 0V${ROW}`, r < pathRow);
				// A fork: leave the lane and curve into the child's stop.
				if (kids.includes(r)) add(r, `M${x} 0V${ROW / 2 - 6}q0 6 6 6H${col(depth + 1) - 5}`, r === pathRow);
			}
		}
		return perRow;
	});

	const active = $derived(tree.branches.find((b) => b.id === activeId));
	const share = $derived(active === undefined ? undefined : contextShare(active));

	// What fills the context, estimated from the view and scaled to the last request's real size.
	const parts = $derived(view === undefined ? [] : contextBreakdown(view, active?.context?.tokens));
	const partsTotal = $derived(parts.reduce((sum, p) => sum + p.tokens, 0));
	const PART_HUES = [265, 205, 145, 35, 300, 15, 175, 90];
	/** Width of the meter: the window when known, else the parts themselves. */
	const meterScale = $derived(active?.context?.window ?? partsTotal);


	const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

	const titleOf = (id: number) => tree.branches.find((b) => b.id === id)?.title ?? "another branch";
	/** Where a note came from and went: "from WAL to every branch", or "note to Main" for one typed in. */
	const route = (note: SharedNote) => {
		const to = note.to === "*" ? "every branch" : note.to.map(titleOf).join(", ");
		return note.from === undefined ? `note to ${to}` : `from ${titleOf(note.from.conversationId)} to ${to}`;
	};
</script>

<aside>
	<div class="top">
		<button class="commands" onclick={commands} title="Switch branches, search messages, run commands">
			<span>Search or run a command…</span><kbd>{modKey}K</kbd>
		</button>
		<button class="theme" onclick={cycleTheme} title="Theme: {theme} (click to change)" aria-label="Theme: {theme}">
			{theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐"}
		</button>
	</div>
	<div class="section-head">
		<h2>Branches</h2>
		<button onclick={forkTip} title="Branch from the end of the current branch">Fork</button>
		<button onclick={create} title="Start an unrelated thread">New</button>
	</div>
	<ul class="branches">
		{#each ordered as { branch, depth }, row (branch.id)}
			<li>
				<button class="branch" class:active={branch.id === activeId} style="--hue: {branchHue(branch.id)}" onclick={() => select(branch.id)}>
					<svg class="track" width={col(depth) + 8} height={ROW} aria-hidden="true">
						{#each lanes[row] ?? [] as lane, i (i)}
							<path d={lane.d} class="lane" class:on-path={lane.onPath} style="--lane: {lane.hue}" />
						{/each}
						<circle cx={col(depth)} cy={ROW / 2} r="4.5" class="stop" class:busy={branch.busy} />
					</svg>
					<span class="name">{branch.title}</span>
					{#if branch.queued > 0}<span class="count" title="Queued inputs">+{branch.queued}</span>{/if}
					{#if branch.sharedIn > 0}<span class="count" title="Shared notes it sees">⇄{branch.sharedIn}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>

	{#if active !== undefined}
		<div class="section-head">
			<h2>Context</h2>
		</div>
		<div class="context">
			<div class="context-line" title="Size of {active.title}'s last model request">
				{#if active.context !== undefined}
					<span>{formatTokens(active.context.tokens)}{#if active.context.window}<span class="muted">{` / ${formatTokens(active.context.window)}`}</span>{/if} tokens</span>
					{#if share !== undefined}<span class="muted">{Math.round(share * 100)}%</span>{/if}
				{:else if partsTotal > 0}
					<span>≈{formatTokens(partsTotal)} tokens</span><span class="muted">estimated</span>
				{:else}
					<span class="muted">No model request yet</span>
				{/if}
			</div>
			{#if parts.length > 0 && meterScale > 0}
				<div class="meter" class:warn={(share ?? 0) >= 0.7} class:full={(share ?? 0) >= 0.9}>
					{#each parts as part, i (part.label)}
						<div style="width: {(part.tokens / meterScale) * 100}%; --hue: {PART_HUES[i % PART_HUES.length]}" title="{part.label}: ≈{formatTokens(part.tokens)}"></div>
					{/each}
				</div>
				<ul class="parts">
					{#each parts as part, i (part.label)}
						<li>
							{#if part.detail}
								<details>
									<summary><span class="swatch" style="--hue: {PART_HUES[i % PART_HUES.length]}"></span><span class="part-name">{part.label}</span><span class="muted">≈{formatTokens(part.tokens)}</span></summary>
									<ul class="detail">
										{#each part.detail as d (d.label)}
											<li><span class="part-name">{d.label}</span><span class="muted">≈{formatTokens(d.tokens)}</span></li>
										{/each}
									</ul>
								</details>
							{:else}
								<div class="row"><span class="swatch" style="--hue: {PART_HUES[i % PART_HUES.length]}"></span><span class="part-name">{part.label}</span><span class="muted">≈{formatTokens(part.tokens)}</span></div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<div class="context-line muted">
				<span title="Speed of the last answer">{active.tokensPerSecond !== undefined ? formatSpeed(active.tokensPerSecond) : "– tok/s"}</span>
				{#if active.costUsd > 0}<span>${active.costUsd.toFixed(4)}</span>{/if}
			</div>
		</div>
	{/if}

	{#if tree.suggestions.length > 0}
		<div class="section-head">
			<h2>Suggested branches</h2>
		</div>
		<ul class="suggestions">
			{#each tree.suggestions as suggestion (suggestion.id)}
				<li><SuggestionCard {suggestion} branches={tree.branches} showSource {accept} {dismiss} /></li>
			{/each}
		</ul>
	{/if}

	<div class="section-head">
		<h2>Shared context</h2>
		<button onclick={newNote} title="Write a note every branch (or chosen ones) will see">Note</button>
	</div>
	{#if tree.notes.length === 0}
		<p class="hint">Share a summary or a note from any message or node; it reaches the target branches' system prompt.</p>
	{/if}
	<ul class="notes">
		{#each tree.notes as note (note.id)}
			<li>
				<details>
					<summary>
						<span class="note-title">{note.title}</span>
						<span class="meta">{route(note)}{note.author === "model" ? " · by a model" : ""}</span>
					</summary>
					<NoteCard {note} branches={tree.branches} openBranch={(id) => select(id)} {unshare} />
				</details>
			</li>
		{/each}
	</ul>
</aside>

<style>
	.context {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 2px 8px 8px;
		font-size: 12px;
	}
	.context-line {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.muted {
		color: var(--text-muted);
	}
	.meter {
		height: 4px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}
	.meter {
		display: flex;
		height: 6px;
		gap: 1px;
	}
	.meter div {
		height: 100%;
		background: hsl(var(--hue) 60% 55%);
	}
	.meter.warn {
		outline: 1px solid hsl(38 90% 50%);
	}
	.meter.full {
		outline: 1px solid hsl(0 70% 55%);
	}
	.parts,
	.detail {
		margin: 0;
		font-size: 11.5px;
	}
	.parts summary,
	.parts .row,
	.detail li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 1px 0;
	}
	.parts summary {
		cursor: pointer;
		list-style: none;
	}
	.parts summary::-webkit-details-marker {
		display: none;
	}
	.parts summary::after {
		content: "▸";
		color: var(--text-muted);
		font-size: 9px;
	}
	.parts details[open] summary::after {
		content: "▾";
	}
	.detail {
		padding-left: 14px;
	}
	.part-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.swatch {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: hsl(var(--hue) 60% 55%);
	}
	aside {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow-y: auto;
		background: var(--surface-muted);
		border-right: 1px solid var(--border);
		padding: 10px 8px;
		box-sizing: border-box;
	}
	.top {
		display: flex;
		gap: 4px;
	}
	.theme {
		flex: none;
		width: 30px;
		padding: 0;
		font-size: 14px;
		color: var(--text-muted);
	}
	.commands {
		display: flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		color: var(--text-muted);
		font-size: 12px;
		text-align: left;
	}
	.commands span {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.commands kbd {
		font: 11px ui-monospace, monospace;
		padding: 0 4px;
		border: 1px solid var(--border);
		border-radius: 4px;
	}
	.section-head {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		margin-top: 6px;
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.section-head button {
		font-size: 11px;
		padding: 2px 8px;
	}
	ul {
		list-style: none;
		margin: 0 0 8px;
		padding: 0;
	}
	.branch {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		height: 30px;
		padding: 0 8px 0 0;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text);
		text-align: left;
		cursor: pointer;
	}
	.branch:hover {
		background: var(--surface);
	}
	.branch.active {
		background: hsl(var(--hue) 60% 55% / 0.12);
		font-weight: 600;
	}
	.track {
		flex: none;
		overflow: visible;
	}
	.lane {
		fill: none;
		stroke: hsl(var(--lane) 60% 55%);
		stroke-width: 1.5;
		opacity: 0.45;
	}
	.lane.on-path {
		stroke-width: 2.5;
		opacity: 1;
	}
	.stop {
		fill: hsl(var(--hue) 60% 55%);
		stroke: var(--surface-muted);
		stroke-width: 2;
	}
	.branch.active .stop {
		stroke: var(--surface);
		r: 5.5;
	}
	.stop.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.2;
		}
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font-size: 11px;
		color: var(--text-muted);
	}
	.suggestions {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hint {
		font-size: 12px;
		color: var(--text-muted);
		padding: 0 8px;
	}
	.notes details {
		margin: 4px 0;
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--surface);
		font-size: 12px;
	}
	summary {
		cursor: pointer;
	}
	.note-title {
		font-weight: 600;
	}
	.meta {
		display: block;
		color: var(--text-muted);
		font-size: 11px;
	}
</style>
