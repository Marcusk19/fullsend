#!/usr/bin/env bash
# reconcile-repos-test.sh - Regression tests for reconcile-repos.sh.
#
# Uses mocked gh/yq/base64 commands so tests do not hit GitHub.
# Run from the repo root: bash internal/scaffold/fullsend-repo/scripts/reconcile-repos-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RECONCILE_SCRIPT="${SCRIPT_DIR}/reconcile-repos.sh"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

CONFIG_DIR="${TMPDIR}/config"
MOCK_BIN="${TMPDIR}/bin"
GH_LOG="${TMPDIR}/gh-calls.log"
mkdir -p "${CONFIG_DIR}/templates" "${MOCK_BIN}"

cat > "${CONFIG_DIR}/config.yaml" <<'EOF'
version: 1
repos:
  test-repo:
    enabled: true
EOF

cat > "${CONFIG_DIR}/templates/shim-workflow.yaml" <<'EOF'
fresh shim template
EOF

cat > "${MOCK_BIN}/base64" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "-w0" ]]; then
  shift
fi
/usr/bin/base64 "$@" | tr -d '\r\n'
EOF
chmod +x "${MOCK_BIN}/base64"

cat > "${MOCK_BIN}/yq" <<'EOF'
#!/usr/bin/env bash
query="${1:-}"
if [[ "$query" == *"enabled == true"* ]]; then
  echo "test-repo"
elif [[ "$query" == *"enabled == false"* ]]; then
  :
else
  echo "unexpected yq query: $*" >&2
  exit 1
fi
EOF
chmod +x "${MOCK_BIN}/yq"

cat > "${MOCK_BIN}/gh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
printf 'gh' >> "${GH_LOG}"
for arg in "\$@"; do
  printf ' %q' "\$arg" >> "${GH_LOG}"
done
printf '\n' >> "${GH_LOG}"

if [[ "\$1" == "pr" && "\$2" == "list" ]]; then
  for arg in "\$@"; do
    if [[ "\$arg" == "fullsend/onboard" ]]; then
      echo "https://github.com/test-org/test-repo/pull/18"
    fi
  done
  exit 0
fi

if [[ "\$1" != "api" ]]; then
  echo "unexpected gh command: \$*" >&2
  exit 1
fi

endpoint="\$2"
case "\$endpoint" in
  repos/test-org/test-repo/contents/.github/workflows/fullsend.yaml)
    echo "c3RhbGUgc2hpbSB0ZW1wbGF0ZQo="
    ;;
  repos/test-org/test-repo)
    echo "main"
    ;;
  repos/test-org/test-repo/git/ref/heads/main)
    echo "base-sha"
    ;;
  repos/test-org/test-repo/git/commits/base-sha)
    echo "base-tree-sha"
    ;;
  repos/test-org/test-repo/git/blobs)
    echo "blob-sha"
    ;;
  repos/test-org/test-repo/git/trees)
    echo "tree-sha"
    ;;
  repos/test-org/test-repo/git/commits)
    echo "desired-commit-sha"
    ;;
  repos/test-org/test-repo/git/refs)
    exit 1
    ;;
  repos/test-org/test-repo/git/refs/heads/fullsend/onboard)
    exit 0
    ;;
  repos/test-org/test-repo/git/refs/heads/fullsend/offboard)
    exit 0
    ;;
  *)
    echo "unexpected gh api endpoint: \$endpoint" >&2
    exit 1
    ;;
esac
EOF
chmod +x "${MOCK_BIN}/gh"

export PATH="${MOCK_BIN}:${PATH}"
export GITHUB_REPOSITORY_OWNER="test-org"
export GITHUB_SHA="test-sha"
export GH_TOKEN="fake-token"

bash "${RECONCILE_SCRIPT}" "${CONFIG_DIR}" > "${TMPDIR}/stdout.log" 2>&1

if grep -q "refs/heads/fullsend/onboard.*sha=base-sha" "${GH_LOG}"; then
  echo "FAIL: fullsend/onboard was reset to the default branch SHA"
  cat "${GH_LOG}"
  exit 1
fi

if ! grep -q "refs/heads/fullsend/onboard.*sha=desired-commit-sha" "${GH_LOG}"; then
  echo "FAIL: fullsend/onboard was not moved directly to the desired shim commit"
  cat "${GH_LOG}"
  exit 1
fi

if grep -q "contents/.github/workflows/fullsend.yaml.*--method PUT" "${GH_LOG}"; then
  echo "FAIL: shim update used Contents API after resetting branch state"
  cat "${GH_LOG}"
  exit 1
fi

echo "PASS: stale shim branch update is atomic"
