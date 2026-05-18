package cli

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/fullsend-ai/fullsend/internal/gcp"
	"github.com/fullsend-ai/fullsend/internal/ui"
)

func TestCheckVertexAccess_SkippedWhenNotVertex(t *testing.T) {
	t.Setenv("CLAUDE_CODE_USE_VERTEX", "")
	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	assert.NoError(t, err)
}

func TestCheckVertexAccess_SkippedWhenNotOne(t *testing.T) {
	t.Setenv("CLAUDE_CODE_USE_VERTEX", "0")
	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	assert.NoError(t, err)
}

func TestCheckVertexAccess_SkippedWhenMissingProjectID(t *testing.T) {
	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "")
	t.Setenv("CLOUD_ML_REGION", "global")
	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	assert.NoError(t, err)
}

func TestCheckVertexAccess_SkippedWhenMissingRegion(t *testing.T) {
	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "my-project")
	t.Setenv("CLOUD_ML_REGION", "")
	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	assert.NoError(t, err)
}

func TestCheckVertexAccess_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Contains(t, r.Header.Get("Authorization"), "Bearer ")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `{"name":"publishers/anthropic/models/claude-sonnet-4-20250514"}`)
	}))
	defer srv.Close()

	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "my-project")
	t.Setenv("CLOUD_ML_REGION", "global")

	// Override the preflight client to use the test server.
	origClient := vertexPreflightClient
	vertexPreflightClient = gcp.NewClientWithHTTP(srv.Client())
	defer func() { vertexPreflightClient = origClient }()

	// We need to redirect the URL to our test server. Since the client calls
	// a constructed URL, we can't easily intercept it. Instead, use a server
	// that captures any request.
	// For proper testing, we need to use the httptest server as a proxy.
	// Let's use a different approach: create a test server and override the
	// URL construction by using a custom handler.

	// Actually, the simplest approach is to create a test server and have the
	// GCP client hit it. Since NewClientWithHTTP creates a client with a
	// static token, we need to make the HTTP client redirect to our server.
	// The issue is that DoRequest constructs the URL internally.

	// Let's test this properly by using a RoundTripper that intercepts.
	transport := &redirectTransport{target: srv.URL}
	testHTTPClient := &http.Client{Transport: transport}
	vertexPreflightClient = gcp.NewClientWithHTTP(testHTTPClient)

	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	assert.NoError(t, err)
}

func TestCheckVertexAccess_Forbidden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		fmt.Fprint(w, `{"error":{"message":"Permission 'aiplatform.endpoints.predict' denied on resource"}}`)
	}))
	defer srv.Close()

	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "my-project")
	t.Setenv("CLOUD_ML_REGION", "global")

	origClient := vertexPreflightClient
	transport := &redirectTransport{target: srv.URL}
	testHTTPClient := &http.Client{Transport: transport}
	vertexPreflightClient = gcp.NewClientWithHTTP(testHTTPClient)
	defer func() { vertexPreflightClient = origClient }()

	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Vertex AI authorization failed")
	assert.Contains(t, err.Error(), "HTTP 403")
	assert.Contains(t, err.Error(), "aiplatform.endpoints.predict")
	assert.Contains(t, err.Error(), "my-project")
}

func TestCheckVertexAccess_NonForbiddenError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		fmt.Fprint(w, `{"error":{"message":"service temporarily unavailable"}}`)
	}))
	defer srv.Close()

	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "my-project")
	t.Setenv("CLOUD_ML_REGION", "global")

	origClient := vertexPreflightClient
	transport := &redirectTransport{target: srv.URL}
	testHTTPClient := &http.Client{Transport: transport}
	vertexPreflightClient = gcp.NewClientWithHTTP(testHTTPClient)
	defer func() { vertexPreflightClient = origClient }()

	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	// Non-403 errors should warn but not fail.
	assert.NoError(t, err)
}

func TestCheckVertexAccess_NetworkError(t *testing.T) {
	t.Setenv("CLAUDE_CODE_USE_VERTEX", "1")
	t.Setenv("ANTHROPIC_VERTEX_PROJECT_ID", "my-project")
	t.Setenv("CLOUD_ML_REGION", "global")

	origClient := vertexPreflightClient
	// Use a transport that always fails.
	transport := &redirectTransport{target: "http://127.0.0.1:1"} // unreachable port
	testHTTPClient := &http.Client{Transport: transport}
	vertexPreflightClient = gcp.NewClientWithHTTP(testHTTPClient)
	defer func() { vertexPreflightClient = origClient }()

	printer := ui.New(io.Discard)
	err := checkVertexAccess(printer)
	// Network errors should warn but not block.
	assert.NoError(t, err)
}

// redirectTransport is an http.RoundTripper that rewrites the request URL
// to point to a test server, preserving the original path and query.
type redirectTransport struct {
	target string
}

func (t *redirectTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	newURL := t.target + req.URL.Path
	if req.URL.RawQuery != "" {
		newURL += "?" + req.URL.RawQuery
	}
	newReq, err := http.NewRequestWithContext(req.Context(), req.Method, newURL, req.Body)
	if err != nil {
		return nil, err
	}
	newReq.Header = req.Header
	return http.DefaultTransport.RoundTrip(newReq)
}
