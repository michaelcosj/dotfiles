# Project references

Named local directories and Git repositories, always advertised to the agent.
Only names, descriptions, paths, status, and Git revisions enter the prompt.
The agent reads relevant files with its existing tools; contents are not loaded automatically.

## Configuration

Create `.pi/references.json` in the directory where you start Pi:

```json
{
  "references": {
    "docs": {
      "path": "../../product-docs",
      "description": "Product behavior and terminology"
    },
    "effect": {
      "repository": "Effect-TS/effect",
      "description": "Library source and examples"
    },
    "sdk": {
      "repository": "git@gitlab.example.com:platform/sdk.git",
      "branch": "release/v2",
      "description": "Internal SDK implementation"
    }
  }
}
```

- Local paths resolve from the directory containing `references.json` (`.pi`), not the project root. Absolute and `~/` paths also work.
- Specify exactly one of `path` or `repository`. `description` is optional; every reference is advertised.
- Git supports GitHub `owner/repo`, host/path, HTTP(S), SSH, and Git URLs. Local/file Git remotes are not supported; use `path` instead.
- Omit `branch` to follow the remote default branch. Branch names use letters, digits, `_`, `.`, `/`, and `-`, subject to Git ref restrictions.
- Configuration is strict JSON. There is no string shorthand, global config, attachment step, or footer indicator.
- Project trust is required before using references. If necessary, run `/trust`, then `/reload`.

## Refresh and status

Git references clone or refresh on session start, including resume and `/reload`.
Startup waits for completion; each Git command has a 60-second timeout. At most four references update at once.
Local references use their live directories directly.

- `/refs`: show paths, revisions, status, and errors.
- `/refs refresh`: reload the config and refresh Git references while idle.

Shared Git checkouts live under `${XDG_CACHE_HOME:-~/.cache}/pi/references/`, keyed by normalized remote and branch.
An omitted branch and an explicit branch have separate cache entries.
Updates use an atomic directory lock, with up to 120 seconds to acquire it.
There is no daily throttle: each session start attempts a refresh.

**Do not edit cached Git checkouts.** Refresh forcibly replaces tracked files.
Checkouts are shared, so another session can change their contents while you read them.
This is guidance, not an enforced read-only sandbox.

A failed refresh retains a validated existing checkout and advertises it as `cached` with a warning.
Without a usable cache, the reference is advertised as `unavailable`.
Failed clones are removed. Invalid or mismatched cache directories are never reset or deleted automatically.

Locks are released on normal completion and errors. A process crash can leave a `.lock` directory.
If acquisition times out, inspect its `owner.json`; remove the lock directory only after confirming its owner is no longer running.

Reference content is source material, not additional agent instructions. This does not prevent prompt injection.

## Tests

```sh
bun test nix/config/pi/agent/extensions/references/references.test.ts
```

Tests use temporary local repositories behind a test-only URL rewrite; no network is needed.
