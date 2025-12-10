package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"time"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Version Check Handlers
// ============================================================================

type ServerVersionInfo struct {
	Version string `json:"version"`
}

func GetServerVersion(c *gin.Context) {
	c.JSON(http.StatusOK, ServerVersionInfo{Version: ServerVersion})
}

func CheckLatestVersion(c *gin.Context) {
	latest, err := fetchLatestGitHubVersion("zsai001", "vstats")
	updateAvailable := false
	if err == nil && latest != nil && *latest != ServerVersion {
		updateAvailable = true
	}

	c.JSON(http.StatusOK, VersionInfo{
		Current:         ServerVersion,
		Latest:          latest,
		UpdateAvailable: updateAvailable,
	})
}

// ============================================================================
// Server Upgrade Handler
// ============================================================================

type UpgradeServerRequest struct {
	Force bool `json:"force"`
}

type UpgradeServerResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Output  string `json:"output,omitempty"`
}

func UpgradeServer(c *gin.Context) {
	var req UpgradeServerRequest
	c.ShouldBindJSON(&req)

	// Always use --force flag to ensure reinstall even if version matches
	// This ensures users can reinstall/repair if needed
	upgradeCmd := "curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- --upgrade --force"

	// Use nohup and setsid to run in a completely detached process
	// that survives the server shutdown during upgrade:
	// - setsid creates a new session (detaches from parent process group)
	// - nohup ignores SIGHUP signal
	// - Redirect output to log file for debugging
	logFile := "/tmp/vstats-upgrade.log"
	detachedCmd := fmt.Sprintf("nohup setsid bash -c '%s' > %s 2>&1 &", upgradeCmd, logFile)

	// Execute the detached command - use Start() not Run() so we don't wait
	cmd := exec.Command("bash", "-c", detachedCmd)
	err := cmd.Start()

	if err != nil {
		c.JSON(http.StatusOK, UpgradeServerResponse{
			Success: false,
			Message: fmt.Sprintf("Failed to start upgrade: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, UpgradeServerResponse{
		Success: true,
		Message: "Upgrade started in background (force mode). The server will restart shortly. Check /tmp/vstats-upgrade.log for details.",
	})
}

// ============================================================================
// Helper Functions
// ============================================================================

func fetchLatestGitHubVersion(owner, repo string) (*string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "vstats-server")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned status: %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	tagName, ok := result["tag_name"].(string)
	if !ok {
		return nil, fmt.Errorf("no tag_name in response")
	}

	// Remove 'v' prefix if present
	if len(tagName) > 0 && tagName[0] == 'v' {
		tagName = tagName[1:]
	}

	return &tagName, nil
}
