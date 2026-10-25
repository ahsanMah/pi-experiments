<script lang="ts">
	import { branchHue } from "../../../src/lib/layout.ts";
	import type { ForkOption } from "../lib/rail.ts";

	type Props = {
		at: number;
		options: readonly ForkOption[];
		/** Open another continuation; the caller keeps this chip where it is on screen. */
		pick: (branchId: number, at: number) => void;
	};
	let { at, options, pick }: Props = $props();

	const index = $derived(Math.max(0, options.findIndex((option) => option.current)));
	const current = $derived(options[index]);
	const go = (delta: number) => {
		const next = options[(index + delta + options.length) % options.length];
		if (next !== undefined) pick(next.branch.id, at);
	};
	const preview = (option: ForkOption) => (option.first ? option.first.preview : "No messages yet");
</script>

<div class="switcher" data-fork={at} role="group" aria-label="Branches that continue here">
	<div class="chip">
		<button class="step" onclick={() => go(-1)} title="Previous branch here ([)" aria-label="Previous branch">‹</button>
		<span class="count"><b>{index + 1}</b> / {options.length}</span>
		<button class="step" onclick={() => go(1)} title="Next branch here (])" aria-label="Next branch">›</button>
	</div>
	<div class="lanes">
		{#each options as option (option.branch.id)}
			<button
				class="lane"
				class:current={option.current}
				class:busy={option.branch.busy}
				style="--h: {branchHue(option.branch.id)}"
				onclick={() => !option.current && pick(option.branch.id, at)}
				title="{option.branch.title}: {preview(option)}"
				aria-current={option.current}
			>
				<i></i><span>{option.branch.title}</span>
			</button>
		{/each}
	</div>
	{#if current}<span class="sr">Showing {current.branch.title}</span>{/if}
</div>

<style>
	.switcher {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 18px 0 0;
		font: 12px var(--sans);
		min-width: 0;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		flex: none;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 999px;
		box-shadow: var(--shadow-xs);
	}
	.step {
		border: none;
		background: none;
		color: var(--text-2);
		font: 16px/1 var(--sans);
		width: 26px;
		height: 24px;
		cursor: pointer;
		border-radius: 999px;
	}
	.step:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.count {
		font: 500 11.5px var(--mono);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
		min-width: 34px;
		text-align: center;
	}
	.count b {
		color: var(--text);
		font-weight: 600;
	}
	.lanes {
		display: flex;
		gap: 4px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.lane {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		max-width: 180px;
		border: none;
		background: none;
		color: var(--text-3);
		font: 500 12px var(--sans);
		padding: 3px 8px;
		border-radius: 999px;
		cursor: pointer;
	}
	.lane span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lane:hover {
		color: var(--text);
		background: var(--surface-2);
	}
	.lane.current {
		color: var(--text);
		background: hsl(var(--h) var(--lane-s) var(--lane-l) / 0.12);
		cursor: default;
	}
	.lane i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex: none;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		opacity: 0.55;
	}
	.lane.current i {
		opacity: 1;
	}
	.lane.busy i {
		animation: beat 1.2s ease-in-out infinite;
	}
	@keyframes beat {
		50% {
			box-shadow: 0 0 0 4px hsl(var(--h) var(--lane-s) var(--lane-l) / 0.25);
		}
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
