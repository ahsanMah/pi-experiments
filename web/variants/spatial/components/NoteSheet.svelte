<script lang="ts">
	// A sticky opened up: its full text, who sees it (toggle branches to re-share), and unshare.
	import { untrack } from "svelte";
	import type { SharedNote } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { useSpace } from "../lib/space.svelte.ts";
	import Icon from "./Icon.svelte";

	let { note }: { note: SharedNote } = $props();
	const space = useSpace();

	let everyone = $state(untrack(() => note.to) === "*");
	let targets = $state<Set<number>>(new Set(untrack(() => (note.to === "*" ? [] : note.to))));
	let saving = $state(false);
	const source = $derived(space.branch(note.from?.conversationId ?? null));
	const changed = $derived(
		everyone !== (note.to === "*") || (!everyone && (note.to === "*" || note.to.length !== targets.size || note.to.some((id) => !targets.has(id)))),
	);
	const close = () => (space.noteOpen = null);

	const toggle = (id: number) => {
		const next = new Set(targets);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		targets = next;
	};
	const apply = async () => {
		saving = true;
		await space.retarget(note, everyone ? "*" : [...targets]);
		saving = false;
		close();
	};
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="note" class:model={note.author === "model"} role="dialog" aria-modal="true" aria-labelledby="note-title">
		<div class="kind">
			<Icon name={note.author === "model" ? "spark" : "sticky"} size={12} />
			{note.author === "model" ? "Posted by a model" : "Shared by you"}{#if source} · from {source.title}{/if} · {new Date(note.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
			<button class="x" onclick={close} aria-label="Close"><Icon name="close" /></button>
		</div>
		<h2 id="note-title">{note.title}</h2>
		<div class="text">{note.text}</div>

		<div class="label">Seen by</div>
		<div class="targets">
			<button class="target all" class:on={everyone} onclick={() => (everyone = !everyone)} aria-pressed={everyone}><Icon name="globe" size={13} />Every branch</button>
			{#if !everyone}
				{#each space.client.tree.branches as branch (branch.id)}
					<button class="target" class:on={targets.has(branch.id)} style="--hue: {branchHue(branch.id)}" onclick={() => toggle(branch.id)} aria-pressed={targets.has(branch.id)}><i></i>{branch.title}</button>
				{/each}
			{/if}
		</div>
		<div class="foot">
			<button
				class="danger"
				onclick={() => {
					space.unshare(note.id);
					close();
				}}><Icon name="trash" size={14} />Unshare</button
			>
			<span class="spacer"></span>
			<button class="primary" disabled={!changed || saving} onclick={apply}>{saving ? "Saving…" : "Update audience"}</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 16px;
		background: var(--scrim);
		backdrop-filter: blur(3px);
	}
	.note {
		width: min(520px, 100%);
		max-height: calc(100vh - 32px);
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		padding: 20px 22px 16px;
		border-radius: 6px 6px 22px 6px;
		background: var(--sticky);
		color: var(--sticky-text);
		box-shadow: var(--shadow-panel);
		animation: pop 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.15);
	}
	.note.model {
		background: var(--sticky-model);
	}
	@keyframes pop {
		from {
			transform: rotate(-2deg) scale(0.94);
			opacity: 0;
		}
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--sticky-ink);
	}
	.x {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: none;
		border-radius: 8px;
		background: none;
		color: inherit;
		cursor: pointer;
	}
	.x:hover {
		background: rgb(0 0 0 / 0.07);
	}
	h2 {
		margin: 6px 0 8px;
		font-size: 19px;
		letter-spacing: -0.015em;
	}
	.text {
		flex: 1;
		min-height: 60px;
		overflow: auto;
		white-space: pre-wrap;
		font-size: 14px;
		line-height: 1.55;
		padding-bottom: 12px;
	}
	.label {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--sticky-ink);
		margin: 6px 0;
	}
	.targets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 14px;
	}
	.target {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 30px;
		padding: 0 12px;
		border-radius: 999px;
		border: 1.5px solid rgb(0 0 0 / 0.12);
		background: rgb(255 255 255 / 0.35);
		color: inherit;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
		opacity: 0.75;
	}
	.target i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: hsl(var(--hue) 62% 50%);
	}
	.target.on {
		opacity: 1;
		border-color: currentColor;
		background: rgb(255 255 255 / 0.6);
	}
	.foot {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.spacer {
		flex: 1;
	}
	.foot button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		padding: 0 14px;
		border-radius: 10px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.danger {
		border: 1px solid rgb(0 0 0 / 0.12);
		background: none;
		color: var(--danger);
	}
	.primary {
		border: none;
		background: var(--sticky-text);
		color: var(--sticky);
	}
	.primary:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
