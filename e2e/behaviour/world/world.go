package world

import (
	"time"

	"github.com/fullsend-ai/fullsend/e2e/behaviour/drivers/ci"
	"github.com/fullsend-ai/fullsend/e2e/behaviour/drivers/env"
	"github.com/fullsend-ai/fullsend/e2e/behaviour/drivers/scm"
	"github.com/fullsend-ai/fullsend/internal/forge"
	"github.com/fullsend-ai/fullsend/internal/runtime"
)

// World holds scenario state and injected drivers.
type World struct {
	Config env.RunnerConfig
	SCM    scm.Driver
	CI     ci.Driver
	Env    env.Setup

	Org       string
	RepoFull  string
	RepoOwner string
	RepoName  string
	Token     string
	Logf      func(string, ...any)

	ScenarioStart time.Time

	DummyOps            []runtime.BehaviourOperation
	BehaviourScriptPath string
	ArtifactDir         string

	IssueNumber    int
	IssueTitle     string
	WorkflowRun    *forge.WorkflowRun
	TriageWorkflow string
}

const BehaviourScriptRepoPath = "behaviour/current-scenario.yaml"
