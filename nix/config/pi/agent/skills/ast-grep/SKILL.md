---
name: ast-grep
description: Structural code search using ast-grep (sg). Use for AST-based pattern matching — finding code structures that text search can't capture. Load this skill when asked to find code patterns, locate language constructs, or search code by structure.
---

# ast-grep: Structural Code Search

ast-grep (CLI: `sg`) matches code by AST structure, not text. Use it when you need to find patterns like "all functions that call X" or "classes without error handling" — things `rg`/`grep` can't do reliably.

## When to Use sg vs rg

| Tool | Best for |
|------|----------|
| `sg` | Structural queries: "find functions with/without X", "find Y inside Z" |
| `rg` | Simple text: string literals, comments, imports, file paths |

## Workflow

### 1. Clarify the Search
What pattern? What language? Any exclusions? Narrow scope early.

### 2. Write a Test Snippet
Create a small temp file with example code that SHOULD match. This validates your rule.

### 3. Start Simple, Then Add Complexity
```
pattern first → add kind → add relational rules (has/inside) → add composite (all/any/not)
```

### 4. Test the Rule
```bash
# Quick inline test (stdin, no files needed)
echo 'async function f() { await x(); }' | sg scan \
  --inline-rules "id: test language: javascript rule: {pattern: await \$EXPR}" --stdin

# Test with a rule file against example code
sg scan -r test_rule.yml test_example.js
```

### 5. Run Against the Codebase
```bash
# Inline rule (no file needed — escapes required in double quotes)
sg scan --inline-rules \
  "id: find-async language: typescript rule: {kind: function_declaration, has: {pattern: await \$EXPR, stopBy: end}}" \
  src/

# Rule file (for complex/reusable rules)
sg scan -r my_rule.yml src/

# Scan with file filter
sg scan -r my_rule.yml --filter "src/**/*.ts"
```

## CLI Patterns

### Search with Simple Patterns (`-p`)
```bash
sg -p 'console.log($ARG)' -l ts src/          # Find all console.log calls
sg -p 'class $NAME { $$$ }' -l ts .            # Find all class declarations
sg -p '$OBJ.$METHOD($$$)' -l ts --json .       # JSON output
```

### Search with Inline Rules (no temp files)
```bash
# Find functions containing await
sg scan --inline-rules \
  "id: a language: ts rule: {kind: function_declaration, has: {pattern: await \$EXPR, stopBy: end}}" .

# Find X inside Y
sg scan --inline-rules \
  "id: b language: ts rule: {pattern: console.log(\$\$\$), inside: {kind: method_definition, stopBy: end}}" src/
```

### Inspect AST Structure (`--debug-query`)
```bash
# See how code is parsed into AST nodes (use to find correct `kind` values)
sg -p 'async function f() { await x(); }' -l ts --debug-query=ast

# See how ast-grep interprets your pattern
sg -p 'class $NAME { $$$BODY }' -l ts --debug-query=pattern
```

### Rewrite (Code Transform)
```bash
# Replace pattern
sg -p 'console.log($MSG)' -l ts --rewrite 'logger.info($MSG)' src/

# Interactive (confirm each change)
sg -p 'var $X = $Y' -l ts --rewrite 'const $X = $Y' -i src/
```

## Debugging Rules That Don't Match

1. **Inspect the AST** — `--debug-query=ast` to see actual node kinds
2. **Add `stopBy: end`** — required for `has`/`inside` relational rules
3. **Simplify** — remove sub-rules, test each part independently
4. **Check `kind`** — verify node type names against AST output
5. **Check metavariable escaping** — in `--inline-rules` double quotes, use `\$VAR` (shell eats bare `$`)

## Common Patterns

### Find functions with a specific call
```yaml
rule:
  kind: function_declaration
  has: { pattern: useMemo($$$), stopBy: end }
```

### Find code missing error handling
```yaml
rule:
  all:
    - kind: function_declaration
    - has: { pattern: await $EXPR, stopBy: end }
    - not:
        has: { pattern: try { $$$ } catch { $$$ }, stopBy: end }
```

### Find patterns inside a specific context
```yaml
rule:
  pattern: useState($INIT)
  inside: { kind: function_declaration, stopBy: end }
```

### Find duplicate logic patterns across files
```yaml
rule:
  pattern: |
    if ($COND) {
      return $A;
    }
    return $B;
```

## Quick Reference

| Flag | Purpose |
|------|---------|
| `-p, --pattern` | Match AST pattern |
| `-r, --rule` | YAML rule file |
| `-l, --lang` | Language (ts, js, py, rs, etc.) |
| `--inline-rules` | Inline YAML string (no file) |
| `--rewrite` | Replacement string |
| `-i, --interactive` | Confirm each change |
| `--debug-query` | Dump AST (ast, cst, pattern) |
| `--stdin` | Read source from stdin |
| `--json` | JSON output |
| `--filter` | Glob pattern for files |

**Key rule:** Always use `stopBy: end` on `has` and `inside` relational rules.
