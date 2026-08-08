# Custom Tool Rendering in Pi 0.83.0

Findings from inspecting Pizza's pinned `@earendil-works/pi-coding-agent@0.83.0`,
the compatible 0.83.0 sources, and the `heyhuynhgiabuu/pi-pretty` extension
(cloned to `/tmp/pi-github-repos/...`).

## How pi-pretty renders built-in tools

pi-pretty does **not** use a render-only decorator. It fully **replaces** each
built-in tool with its own `pi.registerTool()` definition, then **delegates
execution** back to the SDK factory so behavior is preserved.

### The delegate-execute pattern

For each tool (`read`, `bash`, `ls`, `find`, `grep`) in `src/tools/<tool>.ts`:

```ts
const sdkTool = createBashToolDefinition(cwd); // from @earendil-works/pi-coding-agent

pi.registerTool({
  name: "bash",                 // same name → overrides built-in
  label, description, promptSnippet, promptGuidelines,
  parameters: sdkTool.parameters,                  // keep SDK schema
  renderShell: "self",                             // take full control of framing
  execute: wrapExecuteWithMetrics(async (tid, p, sig, _u, ctx) =>
    (await sdkTool.execute(tid, p, sig, undefined, ctx))),  // delegate
  renderCall(args, theme, ctx) { ... },
  renderResult(result, _opt, theme, ctx) { ... },
});
```

### Rendering mechanics (`src/render.ts`)

- `renderShell: "self"` — opts out of Pi's default `Box`, giving full control
  over padding/background. Re-uses `ctx.lastComponent` and mutates it via
  `text.setText(...)` instead of recreating components.
- Builds ANSI strings directly:
  - Shiki syntax highlighting via `codeToANSI` for `read`/`grep`.
  - `fillToolBackground()` strips/normalizes background SGR codes
    (`preserveBoxBackground`) and applies config-driven backgrounds.
- `pi.on("tool_result", ...)` post-pads the first text block per-line for
  SDK-rendered tools where it doesn't fully take over — a hybrid approach.
- Backend colors come from `~/.pi/agent/pi-pretty.json`
  (`background.tool`/`background.error`), overriding theme.

### SDK tool sourcing (`src/index.ts`)

```ts
const sdk: SdkTools = deps?.sdk ?? {
  createReadToolDefinition:  hostSdk.createReadToolDefinition,
  createBashToolDefinition: hostSdk.createBashToolDefinition,
  createLsToolDefinition:    hostSdk.createLsToolDefinition,
  createFindToolDefinition:  hostSdk.createFindToolDefinition,
  createGrepToolDefinition:  hostSdk.createGrepToolDefinition,
};
```

It tolerates SDK factories being unavailable (`if (createBashTool)`) because
managed installs run in an isolated npm root where the nested SDK import is
crash-prone. Factories are called with `process.cwd()` at activation
(`const cwd = process.cwd()`) — **captured at load time, not the per-call
`ctx.cwd`**.

### Built-in renderer inheritance

Per `docs/extensions.md:2037`:

> Execution override and rendering override are independent. If your override
> omits `renderCall`, the built-in `renderCall` is used. If your override omits
> `renderResult`, the built-in `renderResult` is used. If your override omits
> both, the built-in renderer is used automatically.

So `tool-override.ts` (example extension) can add audit logging by overriding
only `execute` and leaving rendering to the built-in. pi-pretty overrides
*both* `renderCall`/`renderResult` (with `renderShell: "self"`) for full
cosmetic control.

### Caveats the delegate-execute pattern accepts

1. Factory captures `cwd = process.cwd()` at **extension load**, not the
   per-call `ctx.cwd`. Fine when you `pi` in a project dir, but not identical
   to the session-aware built-in.
2. Re-registering replaces the whole definition, including `description`/
   `promptSnippet`/`promptGuidelines`; the override must re-supply these
   (pi-pretty rewrites them deliberately, e.g. forcing `rg -n` guidance).
3. Behavior introduced later via `setActiveTools`/SDK overrides on the
   *original* built-in no longer targets the active tool, since the extension
   now owns that name.
4. `renderShell: "self"` drops the default `Box`, so the extension must
   implement its own padding/background (pi-pretty has a whole
   `preserveBoxBackground`/`fillToolBackground` layer).

## Per-tool output expansion in Pi 0.83.0

**No true per-tool expansion.** Expansion state is tracked per tool component,
but the built-in keybinding toggles **all** tool outputs at once (global
lockstep).

### How it works in Pi core

- `ToolExecutionComponent` (`tool-execution.js`) has its own `expanded`
  boolean + `setExpanded(expanded)`, and passes `expanded` into
  `renderCall`/`renderResult` via the render context (`getRenderContext()`).
