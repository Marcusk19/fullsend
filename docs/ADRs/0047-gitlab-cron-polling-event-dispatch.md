---
title: "47. GitLab cron-polling event dispatch"
status: Accepted
relates_to:
  - agent-infrastructure
  - agent-architecture
  - security-threat-model
topics:
  - gitlab
  - forge
  - ci-cd
  - per-repo
  - polling
  - cron
---

# 47. GitLab cron-polling event dispatch

Date: 2026-06-13

## Status

Accepted

## Context

Fullsend needs a mechanism to detect and react to GitLab events — new issues, merge requests, comments, and label changes — so that agent stages (triage, code, review, fix, retro) can be dispatched automatically. On GitHub, native event triggers (`pull_request_target`, `issues`, `issue_comment`) handle this natively within GitHub Actions. GitLab has no equivalent mechanism for most event types.

GitLab's CI/CD model supports the following pipeline trigger sources: `push`, `merge_request_event`, `schedule`, `trigger`, `web`, `api`, and `parent_pipeline`. Of these, only `merge_request_event` maps directly to an agent-relevant event type. Issue creation, comment posting, and label changes have no native CI pipeline trigger — GitLab's `CI_PIPELINE_SOURCE` has no `issues` or `note` value.

Two architectural approaches were evaluated to fill this gap:

1. **Webhook bridge** — a GCP Cloud Function that receives GitLab webhook POST requests and translates them into Pipeline Trigger API calls. This requires deploying and maintaining external infrastructure, exposing a public HTTPS endpoint, and managing per-project webhook secrets and trigger tokens.

2. **Cron-based polling** — scheduled GitLab CI/CD pipelines that wake up periodically, query the GitLab API for new events since the last poll, and dispatch agent stages via parent-child pipelines. This requires no external infrastructure and runs entirely within GitLab's native CI/CD system.

GitLab supports per-repo installation mode only for fullsend (no per-org mode). The pipeline runs inside the enrolled project on the protected default branch. A bot project access token — retrieved at runtime via GitLab OIDC/GCP WIF from Secret Manager — serves as the single credential for all agent operations (REST, GraphQL, MR creation). See [ADR 0028](0028-gitlab-support.md) for the original GitLab support architecture discussion.

### Why cron polling over webhooks

1. **No external infrastructure for event detection.** A webhook bridge is a GCP Cloud Function that must be deployed, monitored, scaled, and secured. Cron polling runs natively in GitLab CI/CD — the same infrastructure already running the agent pipelines.

2. **No inbound attack surface.** A webhook bridge exposes a public HTTPS endpoint that accepts POST requests from the internet. Cron polling is entirely outbound — scheduled pipelines query the GitLab API. There is no listener, no endpoint to discover, no parser for untrusted external input at the event-detection layer.

3. **Stronger event authenticity.** Webhook authentication relies on `X-Gitlab-Token`, a symmetric shared secret stored in Secret Manager. If leaked, an attacker can forge arbitrary events. Cron polling reads directly from the GitLab API — events are as authentic as GitLab's own database.

