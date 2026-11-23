// A Neovim review note is new work, not passive context. It starts a turn
// when the agent is idle, or is steered into an active turn, so the agent
// reads it between tool calls rather than after it has finished.
// Hidden from the transcript, but part of the model context.
export function deliverNote(pi: any, text: string) {
  try {
    pi.sendMessage(
      { customType: "editor-context", content: text, display: false },
      { triggerTurn: true, deliverAs: "steer" },
    );
  } catch {}
}

// Review comments the user sent from Neovim: a visible user message, so
// the user sees what was sent. Steered into a running turn, so the agent
// reads them between tool calls rather than after it has finished.
export function deliverReview(pi: any, text: string, idle: boolean) {
  try {
    if (idle) pi.sendUserMessage(text);
    else pi.sendUserMessage(text, { deliverAs: "steer" });
  } catch {}
}
