# Columns

Every open branch is a full chat column, laid side by side on a horizontally scrolling strip, the way Miller columns, TweetDeck or a diff viewer lay out related things. You can watch several branches stream at once and read their answers next to each other. A column shows only what its branch added after the fork point. The shared prefix is folded into a stub that shows the fork-point message, so three siblings don't repeat the same history three times. Above the strip, a small branch map draws the tree in the same left-to-right order as the columns. It works as the overview and as the control for which branches are open.

## Interactions

- **Columns in tree order.** Each fork sits right after the branch it came from, newest sibling first. *Branch* on a message forks and slides a new column in beside its parent, then focuses that column's composer. *Edit* (on a user message) forks just before the message and puts its full text, fetched with the `text` request, into the new column's composer.
- **Column header.** It shows the title (click to rename), a busy pulse with the queued count, the cost, and a per-branch model picker. A breadcrumb (`Main @ "…"`) scrolls the parent column to the fork point and flashes it, expanding the folded ancestry if needed. Header buttons pick the column for compare, branch from its end, pin it, or close it. Closing a column leaves the branch running.
- **Folded ancestry.** The stub reads "N earlier messages from Main › WAL" and expands in place. Messages that other branches fork from carry "branched here" chips that open or scroll to those columns.
- **Branch map.** It shows filled chips for open columns, dashed chips for closed ones, and a pulse on busy branches. Click a chip to open its column at its place in tree order, or to scroll to it. The × on a chip closes the column. The map also has *Open all* and *Only active*, and it collapses to a row of dots.
- **Context tray.** Under each header are the shared notes this branch's model sees. Click one to read its text, source and targets, or to unshare it. *+ note* writes a note straight into that branch.
- **Share by drag or menu.** Drag a message's grip onto another column to open the share sheet with that column already targeted. *Share* on any message opens the same sheet, where you choose summary, transcript or note, and chosen branches or every branch. *Note* in the top bar writes a free note.
- **Composer per column.** Enter sends. While the branch is busy, Enter queues and Alt+Enter (or *Steer*) steers. *Stop* aborts the run.
- **Compare.** Pick two columns (header button, or *Compare* in the top bar). A pill confirms the pair, and the compare view shows their last question and answer side by side, with optional word-level difference highlighting. A pane that is still streaming compares what has been written so far.
- **Layout.** Column width can be *Fit* (open columns share the window) or a fixed S, M or L. Pinned columns stick to the left edge while the rest scroll under them. Alt+←/→ moves between columns. The theme toggle cycles system, light and dark by setting `data-theme`.
- **Phone.** One column fills the screen. Swipe between columns (scroll snap) or tap the tabs. The map opens as an indented tree sheet. Message actions are always visible, and the busy buttons move to their own row.

## Trade-offs vs the canvas UI

- **Gains.** Parallel work is visible: you can see two or three branches streaming at once without switching. Comparing answers is direct, by reading across or using compare mode. Folding the shared ancestry makes forks cheap to read. Branching feels spatial, because the new column appears next to its parent.
- **Losses.** The map shows branches, not individual messages, so there is no message-level overview like the canvas's node tree. Deep or wide trees mean horizontal scrolling. Beyond about 4 open columns, each one gets narrow, so you curate which columns are open. Fork points are not aligned vertically across columns. Each column scrolls on its own, and the stub plus breadcrumb do the cross-referencing.
- **Cost.** Every open column is a live subscription (`client.watch` of all open ids), so many open columns mean more traffic than the single-chat canvas UI.
