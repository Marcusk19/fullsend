package envfile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeEnvFile(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	return path
}

func TestLoad_KeyValue(t *testing.T) {
	t.Setenv("ENVTEST_KV", "")
	path := writeEnvFile(t, "ENVTEST_KV=bar\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "bar", os.Getenv("ENVTEST_KV"))
}

func TestLoad_DoubleQuoted(t *testing.T) {
	t.Setenv("ENVTEST_DQ", "")
	path := writeEnvFile(t, `ENVTEST_DQ="hello world"`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "hello world", os.Getenv("ENVTEST_DQ"))
}

func TestLoad_SingleQuoted(t *testing.T) {
	t.Setenv("ENVTEST_SQ", "")
	path := writeEnvFile(t, `ENVTEST_SQ='hello world'`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "hello world", os.Getenv("ENVTEST_SQ"))
}

func TestLoad_ExportPrefix(t *testing.T) {
	t.Setenv("ENVTEST_EXPORTED", "")
	path := writeEnvFile(t, "export ENVTEST_EXPORTED=yes\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "yes", os.Getenv("ENVTEST_EXPORTED"))
}

func TestLoad_CommentsAndBlanks(t *testing.T) {
	t.Setenv("ENVTEST_C1", "")
	t.Setenv("ENVTEST_C2", "")
	content := "# a comment\nENVTEST_C1=val1\n\n# another comment\nENVTEST_C2=val2\n"
	path := writeEnvFile(t, content)
	require.NoError(t, Load(path))
	assert.Equal(t, "val1", os.Getenv("ENVTEST_C1"))
	assert.Equal(t, "val2", os.Getenv("ENVTEST_C2"))
}

func TestLoad_EmptyValue(t *testing.T) {
	t.Setenv("ENVTEST_EMPTY", "placeholder")
	path := writeEnvFile(t, "ENVTEST_EMPTY=\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "", os.Getenv("ENVTEST_EMPTY"))
}

func TestLoad_NoEquals(t *testing.T) {
	t.Setenv("ENVTEST_VALID", "")
	path := writeEnvFile(t, "NOEQUALS\nENVTEST_VALID=ok\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "ok", os.Getenv("ENVTEST_VALID"))
}

func TestLoad_FileNotFound(t *testing.T) {
	err := Load("/nonexistent/.env")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "opening env file")
}

func TestLoad_InlineComment(t *testing.T) {
	t.Setenv("ENVTEST_IC", "")
	path := writeEnvFile(t, "ENVTEST_IC=value # this is a comment\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value", os.Getenv("ENVTEST_IC"))
}

func TestLoad_InlineCommentPreservedInQuotes(t *testing.T) {
	t.Setenv("ENVTEST_ICQ", "")
	path := writeEnvFile(t, `ENVTEST_ICQ="value # not a comment"`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value # not a comment", os.Getenv("ENVTEST_ICQ"))
}

func TestLoad_WindowsLineEndings(t *testing.T) {
	t.Setenv("ENVTEST_CRLF", "")
	path := writeEnvFile(t, "ENVTEST_CRLF=value\r\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value", os.Getenv("ENVTEST_CRLF"))
}

func TestLoad_WindowsLineEndingsQuoted(t *testing.T) {
	t.Setenv("ENVTEST_CRLFQ", "")
	path := writeEnvFile(t, "ENVTEST_CRLFQ=\"quoted\"\r\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "quoted", os.Getenv("ENVTEST_CRLFQ"))
}

func TestLoad_InvalidKeyName(t *testing.T) {
	path := writeEnvFile(t, "INVALID-KEY=value\n")
	err := Load(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid env var name")
}

func TestLoad_InvalidKeyNameWithSpaces(t *testing.T) {
	path := writeEnvFile(t, "KEY WITH SPACES=value\n")
	err := Load(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid env var name")
}

func TestLoad_ValidKeyWithUnderscore(t *testing.T) {
	t.Setenv("_ENVTEST_UNDER", "")
	path := writeEnvFile(t, "_ENVTEST_UNDER=yes\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "yes", os.Getenv("_ENVTEST_UNDER"))
}

func TestLoad_MultipleEquals(t *testing.T) {
	t.Setenv("ENVTEST_URL", "")
	path := writeEnvFile(t, "ENVTEST_URL=https://example.com?a=b&c=d\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "https://example.com?a=b&c=d", os.Getenv("ENVTEST_URL"))
}

func TestLoad_FileTooLarge(t *testing.T) {
	large := strings.Repeat("A=B\n", 400000)
	path := writeEnvFile(t, large)
	err := Load(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds maximum size")
}

func TestLoad_EmptyKey(t *testing.T) {
	path := writeEnvFile(t, "=value\n")
	err := Load(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid env var name")
}

func TestLoad_HashWithoutSpace(t *testing.T) {
	t.Setenv("ENVTEST_HASH", "")
	path := writeEnvFile(t, "ENVTEST_HASH=value#tag\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value#tag", os.Getenv("ENVTEST_HASH"))
}

func TestLoad_MismatchedQuotesLiteral(t *testing.T) {
	t.Setenv("ENVTEST_MQ", "")
	path := writeEnvFile(t, `ENVTEST_MQ="value'`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, `"value'`, os.Getenv("ENVTEST_MQ"))
}

func TestLoad_QuotedValueWithTrailingComment(t *testing.T) {
	t.Setenv("ENVTEST_QTC", "")
	path := writeEnvFile(t, `ENVTEST_QTC="value" # trailing comment`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value", os.Getenv("ENVTEST_QTC"))
}

func TestLoad_SingleQuotedValueWithTrailingComment(t *testing.T) {
	t.Setenv("ENVTEST_SQTC", "")
	path := writeEnvFile(t, `ENVTEST_SQTC='value' # trailing comment`+"\n")
	require.NoError(t, Load(path))
	assert.Equal(t, "value", os.Getenv("ENVTEST_SQTC"))
}

func TestLoad_ExportDoubleSpace(t *testing.T) {
	path := writeEnvFile(t, "export  ENVTEST_DS=value\n")
	err := Load(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid env var name")
}

func TestLoad_MultiFileOverrideOrder(t *testing.T) {
	t.Setenv("ENVTEST_ORDER", "")
	path1 := writeEnvFile(t, "ENVTEST_ORDER=first\n")
	dir2 := t.TempDir()
	path2 := filepath.Join(dir2, ".env")
	require.NoError(t, os.WriteFile(path2, []byte("ENVTEST_ORDER=second\n"), 0o644))

	require.NoError(t, Load(path1))
	require.NoError(t, Load(path2))
	assert.Equal(t, "second", os.Getenv("ENVTEST_ORDER"))
}
