<script lang="ts">
	import type { BranchInfo, SharedNote, TreeIndex } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";

	type Props = {
		tree: TreeIndex;
		activeId: number | undefined;
		select: (id: number) => void;
		create: () => void;
		newNote: () => void;
		unshare: (noteId: string) => void;
	};
	let { tree, activeId, select, create, newNote, unshare }: Props = $props();

	/** Branches in tree order: each fork listed under the branch it came from, like a line map's legend. */
	const ordered = $derived.by(() => {
		const children = new Map<number | undefined, BranchInfo[]>();
		for (const branch of tree.branches) {
			const key = branch.parent?.conversationId;
			children.set(key, [...(children.get(key) ?? []), branch]);
		}
		const out: { branch: BranchInfo; depth: number; parent?: number }[] = [];
		const visit = (parent: number | undefined, depth: number) => {
			for (const branch of children.get(parent) ?? []) {
				out.push({ branch, depth, ...(parent !== undefined ? { parent } : {}) });
				visit(branch.id, depth + 1);
			}
		};
		visit(undefined, 0);
		return out;
	});
	const counts = $derived.by(() => {
		const map = new Map<number, number>();
		for (const node of tree.nodes) if (node.role === "user" || node.role === "assistant") map.set(node.conversationId, (map.get(node.conversationId) ?? 0) + 1);
		return map;
	});
	const targetLabel = (note: SharedNote) =>
		note.to === "*" ? "every branch" : note.to.map((id) => tree.branches.find((b) => b.id === id)?.title ?? `#${id}`).join(", ");
	const sourceLabel = (note: SharedNote) => (note.from === undefined ? "" : (tree.branches.find((b) => b.id === note.from!.conversationId)?.title ?? ""));
	const running = $derived(tree.branches.filter((b) => b.busy).length);
</script>

<div class="lines">
	<section>
		<div class="head">
			<h2>Lines</h2>
			<span class="meta">{tree.branches.length}{running > 0 ? ` · ${running} running` : ""}</span>
			<button class="add" onclick={create} title="Start an unrelated thread">New thread</button>
		</div>
		<ul>
			{#each ordered as { branch, depth, parent } (branch.id)}
				<li>
					<button class="line" class:active={branch.id === activeId} onclick={() => select(branch.id)} style="--h: {branchHue(branch.id)}; --ph: {branchHue(parent ?? branch.id)}">
						<svg class="track" width={18 + depth * 14} height="28" aria-hidden="true">
							{#if depth > 0}
								<path d="M{10 + (depth - 1) * 14} -14V8q0 6 6 6H{4 + depth * 14}" class="elbow" />
							{/if}
							<circle cx={10 + depth * 14} cy="14" r="4.5" class="stop" class:busy={branch.busy} />
						</svg>
						<span class="name">{branch.title}</span>
						{#if branch.busy}<span class="live">live</span>{/if}
						{#if branch.queued > 0}<span class="meta">+{branch.queued}</span>{/if}
						<span class="meta num">{counts.get(branch.id) ?? 0}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<div class="head">
			<h2>Shared context</h2>
			<span class="meta">{tree.notes.length}</span>
			<button class="add" onclick={newNote} title="Write a note for chosen branches (n)">Note</button>
		</div>
		{#if tree.notes.length === 0}
			<p class="empty">Share a summary, transcript or note from any message. It lands in the target branches' system prompts and shows as a station on their rail.</p>
		{/if}
		<ul class="notes">
			{#each tree.notes as note (note.id)}
				<li>
					<details>
						<summary>
							<span class="note-title">{note.title}</span>
							<span class="note-meta">
								{note.author === "model" ? "model" : "you"}{sourceLabel(note) !== "" ? ` · from ${sourceLabel(note)}` : ""} → {targetLabel(note)}
							</span>
						</summary>
						<div class="note-text">{note.text}</div>
						<button class="unshare" onclick={() => unshare(note.id)}>Unshare</button>
					</details>
				</li>
			{/each}
		</ul>
	</section>
</div>

<style>
	.lines {
		display: flex;
		flex-direction: column;
		gap: 28px;
		font: 13px var(--sans);
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 8px;
		padding: 0 6px;
	}
	h2 {
		margin: 0;
		font: 600 11px var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-2);
	}
	.meta {
		font: 11px var(--mono);
		color: var(--text-3);
	}
	.num {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}
	.add {
		margin-left: auto;
		border: none;
		background: none;
		font: 500 12px var(--sans);
		color: var(--text-2);
		padding: 2px 6px;
		border-radius: 6px;
		cursor: pointer;
	}
	.add:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		padding: 0 8px 0 2px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text-2);
		font: 500 13px var(--sans);
		text-align: left;
		cursor: pointer;
	}
	.line:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.line.active {
		color: var(--text);
		background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.1);
	}
	.line.active .name {
		font-weight: 650;
	}
	.track {
		flex: none;
		overflow: visible;
	}
	.elbow {
		fill: none;
		stroke: hsl(var(--ph) var(--lane-s) var(--lane-l));
		stroke-width: 1.5;
		opacity: 0.55;
	}
	.stop {
		fill: hsl(var(--h) var(--lane-s) var(--lane-l));
		stroke: var(--panel);
		stroke-width: 2;
	}
	.stop.busy {
		animation: blink 1.1s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.live {
		font: 600 9.5px var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: hsl(var(--h) var(--lane-s) var(--lane-ink));
		background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.14);
		padding: 1px 5px;
		border-radius: 4px;
		flex: none;
	}
	.empty {
		margin: 0 6px;
		color: var(--text-3);
		font-size: 12.5px;
		line-height: 1.5;
	}
	.notes li + li {
		margin-top: 6px;
	}
	.notes details {
		padding: 9px 10px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
	}
	.notes summary {
		cursor: pointer;
		list-style: none;
	}
	.notes summary::-webkit-details-marker {
		display: none;
	}
	.note-title {
		display: block;
		font-weight: 600;
		color: var(--text);
	}
	.note-meta {
		display: block;
		margin-top: 2px;
		font-size: 11.5px;
		color: var(--text-3);
	}
	.note-text {
		white-space: pre-wrap;
		max-height: 220px;
		overflow: auto;
		margin: 8px 0;
		color: var(--text-2);
		font: 13px/1.55 var(--serif);
	}
	.unshare {
		border: none;
		background: none;
		padding: 0;
		font: 500 12px var(--sans);
		color: var(--danger);
		cursor: pointer;
	}
</style>
