---
name: rex-web
description: >-
  Show rich visual output (HTML pages, diagrams, charts, tables, dashboards,
  previews) in a Rex pane beside the agent, and ask the user questions through
  clickable forms. Use in Rex when a visual explains better than text, such as
  architecture or flow diagrams, comparing options, data or benchmark results,
  UI or color previews, rendered Markdown, or a choice the user picks with a click.
---

# rex-web

`rex-web` renders HTML in a Rex pane next to yours with headless Chrome. The
page is live and interactive: the user can click, type, scroll, and hover. It
follows the Rex theme (light or dark), and fonts are SF Pro and SF Mono.

Use it only in Rex: `$REX_BLOCK` must be set. Otherwise, answer in text.

## When to use it

Use it when a visual communicates better than text:
- diagrams: architecture, data flow, state machines, dependency graphs (Mermaid)
- results: benchmark, test, or coverage numbers; tables with many columns; charts
- comparisons: two or three options side by side, before and after, diffs
- previews: a UI component, colors, rendered Markdown or docs
- questions: a choice that is easier to make by clicking (see "Ask the user")

Don't use it for short answers, plain lists, or code the user will copy. The
pane takes space: close it when the user is done with it.

## Commands

```bash
rex-web show page.html             # open the pane, or replace its page (no focus change)
rex-web show - <<'EOF'             # HTML from stdin
<h1>Hello</h1>
EOF
rex-web show --below --ratio 40 f  # where to open the pane; only applies when it opens
rex-web show --focus f             # give the pane focus: do this before the user types in the page
rex-web shot [-o out.png]          # screenshot of the page; prints the PNG path. Read it to check your work
rex-web eval 'document.title'      # run JS in the page; prints the result as JSON
rex-web wait [--timeout S] [--close]  # wait for the page to send a value; prints it as JSON
rex-web hide                       # close the pane
rex-web status                     # JSON: open, url, pixel size
```

- Each agent pane gets one viewer. `show` again replaces the page in the same
  pane. `--name NAME` keeps a second, separate viewer.
- A local file reloads by itself when it changes. To build a page up, write it
  to a file (for example `/tmp/rex-web-<topic>.html`), `show` it once, and then
  edit the file.
- The page can load anything from the web, for example a library from a CDN.
- The user closes the pane with Ctrl-Q, or by closing it in Rex.

**Check what you show.** After `show`, run `rex-web shot` and read the PNG
before you tell the user it's there. Fix overlapping, cut-off, or empty
content. Libraries that render after load (Mermaid, charts) need a second
or so.

## Writing pages

Write plain semantic HTML. rex-web adds a base style to every page, so `h1`,
`p`, `table`, `code`, `pre`, `button`, `input`, `select`, and `hr` already look
right in the theme. It has zero specificity, so any page style wins. Don't add
`<html>`, `<head>`, or a page background; a fragment is enough.

Classes in the base style:

| Class | Use |
|---|---|
| `card` | bordered panel |
| `grid` | responsive card grid (min 240px columns) |
| `row`, `stack`, `spacer` | flex row, flex column, push to the end |
| `stat` with `.label` and `.value` | big number with a label |
| `badge` plus `red`, `green`, `yellow`, `blue`, `magenta`, `cyan` | status pill |
| `muted` | secondary text |
| `bar` with `style="--v: 64%"` | progress bar (`--c` sets its color) |
| `choice` | option card for a radio or checkbox (see "Ask the user") |
| `add`, `del` | diff line backgrounds |
| `button.primary`, `button.danger` | button styles (a submit button is primary) |

Theme colors are CSS variables. Use them instead of fixed colors, so the page
works in light and dark themes:
`--rex-bg`, `--rex-fg`, `--rex-accent`, `--rex-muted` (secondary text),
`--rex-border`, `--rex-surface` (cards), `--rex-subtle` (hover and code
background), `--rex-red`, `--rex-green`, `--rex-yellow`, `--rex-blue`,
`--rex-magenta`, `--rex-cyan`, `--rex-0` to `--rex-15`. For mixes, use
`color-mix(in srgb, var(--rex-accent) 15%, transparent)`.

