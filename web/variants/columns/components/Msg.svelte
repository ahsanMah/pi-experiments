<script lang="ts">
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ContentBlock, type ViewEntry } from "../../../src/lib/view.ts";
	import { shortModel } from "../lib.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		entry: ViewEntry;
		/** Results of this entry's tool calls, by call id. */
		results: Map<string, ViewEntry>;
		/** Inherited from an ancestor branch (shown only when the stub is expanded). */
		inherited: boolean;
		focused: boolean;
		/** Branches that fork off right after this message, shown as chips to open them. */
		forks: readonly BranchInfo[];
		/** Model of the column, so an answer only names its model when it differs. */
		columnModel: string | undefined;
		/** Actions need a tree node; entries still being indexed have none yet. */
		actions: boolean;
		branch: () => void;
		editBranch?: () => void;
		share: () => void;
		reveal: (id: number) => void;
		/** Drag payload, so a message can be dropped on another column to share into it. */
		drag: { conversationId: number; at: number };
	};
	let { entry, results, inherited, focused, forks, columnModel, actions, branch, editBranch, share, reveal, drag }: Props = $props();

	const message = $derived(entry.model?.[0]);
	const blocks = $derived<ContentBlock[]>(
		message === undefined || message.role === "system"
			? []
			: typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: ((message.content as ContentBlock[]) ?? []),
	);
	const text = $derived(textOf(blocks));
	const model = $derived(message?.role === "assistant" && message.provider !== undefined ? `${message.provider}/${message.model}` : undefined);
	const sharedTitle = $derived((entry.data as { title?: string } | undefined)?.title ?? "context");

	const onDragStart = (event: DragEvent) => {
		event.dataTransfer?.setData("application/x-pi-branch", JSON.stringify(drag));
		event.dataTransfer?.setData("text/plain", text.slice(0, 400));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
	};
</script>

