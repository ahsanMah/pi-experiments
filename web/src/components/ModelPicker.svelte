<script lang="ts">
	// The branch's model, as a button that opens a searchable list. A plain <select> is unusable
	// with a couple of hundred models, so this filters them with the palette's fuzzy matcher and
	// highlights what matched. Used by the chat header and the spatial focus panel.
	import { tick } from "svelte";
	import { fuzzy, highlight } from "../lib/fuzzy.ts";

	type Props = {
		/** `provider/modelId` currently on the branch. */
		value: string;
		models: readonly string[];
		pick: (model: string) => void;
		/** The model new branches use, marked in the list. */
		defaultModel?: string;
		title?: string;
	};
	let { value, models, pick, defaultModel, title = "Model for this branch" }: Props = $props();

	let open = $state(false);
	let query = $state("");
	let cursor = $state(0);
	let root: HTMLElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let listbox: HTMLElement | undefined = $state();

	// A model the server no longer lists (set before a restart, say) still belongs in the list.
	const all = $derived(value !== "" && !models.includes(value) ? [value, ...models] : models);
	const matches = $derived.by(() => {
		const q = query.trim();
		if (q === "") return all.map((model) => ({ model, hits: [] as number[] }));
		const scored: { model: string; hits: number[]; score: number }[] = [];
		for (const model of all) {
			const match = fuzzy(q, model);
			if (match !== null) scored.push({ model, hits: match.hits, score: match.score });
		}
		scored.sort((a, b) => b.score - a.score);
		return scored;
	});

	const show = async () => {
		query = "";
		open = true;
		cursor = Math.max(
			0,
			matches.findIndex((m) => m.model === value),
		);
		await tick();
		input?.focus();
		scrollToCursor();
	};
	const hide = () => {
		open = false;
		query = "";
	};
	const choose = (model: string) => {
		hide();
		if (model !== value) pick(model);
	};
	const scrollToCursor = () => {
		listbox?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
	};
	const move = async (delta: number) => {
		if (matches.length === 0) return;
		cursor = (cursor + delta + matches.length) % matches.length;
		await tick();
		scrollToCursor();
	};
	const onKeyDown = (event: KeyboardEvent) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				return void move(1);
			case "ArrowUp":
				event.preventDefault();
				return void move(-1);
			case "Home":
				event.preventDefault();
				cursor = 0;
				return void tick().then(scrollToCursor);
			case "End":
				event.preventDefault();
				cursor = matches.length - 1;
				return void tick().then(scrollToCursor);
			case "Enter": {
				event.preventDefault();
				const hit = matches[cursor];
				if (hit !== undefined) choose(hit.model);
				return;
			}
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				hide();
				return;
			case "Tab":
				hide();
		}
	};

</script>

<svelte:window
	onpointerdown={(event) => {
		if (open && root !== undefined && !root.contains(event.target as Node)) hide();
	}}
/>

<div class="picker" bind:this={root}>
	<button
		type="button"
		class="current"
		{title}
		aria-label="Model"
		aria-haspopup="listbox"
		aria-expanded={open}
		onclick={() => (open ? hide() : void show())}
	>
		<span class="name">{value || "choose a model"}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<div class="menu">
			<input
				bind:this={input}
				bind:value={query}
				type="text"
				placeholder="Search models…"
				aria-label="Search models"
				autocomplete="off"
				spellcheck="false"
				oninput={() => {
					// Back to the best match, and to the top: the list is still scrolled to the current model.
					cursor = 0;
					if (listbox !== undefined) listbox.scrollTop = 0;
				}}
				onkeydown={onKeyDown}
			/>
			<div class="list" role="listbox" aria-label="Models" bind:this={listbox}>
				{#each matches as match, index (match.model)}
					<button
						type="button"
						class="option"
						class:active={index === cursor}
						class:current={match.model === value}
						role="option"
						aria-selected={match.model === value}
						data-index={index}
						onmousemove={() => (cursor = index)}
						onclick={() => choose(match.model)}
					>
						<span class="tick" aria-hidden="true">{match.model === value ? "✓" : ""}</span>
						<span class="label"
							>{#each highlight(match.model, match.hits) as run, i (i)}{#if run.hit}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}</span
						>
						{#if match.model === defaultModel}<span class="detail">default</span>{/if}
					</button>
				{:else}
					<p class="none">No model matches “{query}”.</p>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		display: inline-flex;
	}
	.current {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 220px;
		height: 32px;
		padding: 0 8px;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		cursor: pointer;
	}
	.current:hover {
		border-color: var(--accent);
	}
	.current .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caret {
		color: var(--text-muted);
		font-size: 10px;
	}
	.menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 40;
		width: min(360px, 80vw);
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
		overflow: hidden;
	}
	.menu input {
		border: none;
		border-bottom: 1px solid var(--border);
		border-radius: 0;
		background: var(--surface-muted);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		padding: 9px 11px;
	}
	.menu input:focus {
		outline: none;
	}
	.list {
		max-height: min(320px, 50vh);
		overflow-y: auto;
		padding: 4px;
	}
	.option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 12.5px;
		text-align: left;
		cursor: pointer;
	}
	.option.active {
		background: var(--accent-soft);
	}
	.option .tick {
		width: 10px;
		color: var(--accent);
	}
	.option .label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.option mark {
		background: none;
		color: var(--accent);
		font-weight: 600;
	}
	.detail {
		color: var(--text-muted);
		font-size: 11px;
	}
	.none {
		margin: 0;
		padding: 10px;
		color: var(--text-muted);
		font-size: 12.5px;
	}
	@media (max-width: 720px) {
		.current {
			max-width: 104px;
		}
	}
</style>
