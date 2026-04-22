---
name: ast-grep
description: Structural code search and replace using ast-grep. Use for finding code patterns, refactoring, and AST-based analysis across multiple languages.
---

# ast-grep Usage

ast-grep is a CLI tool for structural code search and replace using AST patterns.

## Basic Commands

```bash
# Search with pattern
sg -p "console.log($$$)" -l ts

# Search with rule file
sg -r rule.yml

# Apply fixes (rewrite code)
sg -p "await $EXPR" -l ts --rewrite "($EXPR)"

# Scan entire project
sg scan

# Check specific files
sg scan --filter "src/**/*.ts"
```

## Rule File Format

Create `rule.yml`:

```yaml
id: my-rule
language: typescript
rule:
  pattern: console.$METHOD($$$ARGS)
fix: 'logger.$METHOD($$$ARGS)'
```

Run: `sg -r rule.yml`

## Rule Syntax Reference

### Atomic Rules
```yaml
pattern: console.log($ARG)           # Match code pattern
kind: call_expression                # Match node type
regex: '^[a-z]+$'                    # Match text with regex
```

### Relational Rules
```yaml
inside: { pattern: class $C { $$$ }, stopBy: end }  # Inside context
has: { pattern: await $EXPR, stopBy: end }          # Has descendant
precedes: { pattern: return $VAL }                  # Appears before
follows: { pattern: import $M }                       # Appears after
```

### Composite Rules
```yaml
all: [ { kind: call }, { pattern: foo($A) } ]  # AND
any: [ { pattern: foo() }, { pattern: bar() } ] # OR
not: { pattern: console.log($ARG) }             # NOT
```

### Metavariables
| Syntax | Purpose | Example |
|--------|---------|---------|
| `$VAR` | Single named node | `console.log($ARG)` |
| `$$VAR` | Single unnamed (operator) | `$$OP` in `a + b` |
| `$$$VAR` | Multiple nodes | `function $F($$$ARGS)` |
| `$_VAR` | Non-capturing | `$_FUNC($_FUNC)` |

## Examples

```yaml
# Find functions with await
rule:
  kind: function_declaration
  has: { pattern: await $EXPR, stopBy: end }

# Find console.* inside class methods
rule:
  pattern: console.$METHOD($$$)
  inside: { kind: method_definition, stopBy: end }

# Find async functions without try-catch
rule:
  all:
    - kind: function_declaration
    - has: { pattern: await $EXPR, stopBy: end }
    - not:
        has: { pattern: try { $$$ } catch { $$$ }, stopBy: end }
```

## Common Options

| Flag | Description |
|------|-------------|
| `-p, --pattern` | Search pattern |
| `-r, --rule` | Rule file path |
| `-l, --lang` | Language (ts, js, py, etc.) |
| `--rewrite` | Replacement string |
| `-i, --interactive` | Confirm each change |
| `--filter` | File filter pattern |
