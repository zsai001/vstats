package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

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
			ServerID:     server.ID,
			ServerName:   server.Name,
			Location:     server.Location,
			Provider:     server.Provider,
			Tag:          server.Tag,
			GroupID:      server.GroupID,
			Version:      version,
			IP:           server.IP,
			Online:       online,
			Metrics:      metrics,
			PriceAmount:  server.PriceAmount,
			PricePeriod:  server.PricePeriod,
			PurchaseDate: server.PurchaseDate,
			TipBadge:     server.TipBadge,
		})
	}

	c.JSON(http.StatusOK, updates)
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
// Health Check
// ============================================================================

func HealthCheck(c *gin.Context) {
	c.String(http.StatusOK, "OK")
}

// ============================================================================
// Online Users Handler
// ============================================================================

type OnlineUsersResponse struct {
	Count int `json:"count"`
}

func (s *AppState) GetOnlineUsers(c *gin.Context) {
	count := s.GetOnlineUsersCount()
	c.JSON(http.StatusOK, OnlineUsersResponse{Count: count})
}
