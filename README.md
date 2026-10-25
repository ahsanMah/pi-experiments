# pi-branches

Canvas-style conversation branching on [pi-durable](https://github.com/earendil-works/pi/tree/main/packages/durable): start a thread, branch from any message while the original keeps working, jump between branches from an overview of the whole tree, and share context between branches.

```
pi-durable Harness (one process, SQLite) ── every branch is a conversation; forks keep parent edges
  ├─ "branches" extension: shared-notes section in each branch's system prompt,
  │                        list_branches / read_branch / post_note tools for the models
  └─ WebSocket /ws: tree index + each watched conversation's view as Chord ops
        ├─ web/  Svelte 5 + @xyflow/svelte canvas (the library Open WebUI's Overview uses) + chat
        └─ tui/  pi-tui terminal client with a tree overlay
```

## Run

```bash
npm install
npm run build                     # web client into web/dist
PI_MODEL=anthropic/claude-sonnet-5-5 npm run server   # http://localhost:8787
```

The server uses your pi coding agent setup: credentials from `~/.pi/agent/auth.json` (API keys and `/login` subscriptions), custom providers from `models.json`, and the default model and thinking level from `settings.json`. It loads them through the coding agent's own `ModelRuntime`, so every model you can pick in `pi` is in each branch's model picker. `PI_CODING_AGENT_DIR` points it at another agent directory, `PI_MODEL` overrides the default, and environment keys (`ANTHROPIC_API_KEY`, …) work too. With no default model anywhere, it uses `faux/echo`, an offline model that echoes, so everything works without a key.

| Variable | Default | Meaning |
|---|---|---|
| `PI_MODEL` | pi's default model, else `faux/echo` | Model for new conversations, `provider/modelId` |
| `PI_BRANCHES_PI_CONFIG` | `1` | `0` ignores the pi setup and uses environment keys only |
| `PI_BRANCHES_DB` | `./branches.sqlite` | SQLite file holding the whole tree |
| `PI_BRANCHES_CWD` | unset | Enables pi-durable's coding tools (read, write, edit, bash) in this directory |
| `PORT` | `8787` | HTTP and WebSocket port |
| `HOST` | `127.0.0.1` | Interface to listen on |

`npm run build:demo` builds `web/dist-demo/pi-branches-demo.html`, a single page that runs the server in the browser with the echo model and a seeded tree. Nothing is saved.

For web development, run `npm run server` and `npm run web` (Vite on :5173, proxying `/ws`). Run the terminal client with `npm run tui`.

## Workflow

- **Branch while it works.** Hover a message (or select a canvas node) and choose *Branch*: a new conversation continues after that message. The branch you left keeps running on the server; its dot pulses in the sidebar and on the canvas.
- **Edit and branch.** On a user message, *Edit & branch* forks just before it and puts its text in the composer, like editing a message in Open WebUI.
- **Overview.** The right panel draws every branch as one message tree, color-coded per branch, with the active path highlighted. Click a node to open it. Alt+O cycles side, full screen, and hidden. The viewport follows the chat unless pinned. Vertical and horizontal layouts are available, as in Open WebUI.
- **Share context.** *Share…* on a message or node sends a model-written **summary** or the **transcript** of that branch up to there, or a **note** you write, to chosen branches or every branch. Shared notes are kept in a session-wide document and rendered into each target's system prompt, so they apply from the target's next model request, even mid-run. A marker in the target's transcript shows where a note arrived; expand it to read the note. The ⇄ badge in a branch's header lists every note that branch's model sees, and the sidebar lists all notes. Unshare from any of them. In the terminal, notes show under their marker and `/notes` opens each one in full.
- **Models know the tree.** Each branch's system prompt says which branch it is and where it forked, and the model gets `list_branches` (marks its own branch and what each started with), `read_branch`, `post_note`, and `suggest_branch`.
- **Suggested branches.** A model can propose a side inquiry with `suggest_branch`. Nothing is created until you open it, from the card under that answer, the sidebar, or `/suggestions` in the terminal: then it forks after that answer and puts the proposed first message in the composer for you to edit and send.
- **Names.** A new thread is "Main" and a branch is "Branch N" until you rename it (click the title in the web header, `r` in the terminal overview, or `/rename`). The offline echo model calls the tree tools when asked to "list branches", "post a note: …", or "suggest a branch about …".
- **While busy.** Enter queues a follow-up, *Steer* (Alt+Enter) joins the running work after the current tool round, and *Stop* aborts.

## How it maps onto pi-durable

| Need | pi-durable |
|---|---|
| A branch | `conversation.fork(entryId)`; the record keeps `parent: { conversationId, at }` |
| Branches running at once | Each conversation has its own runs; the Harness schedules them all |
| The overview | All conversations' own entries, linked through fork points (`server/tree.ts`) |
| Live chat | `conversation.watch()` frames, applied in the browser with `applyImmutable` from `@earendil-works/chord/delta` |
| Shared context | A `scope: "session"` document plus a prompt `section` (`server/branches.ts`) |
| Summaries | `models.completeSimple()` with the source branch's own model, outside the tree |
| Recovery | SQLite storage; a restarted server resumes unfinished runs |

## Checks

```bash
npm run check      # tsc + svelte-check
npm run smoke      # protocol end to end against the echo model
npm run build && npm run e2e:web   # browser end to end (needs Playwright with Chromium)
```

## Limits

- pi-durable is experimental; its API changes between releases. This targets 1.4.0.
- One server process owns the database (pi-durable has no cross-process locking); every client connects to it.
- With coding tools on, branches share one working directory, so parallel branches can edit the same files.
- The chat shows a branch's active context. History hidden by a compaction or reset stays in storage and on the canvas, but not in the chat.
- No authentication: it listens on localhost by default; set `HOST` only behind your own proxy.
