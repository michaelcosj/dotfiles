---
name: visualise
description: >-
  Use in Rex when showing the user something beats describing it in text:
  diagrams, results or wide tables, side-by-side comparisons, UI or color
  previews, or a small live tool they can play with (a calculator, a what-if
  model).
---

# Visualise

Show the user things in a Rex pane next to yours with `rex-web`. Use it only
in Rex (`$REX_BLOCK` is set), and only when seeing beats reading:

- **Explain:** architecture, data flow, a state machine, a sequence (Mermaid).
- **Results:** benchmarks, test or coverage numbers, tables too wide for chat.
- **Compare:** options side by side, before and after.
- **Preview:** a UI component, colors, rendered docs.
- **Explore:** a live tool where the user changes inputs and sees the result
  (a pricing calculator, a cost or capacity model, a config builder), instead
  of a table of every case.

Not for short answers or code the user will copy. Tell the user in text what
the pane shows, and close it when they are done with it.

Two engines; `show` picks one:
- **tui** (preferred: fast, light, selectable text): Markdown, Mermaid, and
  plain HTML forms, drawn as terminal text. Used for `.md` files, Markdown on
  stdin, and HTML with only plain elements and the kit classes.
- **web** (headless Chrome): anything else: `<script>`, `<style>`, `style=`,
  images, SVG, charts, other classes. Live: click, type, scroll, hover.

Write Markdown when it's enough; use HTML and scripts when the page must move.

## Commands

```bash
rex-web show notes.md              # open the pane, or replace its page (no focus change)
rex-web show - <<'EOF'             # stdin: Markdown, or HTML if it starts with <
# Hello
EOF
rex-web show --below --ratio 40 f  # where to open the pane (only when it opens)
rex-web show --focus f             # give the pane focus (before the user types in it)
rex-web show --engine web f        # force an engine: tui or web (web can't draw .md)
rex-web shot [-o out.png]          # web: PNG; tui: the pane's text (.txt). Prints the path
rex-web eval 'document.title'      # web only: run JS in the page, print the result as JSON
rex-web wait [--timeout S] [--close]  # wait for the page to send a value; print it as JSON
rex-web hide                       # close the pane
rex-web status                     # JSON: open, engine, url, size
```

- One viewer per agent pane; `show` again replaces its page. `--name NAME`
  keeps a second viewer.
- Local files reload when they change: write `/tmp/rex-web-<topic>.md`,
  `show` it once, then edit it as the work goes on.
- After `show`, run `shot` and read the result before you tell the user.
  Fix cut-off or empty content. Web pages that render after load need a
  second or so.

## Markdown (tui)

GitHub-flavored Markdown with highlighted code; a ```` ```mermaid ```` block
becomes a diagram in the theme's colors. The page scrolls (wheel, PgUp/PgDn,
g/G). Keep tables narrow (the pane is often 60 to 100 columns).

````markdown
# Benchmark results

| Test | Before | After |
|---|---:|---:|
| parse | 120 ms | 84 ms |

```mermaid
flowchart LR
  A[Request] --> B{Session?} -- no --> D[401]
```
````

## HTML

Write a semantic fragment (no `<html>`, `<head>`, or page background). A base
style themes `h1`, `p`, `table`, `code`, `pre`, `button`, `input`, `select`,
`hr`. Kit classes (tui draws all of them):

`card`, `grid`, `row`, `stack`, `spacer`, `muted`, `stat` (with `.label`,
`.value`), `badge` (plus `red` `green` `yellow` `blue` `magenta` `cyan`),
`choice` (option card), `button.primary`, `button.danger`, `pre.mermaid`.
Web only: `bar` (`style="--v: 64%"`), `add`/`del` (diff lines).

Web pages:
- Theme colors are CSS variables: `--rex-bg`, `--rex-fg`, `--rex-accent`,
  `--rex-muted`, `--rex-border`, `--rex-surface`, `--rex-subtle`,
  `--rex-red`…`--rex-cyan`, `--rex-0`…`--rex-15`. Use them, not fixed colors.
- Scripts get the same in `rex.theme` (plus `dark`); `rex:theme` fires on a
  theme change. Libraries load from a CDN (Chart.js, Mermaid): take their
  colors from `rex.theme` and turn off animation.
- The pane is 600 to 1300 px wide: let content wrap. Keep pages still;
  constant animation costs CPU.
- `rex.copy(text)` (clipboard), `rex.close()`, `rex.title(text)`.

### Live tools

Inputs (`range`, `number`, `select`, `checkbox`) update the result on
`input`, with no submit. Show the parts of the result, not only the total, so
the user can check the math. Put the model's numbers in one `const` at the
top of the script, so you can correct them when the user says one is wrong.

```html
<h2>Price estimate</h2>
<div class="row"><label>Seats <input id="seats" type="range" min="1" max="200" value="20"></label> <b id="seatsV"></b></div>
<label><input id="annual" type="checkbox" checked> Annual billing (-15%)</label>
<div class="stat"><span class="label">Per month</span><span class="value" id="total"></span></div>
<p class="muted" id="parts"></p>
<script>
const PRICE = { seat: 12, base: 49, annualOff: 0.15 };
function update() {
  const n = +seats.value, sub = PRICE.base + n * PRICE.seat;
  const t = annual.checked ? sub * (1 - PRICE.annualOff) : sub;
  seatsV.textContent = n;
  total.textContent = `$${t.toFixed(0)}`;
  parts.textContent = `$${PRICE.base} base + ${n} × $${PRICE.seat}` + (annual.checked ? " − 15%" : "");
}
addEventListener("input", update); update();
</script>
```

## Getting a value back

A page can send the user's choice back to you: the settings they landed on in
a live tool, or a pick between options you showed. `rex-web wait` blocks until
it arrives and prints it as JSON.

- `rex.send(value)` (web) sends any JSON value, e.g. a "Use this" button:
  `<button onclick="rex.send({seats: +seats.value})">Use this</button>`.
- `<form data-rex>` sends its fields as an object on submit (tui and web).
  The submit button's `name`/`value` replaces the field of that name, so
  several buttons can give different answers. Repeated names become arrays.
  `required` is checked, except for a named button.

In tui, radios and `<select>` are option cards, checkboxes toggle, `<input>`
and `<textarea>` take text. Keys: Tab/arrows/j/k move, Space toggles, Enter
or a click submits, Alt+Enter adds a line.

```bash
rex-web show - <<'EOF'
<h1>Which database?</h1>
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

- Tell the user in text that the pane waits for them.
- Run `wait` in the background if you can. It exits 124 on timeout and 3 if
  the user closed the pane; then ask in text.
- `--close` closes the pane after the value arrives or the timeout.
- Put the choice and its buttons first; the pane can be short.
- Values sent before `wait` starts are kept until the next `show`.

## Troubleshooting

- `no open viewer`: `show` first; the user may have closed the pane.
- `rex split failed`: report it and answer in text. Don't rearrange panes.
- A tui page drawn badly: `show --engine web` it (HTML only).
- Debug log: `REX_WEB_DEBUG=/tmp/rex-web.log rex-web show ...`.
