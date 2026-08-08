import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CONVERSATION_CHARS = 24_000;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function conversationFromBranch(branch: readonly unknown[]): string {
  const messages: string[] = [];

  for (const value of branch) {
    if (typeof value !== "object" || value === null || !("type" in value)) continue;
    if (value.type !== "message" || !("message" in value)) continue;

    const message = value.message;
    if (typeof message !== "object" || message === null || !("role" in message)) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;

    const content = "content" in message ? message.content : undefined;
    const text = textFromContent(content).trim();
    if (text) messages.push(`${message.role}: ${text}`);
  }

  return messages.join("\n\n").slice(-MAX_CONVERSATION_CHARS);
}

function cleanTitle(value: string): string {
  return value
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/[.!:;]+$/, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("generate-title", {
    description: "Generate and set a session title with the active configured AI model",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const conversation = conversationFromBranch(ctx.sessionManager.getBranch());
      if (!conversation) {
        ctx.ui.notify("No conversation available to title", "warning");
        return;
      }

      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No AI model is configured", "error");
        return;
      }
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        ctx.ui.notify(`No authentication configured for ${model.provider}/${model.id}`, "error");
        return;
      }

      ctx.ui.notify(`Generating title with ${model.provider}/${model.id}…`, "info");

      try {
        const response = await ctx.modelRegistry.complete(
          model,
          {
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: [
                      "Generate a concise title for this coding-agent session.",
                      "Use 3-8 words, plain text only. Do not use quotes, markdown, or ending punctuation.",
                      "Describe the main task rather than the latest incidental detail.",
                      "",
                      "<conversation>",
                      conversation,
                      "</conversation>",
                    ].join("\n"),
                  },
                ],
                timestamp: Date.now(),
              },
            ],
          },
          {
            reasoningEffort: "minimal",
            cacheRetention: "none",
            sessionId: uuidv7(),
          },
        );

        const title = cleanTitle(
          response.content
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join(" "),
        );

        if (!title) throw new Error("model returned an empty title");

        pi.setSessionName(title);
        ctx.ui.notify(`Session titled: ${title}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not generate title: ${message}`, "error");
      }
    },
  });
}
