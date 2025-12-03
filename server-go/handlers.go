package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// ServerVersion is defined in main.go and set at build time

// ============================================================================
// Auth Handlers
// ============================================================================

func (s *AppState) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.RLock()
	passwordHash := s.Config.AdminPasswordHash
	s.ConfigMu.RUnlock()

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid password"})
		return
	}

	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "admin",
		"exp": expiresAt.Unix(),
	})

	tokenString, err := token.SignedString([]byte(GetJWTSecret()))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		Token:     tokenString,
		ExpiresAt: expiresAt,
	})
}

func (s *AppState) VerifyToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "valid"})
}

func (s *AppState) ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	if err := bcrypt.CompareHashAndPassword([]byte(s.Config.AdminPasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid current password"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	s.Config.AdminPasswordHash = string(hash)
	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}

// ============================================================================
// Site Settings Handlers
// ============================================================================

func (s *AppState) GetSiteSettings(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.SiteSettings)
}

func (s *AppState) UpdateSiteSettings(c *gin.Context) {
	var settings SiteSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.SiteSettings = settings
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.Status(http.StatusOK)
}

// ============================================================================
// Local Node Configuration Handlers
// ============================================================================

func (s *AppState) GetLocalNodeConfig(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.LocalNode)
}

func (s *AppState) UpdateLocalNodeConfig(c *gin.Context) {
	var config LocalNodeConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.LocalNode = config
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, config)
}

// ============================================================================
// Probe Settings Handlers
// ============================================================================

func (s *AppState) GetProbeSettings(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.ProbeSettings)
}

func (s *AppState) UpdateProbeSettings(c *gin.Context) {
	var settings ProbeSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.ProbeSettings = settings
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.Status(http.StatusOK)
}

// ============================================================================
// Server Management Handlers
// ============================================================================

func (s *AppState) GetServers(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.Servers)
}

func (s *AppState) AddServer(c *gin.Context) {
	var req AddServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	server := RemoteServer{
		ID:       uuid.New().String(),
		Name:     req.Name,
		URL:      req.URL,
		Location: req.Location,
		Provider: req.Provider,
		Tag:      req.Tag,
		Token:    uuid.New().String(),
	}

	s.ConfigMu.Lock()
	s.Config.Servers = append(s.Config.Servers, server)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, server)
}

func (s *AppState) DeleteServer(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	servers := make([]RemoteServer, 0)
	for _, srv := range s.Config.Servers {
		if srv.ID != id {
			servers = append(servers, srv)
		}
	}
	s.Config.Servers = servers
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	s.AgentMetricsMu.Lock()
	delete(s.AgentMetrics, id)
	s.AgentMetricsMu.Unlock()

	c.Status(http.StatusOK)
}

