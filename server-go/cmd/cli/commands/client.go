package commands

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client represents the vStats Cloud API client
type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

// NewClient creates a new API client
func NewClient() *Client {
	return &Client{
		BaseURL: cfg.CloudURL,
		Token:   cfg.Token,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// APIError represents an API error response
type APIError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// Do performs an HTTP request
func (c *Client) Do(method, path string, body interface{}, result interface{}) error {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.BaseURL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "vstats-cli/"+version)

	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode >= 400 {
		var apiErr APIError
		if err := json.Unmarshal(respBody, &apiErr); err == nil && apiErr.Error != "" {
			return fmt.Errorf("API error: %s", apiErr.Error)
		}
		return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	if result != nil {
		if err := json.Unmarshal(respBody, result); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}
	}

	return nil
}

// ============================================================================
// API Response Types
// ============================================================================

// User represents a user
type User struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	Email       *string `json:"email,omitempty"`
	AvatarURL   *string `json:"avatar_url,omitempty"`
	Plan        string  `json:"plan"`
	ServerLimit int     `json:"server_limit"`
	Status      string  `json:"status"`
}

// Server represents a server
type Server struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Hostname     *string        `json:"hostname,omitempty"`
	IPAddress    *string        `json:"ip_address,omitempty"`
	AgentKey     string         `json:"agent_key"`
	AgentVersion *string        `json:"agent_version,omitempty"`
	OSType       *string        `json:"os_type,omitempty"`
	OSVersion    *string        `json:"os_version,omitempty"`
	Status       string         `json:"status"`
	LastSeenAt   *time.Time     `json:"last_seen_at,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	Metrics      *ServerMetrics `json:"metrics,omitempty"`
}

// ServerMetrics represents server metrics
type ServerMetrics struct {
	CPUUsage     *float64 `json:"cpu_usage,omitempty"`
	CPUCores     *int     `json:"cpu_cores,omitempty"`
	LoadAvg1     *float64 `json:"load_avg_1,omitempty"`
	LoadAvg5     *float64 `json:"load_avg_5,omitempty"`
	LoadAvg15    *float64 `json:"load_avg_15,omitempty"`
	MemoryTotal  *int64   `json:"memory_total,omitempty"`
	MemoryUsed   *int64   `json:"memory_used,omitempty"`
	MemoryFree   *int64   `json:"memory_free,omitempty"`
	DiskTotal    *int64   `json:"disk_total,omitempty"`
	DiskUsed     *int64   `json:"disk_used,omitempty"`
	DiskFree     *int64   `json:"disk_free,omitempty"`
	ProcessCount *int     `json:"process_count,omitempty"`
}

// MetricsHistory represents historical metrics
type MetricsHistory struct {
	ServerID string        `json:"server_id"`
	Range    string        `json:"range"`
	Data     []MetricsData `json:"data"`
}

// MetricsData represents a single metrics data point
type MetricsData struct {
	CollectedAt time.Time `json:"collected_at"`
	CPUUsage    *float64  `json:"cpu_usage,omitempty"`
	MemoryUsed  *int64    `json:"memory_used,omitempty"`
	DiskUsed    *int64    `json:"disk_used,omitempty"`
}

// ============================================================================
// API Methods
// ============================================================================

// VerifyToken verifies the current token
func (c *Client) VerifyToken() (*VerifyResponse, error) {
	var resp VerifyResponse
	if err := c.Do("GET", "/api/auth/verify", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// VerifyResponse represents the verify token response
type VerifyResponse struct {
	Valid    bool   `json:"valid"`
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Plan     string `json:"plan"`
}

// GetCurrentUser gets the current user info
func (c *Client) GetCurrentUser() (*CurrentUserResponse, error) {
	var resp CurrentUserResponse
	if err := c.Do("GET", "/api/auth/me", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// CurrentUserResponse represents the current user response
type CurrentUserResponse struct {
	User        User `json:"user"`
	ServerCount int  `json:"server_count"`
	ServerLimit int  `json:"server_limit"`
}

// ListServers lists all servers
func (c *Client) ListServers() ([]Server, error) {
	var servers []Server
	if err := c.Do("GET", "/api/servers", nil, &servers); err != nil {
		return nil, err
	}
	return servers, nil
}

// CreateServer creates a new server
func (c *Client) CreateServer(name string) (*Server, error) {
	var server Server
	if err := c.Do("POST", "/api/servers", map[string]string{"name": name}, &server); err != nil {
		return nil, err
	}
	return &server, nil
}

// GetServer gets a server by ID
func (c *Client) GetServer(id string) (*Server, error) {
	var server Server
	if err := c.Do("GET", "/api/servers/"+id, nil, &server); err != nil {
		return nil, err
	}
	return &server, nil
}

// UpdateServer updates a server
func (c *Client) UpdateServer(id string, name string) (*Server, error) {
	var server Server
	if err := c.Do("PUT", "/api/servers/"+id, map[string]string{"name": name}, &server); err != nil {
		return nil, err
	}
	return &server, nil
}

// DeleteServer deletes a server
func (c *Client) DeleteServer(id string) error {
	return c.Do("DELETE", "/api/servers/"+id, nil, nil)
}

// RegenerateAgentKey regenerates the agent key for a server
func (c *Client) RegenerateAgentKey(id string) (*AgentKeyResponse, error) {
	var resp AgentKeyResponse
	if err := c.Do("POST", "/api/servers/"+id+"/regenerate-key", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// AgentKeyResponse represents the agent key response
type AgentKeyResponse struct {
	AgentKey string `json:"agent_key"`
}

// GetInstallCommand gets the agent installation command
func (c *Client) GetInstallCommand(id string) (*InstallCommandResponse, error) {
	var resp InstallCommandResponse
	if err := c.Do("GET", "/api/servers/"+id+"/install-command", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// InstallCommandResponse represents the install command response
type InstallCommandResponse struct {
	Command  string `json:"command"`
	AgentKey string `json:"agent_key"`
}

// GetServerMetrics gets the latest metrics for a server
func (c *Client) GetServerMetrics(id string) (*MetricsResponse, error) {
	var resp MetricsResponse
	if err := c.Do("GET", "/api/servers/"+id+"/metrics", nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// MetricsResponse represents the metrics response
type MetricsResponse struct {
	Metrics *ServerMetrics `json:"metrics"`
}

// GetServerHistory gets the metrics history for a server
func (c *Client) GetServerHistory(id string, rangeStr string) (*MetricsHistory, error) {
	var resp MetricsHistory
	path := "/api/servers/" + id + "/history"
	if rangeStr != "" {
		path += "?range=" + rangeStr
	}
	if err := c.Do("GET", path, nil, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}
