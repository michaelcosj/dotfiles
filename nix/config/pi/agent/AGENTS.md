## Search Tools
- **Prefer `rg` (ripgrep) over `grep`** — rg is faster, respects `.gitignore` by default, and has better output formatting.
- Use `grep` only when rg cannot express the query (e.g. grep-specific flags rg doesn't support, or when rg is unavailable).
- For **structured code search**: prefer `ast-grep` (invoked via `sg` command). Use the `ast-grep` skill for pattern-based AST search and refactoring across multiple languages.
- For **simple text search**: `rg` (or `grep` as fallback).
- For **file finding**: `find`, `fd`, or `ls`.
