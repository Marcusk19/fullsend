---
name: replay-session
description: Use when the user wants to replay a Claude Code session from a GitHub Actions artifact link. Downloads the artifact, finds JSONL files, generates an interactive HTML replay with claude-replay, and serves it locally.
compatibility: Requires claude-replay (npm install -g claude-replay) and gh CLI authenticated with access to the target repository
---

# Replay Session from GitHub Actions Artifact

Generate an interactive HTML replay from a JSONL transcript stored in a GitHub Actions artifact.

## Prerequisites

- `claude-replay` installed globally (`npm install -g claude-replay`)
- `gh` CLI authenticated with access to the target repository

## Workflow

### 1. Get the artifact

The user provides a GitHub Actions run URL. Extract the owner, repo, and run ID from it.

URL formats to expect:
- `https://github.com/OWNER/REPO/actions/runs/RUN_ID`
- `https://github.com/OWNER/REPO/actions/runs/RUN_ID/attempts/N`
- `https://github.com/OWNER/REPO/actions/runs/RUN_ID/artifacts/ARTIFACT_ID`
- Or the user may just give a run ID and repo name separately

### 2. Ask clarifying questions

Before downloading, interactively ask the user:

- **Which artifact?** Run `gh run view <run-id> -R OWNER/REPO` to list the artifacts available in that run. If there are multiple artifacts, ask which one to use.
- **Which JSONL?** After downloading, list the JSONL files grouped by iteration with their sizes. Each artifact represents a single agent — all JSONL files inside belong to that agent across its iterations. Default to replaying all files. Only ask the user to narrow down if they want a specific iteration or subset.
- **Replay options?** Ask if they want any special options (turn range, theme, hide thinking blocks, redact strings). Defaults are fine for most cases — don't over-ask.

### 3. Download the artifact

```bash
TMPDIR=$(mktemp -d /tmp/replay-XXXXXX)
gh run download <run-id> -R OWNER/REPO -n "<artifact-name>" -D "$TMPDIR/artifact"
```

### 4. Find the JSONL file(s)

The downloaded artifact represents a single agent run. Its top-level directory (e.g., `agent-code-2446-1776439672/`) is the agent identifier. All JSONL files inside — across all `iteration-N/` subdirectories — belong to this agent. There is no need to ask the user which agent to replay.

```bash
find "$TMPDIR/artifact" -name "*.jsonl" -type f
```

List the files to the user grouped by iteration, with sizes, so they can choose "all" (default) or a specific subset.

### 5. Generate and serve the replay

```bash
claude-replay <path-to-jsonl> --no-compress -o "$TMPDIR/replay.html" [extra options]
claude-replay <path-to-jsonl> --no-compress --serve --port 7331
```

Always use `--no-compress` — compressed replays fail to render in some browsers.

If port 7331 is busy, try 7332, 7333, etc.

Present the URL to the user: `http://127.0.0.1:<port>`

### 6. Multiple JSONL files

If the user wants to replay multiple files (e.g., main + subagents), chain them:

```bash
claude-replay file1.jsonl file2.jsonl file3.jsonl -o "$TMPDIR/replay.html"
```

## Notes

- Always use `/tmp` for downloaded artifacts and generated HTML — never pollute the working directory.
- The `--serve` flag works even though the process appears to exit immediately in the background. The server stays up — don't retry or switch to a different HTTP server.
- Kill the previous server's port before starting a new one: `kill $(lsof -ti:<port>) 2>/dev/null`
- Remind the user that the server will stop when the Claude Code session ends.
