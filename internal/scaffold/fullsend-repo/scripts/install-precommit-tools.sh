#!/usr/bin/env bash
# Install pre-commit hook dependencies on the GitHub Actions runner.
#
# Reads a JSON manifest produced by resolve-precommit-tools.sh and
# installs the listed tools. Supports four install types:
#   binary — download from release URL with SHA256 verification
#   apt    — install via apt-get
#   pip    — install via pip
#   npm    — install via npm -g
#
# Binary downloads use architecture detection (uname -m) and pinned
# checksums for supply-chain safety. Same pattern as post-code.sh and
# images/code/Containerfile.
#
# Usage:
#   install-precommit-tools.sh <manifest.json>
#
# The manifest is the JSON output of resolve-precommit-tools.sh.
#
# Exit codes:
#   0 — all tools installed (or already present)
#   1 — critical failure (missing required tool, checksum mismatch)
set -euo pipefail

MANIFEST="${1:?Usage: install-precommit-tools.sh <manifest.json>}"

if [ ! -f "${MANIFEST}" ]; then
  echo "::error::Manifest not found: ${MANIFEST}"
  exit 1
fi

INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "${INSTALL_DIR}"
export PATH="${INSTALL_DIR}:${PATH}"

# Detect architecture once.
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64)
    TRIPLE="x86_64-unknown-linux-gnu"
    GOARCH="x64"
    ;;
  aarch64)
    TRIPLE="aarch64-unknown-linux-gnu"
    GOARCH="arm64"
    ;;
  *)
    echo "::warning::Unsupported architecture: ${ARCH} — skipping binary installs"
    TRIPLE=""
    GOARCH=""
    ;;
esac

# Print warnings from the resolver.
WARNINGS="$(jq -r '.warnings[]' "${MANIFEST}" 2>/dev/null || true)"
if [ -n "${WARNINGS}" ]; then
  while IFS= read -r w; do
    echo "::warning::${w}"
  done <<< "${WARNINGS}"
fi

TOOL_COUNT="$(jq '.tools | length' "${MANIFEST}" 2>/dev/null || echo 0)"
if [ "${TOOL_COUNT}" -eq 0 ]; then
  echo "No additional pre-commit tools to install"
  exit 0
fi

echo "Installing ${TOOL_COUNT} pre-commit tool dependency(ies)..."

