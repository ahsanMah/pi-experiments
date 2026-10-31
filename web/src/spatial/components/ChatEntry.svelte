<script lang="ts">
	// One transcript entry in the focus panel, with the branching actions on hover (or tap).
	import type { TreeNode } from "../../../../shared/protocol.ts";
	import { renderMarkdown } from "../../lib/markdown.ts";
	import { textOf, type ContentBlock, type ViewEntry } from "../../lib/view.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		entry: ViewEntry;
		results: Map<string, ViewEntry>;
		/** Inherited from an ancestor branch, above the fork point. */
		inherited: boolean;
		node: TreeNode | undefined;
		branch: () => void;
		editBranch?: () => void;
		share: () => void;
	};
	let { entry, results, inherited, node, branch, editBranch, share }: Props = $props();

	const message = $derived(entry.model?.[0]);
	const blocks = $derived<ContentBlock[]>(
		message === undefined ? [] : typeof message.content === "string" ? [{ type: "text", text: message.content }] : ((message.content as ContentBlock[]) ?? []),
	);
	const text = $derived(textOf(blocks));
	const sharedTitle = $derived((entry.data as { title?: string } | undefined)?.title ?? "context");
	const modelName = $derived(message?.role === "assistant" ? message.model : undefined);
</script>

{#if entry.kind === "pi.user"}
	<div class="entry user" class:inherited data-entry={entry.id} tabindex="-1">
		<div class="bubble">{text}</div>
		{#if node}
			<div class="actions">
				<button onclick={branch} title="New branch continuing after this message"><Icon name="branch" size={13} /><span>Branch</span></button>
				{#if editBranch}<button onclick={editBranch} title="Fork just before this message, with its text in the new branch's composer"><Icon name="edit" size={13} /><span>Edit &amp; branch</span></button>{/if}
				<button onclick={share} title="Share this branch up to here"><Icon name="share" size={13} /><span>Share</span></button>
			</div>
		{/if}
	</div>
{:else if entry.kind === "pi.assistant"}
	<div class="entry assistant" class:inherited data-entry={entry.id} tabindex="-1">
		{#if modelName && text.trim() !== ""}<div class="who"><Icon name="spark" size={11} />{modelName}</div>{/if}
		{#each blocks as block, index (index)}
			{#if block.type === "text" && block.text.trim() !== ""}
				<div class="markdown">{@html renderMarkdown(block.text)}</div>
			{:else if block.type === "thinking" && block.thinking.trim() !== ""}
				<details class="fold"><summary>Thinking</summary><div class="thinking">{block.thinking}</div></details>
			{:else if block.type === "toolCall"}
				{@const result = results.get(block.id)?.model?.[0]}
				<details class="fold tool" class:error={result?.role === "toolResult" && result.isError}>
					<summary><code>{block.name}</code> <span class="args">{JSON.stringify(block.arguments).slice(0, 100)}</span></summary>
					<pre>{JSON.stringify(block.arguments, null, 2)}</pre>
					{#if result?.role === "toolResult"}<pre class="result">{textOf(result.content).slice(0, 4000)}</pre>{/if}
				</details>
			{/if}
		{/each}
		{#if message?.role === "assistant" && message.stopReason === "error"}
			<div class="error">{message.errorMessage ?? "The model returned an error."}</div>
		{/if}
		{#if node && text.trim() !== ""}
			<div class="actions">
				<button onclick={branch} title="New branch continuing after this answer"><Icon name="branch" size={13} /><span>Branch</span></button>
				<button onclick={share} title="Share this branch up to here"><Icon name="share" size={13} /><span>Share</span></button>
			</div>
		{/if}
	</div>
{:else if entry.kind === "branches.shared"}
	<div class="marker shared" class:inherited data-entry={entry.id}><Icon name="sticky" size={12} />Sticky shared in: <strong>{sharedTitle}</strong></div>
{:else if entry.kind === "pi.compaction"}
	<div class="marker" data-entry={entry.id}>Earlier context was compacted into a summary.</div>
{:else if entry.kind === "pi.reset"}
	<div class="marker" data-entry={entry.id}>Context reset.</div>
{/if}

<style>
	.entry {
		position: relative;
		margin: 14px 0;
		outline: none;
		scroll-margin: 80px;
	}
	.entry.inherited {
		opacity: 0.62;
	}
	.user {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.bubble {
		max-width: 82%;
		padding: 9px 14px;
		border-radius: 18px 18px 6px 18px;
		background: var(--hue-soft);
		color: var(--ink);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-family: var(--mono);
		color: var(--ink-faint);
		margin-bottom: 2px;
	}
	.markdown {
		overflow-wrap: anywhere;
	}
	.markdown :global(p) {
		margin: 0.45em 0;
	}
	.markdown :global(pre) {
		background: var(--well);
		padding: 10px 12px;
		border-radius: 10px;
		overflow-x: auto;
		font-size: 12.5px;
	}
	.markdown :global(code) {
		font-family: var(--mono);
		font-size: 0.9em;
	}
	.markdown :global(a) {
		color: var(--accent);
	}
	.fold {
		margin: 6px 0;
		font-size: 13px;
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 5px 10px;
	}
	.fold.error {
		border-color: var(--danger);
	}
	summary {
		cursor: pointer;
		color: var(--ink-soft);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.args {
		opacity: 0.7;
		font-family: var(--mono);
		font-size: 11.5px;
	}
	pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 12px;
		max-height: 320px;
		overflow: auto;
		font-family: var(--mono);
	}
	.result {
		border-top: 1px solid var(--line);
		padding-top: 6px;
	}
	.thinking {
		white-space: pre-wrap;
		color: var(--ink-soft);
	}
	.error {
		color: var(--danger);
		font-size: 13px;
	}
	.marker {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin: 14px 0;
		font-size: 12px;
		color: var(--ink-faint);
	}
	.marker.shared {
		color: var(--sticky-ink);
	}
	.actions {
		display: flex;
		gap: 4px;
		margin-top: 6px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.entry:hover .actions,
	.entry:focus-within .actions,
	.entry:focus .actions {
		opacity: 1;
	}
	@media (hover: none) {
		/* Touch: compact icon actions, always reachable. */
		.actions {
			opacity: 0.75;
		}
		.actions span {
			display: none;
		}
		.actions button {
			width: 34px;
			height: 30px;
			padding: 0;
			justify-content: center;
		}
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 26px;
		padding: 0 9px;
		border-radius: 8px;
		border: 1px solid var(--line);
		background: var(--panel);
		color: var(--ink-soft);
		font-size: 12px;
		cursor: pointer;
	}
	.actions button:hover {
		color: var(--ink);
		border-color: var(--hue-ink);
	}
</style>
