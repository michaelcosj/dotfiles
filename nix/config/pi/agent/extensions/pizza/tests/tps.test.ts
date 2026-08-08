import { describe, expect, it } from "bun:test";
import { registerTpsExtension } from "../src/features/tps/register.ts";

function createHarness() {
  const handlers = new Map<string, Function>();
  const notifications: Array<[string, string]> = [];
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
  };
  const ctx = {
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
    },
  };

  registerTpsExtension(pi);
  return { handlers, notifications, ctx };
}

function runAtTimes(times: number[], run: () => void) {
  const originalNow = Date.now;
  let calls = 0;
  Date.now = () => {
    if (calls >= times.length) throw new Error("Date.now called too many times");
    return times[calls++]!;
  };

  try {
    run();
  } finally {
    Date.now = originalNow;
  }

  expect(calls).toBe(times.length);
}

describe("tps", () => {
  it("uses summed assistant intervals for TPS and agent wall time for elapsed", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([0, 100, 600, 10_000, 11_000, 12_500], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!(
        {
          messages: [
            { role: "assistant", usage: { input: 10, output: 100, totalTokens: 110 } },
            { role: "assistant", usage: { input: 20, output: 200, totalTokens: 220 } },
          ],
        },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS 200.0 tok/s. out 300, in 30, cache r/w 0/0, total 330, 2 responses, 1.5s model time, 12.5s elapsed",
        "info",
      ],
    ]);
  });

  it("reports zero TPS with only total elapsed when the model returns no output", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([1_000, 3_500], () => {
      handlers.get("agent_start")!({});
      handlers.get("agent_end")!(
        { messages: [{ role: "assistant", usage: { output: 0 } }] },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS 0 tok/s — model returned no output (2.5s elapsed)",
        "warning",
      ],
    ]);
  });

  it("uses the same no-output wording when assistant timing was recorded", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([1_000, 1_500, 2_500, 3_500], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!(
        { messages: [{ role: "assistant", usage: { output: 0 } }] },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS 0 tok/s — model returned no output (2.5s elapsed)",
        "warning",
      ],
    ]);
  });

  it("reports elapsed wall time when assistant timing is unavailable", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([200, 1_700], () => {
      handlers.get("agent_start")!({});
      handlers.get("agent_end")!(
        { messages: [{ role: "assistant", usage: { output: 25 } }] },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS unavailable — model timing was incomplete or invalid (1.5s elapsed)",
        "warning",
      ],
    ]);
  });

  it("does not combine output with a zero-length assistant interval", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([0, 100, 1_100, 2_000, 2_000, 3_000], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!(
        {
          messages: [
            { role: "assistant", usage: { output: 100 } },
            { role: "assistant", usage: { output: 200 } },
          ],
        },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS unavailable — model timing was incomplete or invalid (3.0s elapsed)",
        "warning",
      ],
    ]);
  });

  it("does not combine output with a backward assistant interval", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([0, 100, 1_100, 2_000, 1_500, 3_000], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!(
        {
          messages: [
            { role: "assistant", usage: { output: 100 } },
            { role: "assistant", usage: { output: 200 } },
          ],
        },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS unavailable — model timing was incomplete or invalid (3.0s elapsed)",
        "warning",
      ],
    ]);
  });

  it("does not combine output from an assistant response with missing timing", () => {
    const { handlers, notifications, ctx } = createHarness();

    runAtTimes([0, 100, 1_100, 3_000], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!(
        {
          messages: [
            { role: "assistant", usage: { output: 100 } },
            { role: "assistant", usage: { output: 200 } },
          ],
        },
        ctx,
      );
    });

    expect(notifications).toEqual([
      [
        "TPS unavailable — model timing was incomplete or invalid (3.0s elapsed)",
        "warning",
      ],
    ]);
  });

  it("resets timing state between agent runs", () => {
    const { handlers, notifications, ctx } = createHarness();
    const messages = [{
      role: "assistant",
      usage: { input: 10, output: 100, totalTokens: 110 },
    }];

    runAtTimes([0, 100, 1_100, 2_000, 10_000, 10_250, 10_750, 12_000], () => {
      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!({ messages }, ctx);

      handlers.get("agent_start")!({});
      handlers.get("message_start")!({ message: { role: "assistant" } });
      handlers.get("message_end")!({ message: { role: "assistant" } });
      handlers.get("agent_end")!({ messages }, ctx);
    });

    expect(notifications).toEqual([
      [
        "TPS 100.0 tok/s. out 100, in 10, cache r/w 0/0, total 110, 1 response, 1.0s model time, 2.0s elapsed",
        "info",
      ],
      [
        "TPS 200.0 tok/s. out 100, in 10, cache r/w 0/0, total 110, 1 response, 0.5s model time, 2.0s elapsed",
        "info",
      ],
    ]);
  });
});
