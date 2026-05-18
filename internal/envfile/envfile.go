// Package envfile provides a simple dotenv file parser.
//
// Supported syntax:
//
//	KEY=value
//	KEY="quoted value"
//	KEY='single quoted'
//	export KEY=value
//	KEY=value # inline comment (stripped for unquoted values)
//	# full-line comments
//
// Inline comments require a space before # (KEY=val#tag is preserved).
// Mismatched quotes are treated as literal characters.
//
// Not supported: multiline values, escape sequences (\n, \t),
// variable expansion (${VAR}).
package envfile

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"
)

const maxEnvFileSize = 1 << 20 // 1 MB

var validKeyRe = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Load reads a dotenv file and sets each entry in the process environment.
// It permanently modifies the process environment via os.Setenv.
func Load(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("opening env file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return fmt.Errorf("stat env file: %w", err)
	}
	if info.Size() > maxEnvFileSize {
		return fmt.Errorf("env file %s exceeds maximum size (%d bytes)", path, maxEnvFileSize)
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")

		idx := strings.Index(line, "=")
		if idx < 0 {
			continue
		}
		key := line[:idx]
		value := line[idx+1:]

		if !validKeyRe.MatchString(key) {
			return fmt.Errorf("invalid env var name %q in %s", key, path)
		}

		quoted := false
		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') {
			if end := strings.IndexByte(value[1:], value[0]); end >= 0 {
				value = value[1 : end+1]
				quoted = true
			}
		}

		// Strip inline comments from unquoted values only.
		if !quoted {
			if ci := strings.Index(value, " #"); ci >= 0 {
				value = strings.TrimRight(value[:ci], " ")
			}
		}

		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("setting %s: %w", key, err)
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("reading env file %s: %w", path, err)
	}
	return nil
}