# Process each tool entry.
jq -c '.tools[]' "${MANIFEST}" | while IFS= read -r entry; do
  TYPE="$(echo "${entry}" | jq -r '.type')"
  NAME="$(echo "${entry}" | jq -r '.name')"

  case "${TYPE}" in
    binary)
      if command -v "${NAME}" >/dev/null 2>&1; then
        echo "  ${NAME}: already available ($(command -v "${NAME}"))"
        continue
      fi

      if [ -z "${TRIPLE}" ]; then
        echo "::warning::Cannot install ${NAME} — unsupported architecture"
        continue
      fi

      VERSION="$(echo "${entry}" | jq -r '.version')"
      URL_TEMPLATE="$(echo "${entry}" | jq -r '.url_template')"
      BINARY_NAME="$(echo "${entry}" | jq -r '.binary_name // .name')"
      STRIP_PREFIX="$(echo "${entry}" | jq -r '.strip_prefix // ""')"

      # Resolve checksum for current architecture.
      CHECKSUM="$(echo "${entry}" | jq -r ".checksums.${ARCH} // empty")"
      if [ -z "${CHECKSUM}" ]; then
        echo "::warning::No checksum for ${NAME} on ${ARCH} — skipping"
        continue
      fi

      # Resolve URL template.
      URL="${URL_TEMPLATE}"
      URL="${URL//\{version\}/${VERSION}}"
      URL="${URL//\{triple\}/${TRIPLE}}"
      URL="${URL//\{goarch\}/${GOARCH}}"

      echo "  ${NAME} v${VERSION}: downloading..."
      TMPDIR="$(mktemp -d)"
      TARBALL="${TMPDIR}/${NAME}.tar.gz"

      curl -fsSL "${URL}" -o "${TARBALL}"
      echo "${CHECKSUM}  ${TARBALL}" | sha256sum -c - >/dev/null 2>&1

      tar xzf "${TARBALL}" -C "${TMPDIR}"

      # Find and install the binary.
      if [ -n "${STRIP_PREFIX}" ]; then
        RESOLVED_PREFIX="${STRIP_PREFIX//\{triple\}/${TRIPLE}}"
        RESOLVED_PREFIX="${RESOLVED_PREFIX//\{version\}/${VERSION}}"
        BIN_PATH="${TMPDIR}/${RESOLVED_PREFIX}/${BINARY_NAME}"
      else
        BIN_PATH="${TMPDIR}/${BINARY_NAME}"
      fi

      if [ ! -f "${BIN_PATH}" ]; then
        echo "::warning::Binary not found at expected path: ${BIN_PATH}"
        # Try finding it in the extracted tree.
        FOUND="$(find "${TMPDIR}" -name "${BINARY_NAME}" -type f | head -1)"
        if [ -n "${FOUND}" ]; then
          BIN_PATH="${FOUND}"
        else
          echo "::error::Cannot find ${BINARY_NAME} in archive"
          rm -rf "${TMPDIR}"
          continue
        fi
      fi

      mv "${BIN_PATH}" "${INSTALL_DIR}/${BINARY_NAME}"
      chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

      # Install extra binaries (e.g., uvx alongside uv).
      EXTRAS="$(echo "${entry}" | jq -r '.extra_binaries[]? // empty' 2>/dev/null || true)"
      if [ -n "${EXTRAS}" ]; then
        while IFS= read -r extra; do
          EXTRA_PATH=""
          if [ -n "${STRIP_PREFIX}" ]; then
            EXTRA_PATH="${TMPDIR}/${RESOLVED_PREFIX}/${extra}"
          fi
          if [ ! -f "${EXTRA_PATH:-}" ]; then
            EXTRA_PATH="$(find "${TMPDIR}" -name "${extra}" -type f | head -1)"
          fi
          if [ -n "${EXTRA_PATH}" ] && [ -f "${EXTRA_PATH}" ]; then
            mv "${EXTRA_PATH}" "${INSTALL_DIR}/${extra}"
            chmod +x "${INSTALL_DIR}/${extra}"
            echo "  ${NAME}: installed extra binary: ${extra}"
          fi
        done <<< "${EXTRAS}"
      fi

      rm -rf "${TMPDIR}"
      echo "  ${NAME} v${VERSION}: installed to ${INSTALL_DIR}/${BINARY_NAME}"
      ;;

    apt)
      if command -v "${NAME}" >/dev/null 2>&1; then
        echo "  ${NAME}: already available"
        continue
      fi
      echo "  ${NAME}: installing via apt-get..."
      sudo apt-get update -qq && sudo apt-get install -y -qq "${NAME}" 2>/dev/null \
        || echo "::warning::Failed to install ${NAME} via apt-get"
      ;;

    pip)
      VERSION="$(echo "${entry}" | jq -r '.version // ""')"
      PKG="${NAME}"
      if [ -n "${VERSION}" ]; then
        PKG="${NAME}==${VERSION}"
      fi
      echo "  ${NAME}: installing via pip..."
      pip install --quiet "${PKG}" 2>/dev/null \
        || pip3 install --quiet "${PKG}" 2>/dev/null \
        || echo "::warning::Failed to install ${NAME} via pip"
      ;;

    npm)
      echo "  ${NAME}: installing via npm..."
      npm install -g "${NAME}" 2>/dev/null \
        || echo "::warning::Failed to install ${NAME} via npm"
      ;;

    *)
      echo "::warning::Unknown install type '${TYPE}' for ${NAME}"
      ;;
  esac
done

echo "Pre-commit tool installation complete"