{#snippet toolbar(isUser: boolean)}
	<div class="tools">
		<button class="grip" draggable="true" ondragstart={onDragStart} title="Drag onto another column to share this branch up to here" aria-label="Drag to share">
			<Icon name="grip" size={14} />
		</button>
		<button onclick={branch} title={isUser ? "New column continuing after this message" : "New column continuing after this answer"}>
			<Icon name="branch" size={13} />Branch
		</button>
		{#if editBranch}
			<button onclick={editBranch} title="New column forked just before this message, with its text in the composer"><Icon name="edit" size={13} />Edit</button>
		{/if}
		<button onclick={share} title="Share this branch up to here"><Icon name="share" size={13} />Share</button>
	</div>
{/snippet}

{#snippet forkChips()}
	{#if forks.length > 0}
		<div class="forks">
			<span class="fork-label"><Icon name="branch" size={12} /> branched here</span>
			{#each forks as fork (fork.id)}
				<button class="fork" style="--hue: {branchHue(fork.id)}" onclick={() => reveal(fork.id)} title="Show “{fork.title}”">
					<span class="dot" class:busy={fork.busy}></span>{fork.title}
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

{#if entry.kind === "pi.user"}
	<div class="row user" class:inherited class:focused data-entry={entry.id}>
		<div class="bubble">{text}</div>
		{#if actions}{@render toolbar(true)}{/if}
		{@render forkChips()}
	</div>
{:else if entry.kind === "pi.assistant"}
	<div class="row assistant" class:inherited class:focused data-entry={entry.id}>
		{#if model !== undefined && model !== columnModel}<div class="model">{shortModel(model)}</div>{/if}
		{#each blocks as block, index (index)}
			{#if block.type === "text" && block.text.trim() !== ""}
				<div class="markdown">{@html renderMarkdown(block.text)}</div>
			{:else if block.type === "thinking" && block.thinking.trim() !== ""}
				<details class="fold"><summary>Thinking</summary><div class="thinking">{block.thinking}</div></details>
			{:else if block.type === "toolCall"}
				{@const result = results.get(block.id)}
				{@const resultMessage = result?.model?.[0]}
				<details class="fold tool" class:error={resultMessage?.role === "toolResult" && resultMessage.isError}>
					<summary><code>{block.name}</code> <span class="args">{JSON.stringify(block.arguments).slice(0, 100)}</span></summary>
					<pre>{JSON.stringify(block.arguments, null, 2)}</pre>
					{#if resultMessage?.role === "toolResult"}<pre class="result">{textOf(resultMessage.content).slice(0, 4000)}</pre>{/if}
				</details>
			{/if}
		{/each}
		{#if message?.role === "assistant" && message.stopReason === "error"}
			<div class="error-text">{message.errorMessage ?? "The model returned an error."}</div>
		{/if}
		{#if actions && text.trim() !== ""}{@render toolbar(false)}{/if}
		{@render forkChips()}
	</div>
{:else if entry.kind === "branches.shared"}
	<div class="row marker shared" class:inherited data-entry={entry.id}><Icon name="share" size={12} /> Shared into this branch: <strong>{sharedTitle}</strong></div>
{:else if entry.kind === "pi.compaction"}
	<div class="row marker" data-entry={entry.id}>Earlier context was compacted into a summary.</div>
{:else if entry.kind === "pi.reset"}
	<div class="row marker" data-entry={entry.id}>Context reset.</div>
{/if}

<style>
	.row {
		position: relative;
		margin: 14px 0;
		scroll-margin: 60px;
		border-radius: 10px;
	}
	.row.inherited {
		opacity: 0.62;
	}
	.row.focused {
		animation: flash 1.6s ease-out;
	}
	@keyframes flash {
		0%,
		30% {
			box-shadow: 0 0 0 6px var(--c-soft, var(--accent-soft));
			background: var(--c-soft, var(--accent-soft));
		}
	}
	.user {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}
	.bubble {
		max-width: 88%;
		padding: 8px 13px;
		border-radius: 14px 14px 4px 14px;
		background: var(--c-tint);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.assistant {
		padding: 0 2px;
		overflow-wrap: anywhere;
	}
	.model {
		font: 11px var(--mono);
		color: var(--text-faint);
		margin-bottom: 2px;
	}
	.fold {
		margin: 6px 0;
		font-size: 12.5px;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 4px 10px;
		background: var(--surface-2);
	}
	.fold.error {
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
		font-family: var(--mono);
		font-size: 11px;
	}
	pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font: 11.5px/1.45 var(--mono);
		max-height: 280px;
		overflow: auto;
	}
	.result {
		border-top: 1px solid var(--border);
		padding-top: 6px;
	}
	.thinking {
		white-space: pre-wrap;
		color: var(--text-muted);
	}
	.marker {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.marker.shared {
		color: var(--accent);
	}
	.error-text {
		color: var(--danger);
		font-size: 13px;
	}
	.tools {
		display: flex;
		gap: 2px;
		margin-top: 4px;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.row:hover .tools,
	.row:focus-within .tools {
		opacity: 1;
	}
	.tools button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11.5px;
		padding: 2px 7px;
		border-color: transparent;
		background: transparent;
		color: var(--text-muted);
		border-radius: 6px;
	}
	.tools button:hover {
		background: var(--surface-sunk);
		color: var(--text);
	}
	.tools .grip {
		cursor: grab;
		padding: 2px 3px;
	}
	.forks {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-top: 6px;
	}
	.user .forks {
		justify-content: flex-end;
	}
	.fork-label {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		color: var(--text-faint);
		margin-right: 2px;
	}
	.fork {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		padding: 1px 8px 1px 6px;
		border-radius: 999px;
		border-color: var(--c-soft);
		background: var(--c-soft);
		max-width: 180px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fork:hover:not(:disabled) {
		border-color: var(--c);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	.dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	@media (hover: none) {
		.tools {
			opacity: 1;
		}
		.tools .grip {
			display: none;
		}
	}
</style>
