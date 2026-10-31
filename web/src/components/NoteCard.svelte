<script lang="ts">
	// One shared note as its targets' models see it: where it came from, where it went, its text.
	import type { BranchInfo, SharedNote } from "../../../shared/protocol.ts";
	import { renderMarkdown } from "../lib/markdown.ts";

	type Props = {
		note: SharedNote;
		branches: readonly BranchInfo[];
		openBranch?: (id: number, entry: number | null) => void;
		unshare?: (noteId: string) => void;
	};
	let { note, branches, openBranch, unshare }: Props = $props();

	const titleOf = (id: number) => branches.find((b) => b.id === id)?.title ?? "another branch";
	const targets = $derived(note.to === "*" ? "every branch" : note.to.map(titleOf).join(", "));
	const when = $derived(new Date(note.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
</script>

<div class="note">
	<div class="meta">
		{#if note.from}
			<span>
				From
				{#if openBranch}
					<button class="link" onclick={() => openBranch(note.from!.conversationId, note.from!.at ?? null)}>{titleOf(note.from.conversationId)}</button>
				{:else}
					{titleOf(note.from.conversationId)}
				{/if}
			</span>
		{/if}
		<span>{note.from ? "to" : "Note to"} {targets}</span>
		{#if note.author === "model"}<span>posted by a model</span>{/if}
		<span>{when}</span>
	</div>
	<div class="text markdown">{@html renderMarkdown(note.text)}</div>
	{#if unshare}
		<button class="danger" onclick={() => unshare(note.id)}>Unshare</button>
	{/if}
</div>

<style>
	.note {
		display: flex;
		flex-direction: column;
		gap: 6px;
		text-align: left;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 12px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		color: var(--accent);
		font-size: 12px;
		text-decoration: underline;
	}
	.text {
		font-size: 13px;
		max-height: 320px;
		overflow: auto;
		color: var(--text);
	}
	.text :global(p) {
		margin: 0.3em 0;
	}
	.text :global(ul) {
		margin: 0.3em 0;
		padding-left: 1.3em;
	}
	button.danger {
		align-self: flex-start;
		font-size: 12px;
		padding: 2px 8px;
	}
</style>
