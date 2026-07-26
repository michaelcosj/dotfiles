import { describe, expect, test } from "bun:test";
import { buildFdArgs, buildRgArgs, FD_DEFAULT_LIMIT } from "./src/args.ts";
import { releaseAsset, resolveBinary, TOOL_SPECS, UnsupportedPlatformError, type BinaryEnv } from "./src/binaries.ts";
import { formatOutput } from "./src/output.ts";

describe("file search", () => {
  test("builds safe fd arguments", () => expect(buildFdArgs({ pattern: "-rf" })).toEqual(["--color=never", "--max-results", String(FD_DEFAULT_LIMIT), "--", "-rf"]));
  test("builds literal rg arguments", () => expect(buildRgArgs({ pattern: "a.b", fixed_strings: true })).toContain("--fixed-strings"));
  test("selects official release assets", () => expect(releaseAsset("rg", { os: "darwin", arch: "arm64" })?.url).toContain("github.com/BurntSushi/ripgrep"));
  test("rejects unsupported download targets", async () => {
    const env: BinaryEnv = { probe: async () => false, install: async () => {} };
    await expect(resolveBinary(TOOL_SPECS.fd, "/bin", { os: "win32", arch: "x64" }, env)).rejects.toBeInstanceOf(UnsupportedPlatformError);
  });
  test("prefers system binaries", async () => {
    const env: BinaryEnv = { probe: async command => command === "fd", install: async () => { throw new Error("not called") } };
    await expect(resolveBinary(TOOL_SPECS.fd, "/fallback", { os: "linux", arch: "x64" }, env)).resolves.toEqual({ tool: "fd", command: "fd", source: "system" });
  });
  test("formats ordinary output without persistence", async () => expect(await formatOutput("a\nb\n", { tempPrefix: "test-" })).toMatchObject({ text: "a\nb", lineCount: 2, truncated: false }));
});
