<script lang="ts">
	import { branchHue } from "../../../src/lib/layout.ts";
	import { renderMarkdown } from "../../../src/lib/markdown.ts";
	import { textOf, type ConversationView } from "../../../src/lib/view.ts";
	import { entryText, lastExchange, shortModel, wordDiff, type Ordered } from "../lib.ts";
	import Icon from "./Icon.svelte";

	type Props = {
		pair: readonly [number, number];
		ordered: readonly Ordered[];
		views: Record<number, ConversationView>;
		pick: (side: 0 | 1, id: number) => void;
		reveal: (id: number) => void;
		close: () => void;
	};
	let { pair, ordered, views, pick, reveal, close }: Props = $props();

	let diff = $state(true);

	const side = (id: number) => {
		const branch = ordered.find((o) => o.branch.id === id)?.branch;
		const view = views[id];
		const { question, answer } = lastExchange(view);
		const partial = textOf(view?.docs["pi.live"]?.generation?.message?.content);
		// While the branch streams, compare against what it has written so far.
		const streaming = branch?.busy === true && partial !== "";
		return {
			id,
			branch,
			loading: view === undefined,
			question: entryText(question),
			answer: streaming ? partial : entryText(answer),
			streaming,
			inherited: answer !== undefined && answer.conversationId !== id && !streaming,
		};
	};
	const sides = $derived([side(pair[0]), side(pair[1])] as const);
	const parts = $derived(diff ? wordDiff(sides[0].answer, sides[1].answer) : undefined);
	const sameQuestion = $derived(sides[0].question !== "" && sides[0].question === sides[1].question);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
	<div class="compare" role="dialog" aria-modal="true" aria-label="Compare branches">
		<div class="bar">
			<Icon name="compare" size={18} />
			<h2>Compare last answers</h2>
			<label class="toggle"><input type="checkbox" bind:checked={diff} /> Highlight differences</label>
			<button class="icon" onclick={close} aria-label="Close compare"><Icon name="close" /></button>
		</div>
		<div class="panes">
			{#each sides as s, i (i)}
				<section class="pane" style="--hue: {branchHue(s.id)}">
					<div class="pane-head">
						<span class="dot" class:busy={s.branch?.busy}></span>
						<select value={s.id} onchange={(e) => pick(i as 0 | 1, Number(e.currentTarget.value))} aria-label="Branch for side {i + 1}">
							{#each ordered as { branch, depth } (branch.id)}
								<option value={branch.id}>{" ".repeat(depth * 2)}{branch.title}</option>
							{/each}
						</select>
						<span class="model">{shortModel(s.branch?.model)}</span>
						<button class="icon" onclick={() => (reveal(s.id), close())} title="Show its column"><Icon name="send" size={14} /></button>
					</div>
					{#if s.question}
						<div class="question" class:same={sameQuestion}>
							<span class="q">{sameQuestion ? "Same question" : "Asked"}</span>{s.question}
						</div>
					{/if}
					<div class="answer">
						{#if s.loading}
							<p class="muted">Loading…</p>
						{:else if s.answer === ""}
							<p class="muted">No answer yet in this branch.</p>
						{:else if parts}
							<div class="diff">{#each i === 0 ? parts.left : parts.right as part, k (k)}{#if part.changed}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</div>
						{:else}
							<div class="markdown">{@html renderMarkdown(s.answer)}</div>
						{/if}
					</div>
					<div class="foot">
						{#if s.streaming}<span class="live">streaming…</span>{/if}
						{#if s.inherited}<span>inherited from an ancestor branch</span>{/if}
						<span class="spacer"></span>
						<span>{s.answer.split(/\s+/).filter(Boolean).length} words</span>
					</div>
				</section>
			{/each}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 45;
		display: grid;
		place-items: center;
		padding: 24px;
		background: rgb(10 10 8 / 0.38);
		backdrop-filter: blur(3px);
	}
	.compare {
		display: flex;
		flex-direction: column;
		width: min(1100px, 100%);
		height: min(720px, 100%);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 16px;
		box-shadow: var(--shadow-lift);
		overflow: hidden;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px 12px 18px;
		border-bottom: 1px solid var(--border);
		color: var(--accent);
	}
	h2 {
		flex: 1;
		margin: 0;
		font-size: 16px;
		color: var(--text);
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.panes {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
	}
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border-top: 3px solid var(--c);
	}
	.pane + .pane {
		border-left: 1px solid var(--border);
	}
	.pane-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
	}
	.pane-head select {
		font-weight: 600;
		min-width: 0;
		max-width: 60%;
	}
	.model {
		flex: 1;
		font: 11px var(--mono);
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	.dot.busy {
		animation: pulse 1s ease-in-out infinite;
	}
	.question {
		margin: 0 14px;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--c-tint);
		font-size: 13px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		max-height: 96px;
		overflow: auto;
	}
	.q {
		display: block;
		font-size: 10.5px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}
	.answer {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 12px 16px;
		overflow-wrap: anywhere;
	}
	.diff {
		white-space: pre-wrap;
		line-height: 1.65;
	}
	mark {
		background: var(--c-soft);
		color: inherit;
		border-radius: 3px;
		box-shadow: 0 1px 0 var(--c);
		padding: 0 1px;
	}
	.foot {
		display: flex;
		gap: 10px;
		padding: 8px 16px;
		border-top: 1px solid var(--border);
		font-size: 11.5px;
		color: var(--text-faint);
	}
	.live {
		color: var(--c);
	}
	.spacer {
		flex: 1;
	}
	.muted {
		color: var(--text-faint);
	}
	@media (max-width: 760px) {
		.backdrop {
			padding: 0;
		}
		.compare {
			height: 100%;
			border-radius: 0;
		}
		.panes {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr 1fr;
		}
		.pane + .pane {
			border-left: none;
		}
	}
</style>
