# Pizza Minimal

Child-only Pizza profile for native Herdr subagents.

It activates only when `PIZZA_SUBAGENT=1`, which the parent Pizza extension sets
on new Herdr tabs. Normal Pi sessions ignore it. The full Pizza extension also
skips registration in those child sessions.

## Included

- Pi's default, minimal UI
- Background-terminal tools and lifecycle

## Excluded

- All `subagent_*` tools
- Subagent overlays, editor navigation, result delivery, and `/btw`
- Pizza's custom editor/header
- Questionnaire, Codex usage, TPS, and copy-all

Other independently installed packages (such as web access and FFF) continue to
load normally in the child.
