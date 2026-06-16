#!/usr/bin/env bash
# Single source of truth for the pinned OpenShell version.
#
# Source this script to set OPENSHELL_VERSION and OPENSHELL_SHA in the
# current shell. In GitHub Actions it also exports them to GITHUB_ENV
# for downstream steps. Each consumer handles installation separately.
#
# Usage:
#   source .github/scripts/setup-openshell.sh

# renovate: datasource=github-tags depName=NVIDIA/OpenShell
OPENSHELL_VERSION=0.0.54
OPENSHELL_SHA=79aa355dd008e496a7d8f97b361a7b2866066fbc
OPENSHELL_WHEEL_SHA=sha256:99aa7dca10b000cf1a8ba3bde4f94b3bdfe83e31b34124990f19a4121131b9b1

export OPENSHELL_VERSION OPENSHELL_SHA OPENSHELL_WHEEL_SHA

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "OPENSHELL_VERSION=${OPENSHELL_VERSION}" >> "${GITHUB_ENV}"
  echo "OPENSHELL_SHA=${OPENSHELL_SHA}" >> "${GITHUB_ENV}"
  echo "OPENSHELL_WHEEL_SHA=${OPENSHELL_WHEEL_SHA}" >> "${GITHUB_ENV}"
fi
