<script lang="ts">
	import type { Status } from "../lib.ts";

	let { status, size = 14 }: { status: Status; size?: number } = $props();
</script>

<!-- CI-style glyphs: a spinner for running, a check for unread output, a bang for errors. -->
<span class="icon {status}" style="--size: {size}px" role="img" aria-label={status}>
	{#if status === "done"}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 8.3l2.3 2.2 4.7-4.9" /></svg>
	{:else if status === "errored"}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.6v4" /><path d="M8 11.2v.2" /></svg>
	{/if}
</span>

<style>
	.icon {
		position: relative;
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: var(--size);
		box-sizing: border-box;
		border-radius: 50%;
	}
	.idle {
		border: 1.5px dashed color-mix(in srgb, var(--text-3) 80%, transparent);
		transform: scale(0.86);
	}
	.running {
		border: 1.5px solid var(--run-soft);
		border-top-color: var(--run);
		border-right-color: var(--run);
		animation: spin 0.9s linear infinite;
	}
	.running::after {
		content: "";
		position: absolute;
		inset: 3px;
		border-radius: 50%;
		background: var(--run);
		animation: spin 0.9s linear infinite reverse;
	}
	.done {
		background: var(--ok);
	}
	.errored {
		background: var(--err);
	}
	svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: white;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
