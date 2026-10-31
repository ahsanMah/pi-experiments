# Rail

Chat-first pi-branches. There is no canvas: one branch is read at a time in a typeset column (serif answers, sans questions, mono metadata), and the whole tree is drawn in the gutter beside it like `git log --graph` or a line map. The active path is a bold lane next to the text, with one dot per message. It changes colour where the branch leaves its parent. Every other branch leaves that lane at a fork junction and continues as a faded, compressed side lane, one small dot per message, ending in a named tip. Forks also appear in the transcript as a `‹ 2 / 3 ›` switcher at the point where the conversations diverge, so you can move between sibling branches without losing your place.

Build the demo with `VARIANT=rail npm run build:variant`, which writes `dist/pi-branches-rail.html`.

## Interactions

- **Rail.** Lanes are hand-drawn SVG (`lib/rail.ts` lays them out, `components/Rail.svelte` draws them). Side lanes get columns by interval colouring, so they never overlap, and nested forks step further out. Tip names sit in a right-aligned label column with dotted leaders to their tips. Running branches pulse at their tip. New lanes draw themselves in.
- **Hover a dot** to see a preview card (branch, role or model, message preview). **Click a dot**: on the active lane it jumps to that message, and on a side lane it opens that branch scrolled to that message. Click a tip name to open that branch.
- **Inline switcher** after each fork point: `‹ ›` or the named pills open the sibling branch. The chip stays at the same place on screen; the page adds slack at the end when the new branch is shorter. A dotted tie and a diamond junction connect the chip to the rail.
- **Shared notes are stations.** Each note arrives as a ring station on the lane and as an "Arrived" card in the transcript. Expand the card to read the note or unshare it. The Lines panel lists every note with its source, targets and an Unshare button.
- **Message toolbar** on hover (always shown on touch): Branch, Edit & branch (on questions; forks at `before` with the full text from the `text` request), Share, Copy.
- **Composer** at the bottom: auto-growing input and a per-branch model pill (`configure`). While the branch is busy, Enter queues and Alt+Enter or *Steer* steers; *Queue* and *Stop* sit beside them, along with a queued count and a working spinner. The composer takes the active branch's colour.
- **Lines panel** (a right column at 1280px and wider, a drawer below that, toggled with `l`): the branch tree as a small line map with live badges and message counts, a *New thread* button, and the shared context list.
- **Top bar.** A breadcrumb of the branch's lineage; click the current title to rename it. *Go to* (`g` or Ctrl+K) opens a palette with branches and commands. A theme toggle cycles auto, light and dark by writing `data-theme` on `<html>`.
- **Keyboard.** `j`/`k` move a reading cursor, which the rail dot and toolbar follow. `[`/`]` switch siblings at the nearest fork. `b` branches, `e` edits and branches, `s` shares. `n` adds a note, `c` or `/` focuses the composer, `x` stops, `t` changes the theme and `?` opens help.
- **Phone width.** The rail collapses to the active lane, with short stubs where branches leave. The switcher and the Lines drawer do the navigation.

## Trade-offs vs the canvas UI

- **Better:** reading comes first. The tree costs about 250px of gutter instead of half the screen, and its geometry is tied to the transcript: the fork you see in the rail sits beside the message it forked from. Moving between siblings at a fork (the most common move) is one click or one key and keeps your scroll position. The view also works at phone width without a second pane.
- **Worse:** off-path branches are compressed to dots, so you can't read two branches side by side or see every message's text at once. A very bushy tree runs out of gutter: lanes spread into more columns, and names are elided. There is no free-form pan or zoom and no horizontal layout. Moving to a distant branch takes a tip click, the palette or the Lines panel, where the canvas shows everything at a glance.
- **Same:** every protocol feature is available (send with followUp or steer, abort, fork, edit & branch, new, rename, configure, share as summary, transcript or note to chosen branches or `*`, unshare). The variant reuses `web/src/lib` for the client, layout helpers, markdown and view types.
