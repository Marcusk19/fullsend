package steps

import (
	"context"
	"fmt"
	"os"

	"github.com/fullsend-ai/fullsend/e2e/behaviour/world"
	"github.com/fullsend-ai/fullsend/internal/forge"
)

const triageWorkflowFile = "triage.yml"

func ensureTriageWorkflowComplete(w *world.World) error {
	if w.WorkflowRun != nil {
		return nil
	}
	if w.ScenarioStart.IsZero() {
		return fmt.Errorf("no workflow trigger time: create an issue and comment first")
	}
	ctx := context.Background()
	run, err := w.CI.WaitForWorkflow(ctx, w.Org, forge.ConfigRepoName, triageWorkflowFile, w.ScenarioStart)
	if err != nil {
		return err
	}
	w.WorkflowRun = run
	return nil
}

func ensureArtifacts(w *world.World) error {
	if err := ensureTriageWorkflowComplete(w); err != nil {
		return err
	}
	if w.ArtifactDir != "" {
		return nil
	}
	artifactDir, err := os.MkdirTemp("", "behaviour-artifacts-*")
	if err != nil {
		return err
	}
	ctx := context.Background()
	if err := w.CI.DownloadArtifacts(ctx, w.Org, forge.ConfigRepoName, w.WorkflowRun.ID, artifactDir); err != nil {
		_ = os.RemoveAll(artifactDir)
		return err
	}
	w.ArtifactDir = artifactDir
	return nil
}
