package handlers

import (
	"context"
	"net/http"
	"time"

	"vstats/internal/cloud/database"
	"vstats/internal/cloud/middleware"
	"vstats/internal/cloud/models"
	"vstats/internal/cloud/redis"

	"github.com/gin-gonic/gin"
)

// ============================================================================
// Server Management Handlers
// ============================================================================

// ListServers returns all servers for the current user
func ListServers(c *gin.Context) {
	userID := middleware.GetUserID(c)
	ctx := context.Background()

	servers, err := database.GetServersByUserID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch servers"})
		return
	}

	// Get live status from Redis
	liveServers, _ := redis.GetAllLiveServers(ctx)

	// Merge live status
	result := make([]gin.H, 0, len(servers))
	for _, server := range servers {
		serverData := gin.H{
			"id":            server.ID,
			"name":          server.Name,
			"hostname":      server.Hostname,
			"ip_address":    server.IPAddress,
			"agent_key":     server.AgentKey,
			"agent_version": server.AgentVersion,
			"os_type":       server.OSType,
			"os_version":    server.OSVersion,
			"status":        server.Status,
			"last_seen_at":  server.LastSeenAt,
			"created_at":    server.CreatedAt,
		}

		// Add live data if available
		if live, ok := liveServers[server.ID]; ok {
			serverData["status"] = live.Status
			serverData["last_seen_at"] = live.LastSeenAt
			serverData["metrics"] = live.Metrics
		}

		result = append(result, serverData)
	}

	c.JSON(http.StatusOK, result)
}

// CreateServer creates a new server
func CreateServer(c *gin.Context) {
	userID := middleware.GetUserID(c)
	ctx := context.Background()

	// Check server limit
	user, err := database.GetUserByID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get user"})
		return
	}

	serverCount, _ := database.CountServersByUserID(ctx, userID)
	if serverCount >= user.ServerLimit {
		c.JSON(http.StatusForbidden, gin.H{
			"error":        "Server limit reached",
			"current":      serverCount,
			"limit":        user.ServerLimit,
			"upgrade_hint": "Upgrade your plan to add more servers",
		})
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	server := &models.Server{
		UserID:   userID,
		Name:     req.Name,
		Metadata: []byte("{}"),
	}

	if err := database.CreateServer(ctx, server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create server"})
		return
	}

	c.JSON(http.StatusCreated, server)
}

// GetServer returns a single server
func GetServer(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	// Verify ownership
	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Get live status
	live, _ := redis.GetServerLive(ctx, serverID)
	result := gin.H{
		"id":            server.ID,
		"name":          server.Name,
		"hostname":      server.Hostname,
		"ip_address":    server.IPAddress,
		"agent_key":     server.AgentKey,
		"agent_version": server.AgentVersion,
		"os_type":       server.OSType,
		"os_version":    server.OSVersion,
		"status":        server.Status,
		"last_seen_at":  server.LastSeenAt,
		"metadata":      server.Metadata,
		"created_at":    server.CreatedAt,
		"updated_at":    server.UpdatedAt,
	}

	if live != nil {
		result["status"] = live.Status
		result["last_seen_at"] = live.LastSeenAt
		result["metrics"] = live.Metrics
	}

	c.JSON(http.StatusOK, result)
}

// UpdateServer updates a server
func UpdateServer(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var req struct {
		Name *string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.Name != nil {
		server.Name = *req.Name
	}

	if err := database.UpdateServer(ctx, server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update server"})
		return
	}

	c.JSON(http.StatusOK, server)
}

// DeleteServer deletes a server
func DeleteServer(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := database.DeleteServer(ctx, serverID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete server"})
		return
	}

	// Clean up Redis
	redis.DeleteServerLive(ctx, serverID)

	c.JSON(http.StatusOK, gin.H{"message": "Server deleted"})
}

// RegenerateAgentKey generates a new agent key for a server
func RegenerateAgentKey(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	server.AgentKey = database.GenerateAgentKey()
	if err := database.UpdateServer(ctx, server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to regenerate key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"agent_key": server.AgentKey,
	})
}

// GetInstallCommand returns the agent installation command
func GetInstallCommand(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// _ := middleware.GetUserPlan(c) // Use config for cloud URL

	// Generate install command
	command := `curl -fsSL https://vstats.zsoft.cc/agent.sh | sudo bash -s -- --cloud --key "` + server.AgentKey + `"`

	c.JSON(http.StatusOK, gin.H{
		"command":   command,
		"agent_key": server.AgentKey,
	})
}

// ============================================================================
// Metrics Handlers
// ============================================================================

// GetServerMetrics returns metrics for a server
func GetServerMetrics(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Get latest metrics
	metrics, err := database.GetLatestMetrics(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"metrics": nil})
		return
	}

	c.JSON(http.StatusOK, gin.H{"metrics": metrics})
}

// GetServerHistory returns metrics history for a server
func GetServerHistory(c *gin.Context) {
	userID := middleware.GetUserID(c)
	serverID := c.Param("id")
	rangeStr := c.DefaultQuery("range", "1h")
	ctx := context.Background()

	server, err := database.GetServerByID(ctx, serverID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	if server.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Parse range
	var since time.Time
	var limit int
	switch rangeStr {
	case "1h":
		since = time.Now().Add(-1 * time.Hour)
		limit = 60
	case "24h":
		since = time.Now().Add(-24 * time.Hour)
		limit = 288
	case "7d":
		since = time.Now().Add(-7 * 24 * time.Hour)
		limit = 336
	case "30d":
		since = time.Now().Add(-30 * 24 * time.Hour)
		limit = 720
	default:
		since = time.Now().Add(-1 * time.Hour)
		limit = 60
	}

	history, err := database.GetMetricsHistory(ctx, serverID, since, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch history"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"server_id": serverID,
		"range":     rangeStr,
		"data":      history,
	})
}
