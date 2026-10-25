<script lang="ts">
	import type { BranchInfo } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";

	export type Command = { id: string; label: string; hint?: string; run: () => void };

	type Props = {
		branches: readonly BranchInfo[];
		activeId: number | undefined;
		commands: readonly Command[];
		select: (id: number) => void;
		close: () => void;
	};
	let { branches, activeId, commands, select, close }: Props = $props();

	let query = $state("");
	let index = $state(0);
	let input: HTMLInputElement | undefined = $state();

	type Item = { key: string; label: string; hint?: string; hue?: number; busy?: boolean; current?: boolean; run: () => void };
	const items = $derived.by((): Item[] => {
		const q = query.trim().toLowerCase();
		const match = (text: string) => q === "" || text.toLowerCase().includes(q);
		return [
			...branches
				.filter((b) => match(b.title))
				.map((b) => ({ key: `b${b.id}`, label: b.title, hint: b.busy ? "running" : b.parent ? "branch" : "thread", hue: branchHue(b.id), busy: b.busy, current: b.id === activeId, run: () => select(b.id) })),
			...commands.filter((c) => match(c.label)).map((c) => ({ key: c.id, label: c.label, ...(c.hint !== undefined ? { hint: c.hint } : {}), run: c.run })),
		];
	});
	$effect(() => {
		void query;
		index = 0;
	});
	$effect(() => {
		input?.focus();
	});

	const run = (item: Item | undefined) => {
		if (item === undefined) return;
		close();
		item.run();
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			index = Math.min(index + 1, items.length - 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			index = Math.max(index - 1, 0);
		} else if (event.key === "Enter") {
			event.preventDefault();
			run(items[index]);
		} else if (event.key === "Escape") {
			close();
		}
	};
</script>

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="palette" role="dialog" aria-modal="true" aria-label="Go to a branch">
		<input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Go to a branch, or run a command…" aria-label="Search branches and commands" />
		<ul role="listbox">
			{#each items as item, i (item.key)}
				<li role="option" aria-selected={i === index}>
					<button class:on={i === index} onpointermove={() => (index = i)} onclick={() => run(item)} style={item.hue !== undefined ? `--h: ${item.hue}` : ""}>
						{#if item.hue !== undefined}<i class:busy={item.busy}></i>{:else}<span class="cmd">›</span>{/if}
						<span class="label">{item.label}</span>
						{#if item.current}<span class="hint">current</span>{:else if item.hint}<span class="hint">{item.hint}</span>{/if}
					</button>
				</li>
			{/each}
			{#if items.length === 0}<li class="none">Nothing matches.</li>{/if}
		</ul>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 55;
		background: var(--scrim);
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 14vh 16px 16px;
		animation: fade 0.12s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.palette {
		width: min(560px, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		box-shadow: var(--shadow-xl);
		overflow: hidden;
		font: 14px var(--sans);
	}
	input {
		width: 100%;
		box-sizing: border-box;
		border: none;
		border-bottom: 1px solid var(--border);
		background: none;
		outline: none;
		padding: 15px 18px;
		font: 16px var(--sans);
		color: var(--text);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 6px;
		max-height: 50vh;
		overflow: auto;
	}
	button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: 14px var(--sans);
		text-align: left;
		cursor: pointer;
	}
	button.on {
		background: var(--surface-2);
	}
	i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: hsl(var(--h) var(--lane-s) var(--lane-l));
		flex: none;
	}
	i.busy {
		animation: blink 1.1s infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.cmd {
		width: 9px;
		color: var(--text-3);
		text-align: center;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.hint {
		font: 11px var(--mono);
		color: var(--text-3);
	}
	.none {
		padding: 12px;
		color: var(--text-3);
	}
</style>
