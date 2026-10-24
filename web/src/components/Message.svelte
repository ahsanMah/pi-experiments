<script lang="ts">
	import { renderMarkdown } from "../lib/markdown.ts";
	import { textOf, type ContentBlock, type ViewEntry } from "../lib/view.ts";

	type Props = {
		entry: ViewEntry;
		/** Results of this entry's tool calls, by call id. */
		results: Map<string, ViewEntry>;
		/** Inherited from the branch this one forked from. */
		inherited: boolean;
		focused: boolean;
		actions: boolean;
		branch: () => void;
		editBranch?: () => void;
		share: () => void;
	};
	let { entry, results, inherited, focused, actions, branch, editBranch, share }: Props = $props();

	const message = $derived(entry.model?.[0]);
	const blocks = $derived<ContentBlock[]>(
		message === undefined ? [] : typeof message.content === "string" ? [{ type: "text", text: message.content }] : ((message.content as ContentBlock[]) ?? []),
	);
	const text = $derived(textOf(blocks));
	const sharedTitle = $derived((entry.data as { title?: string } | undefined)?.title ?? "context");
</script>

{#if entry.kind === "pi.user"}
	<div class="row user" class:inherited class:focused data-entry={entry.id}>
		<div class="bubble">{text}</div>
		{#if actions}
			<div class="actions">
				<button onclick={branch} title="New branch continuing after this message">Branch</button>
				{#if editBranch}<button onclick={editBranch} title="Branch before this message and edit it">Edit &amp; branch</button>{/if}
				<button onclick={share} title="Share this branch up to here">Share…</button>
			</div>
		{/if}
	</div>
{:else if entry.kind === "pi.assistant"}
	<div class="row assistant" class:inherited class:focused data-entry={entry.id}>
		{#each blocks as block, index (index)}
			{#if block.type === "text" && block.text.trim() !== ""}
				<div class="markdown">{@html renderMarkdown(block.text)}</div>
			{:else if block.type === "thinking" && block.thinking.trim() !== ""}
				<details class="thinking"><summary>Thinking</summary><div>{block.thinking}</div></details>
			{:else if block.type === "toolCall"}
				{@const result = results.get(block.id)}
				{@const resultMessage = result?.model?.[0]}
				<details class="tool" class:error={resultMessage?.role === "toolResult" && resultMessage.isError}>
					<summary><code>{block.name}</code> <span class="args">{JSON.stringify(block.arguments).slice(0, 120)}</span></summary>
					<pre>{JSON.stringify(block.arguments, null, 2)}</pre>
					{#if resultMessage?.role === "toolResult"}<pre class="result">{textOf(resultMessage.content).slice(0, 4000)}</pre>{/if}
				</details>
			{/if}
		{/each}
		{#if message?.role === "assistant" && message.stopReason === "error"}
			<div class="error-text">{message.errorMessage ?? "The model returned an error."}</div>
		{/if}
		{#if actions && text.trim() !== ""}
			<div class="actions">
				<button onclick={branch} title="New branch continuing after this answer">Branch</button>
				<button onclick={share} title="Share this branch up to here">Share…</button>
			</div>
		{/if}
	</div>
{:else if entry.kind === "branches.shared"}
	<div class="row marker" class:inherited data-entry={entry.id}>⇄ Shared into this branch: <strong>{sharedTitle}</strong></div>
{:else if entry.kind === "pi.compaction"}
	<div class="row marker" data-entry={entry.id}>Earlier context was compacted into a summary.</div>
{:else if entry.kind === "pi.reset"}
	<div class="row marker" data-entry={entry.id}>Context reset.</div>
{/if}

<style>
	.row {
		position: relative;
		margin: 10px 0;
		scroll-margin: 80px;
	}
	.row.inherited {
		opacity: 0.7;
	}
	.row.focused {
		animation: flash 1.2s ease-out;
	}
	@keyframes flash {
		0% {
			background: var(--accent-soft);
		}
	}
	.user {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.bubble {
		max-width: 80%;
		padding: 8px 14px;
		border-radius: 16px;
		background: var(--surface-muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.assistant {
		padding: 0 4px;
	}
	.markdown :global(pre) {
		background: var(--surface-muted);
		padding: 10px;
		border-radius: 8px;
		overflow-x: auto;
	}
	.markdown :global(code) {
		font-size: 0.9em;
	}
	.markdown :global(p) {
		margin: 0.4em 0;
	}
	details {
		margin: 6px 0;
		font-size: 13px;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 4px 10px;
	}
	details.error {
		border-color: var(--danger);
	}
	summary {
		cursor: pointer;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.args {
		opacity: 0.7;
	}
	pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 12px;
		max-height: 320px;
		overflow: auto;
	}
	.result {
		border-top: 1px solid var(--border);
		padding-top: 6px;
	}
	.thinking div {
		white-space: pre-wrap;
		color: var(--text-muted);
	}
	.marker {
		text-align: center;
		font-size: 12px;
		color: var(--text-muted);
	}
	.error-text {
		color: var(--danger);
		font-size: 13px;
	}
	.actions {
		display: flex;
		gap: 4px;
		margin-top: 4px;
		opacity: 0;
		transition: opacity 0.15s;
	}
	.row:hover .actions,
	.row:focus-within .actions {
		opacity: 1;
	}
	.actions button {
		font-size: 11px;
		padding: 2px 8px;
	}
</style>
