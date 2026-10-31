<script lang="ts">
	import type { BranchInfo, SharedNote } from "../../../../shared/protocol.ts";
	import { branchHue } from "../../../src/lib/layout.ts";
	import { ago } from "../lib.ts";

	type Props = {
		notes: readonly SharedNote[];
		branches: readonly BranchInfo[];
		openId: number | undefined;
		now: number;
		open: (id: number, entry?: number) => void;
		unshare: (noteId: string) => void;
		compose: () => void;
	};
	let { notes, branches, openId, now, open, unshare, compose }: Props = $props();

	let scope = $state<"all" | "open">("all");
	let expanded = $state<Set<string>>(new Set());

	const byId = $derived(new Map(branches.map((b) => [b.id, b])));
	const reaches = (note: SharedNote, id: number | undefined) => id !== undefined && (note.to === "*" || note.to.includes(id));
	const shown = $derived([...notes].sort((a, b) => b.createdAt - a.createdAt).filter((n) => scope === "all" || reaches(n, openId)));
	const openTitle = $derived(openId === undefined ? undefined : byId.get(openId)?.title);

	const flip = (id: string) => {
		const next = new Set(expanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expanded = next;
	};
</script>

<div class="inbox">
	<div class="bar">
		<div class="seg" role="tablist" aria-label="Which notes">
			<button role="tab" aria-selected={scope === "all"} class:on={scope === "all"} onclick={() => (scope = "all")}>All <span class="mono">{notes.length}</span></button>
			<button role="tab" aria-selected={scope === "open"} class:on={scope === "open"} disabled={openId === undefined} onclick={() => (scope = "open")}>
				Seen by {openTitle ?? "open branch"}
			</button>
		</div>
		<span class="spacer"></span>
		<button class="btn sm" onclick={compose}>＋ Note</button>
	</div>

	{#if shown.length === 0}
		<div class="empty">
			<p><strong>No shared context{scope === "open" ? " reaches this branch" : " yet"}.</strong></p>
			<p>Share a summary, a transcript, or a note from any branch (<kbd>s</kbd>). Models can post notes too, with their <code>post_note</code> tool.</p>
		</div>
	{/if}

	<ul>
		{#each shown as note (note.id)}
			{@const source = note.from === undefined ? undefined : byId.get(note.from.conversationId)}
			{@const long = note.text.length > 220 || note.text.split("\n").length > 4}
			<li>
				<div class="head">
					{#if openTitle && reaches(note, openId)}<span class="seen" title="In {openTitle}'s system prompt"></span>{/if}
					<span class="author {note.author}">{note.author === "model" ? "◆ Model" : "● You"}</span>
					<span class="title">{note.title}</span>
					<span class="when mono">{ago(note.createdAt, now)}</span>
				</div>
				<div class="route">
					{#if source && note.from}
						{@const from = note.from}
						<button class="chip" style="--hue: {branchHue(source.id)}" onclick={() => open(source.id, from.at)}><span class="dot"></span>{source.title}</button>
					{:else}
						<span class="chip faint">written</span>
					{/if}
					<span class="arrow">→</span>
					{#if note.to === "*"}
						<span class="chip all">✦ every branch</span>
					{:else}
						{#each note.to as id (id)}
							{@const target = byId.get(id)}
							<button class="chip" style="--hue: {branchHue(id)}" onclick={() => open(id)}><span class="dot"></span>{target?.title ?? `#${id}`}</button>
						{/each}
					{/if}
				</div>
				<div class="text" class:clamp={long && !expanded.has(note.id)}>{note.text}</div>
				<div class="foot">
					{#if long}<button class="btn ghost sm" onclick={() => flip(note.id)}>{expanded.has(note.id) ? "Less" : "More"}</button>{/if}
					<span class="spacer"></span>
					<button class="btn ghost sm danger" onclick={() => unshare(note.id)} title="Remove it from every target's system prompt">Unshare</button>
				</div>
			</li>
		{/each}
	</ul>
</div>

<style>
	.inbox {
		height: 100%;
		overflow-y: auto;
		padding: 12px 16px 96px;
		box-sizing: border-box;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.seg {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 8px;
		background: var(--sunken);
		border: 1px solid var(--line);
		min-width: 0;
	}
	.seg button {
		height: 24px;
		padding: 0 10px;
		border: none;
		border-radius: 6px;
		background: none;
		color: var(--text-2);
		font-size: 12px;
		font-weight: 550;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.seg button.on {
		background: var(--raised);
		color: var(--text);
		box-shadow: var(--shadow), 0 0 0 1px var(--line);
	}
	.seg button:disabled {
		opacity: 0.5;
	}
	.seg .mono {
		color: var(--text-3);
		margin-left: 2px;
	}
	.spacer {
		flex: 1;
	}
	.empty {
		margin: 40px auto;
		max-width: 420px;
		text-align: center;
		color: var(--text-2);
	}
	.empty p {
		margin: 4px 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	li {
		padding: 10px 12px 6px;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--panel);
		box-shadow: var(--shadow);
	}
	.seen {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.author {
		flex: none;
		padding: 0 6px;
		border-radius: 4px;
		font-size: 10.5px;
		font-weight: 650;
		line-height: 18px;
		background: var(--sunken);
		color: var(--text-2);
	}
	.author.model {
		background: var(--warn-soft);
		color: var(--warn);
	}
	.title {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		flex: none;
		color: var(--text-3);
		font-size: 11px;
	}
	.route {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		margin-top: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 7px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--sunken);
		color: var(--text-2);
		font-size: 11.5px;
	}
	button.chip:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}
	.chip.all {
		background: var(--accent-soft);
		border-color: transparent;
		color: var(--accent);
		font-weight: 550;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 2px;
		background: hsl(var(--hue) 62% 55%);
	}
	.arrow {
		color: var(--text-3);
		font-size: 12px;
		margin: 0 2px;
	}
	.faint {
		color: var(--text-3);
	}
	.text {
		margin-top: 8px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: var(--text-2);
		font-size: 12.5px;
		line-height: 1.55;
	}
	.text.clamp {
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.foot {
		display: flex;
		align-items: center;
		margin-top: 4px;
	}
	code {
		font-family: var(--mono);
		font-size: 0.9em;
	}
</style>