- The only tool-expansion keybinding is `app.tools.expand` → `ctrl+o`
  (`core/keybindings.js:27`).
  - Fires `toggleToolOutputExpansion()` → `setToolsExpanded(bool)`.
  - `setToolsExpanded` loops **all** expandable children in
    `loadedResourcesContainer` and `chatContainer` and calls `setExpanded`
    on each (`interactive-mode.js:3105–3125`).
- `ctrl+shift+o` / `shift+ctrl+o` is bound to
  **`app.tree.filter.cycleBackward`** — a tree-filter UI action, **not**
  "expand all tools." There is no `expandAll` id or symbol anywhere in the
  dist tree.
- Public API surface: `ctx.ui.setToolsExpanded(expanded)` (global) — used by
  pi-pretty at `session_start` to force-collapse. There is **no** public
  per-component `setExpanded` hook on `ctx.ui`.

### `core/keybindings.js` (relevant entries)

```js
"app.tools.expand":          { defaultKeys: "ctrl+o",       description: "Toggle tool output" }
"app.tree.filter.cycleForward":  { defaultKeys: "ctrl+o",        description: "Tree filter: cycle forward" }
"app.tree.filter.cycleBackward": { defaultKeys: "shift+ctrl+o",  description: "Tree filter: cycle backward" }
```

### How pi-pretty participates

- `renderResult`/`renderCall` read `ctx.expanded` and render a collapsed
  preview vs. the full body (e.g. `tools/bash.ts:106`
  `if (!ctx.expanded) return fillToolBackground(header…)`; `tools/read.ts:137`;
  `tools/grep.ts:136`; `tools/ls.ts:68`; `tools/find.ts:174`).
- It surfaces the hint text itself (`"ctrl+o to expand"` / `"ctrl+o to
  collapse"`) so even with `renderShell: "self"` the affordance is visible.
- It does **not** register a custom shortcut, track per-call expansion, or
  give cursor-targeted expand. It is purely "render differently when
  `ctx.expanded` flips" — and that flip is global.

### pi-pretty README vs. reality in 0.83.0

> Use Pi Ctrl+O (app.tools.expand) on a tool block to show full output;
> Ctrl+Shift+O expands all.

- `Ctrl+O` does toggle expansion — but toggles **all** blocks together, not
  "on a tool block" in a cursor-targeted sense.
- `Ctrl+Shift+O` does **not** expand-all in 0.83.0; it cycles a tree filter
  backward. The README is describing newer Pi behavior (or a config that no
  longer matches this installed version).

### Practical implications

- User model: `Ctrl+O` expands/collapses **every** tool block
  simultaneously. A custom renderer that ignores `ctx.expanded` and always
  renders full output would break that contract.
- A renderer that hides the `ctrl+o to expand` hint when using
  `renderShell: "self"` makes the feature less discoverable — pi-pretty keeps
  the hint inline for that reason.
- True per-tool expansion would require grabbing a specific
  `ToolExecutionComponent` instance and calling its `setExpanded`, but Pi
  does not expose those component instances to extensions — not feasible from
  the public API in 0.83.0.

## Relation to Pizza's earlier decision

Pizza previously deleted `tool-renderers.ts` on the premise that "Pi 0.83.0 has
no render-only API." That was overly conservative: Pi supports cosmetic
rendering through a same-name override that delegates execution to an SDK tool
definition.

Pizza now uses that pattern for built-in `read`, `bash`, `edit`, and `write`,
with additional safeguards discovered during this research:

- It spreads a complete SDK definition so schemas and prompt metadata remain
  SDK-owned.
- It creates the execution delegate per call with `ctx.cwd`, avoiding the
  load-time cwd limitation described above.
- It reloads persisted shell and image settings through `SettingsManager`,
  respecting project trust.
- It defers source inspection and replacement until `session_start`; Pi 0.83.0's
  action APIs (`getAllTools`, `getActiveTools`) intentionally throw during
  extension loading, while `registerTool` remains valid after startup.
- It skips any same-name tool whose source is not `builtin`, preserving SDK and
  extension execution overrides.
- It preserves the active tool-name set and uses theme-backed, self-rendered
  shells with the configured global expansion hint.
- It tolerates incomplete streamed arguments and strips untrusted terminal
  control sequences before applying trusted theme styling.
- Image results fall back to the SDK read result renderer and remain in Pi's
  normal image-display pipeline.

The remaining public-API limitation is that transient in-memory settings
(including a custom session `SettingsManager`) or execution overrides which are
neither persisted nor exposed as SDK tools cannot be recovered by an extension.