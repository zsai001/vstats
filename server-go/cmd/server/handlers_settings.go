package main

import (
	"encoding/json"
	"log"
	"net/http"

	"vstats/internal/common"

	"github.com/gin-gonic/gin"
)

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

	// Broadcast the updated settings to all connected dashboard clients
	s.BroadcastSiteSettings(&settings)

	c.Status(http.StatusOK)
}

// BroadcastSiteSettings sends updated site settings (including theme) to all connected clients
func (s *AppState) BroadcastSiteSettings(settings *SiteSettings) {
	msg := map[string]interface{}{
		"type":          "site_settings",
		"site_settings": settings,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal site settings: %v", err)
		return
	}

	s.DashboardMu.RLock()
	defer s.DashboardMu.RUnlock()

	for conn := range s.DashboardClients {
		if err := conn.WriteMessage(1, data); err != nil {
			log.Printf("Failed to broadcast site settings: %v", err)
		}
	}
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

	// Update local collector's ping targets
	localCollector := GetLocalCollector()
	localCollector.SetPingTargets(settings.PingTargets)

	// Broadcast new ping targets to all connected agents
	s.BroadcastPingTargets(settings.PingTargets)

	c.Status(http.StatusOK)
}

// BroadcastPingTargets sends updated ping targets to all connected agents
func (s *AppState) BroadcastPingTargets(targets []common.PingTargetConfig) {
	msg := map[string]interface{}{
		"type":         "config",
		"ping_targets": targets,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal ping targets: %v", err)
		return
	}

	s.AgentConnsMu.RLock()
	defer s.AgentConnsMu.RUnlock()

	for serverID, conn := range s.AgentConns {
		select {
		case conn.SendChan <- data:
			log.Printf("Sent ping targets update to agent %s", serverID)
		default:
			log.Printf("Failed to send ping targets to agent %s (channel full)", serverID)
		}
	}
}
