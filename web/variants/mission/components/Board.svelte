<script lang="ts">
	import { ago, money, splitModel, STATUS_LABEL, type FeedEvent, type Row, type Status } from "../lib.ts";
	import StatusIcon from "./StatusIcon.svelte";

	export type Section = { key: string; label: string; status?: Status; rows: Row[] };

	type Props = {
		sections: Section[];
		tree: boolean;
		/** Show checkboxes even before anything is selected (touch screens have no hover). */
		selecting: boolean;
		cursorId: number | undefined;
		openId: number | undefined;
		selected: ReadonlySet<number>;
		feed: readonly FeedEvent[];
		now: number;
		open: (id: number) => void;
		toggle: (id: number) => void;
		toggleMany: (ids: number[]) => void;
	};
	let { sections, tree, selecting, cursorId, openId, selected, feed, now, open, toggle, toggleMany }: Props = $props();

	const all = $derived(sections.flatMap((s) => s.rows.map((r) => r.branch.id)));
	const allSelected = $derived(all.length > 0 && all.every((id) => selected.has(id)));
	const anySelected = $derived(selecting || selected.size > 0);

	// Keep the keyboard cursor in view as j/k move it.
	let list: HTMLElement | undefined = $state();
	$effect(() => {
		const id = cursorId;
		if (id === undefined || list === undefined) return;
		list.querySelector(`[data-branch="${id}"]`)?.scrollIntoView({ block: "nearest" });
	});

	const FEED_ICON: Record<FeedEvent["kind"], string> = {
		start: "run",
		finish: "ok",
		error: "err",
		fork: "fork",
		new: "fork",
		note: "note",
		unshare: "muted",
	};
</script>

