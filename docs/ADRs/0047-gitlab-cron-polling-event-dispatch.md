---
title: "47. GitLab cron-polling event dispatch"
status: Accepted
supersedes: "GitLab per-repo support via OIDC/WIF and webhook bridge (PR #2042, webhook bridge sections only)"
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

Supersedes the webhook bridge sections (Sections 2, 4, and Security Layers 1, 3, 6) of the GitLab per-repo support ADR ([PR #2042](https://github.com/fullsend-ai/fullsend/pull/2042)). All other sections of that ADR — credential model (Section 1), pipeline architecture (Section 3), config layering (Section 5), repo layout (Section 6), CLI support (Section 7), forge abstraction (Section 8), and Security Layers 2, 4, 5, 7 — remain in effect.

## Context

ADR 0043 designed GitLab event dispatch around a webhook bridge Cloud Function: GitLab sends webhook POST requests to a GCP Cloud Function, which translates them into Pipeline Trigger API calls with `ref=main` hardcoded. This was the best available analog to GitHub's `pull_request_target` — ensuring agent pipelines always run trusted code from the protected default branch.

Team discussion raised a fundamental question: if we already have to operate the webhook bridge, why not use webhooks for everything? The answer exposed the real issue — the webhook bridge is external infrastructure that must be deployed, monitored, and secured regardless of how many event types it handles. The hybrid model (webhooks for some events, native CI for MR events) is two systems to operate, not one.

Barak Korren proposed a simpler alternative: **replace the webhook bridge entirely with cron-based polling**. Scheduled pipelines wake up every N minutes, query the GitLab API for new events since the last poll, and dispatch agent stages for anything that needs attention. Review and fix agents continue to trigger natively from `.gitlab-ci.yml` on MR events (using `include: project: ref: main` for trusted dispatch), while triage, code, and retro agents run on the polled event loop.

This approach eliminates the webhook bridge entirely — no external Cloud Function, no public HTTP endpoint, no webhook secrets, no trigger tokens. The polling pipeline runs inside GitLab CI/CD on the protected default branch using the same OIDC/WIF credential flow established in ADR 0043.

### Why cron polling over webhooks

1. **No external infrastructure for event detection.** The webhook bridge is a GCP Cloud Function that must be deployed, monitored, scaled, and secured. Cron polling runs natively in GitLab CI/CD — the same infrastructure already running the agent pipelines.

2. **No inbound attack surface.** The webhook bridge exposes a public HTTPS endpoint that accepts POST requests from the internet. Cron polling is entirely outbound — scheduled pipelines query the GitLab API. There is no listener, no endpoint to discover, no parser for untrusted external input at the event-detection layer.

3. **Stronger event authenticity.** Webhook authentication relies on `X-Gitlab-Token`, a symmetric shared secret stored in Secret Manager. If leaked, an attacker can forge arbitrary events. Cron polling reads directly from the GitLab API — events are as authentic as GitLab's own database.

4. **No event loss.** Webhooks can fail silently (network issues, bridge downtime, GitLab's auto-disable after 4 consecutive failures). Polling reads from the source of truth — events are only missed if created and deleted within a single poll interval.

5. **Dramatically simpler for self-hosted GitLab.** The webhook bridge requires bidirectional network connectivity (GitLab → bridge, bridge → GitLab API). For self-hosted instances behind corporate firewalls, this means VPN peering, firewall rules, or on-premise container deployment. Cron polling requires only outbound HTTPS from GitLab runners to the GitLab API (already available by definition) and to GCP for credential retrieval (already required for inference).

6. **Cleaner emergency shutdown.** Disabling a pipeline schedule or revoking the bot PAT in Secret Manager stops all agent activity. With webhooks, the bridge itself must be disabled, but queued or in-flight webhook deliveries may still arrive.

7. **Fewer credentials to manage.** The webhook bridge requires three credential types per project (bot PAT, webhook secret, trigger token). Cron polling requires only the bot PAT — the same credential already needed for agent operations.

### What we give up

1. **Latency.** Webhooks deliver events in sub-second. Cron polling adds up to one poll interval of latency (5 minutes on Premium/Ultimate, 60 minutes on Free tier). For triage, code generation, and retro — all inherently asynchronous — this is acceptable. For slash commands, it requires mitigation (see Section 3).

2. **CI compute minutes.** Polling pipelines consume CI minutes even when no events are found. On GitLab.com shared runners, this is a real cost. On self-hosted runners, compute minutes are not billed (see Section 5).

3. **The `changes` object.** Webhook payloads include a `changes` field showing what specifically changed (with `previous`/`current` values). Polling sees only current state — detecting what changed requires maintaining and diffing state. For fullsend's use cases (detecting new issues, new MRs, new comments, label changes), current state plus a timestamp watermark is sufficient.

## Options

### Alternative 1: Webhook bridge (ADR 0043 current design)

The existing design — a GCP Cloud Function translates webhook events to Pipeline Trigger API calls.

**Rejected for this ADR**: Requires external infrastructure (Cloud Function), exposes a public HTTP endpoint, requires three credential types per project, and creates a complex deployment story for self-hosted GitLab. The bridge cannot be eliminated even in a hybrid model — if any event requires webhooks, the full bridge must be deployed and maintained.

### Alternative 2: Webhook-only (all events via bridge)

Use the webhook bridge for all events, eliminating native CI triggers entirely.

**Rejected**: Still requires the bridge Cloud Function with all its operational complexity. Greg Allen's question ("if we have to use webhooks, why not use webhooks for everything?") correctly identified that the hybrid model is two systems to operate. But the answer is to eliminate the webhook bridge, not to go all-in on it.

### Alternative 3: Native MR events + webhook bridge for issues/comments

Use GitLab's native `merge_request_event` pipeline source with `include: project: ref: main` for MR events. Keep the webhook bridge only for issue and comment events.

**Rejected**: Still requires the bridge Cloud Function, just for fewer event types. The bridge's operational cost is dominated by deployment, monitoring, and credential management — not by the number of event types it handles. Reducing scope does not meaningfully reduce complexity.

### Alternative 4: Cron polling for everything (no native CI triggers)

Pure cron polling — scheduled pipelines detect all events including MR creation and updates.

**Rejected**: MR events have a viable native CI path (`merge_request_event` pipeline source + `include: project: ref: main`) that provides sub-minute latency with zero additional infrastructure. Polling for MR events adds unnecessary latency to the highest-frequency, most latency-sensitive operation (code review). The native path also ensures review pipelines trigger immediately when an MR is opened, which users expect from CI/CD-integrated tools.

## Decision

### Overview

Replace the webhook bridge from ADR 0043 with a two-path event dispatch model:

1. **Native CI triggers for MR events.** MR creation, update, and reopen trigger review pipelines via GitLab's `merge_request_event` pipeline source. The dispatch template is loaded via `include: project: ref: main` from a templates project (or `include: local:` from the enrolled project's protected default branch), ensuring untrusted MR branches cannot modify dispatch logic. MR merge events trigger retro pipelines via the same mechanism.

2. **Cron-polled events for everything else.** A scheduled pipeline runs every N minutes (5 minutes on Premium/Ultimate, 60 minutes on Free tier), queries the GitLab API for new issues, comments, and label changes since the last poll, and dispatches the appropriate agent stages.

The webhook bridge Cloud Function, webhook secrets, and trigger tokens are eliminated entirely.

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

Credential flow (unchanged from ADR 0043):
  Pipeline job → OIDC token → GCP STS → WIF → impersonate SA → Secret Manager → bot PAT
```

### 1. Cron poller pipeline (`poll.yml`)

The polling pipeline runs on a GitLab pipeline schedule configured during `fullsend admin install`. It executes on the protected default branch with the same OIDC/WIF credential flow as all other fullsend stages.

**Poll cycle:**

1. Retrieve the bot PAT via OIDC/WIF (same credential flow as ADR 0043 Section 1).
2. Read the last-poll timestamp from a protected CI/CD variable (`FULLSEND_LAST_POLL_AT`).
3. Query the GitLab API for changes since the last poll:
   - `GET /api/v4/projects/:id/issues?updated_after=<T>&state=all&per_page=100`
   - `GET /api/v4/projects/:id/merge_requests?updated_after=<T>&state=all&per_page=100`
   - `GET /api/v4/projects/:id/events?after=<date>&target_type=note&per_page=100`
4. For each changed issue/MR, fetch notes if the `user_notes_count` increased or `updated_at` changed.
5. Apply event routing rules (see Section 2) to determine which agent stages to dispatch.
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

### 2. Event routing

The poller applies the same routing logic as ADR 0043 Section 4, adapted for API-discovered events rather than webhook payloads:

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

**Label detection via state diffing:** The poller maintains a set of previously-seen labels per issue (stored in the dedup state). When a label appears that was not present in the previous poll, it is treated as a "label added" event. This is equivalent to the webhook bridge's detection of label changes via the `changes` object, but implemented client-side.

### 3. Slash command latency mitigation

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

**GitLab Quick Action concern:** GitLab's built-in Quick Actions silently strip unrecognized `/`-prefixed lines from comments. If `/fs-triage` is stripped before the comment is saved, the poller will never see it. This must be tested empirically. If confirmed, the command syntax for GitLab should use an alternative prefix — `@fullsend triage` (mention-based) or `fs:triage` (colon-based) — that avoids the Quick Action parser. ADR 0042 (fs-prefix) permits forge-specific command syntax as long as the semantic mapping is consistent.

### 4. Native MR event dispatch

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

**Fork MR protection:** The fix and code stages are skipped when `CI_MERGE_REQUEST_SOURCE_PROJECT_PATH != CI_MERGE_REQUEST_TARGET_PROJECT_PATH`. This prevents fork MRs from triggering stages that push commits to the target project. Carried forward from ADR 0043 Layer 7.

### 5. GitLab tier considerations

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

### 6. Repo layout (updated from ADR 0043)

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

Changes from ADR 0043: `poll.yml` replaces the webhook bridge's role. `dispatch.yml` handles only native MR events, not webhook-bridged events.

### 7. CLI changes (delta from ADR 0043)

The `fullsend admin install` flow changes:

**Removed steps** (no longer needed):
- Deploy bridge Cloud Function
- Create pipeline trigger token
- Register project with bridge (webhook secret + trigger token)
- Create project webhook

**Added steps:**
- Create pipeline schedule(s) via GitLab API (`POST /api/v4/projects/:id/pipeline_schedules`)
  - Fast poll schedule (5-minute interval, Premium/Ultimate only)
  - Slow poll schedule (15-minute interval Premium/Ultimate, 60-minute Free)
- Set `FULLSEND_LAST_POLL_AT` CI/CD variable (protected, initial value: current timestamp)

**Unchanged steps:**
- Create Project Access Token → store in Secret Manager
- Configure WIF attribute condition
- Commit CI/CD template files
- Set protected CI/CD variables (WIF config)
- Set up inference WIF

**Updated flags:**
- Remove: `--bridge-project`, `--bridge-region`, `--skip-bridge-deploy`, `--bridge-url`
- Add: `--poll-interval` (default: auto-detect from tier; override for self-managed)
- Add: `--skip-schedule-create` (for environments where schedules are managed externally)

**Uninstall flow changes:**
- Remove: Delete project webhook, delete trigger token, remove bridge registration
- Add: Delete pipeline schedule(s)

### 8. Forge abstraction changes (delta from ADR 0043)

ADR 0043 proposed adding `CreateWebhook`, `DeleteWebhook`, and `TriggerPipeline` to `forge.Client`. With cron polling:

**Still needed:**
- `IsProtectedBranch(ctx, owner, repo, branch string) (bool, error)` — install-time validation

**New methods:**
- `CreatePipelineSchedule(ctx, owner, repo, ref, description, cron string, variables map[string]string) (scheduleID string, err error)`
- `DeletePipelineSchedule(ctx, owner, repo, scheduleID string) error`
- `UpdateVariable(ctx, owner, repo, key, value string) error` — for poll watermark updates

**No longer needed:**
- `CreateWebhook` / `DeleteWebhook` — eliminated with the bridge
- `TriggerPipeline` — replaced by parent-child pipelines (GitLab-native, no forge method needed)

GitHub returns `ErrNotSupported` for `CreatePipelineSchedule`/`DeletePipelineSchedule` (GitHub Actions uses `workflow_dispatch` and `schedule` in YAML, not API-managed schedules).

## Security Model

The cron-polling model inherits Security Layers 2, 4, 5, and 7 from ADR 0043 unchanged. Layers 1, 3, and 6 are replaced or eliminated.

### Layer 1: Pipeline runs on protected default branch only (replaces bridge `ref=main`)

ADR 0043's bridge hardcoded `ref=main` to ensure pipelines run trusted code. In the cron model, the pipeline schedule is configured to run on the protected default branch at install time. The `workflow:rules` enforce this:

```yaml
- if: $CI_PIPELINE_SOURCE == "schedule" && $CI_COMMIT_REF_PROTECTED == "true"
```

A scheduled pipeline cannot be redirected to a non-protected branch without Maintainer access to modify the schedule. If modified, the `CI_COMMIT_REF_PROTECTED` check and WIF attribute conditions (Layer 4) provide defense-in-depth.

**Threat**: An insider with Maintainer access modifies the pipeline schedule to target a malicious branch. **Mitigation**: WIF attribute conditions reject OIDC token exchange for pipelines on non-protected branches (`assertion.ref_protected == "true"`). The bot PAT cannot be retrieved.

### Layer 2: Protected CI/CD variables (unchanged from ADR 0043)

All CI/CD variables that gate credential retrieval are marked protected. Unchanged.

### Layer 3: No webhook secrets needed (eliminates ADR 0043 Layer 3)

The webhook bridge required per-project webhook secrets for `X-Gitlab-Token` validation. Cron polling eliminates webhook secrets entirely — there is no inbound endpoint to authenticate. The credential surface is reduced from three secret types (bot PAT, webhook secret, trigger token) to one (bot PAT).

### Layer 4: OIDC/WIF attribute conditions (unchanged from ADR 0043)

WIF conditions restrict OIDC exchange to enrolled projects on protected branches. Unchanged.

### Layer 5: `CI_DEBUG_TRACE` guard (unchanged from ADR 0043)

Runtime check aborts if debug tracing is enabled. Unchanged.

### Layer 6: Event data sanitization (replaces ADR 0043 Layer 6)

ADR 0043 used base64 encoding to prevent YAML injection when passing webhook payloads as pipeline variables. In the cron model, the poller reads event data directly from the GitLab API and passes it to child pipelines via parent-child pipeline variables. The same base64 encoding is applied:

```bash
EVENT_PAYLOAD=$(echo "${event_json}" | base64 -w0)
```

The risk is the same — attacker-controlled content (issue titles, MR descriptions, comment bodies) could contain YAML metacharacters or shell injection payloads. The mitigation is the same — base64 encode all event data before passing to child pipelines.

### Layer 7: Fork MR protection (unchanged from ADR 0043)

Fix stage skipped for fork MRs. Unchanged.

### Security comparison with webhook bridge

| Dimension | Webhook Bridge (ADR 0043) | Cron Polling (this ADR) |
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

**Overall assessment:** Cron polling has a materially stronger security posture. Eliminating the public HTTP endpoint, the webhook secret management, and the bidirectional network requirement each independently reduce risk. The only trade-off is latency, which is acceptable for the asynchronous operations that cron handles.

## Comparison with GitHub

| Concern | GitHub (ADR 0033) | GitLab (this ADR) |
|---|---|---|
| MR/PR event dispatch | `pull_request_target` (native) | `merge_request_event` + `include: ref: main` (native) |
| Issue/comment dispatch | `issues` / `issue_comment` events (native) | Cron polling (scheduled pipeline) |
| Slash commands | Comment events (sub-second) | Cron polling (up to 5 min) or labels |
| External infrastructure | Mint Cloud Function | None for event dispatch; WIF + Secret Manager for credentials |
| Event detection latency | Sub-second (all events) | Sub-second (MR events), 5 min (issues/comments on Premium) |
| CI minute cost for dispatch | None (event-triggered) | ~8,640 min/month per project at 5-min interval |

## Consequences

### Positive

- **No external infrastructure for event dispatch.** The webhook bridge Cloud Function is eliminated. Deployment, monitoring, scaling, and security of an external service are no longer required.
- **Zero inbound attack surface.** No public HTTP endpoint. No webhook secrets to manage, rotate, or protect against leakage. No trigger tokens.
- **Simpler self-hosted GitLab deployment.** Outbound-only network requirements. No VPN peering, firewall rules, or on-premise container deployment needed for event detection.
- **Stronger event authenticity.** Events read directly from the GitLab API, not from potentially spoofed webhook payloads.
- **No event loss from delivery failures.** Polling reads from the source of truth. GitLab's webhook auto-disable mechanism (after 4 consecutive failures) cannot cause silent event loss.
- **Fewer credentials per project.** One secret type (bot PAT) instead of three (bot PAT + webhook secret + trigger token).
- **MR events still sub-second.** Native `merge_request_event` pipeline source provides the same latency as webhook-bridged MR events, with less complexity.
- **Tier-adaptive.** Architecture works on all GitLab tiers; `fullsend admin install` adapts poll frequency and interaction model to the detected tier.

### Negative

- **Latency for issue/comment events.** Up to 5 minutes on Premium/Ultimate, 60 minutes on Free tier. This is the fundamental trade-off — acceptable for asynchronous agent operations, poor for interactive use on Free tier.
- **CI minute consumption.** Polling pipelines run continuously, consuming CI minutes even when idle. On gitlab.com shared runners: ~8,640 minutes/month at 5-minute intervals (fits within Premium's 10,000; exceeds Free's 400). Self-hosted runners are not billed.
- **State management complexity.** The poller must track last-seen timestamps, dedup processed events, and handle edge cases (clock skew, deleted events, API pagination). The webhook bridge avoided this by processing each event exactly once on delivery.
- **Slash command latency.** Up to 5 minutes vs sub-second with webhooks. Mitigated by labels and multi-frequency polling, but inherently slower than push-based dispatch.
- **Quick Action stripping risk.** GitLab may silently strip `/fs-*` commands from comments. Requires empirical testing and potentially an alternative command syntax for GitLab.

### Risks

Ordered by the project's threat priority (external injection > insider > drift > supply chain):

1. **External injection — prompt injection via polled events.** Same risk as ADR 0043 — attacker-controlled content (issue titles, MR descriptions, comments) reaches the agent. **Mitigation**: Base64 encoding of event payloads passed to child pipelines (Layer 6). The transport mechanism (polling vs webhook) does not change the content risk.

2. **Insider — poll watermark tampering.** A Maintainer could modify `FULLSEND_LAST_POLL_AT` to skip events (set far future) or replay events (set far past). **Mitigation**: The variable is protected (Layer 2). Tampering requires the same Maintainer access that could modify the pipeline itself — the threat is contained within the existing insider model. Event deduplication prevents harmful reprocessing.

3. **Insider — schedule modification.** A Maintainer could modify the pipeline schedule to target a non-protected branch or increase/decrease frequency. **Mitigation**: WIF attribute conditions (Layer 4) reject credential retrieval on non-protected branches. Schedule changes are auditable in GitLab's audit log.

4. **Drift — missed events from API quirks.** The Notes API lacks a `created_after` filter; the Events API `after` parameter is date-only (not datetime). Client-side filtering may miss events at date boundaries. **Mitigation**: 30-second overlap window on the watermark and event ID-based deduplication. Slow poll (15-minute) serves as reconciliation for the fast poll (5-minute).

5. **Drift — CI minute exhaustion.** On gitlab.com shared runners, the polling pipeline may exhaust the project's CI minute quota, preventing legitimate builds. **Mitigation**: `fullsend admin install` warns about CI minute consumption. Polling jobs use the smallest available runner (1 vCPU) and exit quickly when no events are found. Self-hosted runners are the recommended deployment model.

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

As raised in team discussion: many GitLab users track work in Jira, not GitLab issues. The triage and code agents may primarily need to poll Jira for issue events, not GitLab. The cron-polling architecture is well-suited to this — the poller can be extended to query external systems (Jira API) in addition to GitLab. This is a future consideration that does not affect the current ADR.

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

- [GitLab per-repo support via OIDC/WIF and webhook bridge (PR #2042)](https://github.com/fullsend-ai/fullsend/pull/2042) — partially superseded (webhook bridge sections)
- [ADR 0033: Per-repo installation mode](0033-per-repo-installation-mode.md) — GitHub per-repo (adapted for GitLab)
- [ADR 0042: fs-prefix for slash commands](0042-fs-prefix-for-slash-commands.md) — command syntax conventions
- [GitLab Pipeline Schedules](https://docs.gitlab.com/ci/pipelines/schedules/) — scheduled pipeline configuration and tier limits
- [GitLab Issues API](https://docs.gitlab.com/api/issues/) — `updated_after` parameter for polling
- [GitLab Merge Requests API](https://docs.gitlab.com/api/merge_requests/) — `updated_after` parameter for polling
- [GitLab Events API](https://docs.gitlab.com/api/events/) — project activity feed for note discovery
- [GitLab Project Access Tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/) — tier availability
- [GitLab CI/CD Compute Minutes](https://docs.gitlab.com/ci/pipelines/compute_minutes/) — quota and billing
- [GitLab Rate Limits](https://docs.gitlab.com/security/rate_limits/) — API rate limits by tier
- [GitLab `include: project:`](https://docs.gitlab.com/ci/yaml/includes/) — trusted template inclusion from protected branches
