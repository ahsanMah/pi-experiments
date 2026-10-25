<script lang="ts">
	import { branchHue } from "../lib/layout.ts";
	import type { ForkOption } from "../lib/forks.ts";

	type Props = {
		/** The entry other branches continue from. */
		at: number;
		options: readonly ForkOption[];
		/** Open another continuation; the caller keeps this switcher where it is on screen. */
		pick: (branchId: number, at: number) => void;
	};
	let { at, options, pick }: Props = $props();

	const index = $derived(Math.max(0, options.findIndex((option) => option.current)));
	const go = (delta: number) => {
		const next = options[(index + delta + options.length) % options.length];
		if (next !== undefined) pick(next.branch.id, at);
	};
	const preview = (option: ForkOption) => (option.first ? option.first.preview : "No messages yet");
</script>

<div class="switcher" data-fork={at} role="group" aria-label="Branches that continue here">
	<span class="chip">
		<button onclick={() => go(-1)} title="Previous branch here ([ or Alt+[)" aria-label="Previous branch">‹</button>
		<span class="count"><b>{index + 1}</b>/{options.length}</span>
		<button onclick={() => go(1)} title="Next branch here (] or Alt+])" aria-label="Next branch">›</button>
	</span>
	{#each options as option (option.branch.id)}
		<button
			class="lane"
			class:current={option.current}
			class:busy={option.branch.busy}
			style="--hue: {branchHue(option.branch.id)}"
			onclick={() => !option.current && pick(option.branch.id, at)}
			title="{option.branch.title}: {preview(option)}"
			aria-current={option.current}
		>
			<i></i>{option.branch.title}
		</button>
	{/each}
</div>

<style>
	.switcher {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 6px 0;
		font-size: 12px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		flex: none;
		margin-right: 4px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}
	.chip button {
		border: none;
		background: none;
		padding: 0 7px;
		font-size: 14px;
		line-height: 20px;
		color: var(--text-muted);
		border-radius: 999px;
	}
	.chip button:hover {
		color: var(--text);
		background: var(--surface-muted);
	}
	.count {
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.count b {
		color: var(--text);
		font-weight: 600;
	}
	.lane {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: none;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: none;
		background: none;
		padding: 2px 8px;
		border-radius: 999px;
		color: var(--text-muted);
		font-size: 12px;
	}
	.lane:hover {
		color: var(--text);
		background: var(--surface-muted);
	}
	.lane.current {
		color: var(--text);
		background: hsl(var(--hue) 60% 55% / 0.14);
		cursor: default;
	}
	.lane i {
		width: 7px;
		height: 7px;
		flex: none;
		border-radius: 50%;
		background: hsl(var(--hue) 60% 55%);
		opacity: 0.55;
	}
	.lane.current i {
		opacity: 1;
	}
	.lane.busy i {
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.25;
		}
	}
</style>