<div class="board" bind:this={list} class:selecting={anySelected}>
	<div class="head" role="presentation">
		<span class="c-check">
			<button
				class="check"
				class:on={allSelected}
				aria-label={allSelected ? "Clear selection" : "Select all"}
				onclick={() => toggleMany(allSelected ? all : all.filter((id) => !selected.has(id)))}
			></button>
		</span>
		<span class="c-status"></span>
		<span class="c-title">Branch</span>
		<span class="c-activity">Latest activity</span>
		<span class="c-model">Model</span>
		<span class="c-queue" title="Inputs queued behind the current run">Queue</span>
		<span class="c-notes" title="Shared notes this branch's model sees">Notes</span>
		<span class="c-msgs" title="Messages in this branch">Msgs</span>
		<span class="c-cost">Cost</span>
	</div>

	{#each sections as section (section.key)}
		{#if section.status !== undefined}
			<div class="group {section.status}">
				<StatusIcon status={section.status} size={12} />
				<span class="group-label">{section.label}</span>
				<span class="group-count mono">{section.rows.length}</span>
			</div>
		{/if}
		{#each section.rows as row (row.branch.id)}
			{@const b = row.branch}
			{@const [provider, model] = splitModel(b.model)}
			<div
				class="row"
				class:cursor={b.id === cursorId}
				class:open={b.id === openId}
				class:selected={selected.has(b.id)}
				data-branch={b.id}
				style="--hue: {row.hue}"
			>
				<button class="hit" onclick={() => open(b.id)} aria-label="Open {b.title}"></button>
				<span class="c-check">
					<button class="check" class:on={selected.has(b.id)} aria-label="Select {b.title}" onclick={() => toggle(b.id)}></button>
					{#if row.key !== undefined}<span class="hotkey mono">{row.key}</span>{/if}
				</span>
				<span class="c-status"><StatusIcon status={row.status} /></span>
				<span class="c-title" style="--depth: {tree ? row.depth : 0}">
					{#if tree && row.depth > 0}<span class="elbow" aria-hidden="true"></span>{/if}
					<span class="swatch" aria-hidden="true"></span>
					<span class="title">{b.title}</span>
					{#if row.origin !== undefined && !tree}<span class="origin" title="Forked from {row.origin}">↳ {row.origin}</span>{/if}
				</span>
				<span class="c-activity">
					{#if b.busy}
						{#each row.tools as tool, i (i)}<span class="tool mono">⚙ {tool}</span>{/each}
						{#if row.live !== ""}
							<span class="ticker mono"><span>{row.live.slice(-220)}<i class="caret"></i></span></span>
						{:else if row.tools.length === 0}
							<span class="thinking">Working…</span>
						{/if}
					{:else if row.status === "errored"}
						<span class="err-text">The last answer failed. Open to retry or branch.</span>
					{:else if row.preview}
						<span class="preview"><span class="who">{row.preview.role === "user" ? "You" : row.preview.role === "assistant" ? "AI" : "⇄"}</span>{row.preview.text}</span>
					{:else}
						<span class="faint">Empty — waiting for a first message</span>
					{/if}
				</span>
				<span class="c-model" title={b.model}><span class="model mono">{#if provider}<span class="faint">{provider}/</span>{/if}{model}</span></span>
				<span class="c-queue">{#if b.queued > 0}<span class="badge warn mono">+{b.queued}</span>{/if}</span>
				<span class="c-notes">{#if b.sharedIn > 0}<span class="badge mono" title="{b.sharedIn} shared notes">⇄ {b.sharedIn}</span>{/if}</span>
				<span class="c-msgs mono">{row.messages}</span>
				<span class="c-cost mono">{b.costUsd > 0 ? money(b.costUsd) : ""}</span>
			</div>
		{/each}
	{/each}

	{#if feed.length > 0}
		<section class="feed" aria-label="Recent activity">
			<h3>Activity</h3>
			<ol>
				{#each feed.slice(0, 14) as event (event.id)}
					<li>
						<span class="when mono">{ago(event.at, now)}</span>
						<span class="mark {FEED_ICON[event.kind]}"></span>
						{#if event.branchId !== undefined}
							{@const id = event.branchId}
							<button class="feed-text" onclick={() => open(id)}>{event.text}</button>
						{:else}
							<span class="feed-text">{event.text}</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}
</div>

<style>
	.board {
		container: board / inline-size;
		height: 100%;
		overflow-y: auto;
		padding-bottom: 96px;
		box-sizing: border-box;
	}
	.head,
	.row {
		display: grid;
		grid-template-columns: 26px 22px minmax(150px, 1.15fr) minmax(0, 2fr) 104px 48px 48px 40px 64px;
		align-items: center;
		column-gap: 8px;
		padding: 0 16px 0 10px;
	}
	.head {
		position: sticky;
		top: 0;
		z-index: 2;
		height: 30px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
		color: var(--text-3);
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.02em;
	}
	.c-queue,
	.c-notes,
	.c-msgs,
	.c-cost {
		text-align: right;
		justify-self: end;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 16px 0 18px;
		margin-top: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	.group-count {
		color: var(--text-3);
		font-weight: 500;
	}
	.row {
		position: relative;
		height: 40px;
		border-radius: 0;
		color: var(--text);
		border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
	}
	.row:hover {
		background: var(--hover);
	}
	.row.open {
		background: var(--accent-soft);
	}
	.row.cursor::before {
		content: "";
		position: absolute;
		left: 0;
		top: 6px;
		bottom: 6px;
		width: 2px;
		border-radius: 2px;
		background: var(--accent);
	}
	.row.selected {
		background: color-mix(in srgb, var(--accent) 7%, transparent);
	}
	.hit {
		position: absolute;
		inset: 0;
		border: none;
		background: none;
		padding: 0;
	}
	.row > span {
		position: relative;
		pointer-events: none;
		min-width: 0;
	}
	.c-check {
		display: grid;
		place-items: center;
	}
	.row .c-check {
		pointer-events: auto;
	}
	.check {
		width: 14px;
		height: 14px;
		padding: 0;
		border-radius: 4px;
		border: 1.5px solid var(--line-strong);
		background: var(--panel);
		opacity: 0;
		grid-area: 1 / 1;
		transition: opacity 0.1s;
	}
	.check.on {
		background: var(--accent);
		border-color: var(--accent);
		opacity: 1;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.4l2.5 2.4L12 5.4' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	}
	.hotkey {
		grid-area: 1 / 1;
		pointer-events: none;
		color: var(--text-3);
		font-size: 11px;
		transition: opacity 0.1s;
	}
	.row:hover .check,
	.selecting .check,
	.head:hover .check,
	.check:focus-visible {
		opacity: 1;
	}
	.row:hover .hotkey,
	.selecting .hotkey {
		opacity: 0;
	}
	.c-title {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-left: calc(var(--depth) * 18px);
	}
	.elbow {
		flex: none;
		width: 10px;
		height: 12px;
		margin: -10px -2px 0 -14px;
		border-left: 1.5px solid var(--line-strong);
		border-bottom: 1.5px solid var(--line-strong);
		border-bottom-left-radius: 5px;
	}
	.swatch {
		flex: none;
		width: 3px;
		height: 14px;
		border-radius: 2px;
		background: hsl(var(--hue) 62% 55%);
	}
	.title {
		flex: 0 1 auto;
		min-width: 48px;
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.origin {
		flex: 0 4 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-3);
		font-size: 11.5px;
	}
	.c-activity {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		color: var(--text-2);
	}
	.preview {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who {
		display: inline-block;
		min-width: 22px;
		margin-right: 6px;
		color: var(--text-3);
		font-size: 10.5px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.ticker {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: flex-end;
		overflow: hidden;
		white-space: nowrap;
		font-size: 11.5px;
		color: var(--run);
		mask-image: linear-gradient(to right, transparent, black 40px);
	}
	/* At least as wide as the cell: short text starts at the left, long text overflows off the left edge. */
	.ticker > span {
		flex: none;
		min-width: 100%;
	}
	.caret {
		display: inline-block;
		vertical-align: -2px;
		width: 6px;
		height: 13px;
		margin-left: 2px;
		background: var(--run);
		animation: blink 1s steps(1) infinite;
	}
	.thinking {
		color: var(--run);
		font-size: 12px;
		background: linear-gradient(90deg, var(--run) 30%, var(--text-3) 50%, var(--run) 70%) 0 0 / 200% 100%;
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		animation: shimmer 1.6s linear infinite;
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
	.tool {
		flex: none;
		padding: 1px 6px;
		border-radius: 5px;
		background: var(--run-soft);
		color: var(--run);
		font-size: 11px;
	}
	.err-text {
		color: var(--err);
	}
	.faint {
		color: var(--text-3);
	}
	.model {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11.5px;
		color: var(--text-2);
	}
	.badge {
		display: inline-block;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--sunken);
		border: 1px solid var(--line);
		color: var(--text-2);
		font-size: 11px;
		line-height: 18px;
	}
	.badge.warn {
		background: var(--warn-soft);
		border-color: transparent;
		color: var(--warn);
	}
	.c-msgs,
	.c-cost {
		color: var(--text-2);
		font-size: 12px;
	}
	.feed {
		margin: 28px 16px 0 18px;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 1px solid var(--line);
		margin-left: 40px;
	}
	li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 26px;
		font-size: 12px;
	}
	.when {
		position: absolute;
		left: -40px;
		width: 32px;
		text-align: right;
		color: var(--text-3);
		font-size: 11px;
	}
	.mark {
		flex: none;
		width: 7px;
		height: 7px;
		margin-left: -4px;
		border-radius: 50%;
		background: var(--text-3);
		box-shadow: 0 0 0 3px var(--bg);
	}
	.mark.run {
		background: var(--run);
	}
	.mark.ok {
		background: var(--ok);
	}
	.mark.err {
		background: var(--err);
	}
	.mark.fork {
		background: var(--accent);
	}
	.mark.note {
		background: var(--warn);
	}
	.feed-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-2);
		background: none;
		border: none;
		padding: 0;
		text-align: left;
		font-size: 12px;
	}
	button.feed-text:hover {
		color: var(--text);
		text-decoration: underline;
		text-decoration-color: var(--line-strong);
		text-underline-offset: 3px;
	}

	/* Narrower boards (a chat panel open beside it) drop the least useful columns first. */
	@container board (max-width: 940px) {
		.head,
		.row {
			grid-template-columns: 26px 22px minmax(140px, 1fr) minmax(0, 1.5fr) 96px 44px 44px;
		}
		.c-msgs,
		.c-cost {
			display: none;
		}
	}
	@container board (max-width: 720px) {
		.head,
		.row {
			grid-template-columns: 26px 22px minmax(120px, 1fr) minmax(0, 1.4fr) 40px 40px;
		}
		.c-model {
			display: none;
		}
	}
	/* Phone width: two-line cards, the activity under the title. */
	@container board (max-width: 600px) {
		.head {
			display: none;
		}
		.row {
			grid-template-columns: 0 22px minmax(0, 1fr) auto auto;
			grid-template-areas: "check status title queue notes" "check status activity activity cost";
			height: auto;
			padding: 10px 16px;
			row-gap: 3px;
		}
		.c-check {
			grid-area: check;
			visibility: hidden;
		}
		.selecting .row {
			grid-template-columns: 22px 22px minmax(0, 1fr) auto auto;
		}
		.selecting .c-check {
			visibility: visible;
		}
		.c-status {
			grid-area: status;
			align-self: start;
			padding-top: 2px;
		}
		.c-title {
			grid-area: title;
		}
		.c-activity {
			grid-area: activity;
			font-size: 12.5px;
		}
		.c-queue {
			grid-area: queue;
		}
		.c-notes {
			grid-area: notes;
		}
		.c-cost {
			display: block;
			grid-area: cost;
			font-size: 11px;
		}
		.group {
			padding-left: 16px;
		}
		.feed {
			margin-left: 16px;
		}
	}
</style>
