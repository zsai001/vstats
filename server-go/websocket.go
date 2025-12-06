package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// ============================================================================
// Dashboard WebSocket Handler
// ============================================================================

func (s *AppState) HandleDashboardWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Get client IP
	clientIP := c.ClientIP()

	// Register client with IP
	s.DashboardMu.Lock()
	s.DashboardClients[conn] = &DashboardClient{
		Conn: conn,
		IP:   clientIP,
	}
	s.DashboardMu.Unlock()

	// Unregister on exit
	defer func() {
		s.DashboardMu.Lock()
		delete(s.DashboardClients, conn)
		s.DashboardMu.Unlock()
	}()

	// Send initial state
	s.sendInitialState(conn)

	// Handle incoming messages
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (s *AppState) sendInitialState(conn *websocket.Conn) {
	s.ConfigMu.RLock()
	config := s.Config
	s.ConfigMu.RUnlock()

	s.AgentMetricsMu.RLock()
	agentMetrics := make(map[string]*AgentMetricsData)
	for k, v := range s.AgentMetrics {
		agentMetrics[k] = v
	}
	s.AgentMetricsMu.RUnlock()

	// Collect local metrics
	localMetrics := CollectMetrics()

	var updates []ServerMetricsUpdate

	// Add local node
	localNode := config.LocalNode
	localName := "Dashboard Server"
	if localNode.Name != "" {
		localName = localNode.Name
	}
	provider := "Local"
	if localNode.Provider != "" {
		provider = localNode.Provider
	}

	updates = append(updates, ServerMetricsUpdate{
		ServerID:     "local",
		ServerName:   localName,
		Location:     localNode.Location,
		Provider:     provider,
		Tag:          localNode.Tag,
		GroupID:      localNode.GroupID,
		GroupValues:  localNode.GroupValues,
		Version:      ServerVersion,
		IP:           "",
		Online:       true,
		Metrics:      &localMetrics,
		PriceAmount:  localNode.PriceAmount,
		PricePeriod:  localNode.PricePeriod,
		PurchaseDate: localNode.PurchaseDate,
		TipBadge:     localNode.TipBadge,
	})

	// Add remote servers
	for _, server := range config.Servers {
		metricsData := agentMetrics[server.ID]
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
			GroupValues:  server.GroupValues,
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

	msg := DashboardMessage{
		Type:            "metrics",
		Servers:         updates,
		Groups:          config.Groups,
		GroupDimensions: config.GroupDimensions,
		SiteSettings:    &config.SiteSettings,
	}

	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)
}

func (s *AppState) BroadcastMetrics(msg string) {
	s.DashboardMu.RLock()
	defer s.DashboardMu.RUnlock()

	for conn, client := range s.DashboardClients {
		if client != nil && client.Conn != nil {
			if err := conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
				delete(s.DashboardClients, conn)
				conn.Close()
			}
		}
	}
}

// ============================================================================
// Agent WebSocket Handler
// ============================================================================

func (s *AppState) HandleAgentWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	clientIP := c.ClientIP()
	var authenticatedServerID string

	// Create channel for sending commands
	sendChan := make(chan []byte, 16)
	done := make(chan struct{})

	// Goroutine to send commands to agent
	go func() {
		for {
			select {
			case msg := <-sendChan:
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					log.Printf("Failed to send message to agent: %v", err)
					return
				}
			case <-done:
				return
			}
		}
	}()

	// Handle incoming messages
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var agentMsg AgentMessage
		if err := json.Unmarshal(message, &agentMsg); err != nil {
			continue
		}

		switch agentMsg.Type {
		case "auth":
			if agentMsg.ServerID != "" && agentMsg.Token != "" {
				s.ConfigMu.Lock()
				var server *RemoteServer
				for i := range s.Config.Servers {
					if s.Config.Servers[i].ID == agentMsg.ServerID {
						if s.Config.Servers[i].Token == agentMsg.Token {
							server = &s.Config.Servers[i]
							authenticatedServerID = agentMsg.ServerID

							// Update version
							if agentMsg.Version != "" && server.Version != agentMsg.Version {
								server.Version = agentMsg.Version
								SaveConfig(s.Config)
							}

							// Register connection
							s.AgentConnsMu.Lock()
							s.AgentConns[agentMsg.ServerID] = &AgentConnection{
								Conn:     conn,
								SendChan: sendChan,
							}
							s.AgentConnsMu.Unlock()

							// Send auth success with probe config
							response := map[string]interface{}{
								"type":  "auth",
								"status": "ok",
							}
							if len(s.Config.ProbeSettings.PingTargets) > 0 {
								response["ping_targets"] = s.Config.ProbeSettings.PingTargets
							}
							data, _ := json.Marshal(response)
							conn.WriteMessage(websocket.TextMessage, data)
							log.Printf("Agent %s authenticated", agentMsg.ServerID)
						} else {
							conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","status":"error","message":"Invalid token"}`))
						}
						break
					}
				}
				if server == nil {
					conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"auth","status":"error","message":"Server not found"}`))
				}
				s.ConfigMu.Unlock()
			}

		case "metrics":
			if authenticatedServerID != "" && agentMsg.Metrics != nil {
				// Store to database
				if s.DB != nil {
					go StoreMetrics(s.DB, authenticatedServerID, agentMsg.Metrics)
				}

				// Determine IP address
				agentIP := clientIP
				if len(agentMsg.Metrics.IPAddresses) > 0 {
					agentIP = agentMsg.Metrics.IPAddresses[0]
				}

				// Update version and IP in config
				s.ConfigMu.Lock()
				for i := range s.Config.Servers {
					if s.Config.Servers[i].ID == authenticatedServerID {
						changed := false
						if agentMsg.Metrics.Version != "" && s.Config.Servers[i].Version != agentMsg.Metrics.Version {
							s.Config.Servers[i].Version = agentMsg.Metrics.Version
							changed = true
						}
						if s.Config.Servers[i].IP != agentIP {
							s.Config.Servers[i].IP = agentIP
							changed = true
						}
						if changed {
							SaveConfig(s.Config)
						}
						break
					}
				}
				s.ConfigMu.Unlock()

				// Update in-memory state
				s.AgentMetricsMu.Lock()
				s.AgentMetrics[authenticatedServerID] = &AgentMetricsData{
					ServerID:    authenticatedServerID,
					Metrics:     *agentMsg.Metrics,
					LastUpdated: time.Now(),
				}
				s.AgentMetricsMu.Unlock()
			} else {
				conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"error","message":"Not authenticated"}`))
			}
		}
	}

	// Cleanup on disconnect
	close(done) // Stop the send goroutine
	if authenticatedServerID != "" {
		log.Printf("Agent %s disconnected", authenticatedServerID)
		s.AgentConnsMu.Lock()
		delete(s.AgentConns, authenticatedServerID)
		s.AgentConnsMu.Unlock()
	}
}


