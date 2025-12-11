package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ============================================================================
// Agent Registration Handler
// ============================================================================

func (s *AppState) RegisterAgent(c *gin.Context) {
	var req AgentRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	serverID := uuid.New().String()
	agentToken := uuid.New().String()

	server := RemoteServer{
		ID:       serverID,
		Name:     req.Name,
		Location: req.Location,
		Provider: req.Provider,
		Token:    agentToken,
	}

	s.ConfigMu.Lock()
	s.Config.Servers = append(s.Config.Servers, server)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, AgentRegisterResponse{
		ID:    serverID,
		Token: agentToken,
	})
}

// ============================================================================
// Installation Script Handlers
// ============================================================================

func (s *AppState) GetAgentScript(c *gin.Context) {
	// Try to read from web directory first (production)
	webDir := getWebDir()
	if webDir != "" {
		scriptPath := webDir + "/agent.sh"
		if data, err := os.ReadFile(scriptPath); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Fallback: try relative paths (development)
	paths := []string{
		"./web/dist/agent.sh",
		"./web/public/agent.sh",
		"../web/dist/agent.sh",
		"../web/public/agent.sh",
	}

	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Last resort: return error
	c.JSON(http.StatusNotFound, gin.H{"error": "Agent script not found"})
}

func (s *AppState) GetAgentPowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent.ps1")
}

func (s *AppState) GetAgentUpgradePowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent-upgrade.ps1")
}

func (s *AppState) GetAgentUninstallPowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent-uninstall.ps1")
}

func (s *AppState) servePowerShellScript(c *gin.Context, filename string) {
	// Try to read from web directory first (production)
	webDir := getWebDir()
	if webDir != "" {
		scriptPath := webDir + "/" + filename
		if data, err := os.ReadFile(scriptPath); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Fallback: try relative paths (development)
	paths := []string{
		"./web/dist/" + filename,
		"./web/public/" + filename,
		"../web/dist/" + filename,
		"../web/public/" + filename,
	}

	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Last resort: return error
	c.JSON(http.StatusNotFound, gin.H{"error": "PowerShell script not found: " + filename})
}

func (s *AppState) GetInstallCommand(c *gin.Context) {
	host := c.Request.Host
	protocol := "https"

	// Priority: X-Forwarded-Proto header > TLS detection > localhost fallback
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		// Trust the X-Forwarded-Proto header from nginx
		protocol = proto
	} else if c.Request.TLS != nil {
		// Direct TLS connection
		protocol = "https"
	} else if host == "localhost" || (len(host) >= 4 && host[:4] == "127.") || (len(host) >= 10 && host[:10] == "localhost:") {
		protocol = "http"
	}

	baseURL := fmt.Sprintf("%s://%s", protocol, host)

	authHeader := c.GetHeader("Authorization")
	token := ""
	if len(authHeader) > 7 {
		token = authHeader[7:]
	}

	command := fmt.Sprintf(
		`curl -fsSL %s/agent.sh | sudo bash -s -- --server %s --token "%s" --name "$(hostname)"`,
		baseURL, baseURL, token,
	)

	c.JSON(http.StatusOK, InstallCommand{
		Command:   command,
		ScriptURL: fmt.Sprintf("%s/agent.sh", baseURL),
	})
}

// ============================================================================
// Update Agent Handler
// ============================================================================

func (s *AppState) UpdateAgent(c *gin.Context) {
	serverID := c.Param("id")

	var req UpdateAgentRequest
	c.ShouldBindJSON(&req)

	s.AgentConnsMu.RLock()
	conn := s.AgentConns[serverID]
	s.AgentConnsMu.RUnlock()

	if conn == nil {
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: false,
			Message: "Agent is not connected",
		})
		return
	}

	cmd := AgentCommand{
		Type:        "command",
		Command:     "update",
		DownloadURL: req.DownloadURL,
		Force:       req.Force,
	}

	data, _ := json.Marshal(cmd)
	select {
	case conn.SendChan <- data:
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: true,
			Message: "Update command sent to agent",
		})
	default:
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: false,
			Message: "Failed to send update command",
		})
	}
}
