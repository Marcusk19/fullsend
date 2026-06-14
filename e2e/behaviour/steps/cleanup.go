package steps

import (
	"context"
	"os"

	"github.com/fullsend-ai/fullsend/e2e/behaviour/world"
	"github.com/fullsend-ai/fullsend/internal/forge"
)

func CleanupScenario(w *world.World) {
	ctx := context.Background()
	if w.IssueNumber > 0 {
		if err := w.SCM.CloseIssue(ctx, w.RepoOwner, w.RepoName, w.IssueNumber); err != nil {
			worldLogf(w, "behaviour cleanup: close issue #%d: %v", w.IssueNumber, err)
		}
	}
	if w.ArtifactDir != "" {
		if err := os.RemoveAll(w.ArtifactDir); err != nil {
			worldLogf(w, "behaviour cleanup: remove artifact dir: %v", err)
		}
	}
	empty := []byte("ops: []\n")
	if err := w.SCM.CommitFile(ctx, w.Org, forge.ConfigRepoName, world.BehaviourScriptRepoPath, "behaviour: clear dummy agent script", empty); err != nil {
		worldLogf(w, "behaviour cleanup: clear dummy script: %v", err)
	}
}

func worldLogf(w *world.World, format string, args ...any) {
	if w.Logf != nil {
		w.Logf(format, args...)
	}
}
