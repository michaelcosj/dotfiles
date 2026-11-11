#!/usr/bin/env bun
// Streams a background job log in readable form: `tail -F log | bun format-log-cli.ts`.
// Used by the Rex float that /bg_status opens.
import { createFormatter } from "./format-log.ts";

const f = createFormatter();
let carry = "";
const strip = (s: string) =>
  s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");

for await (const chunk of process.stdin) {
  const parts = (carry + chunk.toString()).split("\n");
  carry = parts.pop() ?? "";
  const out = parts.flatMap((l) => f.line(strip(l).replace(/\r$/, "").split("\r").pop() ?? ""));
  if (out.length) process.stdout.write(out.join("\n") + "\n");
}
if (carry) process.stdout.write(f.line(carry).join("\n") + "\n");
