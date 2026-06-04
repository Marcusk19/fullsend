#!/usr/bin/env bash
# after_each hook: delete the ephemeral GitHub repo.
#
# Required env (forward-propagated from setup-fixture.sh):
#   EPHEMERAL_REPO — org/name of the ephemeral repo
set -euo pipefail

EPHEMERAL_REPO="${EPHEMERAL_REPO:-}"
if [[ -z "$EPHEMERAL_REPO" ]]; then
  echo "WARNING: EPHEMERAL_REPO not set, skipping teardown" >&2
  exit 0
fi

gh repo delete "$EPHEMERAL_REPO" --yes 2>/dev/null || true
echo "Deleted repo: $EPHEMERAL_REPO"
