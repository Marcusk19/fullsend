/** Mirrors `internal/forge/forge.go` ConfigRepoName. */
export const CONFIG_REPO_NAME = ".fullsend";

export const CONFIG_FILE_PATH = "config.yaml";

export const AGENT_WORKFLOW_PATH = ".github/workflows/agent.yaml";
export const ONBOARD_WORKFLOW_PATH = ".github/workflows/repo-onboard.yaml";
export const CODEOWNERS_PATH = "CODEOWNERS";

/** Managed workflow files in write order (matches `internal/layers/workflows.go`). */
export const WORKFLOWS_MANAGED_FILES = [
  AGENT_WORKFLOW_PATH,
  ONBOARD_WORKFLOW_PATH,
  CODEOWNERS_PATH,
] as const;

export const SHIM_WORKFLOW_PATH = ".github/workflows/fullsend.yaml";

export const DISPATCH_TOKEN_SECRET_NAME = "FULLSEND_DISPATCH_TOKEN";
