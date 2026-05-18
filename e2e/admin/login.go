//go:build e2e

package admin

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/playwright-community/playwright-go"
)

// verifyGitHubSession checks that the browser context has a valid GitHub
// session by navigating to a page that requires authentication. If the
// session is expired or invalid, it returns an error.
func verifyGitHubSession(page playwright.Page, screenshotDir string, logf func(string, ...any)) error {
	if _, err := page.Goto("https://github.com/settings/profile", playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(15000),
	}); err != nil {
		return fmt.Errorf("navigating to settings/profile: %w", err)
	}

	url := page.URL()
	logf("[session] Verification URL: %s", url)

	if strings.Contains(url, "/login") || strings.Contains(url, "/session") {
		saveDebugScreenshot(page, screenshotDir, "session-expired", logf)
		return fmt.Errorf("session is not authenticated: navigating to /settings/profile redirected to %s\n\nThe stored browser session has expired. To fix:\n  1. make e2e-export-session   # re-login and export a fresh session\n  2. make e2e-upload-session   # export + upload to GitHub secret", url)
	}

	logf("[session] Session is valid")
	return nil
}

// handleSudoIfPresent detects GitHub's "Confirm access" sudo page and
// enters the password to proceed. GitHub requires sudo confirmation when
// accessing sensitive settings pages (token management, app settings)
// even with a valid session. Returns true if sudo was handled.
func handleSudoIfPresent(page playwright.Page, password, screenshotDir string, logf func(string, ...any)) (bool, error) {
	pageTitle, _ := page.Title()
	if !strings.Contains(pageTitle, "Confirm access") && !strings.Contains(pageTitle, "Sudo") {
		return false, nil
	}

	logf("[sudo] Detected sudo confirmation page (title: %s)", pageTitle)

	if password == "" {
		saveDebugScreenshot(page, screenshotDir, "sudo-no-password", logf)
		return false, fmt.Errorf("sudo confirmation required but no password available — set E2E_GITHUB_PASSWORD")
	}

	// GitHub's sudo form uses #sudo_password for the password field.
	passwordInput := page.Locator("#sudo_password")
	if err := passwordInput.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(5000),
	}); err != nil {
		saveDebugScreenshot(page, screenshotDir, "sudo-password-field-missing", logf)
		return false, fmt.Errorf("sudo password field not found: %w", err)
	}

	if err := passwordInput.Fill(password); err != nil {
		return false, fmt.Errorf("filling sudo password: %w", err)
	}

	// Click the confirm button.
	confirmBtn := page.Locator("button[type='submit']:has-text('Confirm'), button[type='submit']:has-text('Confirm password'), button[type='submit']")
	if err := confirmBtn.First().Click(playwright.LocatorClickOptions{
		Timeout: playwright.Float(5000),
	}); err != nil {
		saveDebugScreenshot(page, screenshotDir, "sudo-confirm-click-failed", logf)
		return false, fmt.Errorf("clicking sudo confirm button: %w", err)
	}

	// Wait for the page to navigate away from the sudo page.
	if err := page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
		State: playwright.LoadStateDomcontentloaded,
	}); err != nil {
		return false, fmt.Errorf("waiting for post-sudo navigation: %w", err)
	}

	// Verify we're past sudo.
	newTitle, _ := page.Title()
	if strings.Contains(newTitle, "Confirm access") || strings.Contains(newTitle, "Sudo") {
		saveDebugScreenshot(page, screenshotDir, "sudo-still-on-page", logf)
		return false, fmt.Errorf("sudo confirmation failed — still on confirmation page (title: %s)", newTitle)
	}

	logf("[sudo] Sudo confirmation succeeded")
	return true, nil
}

// saveDebugScreenshot saves a screenshot to dir for debugging.
func saveDebugScreenshot(page playwright.Page, dir, name string, logf func(string, ...any)) {
	path := filepath.Join(dir, fmt.Sprintf("e2e-debug-%s.png", name))
	if _, err := page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(path),
		FullPage: playwright.Bool(true),
	}); err != nil {
		logf("[debug] Could not save screenshot %s: %v", path, err)
		return
	}
	logf("[debug] Screenshot saved: %s", path)
}
