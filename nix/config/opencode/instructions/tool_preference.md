## Tool Preference Over Shell Workarounds

When you have native tool access for an operation, **always use the tool** instead of shell commands or scripts.

### Why This Matters

1. **Reliability** - Tools are designed for the task; shell workarounds are fragile
2. **Context** - Tools maintain proper state and error handling
3. **Efficiency** - Tools are optimized; scripts add overhead
4. **Auditability** - Tool usage is tracked; shell commands are opaque

### Common Anti-Patterns to Avoid

| Task | ❌ Don't Do This | ✅ Do This Instead |
|------|------------------|-------------------|
| **Read file** | `cat file.txt`, `python -c "print(open('f').read())"` | Use `Read` tool |
| **Write file** | `echo "content" > file.txt`, `python script.py` that writes | Use `Write` tool |
| **Edit file** | `sed -i 's/old/new/'`, `awk`, Python/Node scripts | Use `Edit` tool |
| **Search content** | `grep -r "pattern"`, `rg "pattern"` | Use `Grep` tool |
| **Find files** | `find . -name "*.ts"`, `ls -R` | Use `Glob` tool |
| **Fetch URL** | `curl`, `wget`, `python requests` | Use `WebFetch` tool |
| **Ask user** | Guessing user intent, making assumptions | Use `Question` tool (if available) |

### Exceptions

Use shell commands when:
- The tool genuinely doesn't support the operation
- You need to chain commands for a specific workflow (e.g., `git` operations)
- Running tests, builds, or other project-specific commands
- The user explicitly requests a shell approach

### Rule of Thumb

Before writing a shell command or script, ask: **"Is there a tool for this?"**

If yes → use the tool.
If no → proceed with shell.

### Question Tool (When Available)

When you have access to the `Question` tool, **use it proactively** to:
- Clarify ambiguous requirements or user intent
- Gather preferences (technology choices, naming, styling, etc.)
- Offer implementation options when multiple valid approaches exist
- Get decisions on trade-offs (performance vs. simplicity, etc.)

**Don't guess or make assumptions** when you can ask. The Question tool provides structured choices that help users make informed decisions quickly.
