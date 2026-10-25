<script lang="ts">
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ContentBlock, type ViewEntry } from "../../../src/lib/view.ts";

	type Props = {
		entry: ViewEntry;
		/** Results of this entry's tool calls, by call id. */
		results: Map<string, ViewEntry>;
		inherited: boolean;
		focused: boolean;
		/** Only entries the tree shows can be branched from or shared up to. */
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
	const model = $derived(message?.role === "assistant" && message.model ? message.model : "assistant");
	const sharedTitle = $derived((entry.data as { title?: string } | undefined)?.title ?? "context");
</script>

{#snippet tools()}
	{#if actions}
		<div class="actions">
			<button class="btn ghost sm" onclick={branch} title="New branch continuing after this message">⑂ Branch</button>
			{#if editBranch}<button class="btn ghost sm" onclick={editBranch} title="Branch just before this message, with its text in the composer">✎ Edit &amp; branch</button>{/if}
			<button class="btn ghost sm" onclick={share} title="Share this branch up to here">⇄ Share</button>
		</div>
	{/if}
{/snippet}

{#if entry.kind === "pi.user"}
	<article class="msg user" class:inherited class:focused data-entry={entry.id}>
		<header><span class="who">You</span>{@render tools()}</header>
		<div class="body plain">{text}</div>
	</article>
{:else if entry.kind === "pi.assistant"}
	<article class="msg assistant" class:inherited class:focused data-entry={entry.id}>
		<header><span class="who mono">{model}</span>{#if text.trim() !== ""}{@render tools()}{/if}</header>
		<div class="body">
			{#each blocks as block, index (index)}
				{#if block.type === "text" && block.text.trim() !== ""}
					<div class="markdown">{@html renderMarkdown(block.text)}</div>
				{:else if block.type === "thinking" && block.thinking.trim() !== ""}
					<details class="fold"><summary>Thinking</summary><div class="thinking">{block.thinking}</div></details>
				{:else if block.type === "toolCall"}
					{@const result = results.get(block.id)?.model?.[0]}
					{@const failed = result?.role === "toolResult" && result.isError === true}
					<details class="fold tool" class:failed>
						<summary><span class="mono name">⚙ {block.name}</span><span class="args mono">{JSON.stringify(block.arguments).slice(0, 140)}</span></summary>
						<pre>{JSON.stringify(block.arguments, null, 2)}</pre>
						{#if result?.role === "toolResult"}<pre class="result">{textOf(result.content).slice(0, 4000)}</pre>{/if}
					</details>
				{/if}
			{/each}
			{#if message?.role === "assistant" && message.stopReason === "error"}
				<div class="error">{message.errorMessage ?? "The model returned an error."}</div>
			{/if}
		</div>
	</article>
{:else if entry.kind === "branches.shared"}
	<div class="marker shared" data-entry={entry.id}><span>⇄ Shared into this branch · <strong>{sharedTitle}</strong></span></div>
{:else if entry.kind === "pi.compaction"}
	<div class="marker" data-entry={entry.id}><span>Earlier context was compacted into a summary</span></div>
{:else if entry.kind === "pi.reset"}
	<div class="marker" data-entry={entry.id}><span>Context reset</span></div>
{/if}

<style>
	.msg {
		position: relative;
		padding: 10px 12px 12px;
		margin: 2px 0;
		border-radius: 10px;
		scroll-margin: 80px;
	}
	.msg.user {
		background: var(--sunken);
		border: 1px solid var(--line);
		margin: 14px 0 6px;
	}
	.msg.inherited {
		opacity: 0.62;
	}
	.msg.inherited:hover {
		opacity: 1;
	}
	.msg.focused {
		animation: flash 1.6s ease-out;
	}
	@keyframes flash {
		0%,
		30% {
			box-shadow: 0 0 0 2px var(--accent-line);
			background: var(--accent-soft);
		}
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 20px;
		margin-bottom: 2px;
	}
	.who {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.03em;
		color: var(--text-3);
		text-transform: uppercase;
	}
	.assistant .who {
		text-transform: none;
		letter-spacing: 0;
		color: hsl(var(--hue) 50% 48%);
	}
	.actions {
		display: flex;
		gap: 2px;
		margin-left: auto;
		opacity: 0;
		transition: opacity 0.12s;
	}
	.msg:hover .actions,
	.msg:focus-within .actions {
		opacity: 1;
	}
	@media (hover: none) {
		.actions {
			opacity: 1;
		}
	}
	.body {
		overflow-wrap: anywhere;
		font-size: 13.5px;
		line-height: 1.6;
	}
	.plain {
		white-space: pre-wrap;
	}
	.markdown :global(p) {
		margin: 0.35em 0;
	}
	.markdown :global(pre) {
		background: var(--sunken);
		border: 1px solid var(--line);
		padding: 10px 12px;
		border-radius: 8px;
		overflow-x: auto;
		font-size: 12px;
	}
	.markdown :global(code) {
		font-family: var(--mono);
		font-size: 0.88em;
	}
	.markdown :global(:not(pre) > code) {
		padding: 1px 4px;
		border-radius: 4px;
		background: var(--sunken);
	}
	.markdown :global(a) {
		color: var(--accent);
	}
	.fold {
		margin: 6px 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel);
		font-size: 12px;
	}
	.fold.failed {
		border-color: color-mix(in srgb, var(--err) 50%, transparent);
	}
	summary {
		display: flex;
		gap: 8px;
		padding: 5px 10px;
		cursor: pointer;
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.name {
		color: var(--text);
	}
	.args {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-3);
	}
	pre {
		margin: 0;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font: 11.5px/1.5 var(--mono);
		max-height: 280px;
		overflow: auto;
	}
	.thinking {
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		white-space: pre-wrap;
		color: var(--text-2);
	}
	.error {
		margin-top: 6px;
		padding: 6px 10px;
		border-radius: 7px;
		background: var(--err-soft);
		color: var(--err);
		font-size: 12.5px;
	}
	.marker {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 14px 0;
		color: var(--text-3);
		font-size: 11.5px;
	}
	.marker::before,
	.marker::after {
		content: "";
		flex: 1;
		border-top: 1px solid var(--line);
	}
	.marker.shared {
		color: var(--warn);
	}
	.marker.shared::before,
	.marker.shared::after {
		border-top-style: dashed;
		border-color: color-mix(in srgb, var(--warn) 40%, transparent);
	}
</style>
