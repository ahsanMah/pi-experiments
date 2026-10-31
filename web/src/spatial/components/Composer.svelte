<script lang="ts">
	// One composer for cards (compact, on the canvas) and the focus panel: Enter sends, or queues
	// while the branch works; Alt+Enter steers the running work; Stop aborts it.
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		branch: BranchInfo;
		value: string;
		compact?: boolean;
		send: (text: string, whenBusy: "followUp" | "steer") => Promise<void>;
		abort: () => void;
		/** Lets a parent focus the input (keyboard shortcuts, new branches). */
		input?: HTMLTextAreaElement;
	};
	let { branch, value = $bindable(), compact = false, send, abort, input = $bindable() }: Props = $props();

	let sending = $state(false);
	const empty = $derived(value.trim() === "");

	const submit = async (whenBusy: "followUp" | "steer") => {
		const text = value.trim();
		if (text === "" || sending) return;
		sending = true;
		try {
			await send(text, whenBusy);
			value = "";
		} finally {
			sending = false;
		}
	};

	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void submit(event.altKey && branch.busy ? "steer" : "followUp");
		} else if (event.key === "Escape") {
			input?.blur();
		}
	};

	const placeholder = $derived(
		branch.busy ? (compact ? "Queue or steer…" : "Working… queue a follow-up or steer") : compact ? "Reply…" : `Message “${branch.title}”`,
	);
</script>

<div class="composer nodrag nopan" class:compact class:busy={branch.busy}>
	<textarea
		class="nowheel"
		bind:this={input}
		bind:value
		onkeydown={onKey}
		rows={compact ? 1 : 2}
		{placeholder}
		aria-label="Message {branch.title}"
	></textarea>
	<div class="actions">
		{#if branch.busy}
			<button class="ghost" onclick={() => submit("steer")} disabled={empty} title="Steer: join the running work after the current tool round (Alt+Enter)">
				<Icon name="steer" size={15} />{#if !compact}<span>Steer</span>{/if}
			</button>
			<button class="ghost" onclick={() => submit("followUp")} disabled={empty} title="Queue a follow-up after this run (Enter)">
				<Icon name="queue" size={15} />{#if !compact}<span>Queue{branch.queued > 0 ? ` · ${branch.queued}` : ""}</span>{/if}
			</button>
			<button class="stop" onclick={abort} title="Stop the running work" aria-label="Stop"><Icon name="stop" size={15} /></button>
		{:else}
			<button class="go" onclick={() => submit("followUp")} disabled={empty || sending} title="Send (Enter)" aria-label="Send"><Icon name="send" size={15} /></button>
		{/if}
	</div>
</div>

<style>
	.composer {
		display: flex;
		align-items: flex-end;
		gap: 6px;
		padding: 6px 6px 6px 12px;
		border-radius: 14px;
		border: 1px solid var(--line);
		background: var(--field);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}
	.composer:focus-within {
		border-color: color-mix(in oklab, var(--accent) 60%, var(--line));
		box-shadow: 0 0 0 3px var(--accent-ring);
	}
	.composer.busy {
		border-style: dashed;
	}
	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		border: none;
		outline: none;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 14px;
		line-height: 20px;
		padding: 4px 0;
		max-height: 160px;
	}
	.compact textarea {
		font-size: 13px;
		height: 20px;
		white-space: nowrap;
		overflow: hidden;
	}
	textarea::placeholder {
		color: var(--ink-faint);
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 28px;
		min-width: 28px;
		justify-content: center;
		padding: 0 8px;
		border-radius: 9px;
		border: 1px solid transparent;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.compact button {
		padding: 0;
		width: 28px;
	}
	.go {
		background: var(--ink);
		color: var(--paper);
	}
	.go:disabled {
		background: var(--chip);
		color: var(--ink-faint);
	}
	.ghost {
		background: var(--chip);
		color: var(--ink-soft);
	}
	.ghost:hover:not(:disabled) {
		color: var(--ink);
		border-color: var(--line);
	}
	.stop {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.stop:hover {
		border-color: var(--danger);
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	@media (max-width: 760px) {
		button span {
			display: none;
		}
		.actions button {
			width: 34px;
			height: 34px;
			padding: 0;
		}
	}
</style>
