import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditToolDetails,
  type ExtensionAPI,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function title(theme: any, context: any, name: string, detail: string): Text {
  const color = context.isError ? "error" : context.isPartial || !context.executionStarted ? "warning" : "success";
  return new Text(
    theme.fg(color, "● ") + theme.fg("toolTitle", theme.bold(name)) + theme.fg("text", `(${detail})`),
    0,
    0,
  );
}

function textResult(result: any): string {
  return result.content
    .filter((item: any) => item.type === "text")
    .map((item: any) => item.text)
    .join("\n");
}

function indented(theme: any, text: string, color: string = "toolOutput", maxLines?: number): Text {
  const lines = text.split("\n");
  const shown = maxLines == null ? lines : lines.slice(0, maxLines);
  let output = theme.fg("dim", "  └  ") + theme.fg(color, shown[0] || "Done");
  for (const line of shown.slice(1)) output += `\n${theme.fg("dim", "     ")}${theme.fg(color, line)}`;
  if (maxLines != null && lines.length > maxLines) {
    output += `\n${theme.fg("dim", `     … ${lines.length - maxLines} more lines (ctrl+o to expand)`)}`;
  }
  return new Text(output, 0, 0);
}

export function registerClaudeStyleToolRenderers(pi: ExtensionAPI): void {
  const cwd = process.cwd();

  const bash = createBashTool(cwd);
  pi.registerTool({
    ...bash,
    renderShell: "self",
    renderCall(args, theme, context) {
      return title(theme, context, "Bash", args.command);
    },
    renderResult(result, options, theme) {
      const output = textResult(result);
      if (options.isPartial) return indented(theme, output || "Running…");
      return indented(theme, output || "Done", "toolOutput", options.expanded ? undefined : 12);
    },
  });

  const read = createReadTool(cwd);
  pi.registerTool({
    ...read,
    renderShell: "self",
    renderCall(args, theme, context) {
      return title(theme, context, "Read", args.path);
    },
    renderResult(result, options, theme) {
      const output = textResult(result);
      const lineCount = output ? output.split("\n").length : 0;
      if (!options.expanded) return indented(theme, `Read ${lineCount} lines`);
      return indented(theme, output || "No content", "toolOutput");
    },
  });

  const write = createWriteTool(cwd);
  pi.registerTool({
    ...write,
    renderShell: "self",
    renderCall(args, theme, context) {
      return title(theme, context, "Write", args.path);
    },
    renderResult(result, options, theme, context) {
      const output = textResult(result);
      const summary = context.isError
        ? output
        : `Wrote ${context.args.content.split("\n").length} lines to ${context.args.path}`;
      return indented(theme, summary || "Done", context.isError ? "error" : "toolOutput", options.expanded ? undefined : 12);
    },
  });

  const edit = createEditTool(cwd);
  pi.registerTool({
    ...edit,
    renderShell: "self",
    renderCall(args, theme, context) {
      return title(theme, context, "Edit", args.path);
    },
    renderResult(result, options: ToolRenderResultOptions, theme, context) {
      const output = textResult(result);
      if (context.isError) return indented(theme, output || "Edit failed", "error");
      const diff = (result.details as EditToolDetails | undefined)?.diff;
      if (!diff) return indented(theme, output || "Updated successfully");
      const lines = diff.split("\n");
      const additions = lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
      const removals = lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
      const max = options.expanded ? lines.length : 30;
      let rendered = theme.fg("dim", "  └  ") + theme.fg("toolOutput", `Added ${additions} lines, removed ${removals} lines`);
      for (const line of lines.slice(0, max)) {
        const color = line.startsWith("+") && !line.startsWith("+++")
          ? "toolDiffAdded"
          : line.startsWith("-") && !line.startsWith("---")
            ? "toolDiffRemoved"
            : "toolDiffContext";
        rendered += `\n${theme.fg("dim", "     ")}${theme.fg(color, line)}`;
      }
      if (lines.length > max) rendered += `\n${theme.fg("dim", `     … ${lines.length - max} more lines`)}`;
      return new Text(rendered, 0, 0);
    },
  });
}
