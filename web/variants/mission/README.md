# Mission Control

Branches keep running after you leave them, so this variant treats them as parallel agents you supervise rather than as places on a canvas. The home screen is a dense board, like Linear or a CI dashboard: every branch is one row grouped by status (Running, Needs attention, Done · unread, Idle), with a live ticker of the text it is streaming, the tools it is running, its queue, model, shared-note count, cost and fork origin. Picking a row opens its chat in a side panel while the board stays visible, and a ⌘K command palette drives everything: switching, branching, sharing, renaming, changing models, stopping, and searching across every message in the tree.

## Interactions

- **Board.** Rows are grouped by status, or shown as an indented tree (`g`, or the Status/Tree toggle). Running rows show the streaming text as a ticker and the tools in progress. A branch that finished while you were away moves to *Done · unread* until you open it. The newest error moves it to *Needs attention*. An activity log under the board records starts, finishes, forks, renames and shared notes.
- **Focus panel.** The chat for the open branch, with a breadcrumb of its path (root › fork › fork) where each crumb opens that branch. Below the breadcrumb are the title (click to rename), status, model picker, shared-note count, a link to the fork point, and chips for the branch's own forks (a dot pulses on running ones). Context inherited from the parent folds into one line, so a fork reads as its own conversation.
- **While busy.** Enter queues a follow-up and Alt+Enter steers. *Stop* aborts. Queued and steering inputs are listed above the composer.
- **Per message.** *Branch* (fork after it), *Edit & branch* (fork just before a user message, with its full text in the composer), and *Share* (share the branch up to there).
- **Command palette (⌘K / Ctrl+K, or `/`).** Actions on the highlighted branch: *Branch from here*, *Share summary/transcript of X to…* (opens a multi-select of targets or *Every branch*), *Rename…*, *Change model…*, *Stop*. Global commands: *New branch*, *Write a note to…*, *Stop all running*, *Open context inbox*, grouping and theme. It also has *Switch to…* for every branch and fuzzy message search over the tree. ⌘↵ on a branch or a message branches from it.
- **Keyboard.** `j`/`k` move, `↵` opens, `space` selects, `b` branches from the latest message, `s` shares, `x` stops, `⇧X` stops all, `n` creates a new branch, `r` renames, `m` changes the model, `i` opens the context inbox, `1`–`9` jump to a row, and `esc` hands the keyboard back from the composer, then clears the selection, then closes the panel. A status bar shows the hints.
- **Bulk.** Select rows with checkboxes, `space`, or *Select* on touch screens. A floating bar sends one follow-up to all of them (busy ones queue it), shares a note to them, or stops them.
- **Context inbox.** Every shared note shows who wrote it (you, or a model through `post_note`), its source branch → targets (each one clickable), and its age. You can filter to the notes the open branch sees, expand long notes, and *Unshare*.
- **Share sheet.** You choose Summary, Transcript or Note, pick targets as chips (the current selection is preselected), and can add a title and a focus.
- **Phones.** The board turns into two-line cards, and the chat opens as a full-screen sheet with a *‹ Board* back button.

## Trade-offs vs the canvas UI

- **Better:** you can scan many branches at once. Status, liveness, queues, cost and errors are visible without opening anything, so running five things in parallel feels manageable. Everything is reachable from the keyboard, and message search finds a point to branch from without panning a canvas.
- **Worse:** the shape of the tree is weaker. The tree grouping shows branch-level parentage, but not message-level fork points side by side as the canvas does. You see where a branch forked through the breadcrumb and the fork-point link, not spatially.
- **Cost:** to show live tickers and error states, the board watches every branch, capped at 40, preferring the open, running and selected ones. The canvas UI watches only the open branch. With many large branches this means more data over the socket.
- *Done · unread* is tracked in memory for the current tab only, so a reload marks everything as seen.