In scripts, `rex.theme` has the same colors (`bg`, `fg`, `accent`, `muted`,
`border`, `surface`, `red`, ... and `dark`). The `rex:theme` event fires when
the user changes the theme.

The pane is usually 600 to 1300 px wide. Design for that width, and let
content wrap; don't use fixed widths.

Keep pages still. Constant animation (canvas loops, endless CSS animation)
makes rex-web send frames all the time and costs CPU. Short transitions are
fine.

### Mermaid diagram

```html
<pre class="mermaid">
flowchart LR
  A[Request] --> B{Session?}
  B -- yes --> C[Handler]
  B -- no --> D[401]
</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
const t = rex.theme;
mermaid.initialize({ startOnLoad: true, theme: "base", themeVariables: {
  darkMode: t.dark, background: t.bg, primaryColor: t.surface, primaryBorderColor: t.border,
  primaryTextColor: t.fg, lineColor: t.muted, edgeLabelBackground: t.bg, fontFamily: "-apple-system" } });
</script>
```

Remove the `card` look from a `pre.mermaid` with `style="background:none;border:0"`
if the diagram should stand alone.

### Charts

Use Chart.js from `https://cdn.jsdelivr.net/npm/chart.js` and take its colors
from `rex.theme` (set `Chart.defaults.color = rex.theme.muted` and
`Chart.defaults.borderColor = rex.theme.border`). Set `animation: false`. For
a few bars, plain HTML with `.bar` is simpler.

## Ask the user

The page can send a value back to you. `rex-web wait` blocks until it arrives
and prints it as JSON.

- `<form data-rex>`: submitting sends the fields as an object. The submit
  button's own `name`/`value` is included, so several buttons can give
  different answers. Repeated names (checkboxes) become arrays.
- `rex.send(value)` from any script sends any JSON value.

```bash
rex-web show - <<'EOF'
<h1>Which database?</h1>
<p class="muted">Pick one and continue.</p>
<form data-rex>
  <label class="choice"><input type="radio" name="db" value="postgres" checked>
    <div><b>Postgres</b><small>Mature, JSONB, extensions</small></div></label>
  <label class="choice"><input type="radio" name="db" value="sqlite">
    <div><b>SQLite</b><small>Zero ops, one file</small></div></label>
  <div class="row"><button type="submit">Continue</button><button name="db" value="none">Neither</button></div>
</form>
EOF
rex-web wait --timeout 600 --close   # prints {"db":"sqlite"}
```

- Tell the user in text that a question is waiting in the pane. If they must
  type in the page, use `show --focus`.
- Run `wait` with a timeout that fits the question, and in the background if
  your harness allows it. It exits 124 on timeout and 3 if the user closed the
  pane. Then ask in text instead.
- `--close` closes the pane after the answer arrives or the wait times out.
  Without it, the pane stays open and you can `show` the next step.
- Put the question and its submit button at the top of the page, before any
  long table or detail. The pane can be narrow (about 640 px) and short, and
  the user should not have to scroll to answer.
- Values sent before `wait` starts are kept until the next `show`.

## Other page APIs

- `rex.copy(text)`: put text on the user's clipboard (OSC 52; works over SSH).
- `rex.close()`: close the pane.
- `rex.title(text)`: set the pane's title.

## Troubleshooting

- `no open viewer`: run `show` first. The user may have closed the pane.
- `show needs a Rex terminal`: `$REX_BLOCK` is not set. Answer in text.
- When your own pane is not shown in a window (for example a child agent the
  user hasn't switched to), `show` splits the focused pane instead.
- `rex split failed`: report the error and answer in text. Don't move or
  rearrange the user's panes to work around it.
- An empty or wrong-looking page: run `rex-web shot`, then
  `rex-web eval` to inspect the DOM or errors.
- Debug log: `REX_WEB_DEBUG=/tmp/rex-web.log rex-web show ...` (only applies
  when the pane opens).
