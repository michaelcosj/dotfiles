# Plan: vim editor mode for pi

Add a vim-style modal editor to pi's prompt input. Copy the feature set and behavior of Claude Code's vim editor mode (code.claude.com/docs/en/interactive-mode#vim-editor-mode).

## Facts that shape the design

- pi supports replacing the prompt editor: `ctx.ui.setEditorComponent(factory)` with a subclass of `CustomEditor` (pi-coding-agent 1.5.0). `CustomEditor` routes app keys (Esc = `app.interrupt`, Ctrl+D, model switch, extension shortcuts) and then calls `Editor.handleInput`.
- The bundled example `examples/extensions/modal-editor.ts` maps normal-mode keys to escape sequences (`h` → `\x1b[D`). That is too weak for operators, text objects, counts, registers and `.`.
- `Editor` (pi-tui) public API: `getText()`, `getLines()`, `getCursor()`, `setText()`, `insertTextAtCursor()`, `addToHistory()`, `isShowingAutocomplete()`, `renderTopBorder/renderBottomBorder` (protected). **There is no public cursor setter.** The cursor lives in private `state.cursorLine/cursorCol` and private `setCursorCol()`.
- `setText()` pushes a snapshot to pi's undo stack and moves the cursor to the end.
- The agent-bridge extension already calls `setEditorComponent` for child agents (`agent-bridge/agents/ui.ts` → `ChildEditor`). Two calls to `setEditorComponent` do not compose; the last one wins.
- Our settings: `showHardwareCursor: false`, so pi draws a fake block cursor (`renderFakeCursor`). Kitty keyboard protocol can be on, so printable keys can arrive as CSI-u sequences.

## Architecture

New extension `nix/config/pi/agent/extensions/vim-editor/`:

| File | Job |
| --- | --- |
| `engine.ts` | Pure vim state machine. Input: `{ lines, cursor }` + one key. Output: new `{ lines, cursor }`, mode, register changes, and "pass through to pi" actions. No pi imports. |
| `motions.ts` | Motions and text objects as pure functions over `lines` + cursor (w/e/b/W/E/B, 0/^/$, gg/G, f/F/t/T/;/,, %, iw/aw/iW/aW, quotes, brackets). |
| `editor.ts` | `VimEditor extends CustomEditor`. Decodes keys, feeds the engine, applies results to the base editor, draws the mode label. Exported so other extensions can extend it. |
| `config.ts` | Reads `vim-editor/config.json`. |
| `index.ts` | Installs the editor on `session_start` (TUI mode only). Registers `/vim` to toggle. |
| `engine.test.ts`, `motions.test.ts` | `bun test`, same style as the other extensions. |

**Apply step (the one fragile part).** After the engine changes text, `editor.ts` calls `setText(newText)` and then sets the cursor. Setting the cursor needs pi-tui private fields. I will put that access in one function `placeCursor(editor, line, col)` with a runtime check. If the private fields are missing (pi upgrade), it falls back to sending arrow-key sequences to `super.handleInput`, and logs a warning once. Pure cursor moves (no text change) use the same function and do not touch undo.

**Pass-through keys.** In NORMAL and VISUAL modes these go to `super.handleInput` unchanged:
- Control keys and app keybindings (Ctrl+C, Ctrl+D, Ctrl+P, Ctrl+L, extension shortcuts).
- Bracketed paste (`\x1b[200~` … `\x1b[201~`): pastes as text, same as Claude Code.
- `Enter`: submits the prompt.
- Any key while the autocomplete menu is open.

INSERT mode passes everything to pi except `Esc` and the configured insert remap (`jj`).

## Feature scope (Claude Code parity)

**Phase 1: core**
- Modes: INSERT (start mode), NORMAL. `Esc` / `Ctrl+[` → NORMAL. `i I a A o O` → INSERT.
- Motions: `h j k l`, `Space`, `w e b`, `W E B`, `0 ^ $`, `gg G`, `f F t T {char}`, `; ,`, `%`.
- Counts: `3w`, `2dd`, `d3w`.
- Operators: `d c y` with any motion, `dd cc yy`, `D C Y`, `x`, `s S`, `r{char}`, `J`, `>> <<`, `~`.
- Text objects: `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{` (and `` i` ``, `ib`, `iB` aliases).
- Registers: one unnamed register in memory. `p P` honor charwise vs linewise.
- Undo: own undo/redo stack in the vim layer. `u` undo, `Ctrl+R` redo. One INSERT session = one undo step, as in vim.
- `.` repeat last change, including the text typed in the INSERT session that followed `c`/`o`/`i`.
- History: `j`/`k` (and `↑`/`↓`) on the first/last line go to prompt history (pass the arrow key to pi, which already does this).
- Mode badge at the right end of the bottom border, styled like the child-agent title badge (`theme.inverse(theme.fg(color, " N "))` + `──`). See "Mode badge" below.
- Insert remap: `vimInsertModeRemaps`-style `{"jj": "<Esc>"}` with the same 1-second rule as Claude Code.

**Phase 2: visual mode**
- `v` charwise, `V` linewise. Motions and text objects extend the selection. `d x y c s p P r ~ u U > < J o` act on it.
- Needs selection highlighting. pi's `layoutText` is private, so I must override `render()` and map buffer ranges to wrapped rows. I will spike this first; if it is too fragile, I will draw the selection only for unwrapped lines and fall back to a label (`-- VISUAL 12 chars --`).

**Out of scope**
- Ex commands (`:`), marks, macros, named registers, search `/` `n` (Claude Code maps `/` to history search; pi has no reverse history search UI to call).
- Cursor shape changes (the fake block cursor stays).

## Mode badge

```
───────────────────────────────────────────── N ──
```

- One letter: `I` INSERT, `N` NORMAL, `V` VISUAL (phase 2; `V` for both `v` and `V`).
- Colors from theme tokens, so they follow the system theme: `I` → `success` (green), `N` → `accent`, `V` → `warning`. Inverse video, like the child title badge.
- Override `renderBottomBorder(width, hidden)`. pi draws the `↓ N more` scroll label in the middle of the bottom border, so the badge on the right end does not collide. Replace the last `5` cells of the border string; if the terminal is too narrow (< 12 cells), draw no badge.
- A pending operator or count shows in the badge too (`N d`, `N 3d`), so you can see a half-typed command. Optional; drop it if it looks noisy.
- Child agents: their title badge stays in the top border, the mode badge in the bottom border.

## Config

`vim-editor/config.json`, linked from the repo like `generate-title/config.json`:

```json
{
  "enabled": true,
  "insertRemaps": { "jj": "<Esc>" },
  "clipboard": "unnamedplus"
}
```

**Clipboard (`unnamedplus`).** Yank, delete and change write the unnamed register and the macOS clipboard (pi-tui `getNativeClipboard().setText`, fallback `pbcopy`). Clipboard writes are async and fire-and-forget; a failure only logs once. `p`/`P` read the clipboard (`getText`, fallback `pbpaste`) so text copied in other apps pastes too. If the clipboard text equals the last text we wrote, use the in-memory register so linewise/charwise type is kept. If the read fails or is slow (>200 ms), use the in-memory register. `"clipboard": "unnamed"` turns this off.

`/vim` toggles `enabled`, writes the file, and swaps the editor live (`setEditorComponent(undefined)` restores pi's default).

## Composition with agent-bridge child editors

The child editor and the vim editor both replace the editor. Fix: `ChildEditor` extends `VimEditor` (when vim is enabled) instead of `CustomEditor`, and `vim-editor/index.ts` does nothing when `PI_BRIDGE_PARENT` is set. Small change in `agent-bridge/agents/ui.ts`.

## Tests

- Pure tests for every motion, text object, operator, count, register, `.`, undo/redo, and the remap timer (fake clock).
- Table-driven: `["foo b|ar baz", "dw", "foo |baz"]` (`|` marks the cursor).
- Editor tests: construct `VimEditor` with a fake TUI (like `agent-bridge/editor.test.ts`), check that Esc in NORMAL reaches `app.interrupt`, Enter submits, paste inserts, autocomplete keys pass through.
- Manual check in a live pi session, also in a child agent pane.

## Steps

1. Spike `placeCursor` against pi-tui 1.5.0 and confirm `setText` + cursor placement + scroll work.
2. `motions.ts` + tests.
3. `engine.ts` (modes, counts, operators, registers, undo, `.`, remap) + tests.
4. `editor.ts` + `index.ts` + `config.json`, `/vim` command, clipboard.
5. agent-bridge `ChildEditor` change.
6. Biome check, `bun test`, commit `feat(pi): vim editor mode`.
7. **Stop.** You test phase 1 in live sessions. I fix the issues you find.
8. Phase 2 visual mode (spike render first), tests, commit `feat(pi): vim visual mode`.

## Decisions (approved)

1. **Esc:** Claude Code behavior. Esc in INSERT goes to NORMAL; Esc in NORMAL goes to pi (abort). Ctrl+C still aborts at once.
2. **Clipboard:** `unnamedplus` by default (see Config).
3. **Default state:** on for all sessions; `/vim` toggles.
4. **Visual mode:** after phase 1 is done and tested by you.
