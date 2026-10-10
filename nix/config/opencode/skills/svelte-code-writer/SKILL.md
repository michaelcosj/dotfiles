---
name: svelte-code-writer
description: Entry point for creating, editing, or analyzing Svelte components (.svelte) and modules (.svelte.ts/.svelte.js). Provides documentation lookup, code analysis, and targeted framework guidance.
---

## CLI tools

You have access to `@sveltejs/mcp` CLI for Svelte-specific assistance. Use these commands via `npx`:

### List documentation sections

```bash
npx @sveltejs/mcp list-sections
```

Lists all available Svelte 5 and SvelteKit documentation sections with titles and paths.

### Get documentation

```bash
npx @sveltejs/mcp get-documentation "<section1>,<section2>,..."
```

Retrieves full documentation for specified sections. Use after `list-sections` to fetch relevant docs.

**Example:**

```bash
npx @sveltejs/mcp get-documentation '$state,$derived,$effect'
```

### Svelte autofixer

```bash
npx @sveltejs/mcp svelte-autofixer "<code_or_path>" [options]
```

Analyzes Svelte code and suggests fixes for common issues.

**Options:**

- `--async` - Enable async Svelte mode (default: false)
- `--svelte-version` - Target version: 4 or 5 (default: 5)

**Examples:**

```bash
# Analyze inline code (single quotes preserve $ literally)
npx @sveltejs/mcp svelte-autofixer '<script>let count = $state(0);</script>'

# Analyze a file
npx @sveltejs/mcp svelte-autofixer ./src/lib/Component.svelte

# Target Svelte 4
npx @sveltejs/mcp svelte-autofixer ./Component.svelte --svelte-version 4
```

Prefer file paths for real components. For inline code or documentation names containing runes, use single quotes to prevent shell expansion of `$`. Do not backslash-escape `$` inside single quotes.

## Workflow

1. For substantive reactivity, lifecycle, state, or component-design work, load `svelte-core-bestpractices`. Skip it for cosmetic edits or simple lookups.
2. When uncertain about syntax, run `list-sections` then `get-documentation` for relevant topics.
3. Run `svelte-autofixer` before finalizing created or modified components. For read-only analysis, use it when it helps answer the question; it is not mandatory.
