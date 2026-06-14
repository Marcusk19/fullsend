package runtime

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/fullsend-ai/fullsend/internal/sandbox"
)

func TestLoadBehaviourScript(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	path := filepath.Join(dir, "current-scenario.yaml")
	content := `ops:
  - description: Emit JSON
    op: write_fixture
    args: output/agent-result.json, fixtures/triage/sufficient.json
    content: '{"action":"sufficient"}'
`
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))

	script, err := LoadBehaviourScript(path)
	require.NoError(t, err)
	require.Len(t, script.Ops, 1)
	assert.Equal(t, "Emit JSON", script.Ops[0].Description)
	assert.Equal(t, "write_fixture", script.Ops[0].Op)
	assert.Contains(t, script.Ops[0].Content, "sufficient")
}

func TestResolveWriteFixtureEmbeddedContent(t *testing.T) {
	t.Parallel()

	dest, content, err := resolveWriteFixture(BehaviourOperation{
		Op:      "write_fixture",
		Args:    "output/agent-result.json, fixtures/triage/sufficient.json",
		Content: "hello",
	})
	require.NoError(t, err)
	assert.Equal(t, "output/agent-result.json", dest)
	assert.Equal(t, "hello", content)
}

func TestResolveWriteFixtureMissingContent(t *testing.T) {
	t.Parallel()

	_, _, err := resolveWriteFixture(BehaviourOperation{
		Op:   "write_fixture",
		Args: "output/agent-result.json, fixtures/triage/sufficient.json",
	})
	require.Error(t, err)
}

func TestResolveSandboxPathWithinBase(t *testing.T) {
	t.Parallel()

	base := filepath.Join(t.TempDir(), "workspace")
	require.NoError(t, os.MkdirAll(base, 0o755))

	got, err := resolveSandboxPath(base, "output/file.json")
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(base, "output/file.json"), got)
}

func TestResolveSandboxPathRejectsEscape(t *testing.T) {
	t.Parallel()

	base := filepath.Join(t.TempDir(), "workspace")
	require.NoError(t, os.MkdirAll(base, 0o755))

	_, err := resolveSandboxPath(base, "../outside")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "escapes base")
}

func TestResolveSandboxPathRejectsAbsoluteOutsideWorkspace(t *testing.T) {
	t.Parallel()

	_, err := resolveSandboxPath(sandbox.SandboxWorkspace, "/etc/passwd")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "escapes sandbox workspace")
}

func TestExecuteBehaviourOpUnknown(t *testing.T) {
	t.Parallel()

	err := executeBehaviourOp("unused", t.TempDir(), BehaviourOperation{Op: "nope"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown op")
}