4. **No event loss.** Webhooks can fail silently (network issues, bridge downtime, GitLab's auto-disable after 4 consecutive failures). Polling reads from the source of truth — events are only missed if created and deleted within a single poll interval.

5. **Dramatically simpler for self-hosted GitLab.** A webhook bridge requires bidirectional network connectivity (GitLab → bridge, bridge → GitLab API). For self-hosted instances behind corporate firewalls, this means VPN peering, firewall rules, or on-premise container deployment. Cron polling requires only outbound HTTPS from GitLab runners to the GitLab API (already available by definition) and to GCP for credential retrieval (already required for inference).

6. **Cleaner emergency shutdown.** Disabling a pipeline schedule or revoking the bot PAT in Secret Manager stops all agent activity. With webhooks, the bridge itself must be disabled, but queued or in-flight webhook deliveries may still arrive.

7. **Fewer credentials to manage.** A webhook bridge requires three credential types per project (bot PAT, webhook secret, trigger token). Cron polling requires only the bot PAT — the same credential already needed for agent operations.

### What we give up

1. **Latency.** Webhooks deliver events in sub-second. Cron polling adds up to one poll interval of latency (5 minutes on Premium/Ultimate, 60 minutes on Free tier). For triage, code generation, and retro — all inherently asynchronous — this is acceptable. For slash commands, it requires mitigation (see Section 3).

2. **CI compute minutes.** Polling pipelines consume CI minutes even when no events are found. On GitLab.com shared runners, this is a real cost. On self-hosted runners, compute minutes are not billed (see Section 5).

3. **The `changes` object.** Webhook payloads include a `changes` field showing what specifically changed (with `previous`/`current` values). Polling sees only current state — detecting what changed requires maintaining and diffing state. For fullsend's use cases (detecting new issues, new MRs, new comments, label changes), current state plus a timestamp watermark is sufficient.

## Options

### Alternative 1: Webhook bridge Cloud Function

Deploy a GCP Cloud Function that receives GitLab webhook POST requests, validates the `X-Gitlab-Token` header, and calls the GitLab Pipeline Trigger API with `ref=main` hardcoded to ensure agent pipelines always run trusted code from the protected default branch.

**Rejected**: Requires external infrastructure (Cloud Function) that must be deployed, monitored, and secured. Exposes a public HTTP endpoint — an inbound attack surface that does not exist in the polling model. Requires three credential types per project (bot PAT, webhook secret, trigger token) vs one for polling. Creates a complex deployment story for self-hosted GitLab instances behind corporate firewalls (VPN peering, on-premise container deployment, or Cloud Run + VPC Connector). The bridge cannot be eliminated even in a hybrid model — if any event type uses webhooks, the full bridge must be deployed and maintained.

### Alternative 2: Webhook-only (all events via bridge)

Use a webhook bridge for all events, eliminating native CI triggers entirely.

**Rejected**: Still requires the bridge Cloud Function with all its operational complexity. The question "if we have to use webhooks for some events, why not use webhooks for everything?" correctly identifies that a hybrid webhook+native model is two systems to operate. But the answer is to eliminate the webhook bridge entirely, not to go all-in on it.

### Alternative 3: Native MR events + webhook bridge for issues/comments

Use GitLab's native `merge_request_event` pipeline source for MR events. Keep a webhook bridge only for issue and comment events (which have no native CI trigger).

**Rejected**: Still requires the bridge Cloud Function, just for fewer event types. The bridge's operational cost is dominated by deployment, monitoring, and credential management — not by the number of event types it handles. Reducing scope does not meaningfully reduce complexity.

### Alternative 4: Cron polling for everything (no native CI triggers)

Pure cron polling — scheduled pipelines detect all events including MR creation and updates.

**Rejected**: MR events have a viable native CI path (`merge_request_event` pipeline source + `include: local: ref: main`) that provides sub-minute latency with zero additional infrastructure. Polling for MR events adds unnecessary latency to the highest-frequency, most latency-sensitive operation (code review). The native path also ensures review pipelines trigger immediately when an MR is opened, which users expect from CI/CD-integrated tools.

## Decision

### Overview

GitLab event dispatch uses a two-path model:

1. **Native CI triggers for MR events.** MR creation, update, and reopen trigger review pipelines via GitLab's `merge_request_event` pipeline source. The dispatch template is loaded via `include: local:` from the enrolled project's protected default branch, ensuring untrusted MR branches cannot modify dispatch logic. MR merge events trigger retro pipelines via the same mechanism.

2. **Cron-polled events for everything else.** A scheduled pipeline runs every N minutes (5 minutes on Premium/Ultimate, 60 minutes on Free tier), queries the GitLab API for new issues, comments, and label changes since the last poll, and dispatches the appropriate agent stages.

No external infrastructure is required for event dispatch. No webhook bridge, no webhook secrets, no trigger tokens.

```
GitLab cron-polling architecture:

ENROLLED PROJECT                           GCP
────────────────                           ───
.gitlab-ci.yml (root pipeline)             WIF pool/provider (validates GitLab OIDC)
.gitlab/ci/dispatch.yml (MR routing)       Service Account (impersonated by jobs)
.gitlab/ci/poll.yml (cron poller)          Secret Manager:
.gitlab/ci/triage.yml                        - bot PAT per enrolled project
.gitlab/ci/code.yml
.gitlab/ci/review.yml
.gitlab/ci/fix.yml
.gitlab/ci/retro.yml
.fullsend/ (config workspace)

Event flow (MR events — native CI):
  MR opened/updated → merge_request_event pipeline → dispatch.yml → review/fix stage

Event flow (issues, comments, labels — cron):
  Pipeline schedule (every 5 min) → poll.yml → query GitLab API → dispatch agent stage

Credential flow:
  Pipeline job → OIDC token → GCP STS → WIF → impersonate SA → Secret Manager → bot PAT
```

### 1. Credential model

**Primary credential — bot project access token via OIDC/WIF**: A Developer-role project access token with `api` scope, created during `fullsend admin install` and stored in GCP Secret Manager. Retrieved at runtime via GitLab OIDC → GCP WIF — no credentials are stored as CI/CD variables in the enrolled project.

**OIDC token exchange flow**:
1. Each stage pipeline declares `id_tokens: { FULLSEND_ID_TOKEN: { aud: "fullsend" } }`
2. GitLab issues a signed JWT with claims: `project_id`, `project_path`, `namespace_id`, `ref_protected`, `pipeline_source`
3. The job exchanges the OIDC token at GCP STS (`sts.googleapis.com`)
4. GCP WIF validates the JWT signature against GitLab's JWKS public keys
5. GCP WIF validates attribute conditions: enrolled project ID and `ref_protected == "true"`
6. The job impersonates the fullsend GCP Service Account
7. The job reads the bot project access token from Secret Manager
8. The agent uses the bot PAT for all REST and GraphQL API operations

**Why `api` scope**: No narrower project access token scope covers MR creation. GitLab's fine-grained CI/CD job token permissions support only `READ_MERGE_REQUESTS`, not write. When GitLab makes fine-grained project access tokens available, the bot PAT should be migrated to the narrowest possible scope.

**Bot identity**: The project access token creates a dedicated bot user in GitLab. Agent comments, label changes, and MR operations are attributable to this bot — providing the same recognizable identity that GitHub Apps give fullsend via `fullsend-ai-review[bot]`.

**GraphQL support**: Unlike `CI_JOB_TOKEN` (which [cannot authenticate GraphQL requests](https://docs.gitlab.com/ci/jobs/ci_job_token/)), the bot PAT authenticates both REST and GraphQL APIs. This is required for GitLab's Work Items API (issues, epics, custom fields, health status) which is GraphQL-only.

**Compensating controls for broad scope**:
- Set project access token expiry to 90 days (shorter than the 1-year maximum) to limit the window of exposure
- Bot PAT stored in Secret Manager with IAM access controls — only the fullsend Service Account can read it
- WIF attribute conditions restrict retrieval to pipelines from enrolled projects on protected branches
- Token is never stored as a CI/CD variable — `CI_DEBUG_TRACE` cannot expose it

**What is NOT needed**:
- Token mint (no custom credential exchange service — standard GCP WIF handles it)
- `CI_JOB_TOKEN` for API operations (insufficient for GraphQL and MR creation)
- Per-project CI/CD variables for credentials (the project is secretless from GitLab's perspective)
- Per-role tokens (all stages share the same bot PAT; per-role isolation is a future possibility via WIF attribute conditions)
- Webhook secrets or trigger tokens (no webhook bridge)

### 2. Cron poller pipeline (`poll.yml`)

The polling pipeline runs on a GitLab pipeline schedule configured during `fullsend admin install`. It executes on the protected default branch with the same OIDC/WIF credential flow as all other fullsend stages.

**Poll cycle:**

1. Retrieve the bot PAT via OIDC/WIF.
2. Read the last-poll timestamp from a protected CI/CD variable (`FULLSEND_LAST_POLL_AT`).
3. Query the GitLab API for changes since the last poll:
   - `GET /api/v4/projects/:id/issues?updated_after=<T>&state=all&per_page=100`
   - `GET /api/v4/projects/:id/merge_requests?updated_after=<T>&state=all&per_page=100`
   - `GET /api/v4/projects/:id/events?after=<date>&target_type=note&per_page=100`
4. For each changed issue/MR, fetch notes if the `user_notes_count` increased or `updated_at` changed.
5. Apply event routing rules (see Section 3) to determine which agent stages to dispatch.
6. For each dispatched stage, trigger a child pipeline via GitLab parent-child pipelines.
7. Update `FULLSEND_LAST_POLL_AT` to `max(updated_at)` of all processed items, minus a 30-second overlap window for clock skew.
8. Deduplication: track processed event IDs (issue IID + action, MR IID + action, note ID) in a job artifact or CI variable to prevent reprocessing across overlapping windows.

**Timestamp watermark with overlap:** The 30-second overlap on `updated_after` means some events may be seen in consecutive polls. The poller deduplicates by event identity (issue IID + label set, note ID, MR IID + state). This handles clock skew, in-flight database writes, and the imprecision of the Events API's date-only `after` parameter.

**API cost per poll cycle:** For a moderately active project (10–50 issues/day, 5–20 MRs):

| Request | Count | Notes |
|---|---|---|
| Issues list (`updated_after`) | 1 | Single page, <100 results |
| MRs list (`updated_after`) | 1 | Single page, <100 results |
| Events (`target_type=note`) | 1 | For comment discovery |
| Notes per changed issue | 2–5 | Only for items with new notes |
| Notes per changed MR | 1–3 | Only for items with new notes |
| **Total per poll** | **6–11** | |

At 288 polls/day (5-minute interval), this is ~1,700–3,200 API calls/day — well within GitLab's 2,000 requests/minute rate limit (same across all tiers).

**State storage:** `FULLSEND_LAST_POLL_AT` is stored as a protected CI/CD variable, updated via the GitLab API (`PUT /api/v4/projects/:id/variables/FULLSEND_LAST_POLL_AT`) at the end of each poll cycle. Protected variables are only accessible to pipelines on protected branches — tampering requires Maintainer access, the same privilege level as modifying the pipeline itself.

### 3. Event routing

| Detected Change | Signal | Stage |
|---|---|---|
| Issue label added | Label `fullsend:ready-to-code` present, not previously seen | code |
| Issue label added | Label `fullsend:ready-for-review` present, not previously seen | review |
| New issue note | Body starts with `/fs-triage` | triage |
| New issue note | Body starts with `/fs-code` | code |
| New issue note | Body starts with `/fs-review` | review |
| New issue note | Body starts with `/fs-fix` | fix |
| New issue note | Body starts with `/fs-retro` | retro |
| New issue note | Body starts with `/fs-prioritize` | prioritize |
| New issue note | Non-command, issue has `needs-info` label | triage |
| MR opened/updated/reopened | (native CI path, not polled) | review |
| MR merged | (native CI path, not polled) | retro |
| MR note with changes-requested marker | Same-project MR only | fix |

**Label detection via state diffing:** The poller maintains a set of previously-seen labels per issue (stored in the dedup state). When a label appears that was not present in the previous poll, it is treated as a "label added" event. Webhook payloads include a `changes` object with previous/current label values, but since this architecture does not use webhooks, label change detection is implemented client-side via state comparison.

### 4. Slash command latency mitigation

Slash commands (`/fs-*` in comments) are the only latency-sensitive operation in the polling model. Triage, code generation, and review are inherently asynchronous — users do not wait for them. But a user who types `/fs-review` in a comment expects a response within seconds, not minutes.

**Primary mitigation — label-based triggers:** For the most common operations, labels provide an alternative trigger mechanism with no latency penalty on the native MR CI path:

- Applying `fullsend:review` label → detected by poller or (on MR) by native CI
- Applying `fullsend:triage` label → detected by poller
- Applying `fullsend:code` label → detected by poller

Labels are discoverable (sidebar dropdown), visible in list views, and create no comment noise. They work well for simple "do this thing" triggers.

**Secondary mitigation — multi-frequency polling (Premium/Ultimate):** Configure two pipeline schedules:

- **Fast poll (every 5 minutes):** Checks only for new notes containing `/fs-*` commands. Minimal API cost (one Events API call filtered by `target_type=note`). This keeps slash command latency at most 5 minutes.
- **Slow poll (every 15 minutes):** Full event scan — issues, MRs, label changes, non-command notes. Handles all other event types.

On Free tier (60-minute minimum schedule interval), the fast poll is not available. Labels and the manual pipeline trigger (see below) are the primary interaction mechanisms.

**Tertiary mitigation — manual pipeline trigger:** Users can trigger agent stages directly via the GitLab UI (Build → Pipelines → New pipeline) with pre-defined variables:

```
STAGE=review
TARGET_MR=42
```

This is an escape hatch for power users, not the primary interface. The `fullsend admin install` command documents this in the project README.

**GitLab Quick Action concern:** GitLab's built-in Quick Actions silently strip unrecognized `/`-prefixed lines from comments. If `/fs-triage` is stripped before the comment is saved, the poller will never see it. This must be tested empirically. If confirmed, the command syntax for GitLab should use an alternative prefix — `@fullsend triage` (mention-based) or `fs:triage` (colon-based) — that avoids the Quick Action parser. [ADR 0042](0042-fs-prefix-for-slash-commands.md) permits forge-specific command syntax as long as the semantic mapping is consistent.

### 5. Native MR event dispatch

MR events use GitLab's native `merge_request_event` pipeline source. The dispatch template is loaded from the protected default branch, ensuring MR authors cannot tamper with routing, credential retrieval, or fork protection.

**Root pipeline** (`.gitlab-ci.yml`):
```yaml
include:
  - local: '.gitlab/ci/dispatch.yml'
    rules:
      - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  - local: '.gitlab/ci/poll.yml'
    rules:
      - if: $CI_PIPELINE_SOURCE == "schedule"

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_PIPELINE_SOURCE == "schedule" && $CI_COMMIT_REF_PROTECTED == "true"
    - if: $CI_PIPELINE_SOURCE == "parent_pipeline"
```

**Dispatch pipeline** (`.gitlab/ci/dispatch.yml`):
```yaml
dispatch:
  stage: .pre
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - |
      if [[ "${CI_DEBUG_TRACE:-}" == "true" ]]; then
        echo "ERROR: CI_DEBUG_TRACE enabled — aborting to protect secrets"
        exit 1
      fi

      ACTION="${CI_MERGE_REQUEST_EVENT_TYPE}"
      case "${ACTION}" in
        open|update|reopen)
          echo "STAGE=review" >> dispatch.env
          echo "RESOURCE_KEY=mr-${CI_MERGE_REQUEST_IID}" >> dispatch.env
          ;;
        merge)
          echo "STAGE=retro" >> dispatch.env
          echo "RESOURCE_KEY=mr-${CI_MERGE_REQUEST_IID}" >> dispatch.env
          ;;
        *)
          echo "Unhandled MR event type: ${ACTION}"
          exit 0
          ;;
      esac
  artifacts:
    reports:
      dotenv: dispatch.env
```

**Fork MR protection:** The fix and code stages are skipped when `CI_MERGE_REQUEST_SOURCE_PROJECT_PATH != CI_MERGE_REQUEST_TARGET_PROJECT_PATH`. This prevents fork MRs from triggering stages that push commits to the target project.

### 6. GitLab tier considerations

The cron-polling architecture works across all GitLab tiers but with meaningful differences:

| Feature | Free | Premium | Ultimate |
|---|---|---|---|
| Pipeline schedule minimum interval | 60 minutes | 5 minutes | 5 minutes |
| Schedules per project | 10 | 50 | 50 |
| CI compute minutes (shared runners) | 400/month | 10,000/month | 50,000/month |
| Project access tokens (gitlab.com SaaS) | **Not available** | Available | Available |
| OIDC `id_tokens` | Available | Available | Available |
| Protected variables | Available | Available | Available |
| Resource groups | Available | Available | Available |
| Parent-child pipelines | Available | Available | Available |
| Code Owner approval enforcement | Not available | Available | Available |
| Multi-project pipelines | Not available | Available | Available |
| API rate limits | 2,000/min | 2,000/min | 2,000/min |

**Self-hosted runners do not consume CI compute minutes.** On self-hosted GitLab or with project/group runners on gitlab.com, the compute minute quotas are irrelevant. This is the expected deployment model for most enterprise GitLab installations.

#### Free tier experience

- **60-minute poll interval.** Agent responses to issue events take up to 1 hour. This is acceptable for triage and code generation but poor for interactive workflows.
- **No project access tokens on gitlab.com SaaS.** Must use a personal access token, which ties the bot identity to a human user account. On self-managed GitLab, project access tokens are available on all tiers.
- **No Code Owner approval enforcement.** The safety guardrail that prevents agents from modifying their own configuration relies on CODEOWNERS, which requires Premium.
- **400 CI minutes/month on shared runners.** A single polling pipeline at 60-minute intervals with 1-minute job duration consumes ~720 minutes/month — already exceeding the quota. **Free tier requires self-hosted runners.**
- **Labels and manual triggers are the primary interaction model.** Slash commands in comments have up to 60-minute latency, making labels the practical trigger mechanism.

#### Premium tier experience (recommended minimum)

- **5-minute poll interval.** Agent responses within 5 minutes of event occurrence.
- **Project access tokens.** Proper bot identity without tying credentials to a human account.
- **Code Owner approval.** Full safety guardrails for autonomous agents.
- **10,000 CI minutes/month.** Sufficient for a single project polling every 5 minutes (~8,640 minutes/month at 1-minute job duration). Multiple polled projects on shared runners require additional minutes ($10/1,000).
- **Slash commands viable.** 5-minute latency is tolerable for most `/fs-*` operations.

#### Tiered offering design

`fullsend admin install` should adapt its configuration based on the detected tier:

- **Free tier:** Single pipeline schedule at 60-minute interval. README documents label-based triggers as primary. Warns about CI minute constraints and recommends self-hosted runners.
- **Premium/Ultimate:** Two pipeline schedules — fast poll (5 minutes, slash command detection only) and slow poll (15 minutes, full event scan). README documents both slash commands and labels.

### 7. Repo layout

```
enrolled-project/
├── .gitlab-ci.yml                    ← root pipeline (schedule + MR event rules)
├── .gitlab/ci/
│   ├── dispatch.yml                 ← MR event routing (native CI path)
│   ├── poll.yml                     ← cron poller (scheduled pipeline)
│   ├── triage.yml                   ← fullsend-stage: triage
│   ├── code.yml                     ← fullsend-stage: code
│   ├── review.yml                   ← fullsend-stage: review
│   ├── fix.yml                      ← fullsend-stage: fix
│   ├── retro.yml                    ← fullsend-stage: retro
│   └── prioritize.yml               ← fullsend-stage: prioritize
├── .fullsend/                        ← config workspace (optional)
│   ├── config.yaml                  ← project-level config
│   └── customized/                  ← user overrides
└── AGENTS.md
```

### 8. Config layering

Same `customized/` convention as GitHub per-repo ([ADR 0033](0033-per-repo-installation-mode.md), [ADR 0035](0035-layered-content-resolution.md)):

```
fullsend-ai/fullsend defaults  <  .fullsend/customized/  <  AGENTS.md
(base, fetched at runtime)       (project overrides)       (instructions)
```

Config is always read from the protected default branch, not from MR source branches. The pipeline runs on `ref=main`, so the checkout reflects the default branch. This prevents MR authors from injecting modified agent instructions or policies.

### 9. CLI support

```
fullsend admin install group/project --forge gitlab
```

The argument must be `group/project` format. Passing just a group name with `--forge gitlab` is an error: "GitLab installation supports per-repo mode only."

**Flags**:
- `--forge {github|gitlab}` — auto-detected from remote URL, overridable
- `--gitlab-url` — GitLab instance URL (default: `https://gitlab.com`)
- `--inference-project` — GCP project for Vertex AI inference (required)
- `--inference-region` — GCP region for inference (default: `global`)
- `--poll-interval` — cron schedule for polling (default: auto-detect from tier)
- `--skip-schedule-create` — skip pipeline schedule creation (for externally managed schedules)
- `--dry-run` — preview changes without making them

**Install flow**:
1. Parse `group/project`, resolve GitLab token (`GL_TOKEN` / `GITLAB_TOKEN` / `glab auth token`)
2. Create GitLab forge client, validate project exists and user has Maintainer access
3. Validate default branch is protected (`IsProtectedBranch`)
4. Validate `CI_DEBUG_TRACE` is not enabled project-wide
5. Set up WIF pool/provider for GitLab OIDC (if not already configured)
6. Create Project Access Token (Developer role, `api` scope) → store in Secret Manager
7. Configure WIF attribute condition: `assertion.project_id == "<id>" && assertion.ref_protected == "true"`
8. Create pipeline schedule(s) — tier-adaptive (see Section 6)
9. Commit CI/CD template files to the project via GitLab API
10. Set protected CI/CD variables: `FULLSEND_WIF_PROVIDER`, `FULLSEND_SA`, `FULLSEND_BOT_TOKEN_SECRET`, `FULLSEND_GCP_PROJECT_ID`, `FULLSEND_FORGE=gitlab`, `FULLSEND_PER_REPO_INSTALL=true`
11. Initialize poll watermark: `FULLSEND_LAST_POLL_AT` (protected, current timestamp)
12. Set up inference WIF if `--inference-project` provided

**Uninstall flow** (`fullsend admin uninstall group/project --forge gitlab`):
1. Delete pipeline schedule(s)
2. Revoke bot project access token, delete Secret Manager secret
3. Remove WIF attribute condition for this project
4. Remove CI/CD template files from project
5. Remove protected CI/CD variables

### 10. Forge abstraction compliance

[ADR 0005](0005-forge-abstraction-layer.md) promises: "Adding a new forge requires implementing `forge.Client` — no changes to layers, CLI, or app setup code."

This ADR adds the following forge-neutral methods to `forge.Client`:
- `IsProtectedBranch(ctx, owner, repo, branch string) (bool, error)`
- `CreatePipelineSchedule(ctx, owner, repo, ref, description, cron string, variables map[string]string) (scheduleID string, err error)`
- `DeletePipelineSchedule(ctx, owner, repo, scheduleID string) error`
- `UpdateVariable(ctx, owner, repo, key, value string) error`

GitHub-only methods (`ListOrgInstallations`, `GetAppClientID`) move to a `GitHubExtensions` extension interface. Callers type-assert to access them.

A new `ErrNotSupported` sentinel allows forge implementations to reject inapplicable operations (e.g., GitLab returns `ErrNotSupported` for `DispatchWorkflow`; GitHub returns it for `CreatePipelineSchedule`).

## Security Model

### Layer 1: Pipeline runs on protected default branch only

The pipeline schedule is configured to run on the protected default branch at install time. The `workflow:rules` enforce this:

```yaml
- if: $CI_PIPELINE_SOURCE == "schedule" && $CI_COMMIT_REF_PROTECTED == "true"
```

A scheduled pipeline cannot be redirected to a non-protected branch without Maintainer access to modify the schedule. If modified, the `CI_COMMIT_REF_PROTECTED` check and WIF attribute conditions (Layer 4) provide defense-in-depth.

**Threat**: An insider with Maintainer access modifies the pipeline schedule to target a malicious branch. **Mitigation**: WIF attribute conditions reject OIDC token exchange for pipelines on non-protected branches (`assertion.ref_protected == "true"`). The bot PAT cannot be retrieved.

### Layer 2: Protected CI/CD variables

All CI/CD variables that gate credential retrieval MUST be marked as "protected." GitLab restricts protected variables to pipelines running on protected branches only. No credentials are stored directly as CI/CD variables — the bot PAT lives in Secret Manager — but the WIF configuration variables enable credential retrieval, so protecting them is defense-in-depth.

**Required protected variables**:
- `FULLSEND_WIF_PROVIDER` — WIF provider resource name
- `FULLSEND_SA` — GCP Service Account email
- `FULLSEND_BOT_TOKEN_SECRET` — Secret Manager secret name for the bot PAT
- `FULLSEND_GCP_PROJECT_ID` — GCP project for Secret Manager and inference
- `FULLSEND_LAST_POLL_AT` — poll watermark timestamp

### Layer 3: No inbound endpoint, no webhook secrets

Cron polling is entirely outbound — there is no public endpoint to authenticate, no webhook secrets to manage, and no trigger tokens. The credential surface is a single bot PAT stored in Secret Manager, retrieved via OIDC/WIF. This eliminates the attack vectors associated with shared-secret authentication: leakage, brute-forcing, timing side-channels, and replay of intercepted webhook payloads.

### Layer 4: OIDC/WIF attribute conditions

GCP WIF attribute conditions restrict which GitLab pipelines can exchange OIDC tokens for GCP credentials:
- `assertion.project_id == "<enrolled_project_id>"` — only the specific enrolled project
- `assertion.ref_protected == "true"` — only pipelines running on protected branches

This provides cryptographic enforcement that the bot PAT can only be retrieved by the correct project on a protected branch.

### Layer 5: `CI_DEBUG_TRACE` guard (best-effort)

GitLab's `CI_DEBUG_TRACE` variable, when enabled, prints all CI/CD variables to job logs. Two defenses:
1. **Install-time**: `fullsend admin install` validates that `CI_DEBUG_TRACE` is not enabled.
2. **Runtime**: Every stage pipeline includes an early guard that aborts if `CI_DEBUG_TRACE` is detected.

The bot PAT is not stored as a CI/CD variable, so `CI_DEBUG_TRACE` cannot directly expose it. However, the OIDC token may be logged, and an attacker with the WIF config + OIDC token could replay the exchange within its ~5 minute TTL.

### Layer 6: Event data sanitization

Attacker-controlled content (issue titles, MR descriptions, comment bodies) could contain YAML metacharacters or shell injection payloads. All event data is base64-encoded before passing to child pipelines:

```bash
EVENT_PAYLOAD=$(echo "${event_json}" | base64 -w0)
```

### Layer 7: Fork MR protection

The fix stage is skipped when the MR's `source_project_id != target_project_id`. This prevents fork MRs from triggering fix pipelines that would push commits to the target project.

### Security comparison: polling vs webhooks

| Dimension | Webhook Bridge | Cron Polling (this ADR) |
|---|---|---|
| Inbound attack surface | Public HTTPS endpoint | None |
| Event authenticity | Shared secret (`X-Gitlab-Token`) | Direct API read (authoritative) |
| Replay attacks | UUID dedup with TTL cache | No payload to replay |
| Credential count per project | 3 (bot PAT, webhook secret, trigger token) | 1 (bot PAT) |
| Event loss | Webhook delivery failures, auto-disable after 4 failures | Only if created+deleted within one poll interval |
| Self-hosted network requirements | Bidirectional (GitLab ↔ bridge) | Outbound only (runners → API + GCP) |
| Emergency shutdown | Disable Cloud Function | Disable schedule or revoke PAT |
| Prompt injection risk | Same (attacker-controlled event content) | Same |
| Infrastructure to secure | Cloud Function + IAM + network policies | Pipeline schedule (native CI/CD) |

## Comparison with GitHub

| Concern | GitHub ([ADR 0033](0033-per-repo-installation-mode.md)) | GitLab (this ADR) |
|---|---|---|
| Installation modes | Per-org and per-repo | Per-repo only |
| Primary credential | GitHub App installation token via mint OIDC | Bot project access token via OIDC/WIF |
| MR/PR event dispatch | `pull_request_target` (native) | `merge_request_event` + `include: ref: main` (native) |
| Issue/comment dispatch | `issues` / `issue_comment` events (native) | Cron polling (scheduled pipeline) |
| Slash commands | Comment events (sub-second) | Cron polling (up to 5 min) or labels |
| External infrastructure | Mint Cloud Function | None for event dispatch; WIF + Secret Manager for credentials |
| Event detection latency | Sub-second (all events) | Sub-second (MR events), 5 min (issues/comments on Premium) |
| CI minute cost for dispatch | None (event-triggered) | ~8,640 min/month per project at 5-min interval |
| Token mint | Required (custom Cloud Function) | Not needed (standard GCP WIF) |
| Credential rotation | App keys never expire | PAT expires (max 1 year), centralized in Secret Manager |

**Where GitLab is simpler**:
- No App creation dance (no browser-based manifest flow)
- No custom mint service (standard GCP WIF replaces the mint Cloud Function)
- No PEM handling (no private key generation, no JWT signing)
- No installation token exchange chain
- Secretless from the project's perspective (no credentials stored as CI/CD variables)
- No external infrastructure for event dispatch (no webhook bridge)

**Where GitLab is harder**:
- No native CI triggers for issue/comment events (requires polling)
- Review semantics (no native review object — must synthesize from notes and approvals)
- Project access token rotation (GitHub App keys don't expire)
- `CI_DEBUG_TRACE` exposure (though reduced risk since credentials are not CI/CD variables)
- Subgroup paths (deeply nested namespaces like `org/sub1/sub2/project`)
- CI minute consumption for polling on shared runners

## Consequences

### Positive

- **No external infrastructure for event dispatch.** No Cloud Function, no webhook bridge, no additional services to deploy, monitor, or maintain.
- **Zero inbound attack surface.** No public HTTP endpoint. No webhook secrets to manage, rotate, or protect against leakage. No trigger tokens.
- **Simpler self-hosted GitLab deployment.** Outbound-only network requirements. No VPN peering, firewall rules, or on-premise container deployment needed for event detection.
- **Stronger event authenticity.** Events read directly from the GitLab API, not from potentially spoofed webhook payloads.
- **No event loss from delivery failures.** Polling reads from the source of truth.
- **Single credential per project.** One secret type (bot PAT) stored in Secret Manager, retrieved via OIDC/WIF.
- **MR events still sub-second.** Native `merge_request_event` pipeline source provides immediate review triggers.
- **Tier-adaptive.** Architecture works on all GitLab tiers; `fullsend admin install` adapts poll frequency and interaction model to the detected tier.
- **No token mint changes.** GitLab support requires zero changes to existing mint infrastructure.
- **Reuses inference infrastructure.** WIF pool/provider and Secret Manager are the same GCP services already provisioned for Vertex AI inference.

### Negative

- **Latency for issue/comment events.** Up to 5 minutes on Premium/Ultimate, 60 minutes on Free tier. Acceptable for asynchronous agent operations, poor for interactive use on Free tier.
- **CI minute consumption.** Polling pipelines run continuously, consuming CI minutes even when idle. On gitlab.com shared runners: ~8,640 minutes/month at 5-minute intervals. Self-hosted runners are not billed.
- **State management complexity.** The poller must track last-seen timestamps, dedup processed events, and handle edge cases (clock skew, deleted events, API pagination).
- **Slash command latency.** Up to 5 minutes vs sub-second with webhooks. Mitigated by labels and multi-frequency polling, but inherently slower than push-based dispatch.
- **Quick Action stripping risk.** GitLab may silently strip `/fs-*` commands from comments. Requires empirical testing and potentially an alternative command syntax for GitLab.
- **Per-repo only.** No centralized config, policies, or credential management across projects. Organizations wanting uniform agent behavior must manage CI/CD Components and group-level variables independently.
- **`api` scope is broad.** The bot project access token has full project API access. A narrower scope is not available in GitLab today.
- **GCP dependency for forge credentials.** Secret Manager + WIF are required for credential retrieval, not just inference.

### Risks

Ordered by the project's threat priority (external injection > insider > drift > supply chain):

1. **External injection — prompt injection via polled events.** Attacker-controlled content (issue titles, MR descriptions, comments) reaches the agent. **Mitigation**: Base64 encoding of event payloads passed to child pipelines (Layer 6). The transport mechanism does not change the content risk.

2. **Insider — poll watermark tampering.** A Maintainer could modify `FULLSEND_LAST_POLL_AT` to skip events (set far future) or replay events (set far past). **Mitigation**: The variable is protected (Layer 2). Tampering requires the same Maintainer access that could modify the pipeline itself. Event deduplication prevents harmful reprocessing.

3. **Insider — schedule modification.** A Maintainer could modify the pipeline schedule to target a non-protected branch or increase/decrease frequency. **Mitigation**: WIF attribute conditions (Layer 4) reject credential retrieval on non-protected branches. Schedule changes are auditable in GitLab's audit log.

4. **Drift — missed events from API quirks.** The Notes API lacks a `created_after` filter; the Events API `after` parameter is date-only (not datetime). Client-side filtering may miss events at date boundaries. **Mitigation**: 30-second overlap window on the watermark and event ID-based deduplication. Slow poll (15-minute) serves as reconciliation for the fast poll (5-minute).

5. **Drift — CI minute exhaustion.** On gitlab.com shared runners, the polling pipeline may exhaust the project's CI minute quota. **Mitigation**: `fullsend admin install` warns about CI minute consumption. Polling jobs use the smallest available runner and exit quickly when no events are found. Self-hosted runners are the recommended deployment model.

6. **Drift — token expiration.** If the bot PAT expires without renewal, all agent stages fail to authenticate. **Mitigation**: Expiration monitoring and `fullsend admin rotate-token` command (updates Secret Manager secret centrally).

## Open Questions

### Quick Action stripping of `/fs-*` commands

GitLab's Quick Action parser may silently strip unrecognized `/`-prefixed lines from comments. If `/fs-triage` is removed from the rendered comment before it reaches the database, the poller will never see it. This needs empirical testing on gitlab.com. If confirmed, alternatives:

- `@fullsend triage` (mention-based — requires a GitLab user for the mention to resolve)
- `fs:triage` (colon-based — no conflict with Quick Actions)
- Backtick-wrapped `` `/fs-triage` `` (may prevent stripping)

### GraphQL vs REST for polling efficiency

The current design uses REST API calls. A GraphQL query could batch issues + MRs in a single request, reducing per-poll API calls from ~3 baseline to ~1. However, GraphQL has a complexity limit of 250 per query, and nested note queries quickly exceed this. The recommendation is to start with REST (simpler, well-documented `updated_after` support) and migrate to GraphQL if rate limits become a concern.

### ETag support for efficient no-op polls

GitLab's ETag caching system could allow the poller to skip full responses when nothing has changed (304 Not Modified). However, ETag support is endpoint-specific and not publicly documented. The poller should send `If-None-Match` headers as a best-effort optimization and handle both 200 and 304 responses.

### Pipeline schedule management on self-managed GitLab

Self-managed GitLab administrators may have different minimum schedule intervals (default: 10 minutes for non-admin users, configurable). `fullsend admin install` should detect the instance's configured minimum and adapt the poll frequency. The `--poll-interval` flag provides an override.

### Jira integration path

Many GitLab users track work in Jira, not GitLab issues. The triage and code agents may primarily need to poll Jira for issue events, not GitLab. The cron-polling architecture is well-suited to this — the poller can be extended to query external systems (Jira API) in addition to GitLab. This is a future consideration that does not affect the current ADR.

### Per-role credential isolation via WIF

The current design uses a single bot PAT for all stages. WIF attribute conditions could be extended to select different Secret Manager secrets per stage — for example, a read-only PAT for triage/review and a write PAT for code/fix. This would require per-stage `id_tokens` with different audiences and corresponding WIF attribute conditions. This is a future optimization that adds complexity but provides per-role isolation.

## Implementation Details

Detailed implementation guidance is maintained in a companion document: [docs/plans/gitlab-cron-polling-implementation.md](../plans/gitlab-cron-polling-implementation.md).

The implementation is organized in six phases:

### Phase 0: Forge interface preparation
Add `IsProtectedBranch`, `CreatePipelineSchedule`, `DeletePipelineSchedule`, `UpdateVariable` to `forge.Client`. Move GitHub-only methods to `GitHubExtensions` extension interface. Add `ErrNotSupported` sentinel. Create `internal/forge/detect.go` for forge auto-detection.

### Phase 1: GitLab forge client
Implement `internal/forge/gitlab/gitlab.go` with full `forge.Client` interface using `gitlab.com/gitlab-org/api/client-go`. Single-token constructor for the bot PAT. Add polling-specific query methods (`ListIssuesUpdatedSince`, `ListProjectEvents`, etc.).

### Phase 2: Cron poller
Implement `internal/poll/` package — event discovery, routing, deduplication, label state tracking, watermark management, and child pipeline YAML generation. Expose via `fullsend poll` CLI subcommand. No external infrastructure — runs inside the fullsend container image.

### Phase 3: GitLab CI/CD templates
Create `internal/scaffold/fullsend-repo-gitlab/` with two dispatch paths: `dispatch.yml` for native MR events and `poll.yml` for scheduled polling. Per-stage pipeline templates with OIDC/WIF credential flow.

### Phase 4: CLI changes
Add `--forge`, `--gitlab-url`, `--poll-interval` flags to `fullsend admin install`. Implement `runGitLabPerRepoInstall()` with project access token creation, pipeline schedule setup, and scaffold file commit. Tier detection for adaptive poll frequency.

### Phase 5: Integration and testing
Wire forge detection into CLI. Unit tests for GitLab client, poller, forge detection. Integration tests with mock GitLab API. E2E tests against GitLab.com test project.

### Dependency order

Phases 1 and 2 depend on Phase 0 (forge interface changes). Phase 3 (CI/CD templates) has no code dependency on Phase 0 and can start immediately. Phase 4 depends on Phase 1. Phase 5 depends on all prior phases.

## References

- [ADR 0005: Forge abstraction layer](0005-forge-abstraction-layer.md) — abstraction boundary preserved
- [ADR 0028: GitLab Support Architecture](0028-gitlab-support.md) — original GitLab support discussion
- [ADR 0033: Per-repo installation mode](0033-per-repo-installation-mode.md) — GitHub per-repo (adapted for GitLab)
- [ADR 0035: Layered content resolution](0035-layered-content-resolution.md) — same `customized/` convention
- [ADR 0042: fs-prefix for slash commands](0042-fs-prefix-for-slash-commands.md) — command syntax conventions
- [GitLab Pipeline Schedules](https://docs.gitlab.com/ci/pipelines/schedules/) — scheduled pipeline configuration and tier limits
- [GitLab OIDC `id_tokens`](https://docs.gitlab.com/ci/secrets/id_token_authentication/) — native OIDC token issuance
- [GCP Workload Identity Federation for GitLab](https://docs.gitlab.com/ci/cloud_services/google_cloud/) — OIDC → GCP credential exchange
- [GitLab CI/CD job tokens](https://docs.gitlab.com/ee/ci/jobs/ci_job_token.html) — `CI_JOB_TOKEN` limitations
- [GitLab Project Access Tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/) — scopes, tier availability
- [GitLab Issues API](https://docs.gitlab.com/api/issues/) — `updated_after` parameter for polling
- [GitLab Merge Requests API](https://docs.gitlab.com/api/merge_requests/) — `updated_after` parameter for polling
- [GitLab Events API](https://docs.gitlab.com/api/events/) — project activity feed for note discovery
- [GitLab CI/CD Compute Minutes](https://docs.gitlab.com/ci/pipelines/compute_minutes/) — quota and billing
- [GitLab Rate Limits](https://docs.gitlab.com/security/rate_limits/) — API rate limits by tier
- [GitLab `include: project:`](https://docs.gitlab.com/ci/yaml/includes/) — trusted template inclusion from protected branches
