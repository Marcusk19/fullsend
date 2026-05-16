#!/usr/bin/env bash
# Resolve pre-commit hook tool dependencies for a target repository.
#
# Reads the target repo's .pre-commit-config.yaml, matches hooks
# against the known-tools registry (tools/precommit-tools.yaml),
# and outputs a JSON manifest to stdout. The manifest is consumed
# by install-precommit-tools.sh.
#
# Usage:
#   resolve-precommit-tools.sh <target-repo-path>
#
# Output (JSON to stdout):
#   {
#     "tools": [
#       { "type": "binary", "name": "lychee", "version": "0.24.2", ... },
#       { "type": "apt", "name": "shellcheck" }
#     ],
#     "warnings": ["hook 'custom-lint' uses language:system but is not in registry"]
#   }
#
# Exit codes:
#   0 — manifest produced (may have warnings)
#   1 — missing dependencies or invalid input
set -euo pipefail

TARGET_REPO="${1:?Usage: resolve-precommit-tools.sh <target-repo-path>}"
PRECOMMIT_CONFIG="${TARGET_REPO}/.pre-commit-config.yaml"

if [ ! -f "${PRECOMMIT_CONFIG}" ]; then
  echo '{"tools":[],"warnings":["no .pre-commit-config.yaml found"]}' >&2
  echo '{"tools":[],"warnings":[]}'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_REGISTRY="${SCRIPT_DIR}/../tools/precommit-tools.yaml"

if [ ! -f "${TOOLS_REGISTRY}" ]; then
  echo "::error::Tools registry not found at ${TOOLS_REGISTRY}" >&2
  echo '{"tools":[],"warnings":["tools registry not found"]}'
  exit 0
fi

# Require python3 and PyYAML for YAML parsing.
if ! python3 -c "import yaml" 2>/dev/null; then
  if ! pip install --quiet "pyyaml>=6.0" 2>/dev/null; then
    echo "::warning::PyYAML not available — cannot resolve pre-commit tools" >&2
    echo '{"tools":[],"warnings":["PyYAML not available"]}'
    exit 0
  fi
fi

python3 - "${PRECOMMIT_CONFIG}" "${TOOLS_REGISTRY}" <<'PYTHON_SCRIPT'
import json
import sys
import yaml

def main():
    precommit_path = sys.argv[1]
    registry_path = sys.argv[2]

    with open(precommit_path) as f:
        precommit = yaml.safe_load(f)
    with open(registry_path) as f:
        registry = yaml.safe_load(f)

    if not precommit or "repos" not in precommit:
        print(json.dumps({"tools": [], "warnings": ["empty or invalid .pre-commit-config.yaml"]}))
        return

    registry_tools = registry.get("tools", [])

    # Build lookup: (repo, hook_id) -> tool entry
    # Also build entry-based lookup for local hooks matched by entry content
    repo_hook_map = {}
    entry_match_map = {}
    for tool in registry_tools:
        key = (tool.get("repo", ""), tool["hook_id"])
        repo_hook_map[key] = tool
        if "match_entry" in tool:
            entry_match_map[tool["match_entry"]] = tool

    resolved = []
    seen_names = set()
    warnings = []

    for repo_entry in precommit.get("repos", []):
        repo_url = repo_entry.get("repo", "")
        for hook in repo_entry.get("hooks", []):
            hook_id = hook.get("id", "")
            entry = hook.get("entry", "")
            language = hook.get("language", "")

            # Try exact match first
            tool = repo_hook_map.get((repo_url, hook_id))

            # Try entry-based match for local hooks
            if tool is None and repo_url == "local":
                for match_str, match_tool in entry_match_map.items():
                    if match_str in entry:
                        tool = match_tool
                        break

            if tool is not None:
                install = tool.get("install", {})
                name = install.get("name", "")
                if name and name not in seen_names:
                    seen_names.add(name)
                    resolved.append(install)
            else:
                # Language-based fallback
                if language == "system":
                    cmd = entry.split()[0] if entry else hook_id
                    warnings.append(
                        f"hook '{hook_id}' uses language:system "
                        f"(command: {cmd}) — not in registry, "
                        f"must be pre-installed on runner"
                    )
                elif language in ("golang",):
                    warnings.append(
                        f"hook '{hook_id}' requires Go toolchain "
                        f"(language: {language})"
                    )
                elif language in ("rust",):
                    warnings.append(
                        f"hook '{hook_id}' requires Rust toolchain "
                        f"(language: {language})"
                    )
                # python, node, script — already available on GHA runners

    print(json.dumps({"tools": resolved, "warnings": warnings}))

if __name__ == "__main__":
    main()
PYTHON_SCRIPT
