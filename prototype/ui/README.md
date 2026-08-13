# MarkShare UI prototype — Split Desk (throwaway)

**Question:** what should MarkShare's UI look like?

Three variants were built and compared. **Split Desk won**; Paper (a single centred sheet) and
Console (chromeless, command-palette driven) have been deleted. What's left is one self-contained
HTML file with no build, no dependencies and no persistence — a thing to look at and argue with,
not code to promote.

## Run it

```
open prototype/ui/markshare-ui-prototype.html
```

The floating **Author / Reader** toggle at the bottom swaps between the editing surface and what
someone opening a share link sees. That bar is prototype scaffolding, not part of the design.

## The design

App bar on top (title, save state, Share, Save changes, theme), Write and Preview side by side,
publishing in a modal. Below 900px the panes collapse to Edit / Preview tabs.

**Typeface: Inter** for the interface and the rendered document; monospace kept for the Markdown
source, where column alignment in tables and code matters. Loaded from Google Fonts, so the very
first paint needs a network; it falls back to the system sans otherwise.

### Resizable split

- **Drag** the divider between the panes to rebalance them. Clamped to 22–78% so neither pane
  can be squeezed to nothing.
- **Double-click** the divider to reset to 50/50.
- **Keyboard**: focus the divider (it's a `role="separator"` in the tab order) and use `←` / `→`
  to nudge by 2%, `Shift` for 10%, `Home` to reset.
- The position survives re-renders and is hidden entirely on narrow screens, where the panes stack.

### Responsive behaviour

The shell owns the window: `html, body` are locked at `height:100%` with `overflow:hidden`, and
every scroll happens inside a pane. The page itself never scrolls, so the app bar can't be pushed
off the top and the footer always sits on the bottom edge, at any window size.

| Width | Behaviour |
|---|---|
| ≥ 900px | Two panes with the draggable divider |
| < 900px | Divider hidden, panes collapse to Edit / Preview tabs, rail-free |
| < 620px | Share becomes an icon, "Save changes" becomes "Save", the wordmark gives way to the document title, and the "Saved" chip drops (the amber unsaved dot always survives) |

Verified at 1920, 1440, 1280, 1024, 900, 768, 620, 420 and 320 wide: no page scroll, no horizontal
overflow, the shell fills the viewport, and the reader surface scrolls inside itself.

## What's real enough to judge

- Live Markdown rendering (headings, lists, task lists, tables, fenced code, blockquote, hr,
  a `mermaid` placeholder block, and a private-image placeholder)
- Title derived from the first `# heading`, per the agreed rule
- Explicit publishing: the draft runs ahead of the share link, and "Saved / Unsaved changes"
  updates as you type
- Share link vs edit link presented separately, with the read-only warning
- Light / dark / system theme, images `n/20`, expiry on and off, word count
- Reader surface with Download .md

Fake in-memory document, fake links, fake copy-to-clipboard. `⌘S` saves, `Esc` closes the modal.

## Still open on this design

- **Preview scroll doesn't follow the cursor.** With a wide Write pane the two sides drift apart;
  worth deciding whether scroll sync is in scope for version one.
- **The formatting toolbar is decorative here.** Nothing behind B / I / H / link / code yet.

## When it's folded in

Rewrite it properly against the real stack — this was written under prototype constraints (no
tests, no error handling, innerHTML re-renders). Then move this folder onto a throwaway branch and
leave a pointer on `markshare-9yf` (Bootstrap the MarkShare application), whose description now
carries the authoritative spec taken from this prototype. `shots/` holds reference screenshots of
the author surface, the reader surface, and the phone layout.
