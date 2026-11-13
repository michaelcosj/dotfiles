---
name: visualise
description: >-
  Use in Rex when showing the user something beats describing it in text:
  diagrams, results or wide tables, side-by-side comparisons, charts, color
  previews, a question with options, or a small live tool they can play with
  (a calculator, a what-if model).
---

# Visualise

Show the user things in a Rex pane next to yours with `rex-view`. Use it only
in Rex (`$REX_BLOCK` is set), and only when seeing beats reading:

- **Explain:** architecture, data flow, a state machine (Mermaid).
- **Results:** benchmarks, test numbers, charts, tables too wide for chat.
- **Compare:** options side by side, before and after.
- **Ask:** a choice between options, with details; the answer comes back as JSON.
- **Explore:** a live tool: the user moves inputs and sees the result.

Not for short answers or code the user will copy. Tell the user in text what
the pane shows, and close it when they are done.

## Commands

```bash
rex-view show /tmp/rex-view-topic.md   # open the pane, or replace its page
rex-view show - <<'EOF'                # Markdown on stdin
# Hello
EOF
rex-view show --below --ratio 40 F     # where the pane opens; --focus gives it focus
rex-view shot                          # the pane as text; read it before you tell the user
rex-view wait [--timeout S] [--close]  # wait for a submit; print it as JSON
rex-view hide                          # close the pane
rex-view snap URL|FILE.html [-o out.png] [--size 1280x800]   # one screenshot (Chrome)
```

One pane per agent pane; `show` again replaces its page (`--name N` keeps a
second one). A file reloads when it changes, so write it, `show` it once, then
edit it as work goes on. Inputs keep their values only while the page is the same.

## Pages

Pages are GitHub Markdown (tables, code, task lists). The pane is often 60 to
100 columns: keep tables narrow. Special fenced blocks:

| Fence | Draws |
|---|---|
| `mermaid` | a diagram in the theme's colors |
| `chart bar\|line\|pie "Title"` | a chart; rows `label: v1, v2`, optional `series: A, B` |
| `cols` | columns of Markdown split by `---` lines (stacked when narrow) |
| `inputs` | live controls (below) |
| `ask` / `ask multi` | a question with option cards; sends `{"answer": …}` |
| `colors` | swatches; lines `name: #rrggbb` |
| `svg` | inline SVG; `currentColor` and `var(--accent)` etc. use the theme |

`![alt](file.png)` alone in a paragraph shows an image (PNG, JPEG, SVG), with
the path relative to the page. For a real web UI, `snap` it and show the PNG.
A bad line in a block shows an error with its line number: fix it and `show` again.

### Live tools

````markdown
## Price estimate

```inputs
seats: slider 1..200 = 20
annual: check = true "Annual billing (−15%)"
plan: pick Team ($12)=12 | *Business ($20)=20
base: 49
[Use this]
```

**Per month:** {{ money((base + seats * plan) * (annual ? 0.85 : 1)) }}
({{ money(base) }} base + {{ seats }} × {{ money(plan) }})

```chart bar "Cost by plan"
Team: base + seats * 12
Business: base + seats * 20
```
````

`inputs` lines are `name: kind …` with an optional `"Label"` at the end:
- `slider MIN..MAX [step S] [= V]`, `number [MIN..MAX] [step S] [= V]`
- `check [= true]`: true/false
- `pick A=1 | *B=2`: one value; `multi A | *B`: a list (`*` = selected)
- `text [= "x"]`, `long`: text (add `required` to require it)
- `base: 49` or `cur: "€"`: a constant
- `[Use this]` and `[Neither](choice=none)`: submit buttons. Without one, the
  tool is only live.

`{{ formula }}` anywhere in text, and every chart value, updates as inputs
change. Formulas use input names, `+ - * / % **`, `== != < <= > >=`,
`&& || !`, `a ? b : c`, `'text'`, and `money(x, '$', dp)`, `pct(x)`,
`fmt(x, dp)`, `round(x, n)`, `min`, `max`, `clamp`, `abs`, `floor`, `ceil`,
`sqrt`, `pow`, `has(list, v)`, `count(list)`. Show the parts of a result, not
only the total.

### Getting an answer

````markdown
```ask
Which database?
- Postgres: mature, JSONB, extensions
- SQLite: zero ops, one file
other
```
````

`rex-view wait --timeout 600 --close` prints `{"answer":"SQLite"}`
(`other` adds a text box, sent as `"other"`). An `inputs` submit sends every
input with typed values: `{"seats":21,"annual":false,"plan":20,"base":49}`.

- Tell the user in text that the pane waits for them.
- Run `wait` in the background if you can. It exits 124 on timeout and 3 if
  the user closed the pane; then ask in text.
- Keys: Tab moves, arrows pick or step a slider (shift ×10), Space toggles,
  Enter submits.

## Troubleshooting

- `no open viewer`: `show` first; the user may have closed the pane.
- `rex split failed`: report it and answer in text. Don't rearrange panes.
- Debug log: `REX_VIEW_DEBUG=/tmp/rex-view.log rex-view show ...`.
