import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { sanitizeText } from "./ui/output-view.js";

export function registerBackgroundTerminalMessageRenderers(pi: ExtensionAPI) {
  pi.registerMessageRenderer(
    "background-terminal-result",
    (message, { expanded }, theme) => {
      const details = (message.details ?? {}) as {
        id?: string;
        title?: string;
        status?: string;
        exitCode?: number;
        signal?: string;
      };
      const failed = details.status === "failed";
      const killed = details.status === "killed";
      const icon = failed
        ? theme.fg("error", "x")
        : killed
          ? theme.fg("muted", "■")
          : theme.fg("success", "■");
      const how = killed
        ? "killed"
        : (details.signal ?? `exit ${details.exitCode ?? "?"}`);
      const header =
        `${icon} ` +
        theme.fg("accent", theme.bold(`terminal ${details.id ?? "?"}`)) +
        theme.fg("muted", ` · ${details.title ?? ""} · ${how}`);

      const content = typeof message.content === "string" ? message.content : "";
      // Keep the summary line in the heading, but retain any error line in the
      // body. ANSI/control stripping belongs at presentation time.
      const body = sanitizeText(content.split("\n").slice(1).join("\n").trim());
      if (expanded) {
        const markdown = new Markdown(body, 0, 0, getMarkdownTheme());
        const headerText = new Text(header, 0, 0);
        return {
          render: (width: number) => [
            ...headerText.render(width),
            ...markdown.render(width),
          ],
          invalidate: () => {
            headerText.invalidate();
            markdown.invalidate();
          },
        };
      }

      const previewLines = body.split("\n").slice(0, 8);
      let text = header;
      for (const line of previewLines) {
        text += `\n${theme.fg("toolOutput", line)}`;
      }
      if (body.split("\n").length > 8) {
        text += `\n${theme.fg("dim", "... (ctrl+o to expand)")}`;
      }
      return new Text(text, 0, 0);
    },
  );
}
