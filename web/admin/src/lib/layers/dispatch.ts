import type { LayerReport } from "../status/types";
import { DISPATCH_TOKEN_SECRET_NAME } from "./constants";
import type { LayerGithub } from "./githubClient";

/**
 * Read-only port of `DispatchTokenLayer.Analyze` (`internal/layers/dispatch.go`).
 */
export async function analyzeDispatchTokenLayer(
  org: string,
  gh: LayerGithub,
): Promise<LayerReport> {
  const report: LayerReport = {
    name: "dispatch-token",
    status: "unknown",
    details: [],
    wouldInstall: [],
    wouldFix: [],
  };

  const res = await gh.orgSecretExists(org, DISPATCH_TOKEN_SECRET_NAME);
  if (res.kind === "forbidden") {
    report.status = "unknown";
    report.details.push(
      `cannot verify ${DISPATCH_TOKEN_SECRET_NAME} org secret (insufficient permissions; admin:org scope may be required)`,
    );
    return report;
  }
  if (res.kind === "error") {
    report.status = "unknown";
    report.details.push(`cannot verify ${DISPATCH_TOKEN_SECRET_NAME} org secret: ${res.message}`);
    return report;
  }

  if (res.exists) {
    report.status = "installed";
    report.details.push(`${DISPATCH_TOKEN_SECRET_NAME} org secret exists`);
  } else {
    report.status = "not_installed";
    report.wouldInstall.push(`create ${DISPATCH_TOKEN_SECRET_NAME} org secret`);
  }

  return report;
}
