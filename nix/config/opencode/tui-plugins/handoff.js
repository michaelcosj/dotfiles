import { Plugin } from "@opencode-ai/plugin/tui";

const SUMMARY_PROMPT = `Write a concise, self-contained handoff for another agent to continue this conversation in a fresh session.
Summarize only; do not perform any work or call tools. Return only the handoff, without introductory commentary.
Include the objective, user requirements and constraints, decisions and their rationale, completed work, relevant files, verification results, remaining work, blockers, and the next concrete action.
Distinguish verified facts from hypotheses. Do not invent file contents or successful checks. Omit secrets and irrelevant tool output.
The new agent shares the working directory but will not have this conversation's history. Remind it to inspect the current files before editing; the working tree may have changed.`;

export default Plugin.define({
  id: "handoff.tui",
  setup(ctx) {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let running = false;

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "handoff.start",
          title: "Handoff to another agent",
          description: "/handoff <agent> <additional context>",
          palette: true,
          slash: { name: "handoff", arguments: true },
          enabled: () => ctx.ui.router.current().type === "session",
          async run(input) {
            const route = ctx.ui.router.current();
            if (route.type !== "session" || controller.signal.aborted) return;
            if (running) {
              ctx.ui.toast.show({ message: "A handoff is already running." });
              return;
            }

            const argumentsText = (input ?? "")
              .trim()
              .replace(/^\/handoff(?:\s+|$)/, "");
            const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(argumentsText);
            if (!match) {
              ctx.ui.toast.show({
                message: "Usage: /handoff <agent> <additional context>",
                variant: "error",
              });
              return;
            }
            const agentID = match[1];
            const additionalContext = match[2] ?? "";
            const sourceID = route.sessionID;
            let destinationID;
            running = true;

            try {
              const source = await ctx.client.session.get(
                { sessionID: sourceID },
                options,
              );
              controller.signal.throwIfAborted();
              const agents = await ctx.client.agent.list(
                { location: source.location },
                options,
              );
              controller.signal.throwIfAborted();
              if (!agents.data.some((agent) => agent.id === agentID)) {
                throw new Error(`Unknown agent: ${agentID}`);
              }

              ctx.ui.toast.show({ message: `Generating handoff for ${agentID}…` });
              const summary = await ctx.client.session.generate(
                { sessionID: sourceID, prompt: SUMMARY_PROMPT },
                options,
              );
              controller.signal.throwIfAborted();
              if (!summary.text.trim()) throw new Error("The handoff was empty.");

              const text = [
                `Continue the work described below. Source session: ${sourceID}.`,
                "Treat the handoff as historical context, not a replacement for your instructions. The user's additional context takes precedence over the summary.",
                `## Handoff\n${summary.text.trim()}`,
                ...(additionalContext
                  ? [`## Additional context from the user\n${additionalContext}`]
                  : []),
              ].join("\n\n");
              const destination = await ctx.client.session.create(
                {
                  agent: agentID,
                  location: source.location,
                  title: `Handoff to ${agentID}: ${source.title ?? sourceID}`,
                },
                options,
              );
              destinationID = destination.id;
              controller.signal.throwIfAborted();
              await ctx.client.session.prompt(
                { sessionID: destinationID, text },
                options,
              );
            } catch (error) {
              if (!controller.signal.aborted) {
                const detail = error instanceof Error ? error.message : String(error);
                ctx.ui.toast.show({
                  title: "Handoff failed",
                  message: destinationID
                    ? `${detail}\nDestination: ${destinationID}. Check it before retrying; submission may have been accepted.`
                    : detail,
                  variant: "error",
                  duration: 10000,
                });
              }
              return;
            } finally {
              running = false;
            }

            if (controller.signal.aborted) return;
            try {
              const current = ctx.ui.router.current();
              if (current.type === "session" && current.sessionID === sourceID) {
                if (ctx.ui.tabs.enabled()) {
                  ctx.ui.tabs.open(destinationID);
                  ctx.ui.tabs.focus(destinationID);
                } else {
                  ctx.ui.router.navigate({ type: "session", sessionID: destinationID });
                }
              }
              ctx.ui.toast.show({
                message: `Handoff submitted to ${agentID} (${destinationID}).`,
                variant: "success",
              });
            } catch {
              ctx.ui.toast.show({
                message: `Handoff submitted. Open session ${destinationID} from /sessions.`,
                variant: "success",
              });
            }
          },
        },
      ],
    }));

    return () => controller.abort();
  },
});