func (s *AppState) UpdateServer(c *gin.Context) {
	id := c.Param("id")

	var req UpdateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *RemoteServer
	for i := range s.Config.Servers {
		if s.Config.Servers[i].ID == id {
			if req.Name != nil {
				s.Config.Servers[i].Name = *req.Name
			}
			if req.Location != nil {
				s.Config.Servers[i].Location = *req.Location
			}
			if req.Provider != nil {
				s.Config.Servers[i].Provider = *req.Provider
			}
			if req.Tag != nil {
				s.Config.Servers[i].Tag = *req.Tag
			}
			updated = &s.Config.Servers[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

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
// History Handler
// ============================================================================

func (s *AppState) GetHistory(c *gin.Context, db *sql.DB) {
	serverID := c.Param("server_id")
	rangeStr := c.DefaultQuery("range", "24h")

	data, err := GetHistory(db, serverID, rangeStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch history"})
		return
	}

	var pingTargets []PingHistoryTarget
	if rangeStr == "1h" || rangeStr == "24h" {
		pingTargets, _ = GetPingHistory(db, serverID, rangeStr)
	}

	c.JSON(http.StatusOK, HistoryResponse{
		ServerID:    serverID,
		Range:       rangeStr,
		Data:        data,
		PingTargets: pingTargets,
	})
}

// ============================================================================
// Metrics Handlers
// ============================================================================

type LocalMetricsResponse struct {
	SystemMetrics
	LocalNode LocalNodeConfig `json:"local_node"`
}

func (s *AppState) GetMetrics(c *gin.Context) {
	metrics := CollectMetrics()

	s.ConfigMu.RLock()
	localNode := s.Config.LocalNode
	s.ConfigMu.RUnlock()

	c.JSON(http.StatusOK, LocalMetricsResponse{
		SystemMetrics: metrics,
		LocalNode:     localNode,
	})
}

func (s *AppState) GetAllMetrics(c *gin.Context) {
	s.ConfigMu.RLock()
	servers := s.Config.Servers
	s.ConfigMu.RUnlock()

	s.AgentMetricsMu.RLock()
	defer s.AgentMetricsMu.RUnlock()

	var updates []ServerMetricsUpdate
	for _, server := range servers {
		metricsData := s.AgentMetrics[server.ID]
		online := false
		if metricsData != nil {
			online = time.Since(metricsData.LastUpdated).Seconds() < 30
		}

		version := server.Version
		if metricsData != nil && metricsData.Metrics.Version != "" {
			version = metricsData.Metrics.Version
		}

		var metrics *SystemMetrics
		if metricsData != nil {
			metrics = &metricsData.Metrics
		}

		updates = append(updates, ServerMetricsUpdate{
			ServerID:   server.ID,
			ServerName: server.Name,
			Location:   server.Location,
			Provider:   server.Provider,
			Tag:        server.Tag,
			Version:    version,
			IP:         server.IP,
			Online:     online,
			Metrics:    metrics,
		})
	}

	c.JSON(http.StatusOK, updates)
}

// ============================================================================
// Installation Script Handler
// ============================================================================

const AgentScript = `#!/bin/bash
# vStats Agent Installation Script
set -e

echo "Installing vStats Agent..."

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --server) SERVER="$2"; shift 2 ;;
        --token) TOKEN="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        *) shift ;;
    esac
done

# Validate required arguments
if [ -z "$SERVER" ] || [ -z "$TOKEN" ]; then
    echo "Usage: $0 --server <server_url> --token <admin_token> [--name <server_name>]"
    exit 1
fi

NAME="${NAME:-$(hostname)}"

# Register with server
echo "Registering with server..."
RESPONSE=$(curl -s -X POST "${SERVER}/api/agent/register" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${NAME}\", \"location\": \"\", \"provider\": \"\"}")

SERVER_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
AGENT_TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SERVER_ID" ] || [ -z "$AGENT_TOKEN" ]; then
    echo "Failed to register agent: $RESPONSE"
    exit 1
fi

echo "Agent registered successfully!"
echo "Server ID: $SERVER_ID"
`

func (s *AppState) GetAgentScript(c *gin.Context) {
	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.String(http.StatusOK, AgentScript)
}

func (s *AppState) GetInstallCommand(c *gin.Context) {
	host := c.Request.Host
	protocol := "https"
	if host == "localhost" || host[:4] == "127." || host[:10] == "localhost:" {
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

// ============================================================================
// Health Check
// ============================================================================

func HealthCheck(c *gin.Context) {
	c.String(http.StatusOK, "OK")
}

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

type UpgradeServerResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Output  string `json:"output,omitempty"`
}

func UpgradeServer(c *gin.Context) {
	// Execute upgrade command
	cmd := exec.Command("bash", "-c", "curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- --upgrade")

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		c.JSON(http.StatusOK, UpgradeServerResponse{
			Success: false,
			Message: fmt.Sprintf("Upgrade failed: %v", err),
			Output:  outputStr,
		})
		return
	}

	c.JSON(http.StatusOK, UpgradeServerResponse{
		Success: true,
		Message: "Upgrade command executed successfully",
		Output:  outputStr,
	})
}

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
