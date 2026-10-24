<script lang="ts">
	import type { BranchInfo, SharedNote, TreeIndex } from "../../../shared/protocol.ts";
	import { branchHue } from "../lib/layout.ts";

	type Props = {
		tree: TreeIndex;
		activeId: number | undefined;
		select: (id: number) => void;
		create: () => void;
		forkTip: () => void;
		newNote: () => void;
		unshare: (noteId: string) => void;
	};
	let { tree, activeId, select, create, forkTip, newNote, unshare }: Props = $props();

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

	const targetLabel = (note: SharedNote) =>
		note.to === "*" ? "all branches" : note.to.map((id) => tree.branches.find((b) => b.id === id)?.title ?? `#${id}`).join(", ");
</script>

<aside>
	<div class="section-head">
		<h2>Branches</h2>
		<button onclick={forkTip} title="Branch from the end of the current branch">Fork</button>
		<button onclick={create} title="Start an unrelated thread">New</button>
	</div>
	<ul class="branches">
		{#each ordered as { branch, depth } (branch.id)}
			<li>
				<button
					class="branch"
					class:active={branch.id === activeId}
					style="--hue: {branchHue(branch.id)}; padding-left: {8 + depth * 14}px"
					onclick={() => select(branch.id)}
				>
					<span class="dot" class:busy={branch.busy}></span>
					<span class="name">{branch.title}</span>
					{#if branch.queued > 0}<span class="count" title="Queued inputs">+{branch.queued}</span>{/if}
					{#if branch.sharedIn > 0}<span class="count" title="Shared notes it sees">⇄{branch.sharedIn}</span>{/if}
				</button>
			</li>
		{/each}
	</ul>

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
						<span class="meta">{note.author === "model" ? "by a model" : "by you"} → {targetLabel(note)}</span>
					</summary>
					<div class="note-text">{note.text}</div>
					<button class="danger" onclick={() => unshare(note.id)}>Unshare</button>
				</details>
			</li>
		{/each}
	</ul>
</aside>

<style>
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
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
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
		background: var(--surface);
		box-shadow: inset 3px 0 0 hsl(var(--hue) 60% 55%);
		font-weight: 600;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
		background: hsl(var(--hue) 60% 55%);
	}
	.dot.busy {
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
	.note-text {
		white-space: pre-wrap;
		max-height: 240px;
		overflow: auto;
		margin: 6px 0;
	}
</style>
