package cli

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/fullsend-ai/fullsend/internal/gcp"
	"github.com/fullsend-ai/fullsend/internal/ui"
)

// checkVertexAccess performs a pre-flight authorization check against Vertex AI
// before sandbox creation. It calls the Vertex AI publishers.models.get endpoint
// which exercises the same IAM path as aiplatform.endpoints.predict. If the
// credentials lack the required permission, we fail fast with a clear error
// instead of spending ~100s on sandbox setup only to get a cryptic failure.
//
// The check is skipped when CLAUDE_CODE_USE_VERTEX is not set to "1".
func checkVertexAccess(printer *ui.Printer) error {
	if os.Getenv("CLAUDE_CODE_USE_VERTEX") != "1" {
		return nil
	}

	projectID := os.Getenv("ANTHROPIC_VERTEX_PROJECT_ID")
	region := os.Getenv("CLOUD_ML_REGION")
	if projectID == "" || region == "" {
		printer.StepWarn("Vertex AI pre-flight check skipped: ANTHROPIC_VERTEX_PROJECT_ID or CLOUD_ML_REGION not set")
		return nil
	}

	start := time.Now()
	printer.StepStart("Checking Vertex AI access")

	client := vertexPreflightClient
	if client == nil {
		client = gcp.NewClient()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Call publishers.models.get — a lightweight read-only endpoint that
	// exercises the same IAM permissions as inference without doing actual work.
	url := fmt.Sprintf(
		"https://%s-aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/anthropic/models/claude-sonnet-4-20250514",
		region, projectID, region,
	)

	resp, err := client.DoRequest(ctx, http.MethodGet, url, "")
	if err != nil {
		// Credential/network errors — warn but don't block, since the real
		// failure will happen inside the sandbox anyway.
		printer.StepWarn(fmt.Sprintf("Vertex AI pre-flight check could not reach API: %v", err))
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		printer.StepDone(fmt.Sprintf("Vertex AI access verified (%.1fs)", time.Since(start).Seconds()))
		return nil
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	errMsg := gcp.ExtractErrorMessage(body)

	if resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf(
			"Vertex AI authorization failed (HTTP 403): %s\n\n"+
				"The WIF credentials for project %q do not have the required IAM permissions.\n"+
				"Ensure the service account has the 'aiplatform.endpoints.predict' permission\n"+
				"(e.g., the Vertex AI User role). This may take a few minutes to propagate\n"+
				"after granting.",
			errMsg, projectID,
		)
	}

	// Non-403 errors (404, 500, etc.) — warn but don't block.
	printer.StepWarn(fmt.Sprintf("Vertex AI pre-flight check returned HTTP %d: %s", resp.StatusCode, errMsg))
	return nil
}

// vertexPreflightClient can be overridden in tests to inject a mock GCP client.
var vertexPreflightClient *gcp.Client
