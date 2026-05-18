import type { LayerReport } from "../status/types";
import { SHIM_WORKFLOW_PATH } from "./constants";
import type { LayerGithub } from "./githubClient";

/**
 * Read-only port of `EnrollmentLayer.Analyze` (`internal/layers/enrollment.go`).
 */
export async function analyzeEnrollmentLayer(
  org: string,
  gh: LayerGithub,
  enabledRepos: string[],
): Promise<LayerReport> {
  const report: LayerReport = {
    name: "enrollment",
    status: "unknown",
    details: [],
    wouldInstall: [],
    wouldFix: [],
  };

  const enrolled: string[] = [];
  const notEnrolled: string[] = [];

  for (const repo of enabledRepos) {
    const body = await gh.getRepoFileUtf8(org, repo, SHIM_WORKFLOW_PATH);
    if (body !== null) {
      enrolled.push(repo);
    } else {
      notEnrolled.push(repo);
    }
  }

  if (enabledRepos.length === 0) {
    report.status = "installed";
    report.details.push("no repositories enrolled");
  } else if (notEnrolled.length === 0) {
    report.status = "installed";
    for (const r of enrolled) {
      report.details.push(`${r} enrolled`);
    }
  } else if (enrolled.length === 0) {
    report.status = "not_installed";
    for (const r of notEnrolled) {
      report.wouldInstall.push(`create enrollment PR for ${r}`);
    }
  } else {
    report.status = "degraded";
    for (const r of enrolled) {
      report.details.push(`${r} enrolled`);
    }
    for (const r of notEnrolled) {
      report.wouldFix.push(`create enrollment PR for ${r}`);
    }
  }

  return report;
}
