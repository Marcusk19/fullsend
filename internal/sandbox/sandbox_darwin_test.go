//go:build darwin

package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestUploadDir_SuppressesAppleDoubleInTarball verifies that COPYFILE_DISABLE=1
// prevents ._* files from appearing in the tarball produced by UploadDir's tar
// invocation. macOS bsdtar silently hides ._* members from its own listings, so
// python3 tarfile is used to enumerate all members including hidden AppleDouble files.
//
// The test also asserts the negative: running tar without COPYFILE_DISABLE=1 on a
// quarantined file does produce ._* members, proving the test can detect a regression.
func TestUploadDir_SuppressesAppleDoubleInTarball(t *testing.T) {
	// Verify python3 is available (used to inspect tarball members).
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not available")
	}

	// Create a source directory with a file that will receive extended attributes.
	srcDir := t.TempDir()
	testFile := filepath.Join(srcDir, "pack-abc.idx")
	require.NoError(t, os.WriteFile(testFile, []byte("idx content"), 0o644))

	// Apply com.apple.quarantine xattr — the most common trigger for AppleDouble
	// generation on macOS. xattr is always present on macOS.
	xattrCmd := exec.Command("xattr", "-w", "com.apple.quarantine",
		"0083;00000000;Safari;", testFile)
	if out, err := xattrCmd.CombinedOutput(); err != nil {
		t.Fatalf("xattr command failed (unexpected on macOS): %v: %s", err, out)
	}

	// listTarMembers uses python3 tarfile to return all member names, including
	// ._* members that macOS tar -t hides from its own output.
	listTarMembers := func(tarPath string) []string {
		t.Helper()
		out, err := exec.Command("python3", "-c",
			"import tarfile, sys; [print(m.name) for m in tarfile.open(sys.argv[1])]",
			tarPath,
		).Output()
		require.NoError(t, err, "python3 tarfile listing failed")
		var members []string
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line != "" {
				members = append(members, line)
			}
		}
		return members
	}

	hasAppleDouble := func(members []string) bool {
		for _, m := range members {
			if strings.HasPrefix(filepath.Base(m), "._") {
				return true
			}
		}
		return false
	}

	// --- Negative control: tar WITHOUT COPYFILE_DISABLE should produce ._* files.
	// Filter COPYFILE_DISABLE from the environment so pre-existing CI env vars
	// don't suppress AppleDouble generation and invalidate the control.
	controlEnv := make([]string, 0, len(os.Environ()))
	for _, e := range os.Environ() {
		if !strings.HasPrefix(e, "COPYFILE_DISABLE=") {
			controlEnv = append(controlEnv, e)
		}
	}
	controlTar := filepath.Join(t.TempDir(), "control.tar.gz")
	controlCmd := exec.Command("tar", "-czf", controlTar, "-C", srcDir, ".")
	controlCmd.Env = controlEnv
	if out, err := controlCmd.CombinedOutput(); err != nil {
		t.Fatalf("control tar failed: %v: %s", err, out)
	}
	controlMembers := listTarMembers(controlTar)
	if !hasAppleDouble(controlMembers) {
		t.Skip("tar without COPYFILE_DISABLE produced no ._* files — xattr may not have applied; skipping")
	}

	// --- Subject: tar WITH COPYFILE_DISABLE=1 (matching UploadDir) must produce no ._* files.
	subjectTar := filepath.Join(t.TempDir(), "subject.tar.gz")
	subjectCmd := exec.Command("tar", "-czf", subjectTar, "-C", srcDir, ".")
	subjectCmd.Env = append(controlEnv, "COPYFILE_DISABLE=1")
	out, err := subjectCmd.CombinedOutput()
	require.NoError(t, err, "tar with COPYFILE_DISABLE=1 failed: %s", out)

	subjectMembers := listTarMembers(subjectTar)
	assert.False(t, hasAppleDouble(subjectMembers),
		"tarball must contain no ._* members when COPYFILE_DISABLE=1; got: %v", subjectMembers)
}
