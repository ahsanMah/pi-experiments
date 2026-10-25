<script lang="ts">
	// A branch a model proposed. Opening it forks after the answer it came with and puts the
	// proposed first message in the composer; nothing is sent until the user sends it.
	import type { BranchInfo, BranchSuggestion } from "../../../shared/protocol.ts";
	import { branchHue } from "../lib/layout.ts";

	type Props = {
		suggestion: BranchSuggestion;
		branches: readonly BranchInfo[];
		/** Name the branch it came from (the sidebar lists suggestions from every branch). */
		showSource?: boolean;
		accept: (id: string) => Promise<void>;
		dismiss: (id: string) => void;
	};
	let { suggestion, branches, showSource = false, accept, dismiss }: Props = $props();

	const source = $derived(branches.find((b) => b.id === suggestion.conversationId));
	let opening = $state(false);
	let error = $state("");

	const open = async () => {
		opening = true;
		error = "";
		try {
			await accept(suggestion.id);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			opening = false;
		}
	};
</script>

<div class="suggestion" style="--hue: {branchHue(suggestion.conversationId)}">
	<div class="head">
		<span class="mark" aria-hidden="true">✦</span>
		<span class="label">Suggested branch</span>
		{#if showSource && source}<span class="source">from {source.title}</span>{/if}
	</div>
	<div class="title">{suggestion.title}</div>
	<div class="reason">{suggestion.reason}</div>
	<div class="prompt">Starts with: “{suggestion.prompt}”</div>
	{#if error}<div class="error">{error}</div>{/if}
	<div class="actions">
		<button class="primary" onclick={open} disabled={opening || source?.busy}>
			{opening ? "Opening…" : source?.busy ? "Available after this answer" : "Open branch"}
		</button>
		<button onclick={() => dismiss(suggestion.id)}>Dismiss</button>
	</div>
</div>

<style>
	.suggestion {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: 10px;
		border: 1px solid hsl(var(--hue) 55% 55% / 0.6);
		background: var(--surface);
		font-size: 13px;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.mark {
		color: hsl(var(--hue) 60% 50%);
	}
	.source {
		text-transform: none;
		letter-spacing: 0;
	}
	.title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.reason,
	.prompt {
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.error {
		color: var(--danger);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 4px;
	}
	.actions button {
		font-size: 12px;
		padding: 3px 10px;
	}
</style>
