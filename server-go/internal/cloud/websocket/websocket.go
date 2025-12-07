package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"vstats/internal/cloud/database"
	"vstats/internal/cloud/models"
	"vstats/internal/cloud/redis"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for now
	},
}

// ============================================================================
// Hub - manages all WebSocket connections
// ============================================================================

type Hub struct {
	// Agent connections (key: server agent_key)
	agentConns   map[string]*AgentConn
	agentConnsMu sync.RWMutex

	// Dashboard connections (key: connection ID)
	dashboardConns   map[string]*DashboardConn
	dashboardConnsMu sync.RWMutex

	// Broadcast channels
	agentBroadcast     chan *AgentMessage
	dashboardBroadcast chan *DashboardMessage

	// User's dashboard connections (key: user_id)
	userDashboards   map[string]map[string]*DashboardConn
	userDashboardsMu sync.RWMutex
}

type AgentConn struct {
	Conn      *websocket.Conn
	ServerID  string
	AgentKey  string
	UserID    string
	SendChan  chan []byte
	CloseChan chan struct{}
}

type DashboardConn struct {
	Conn      *websocket.Conn
	ConnID    string
	UserID    string
	SendChan  chan []byte
	CloseChan chan struct{}
}

type AgentMessage struct {
	Type     string          `json:"type"`
	ServerID string          `json:"server_id,omitempty"`
	AgentKey string          `json:"agent_key,omitempty"`
	Metrics  json.RawMessage `json:"metrics,omitempty"`
	Version  string          `json:"version,omitempty"`
	Hostname string          `json:"hostname,omitempty"`
	OS       string          `json:"os,omitempty"`
	IP       string          `json:"ip,omitempty"`
}

type DashboardMessage struct {
	Type      string      `json:"type"`
	Timestamp int64       `json:"ts,omitempty"`
	Data      interface{} `json:"data,omitempty"`
}

var hub *Hub

// InitHub initializes the WebSocket hub
func InitHub() *Hub {
	hub = &Hub{
		agentConns:         make(map[string]*AgentConn),
		dashboardConns:     make(map[string]*DashboardConn),
		agentBroadcast:     make(chan *AgentMessage, 256),
		dashboardBroadcast: make(chan *DashboardMessage, 256),
		userDashboards:     make(map[string]map[string]*DashboardConn),
	}

	go hub.runBroadcastLoop()

	return hub
}

// GetHub returns the global hub instance
func GetHub() *Hub {
	return hub
}

func (h *Hub) runBroadcastLoop() {
	for {
		select {
		case msg := <-h.dashboardBroadcast:
			h.broadcastToDashboards(msg)
		}
	}
}

func (h *Hub) broadcastToDashboards(msg *DashboardMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.dashboardConnsMu.RLock()
	defer h.dashboardConnsMu.RUnlock()

	for _, conn := range h.dashboardConns {
		select {
		case conn.SendChan <- data:
		default:
			// Channel full, skip
		}
	}
}

// BroadcastToUser sends message to specific user's dashboards
func (h *Hub) BroadcastToUser(userID string, msg *DashboardMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.userDashboardsMu.RLock()
	defer h.userDashboardsMu.RUnlock()

	if conns, ok := h.userDashboards[userID]; ok {
		for _, conn := range conns {
			select {
			case conn.SendChan <- data:
			default:
			}
		}
	}
}

// ============================================================================
// Agent WebSocket Handler
// ============================================================================

func HandleAgentWS(c *gin.Context) {
	agentKey := c.Query("key")
	if agentKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Agent key required"})
		return
	}

	ctx := context.Background()

	// Verify agent key
	server, err := database.GetServerByAgentKey(ctx, agentKey)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid agent key"})
		return
	}

	// Upgrade connection
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	agentConn := &AgentConn{
		Conn:      conn,
		ServerID:  server.ID,
		AgentKey:  agentKey,
		UserID:    server.UserID,
		SendChan:  make(chan []byte, 64),
		CloseChan: make(chan struct{}),
	}

	hub.agentConnsMu.Lock()
	hub.agentConns[agentKey] = agentConn
	hub.agentConnsMu.Unlock()

	// Update server status
	database.UpdateServerStatus(ctx, server.ID, "online")
	redis.SetServerLive(ctx, server.ID, &redis.ServerLiveData{
		ServerID:   server.ID,
		Status:     "online",
		LastSeenAt: time.Now(),
	})

	// Notify user's dashboards
	hub.BroadcastToUser(server.UserID, &DashboardMessage{
		Type:      "server_online",
		Timestamp: time.Now().Unix(),
		Data:      gin.H{"server_id": server.ID},
	})

	log.Printf("Agent connected: %s (server: %s)", agentKey[:8], server.Name)

	// Handle connection
	go agentConn.writePump()
	agentConn.readPump()
}

func (ac *AgentConn) readPump() {
	defer func() {
		hub.agentConnsMu.Lock()
		delete(hub.agentConns, ac.AgentKey)
		hub.agentConnsMu.Unlock()

		ctx := context.Background()
		database.UpdateServerStatus(ctx, ac.ServerID, "offline")
		redis.DeleteServerLive(ctx, ac.ServerID)

		hub.BroadcastToUser(ac.UserID, &DashboardMessage{
			Type:      "server_offline",
			Timestamp: time.Now().Unix(),
			Data:      gin.H{"server_id": ac.ServerID},
		})

		close(ac.CloseChan)
		ac.Conn.Close()
		log.Printf("Agent disconnected: %s", ac.AgentKey[:8])
	}()

	ac.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	ac.Conn.SetPongHandler(func(string) error {
		ac.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := ac.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Agent read error: %v", err)
			}
			break
		}

		var msg AgentMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}

		ac.handleMessage(&msg)
	}
}

func (ac *AgentConn) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		ac.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-ac.SendChan:
			if !ok {
				ac.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := ac.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			if err := ac.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-ac.CloseChan:
			return
		}
	}
}

func (ac *AgentConn) handleMessage(msg *AgentMessage) {
	ctx := context.Background()

	switch msg.Type {
	case "metrics":
		// Update live status in Redis
		redis.SetServerLive(ctx, ac.ServerID, &redis.ServerLiveData{
			ServerID:   ac.ServerID,
			Status:     "online",
			LastSeenAt: time.Now(),
			Metrics:    msg.Metrics,
		})

		// Store metrics in database (periodically)
		var metrics models.ServerMetrics
		if err := json.Unmarshal(msg.Metrics, &metrics); err == nil {
			metrics.ServerID = ac.ServerID
			metrics.CollectedAt = time.Now()
			database.InsertServerMetrics(ctx, &metrics)
		}

		// Broadcast to user's dashboards
		hub.BroadcastToUser(ac.UserID, &DashboardMessage{
			Type:      "metrics",
			Timestamp: time.Now().Unix(),
			Data: gin.H{
				"server_id": ac.ServerID,
				"metrics":   msg.Metrics,
			},
		})

	case "info":
		// Update server info
		server, err := database.GetServerByID(ctx, ac.ServerID)
		if err == nil {
			if msg.Hostname != "" {
				server.Hostname = &msg.Hostname
			}
			if msg.Version != "" {
				server.AgentVersion = &msg.Version
			}
			if msg.OS != "" {
				server.OSType = &msg.OS
			}
			if msg.IP != "" {
				server.IPAddress = &msg.IP
			}
			database.UpdateServer(ctx, server)
		}
	}
}

// ============================================================================
// Dashboard WebSocket Handler
// ============================================================================

func HandleDashboardWS(c *gin.Context, userID string) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	connID := time.Now().Format("20060102150405") + "-" + userID[:8]

	dashConn := &DashboardConn{
		Conn:      conn,
		ConnID:    connID,
		UserID:    userID,
		SendChan:  make(chan []byte, 64),
		CloseChan: make(chan struct{}),
	}

	// Register connection
	hub.dashboardConnsMu.Lock()
	hub.dashboardConns[connID] = dashConn
	hub.dashboardConnsMu.Unlock()

	hub.userDashboardsMu.Lock()
	if hub.userDashboards[userID] == nil {
		hub.userDashboards[userID] = make(map[string]*DashboardConn)
	}
	hub.userDashboards[userID][connID] = dashConn
	hub.userDashboardsMu.Unlock()

	ctx := context.Background()
	redis.AddWSConnection(ctx, "dashboard", connID, userID)

	log.Printf("Dashboard connected: %s (user: %s)", connID, userID[:8])

	// Send initial state
	go dashConn.sendInitialState()
	go dashConn.writePump()
	dashConn.readPump()
}

func (dc *DashboardConn) sendInitialState() {
	ctx := context.Background()

	// Get user's servers with live status
	servers, _ := database.GetServersByUserID(ctx, dc.UserID)
	liveServers, _ := redis.GetAllLiveServers(ctx)

	var serverData []gin.H
	for _, server := range servers {
		data := gin.H{
			"id":            server.ID,
			"name":          server.Name,
			"status":        server.Status,
			"last_seen_at":  server.LastSeenAt,
			"agent_version": server.AgentVersion,
		}

		if live, ok := liveServers[server.ID]; ok {
			data["status"] = live.Status
			data["last_seen_at"] = live.LastSeenAt
			data["metrics"] = live.Metrics
		}

		serverData = append(serverData, data)
	}

	msg := &DashboardMessage{
		Type:      "init",
		Timestamp: time.Now().Unix(),
		Data:      gin.H{"servers": serverData},
	}

	data, _ := json.Marshal(msg)
	select {
	case dc.SendChan <- data:
	default:
	}
}

func (dc *DashboardConn) readPump() {
	defer func() {
		hub.dashboardConnsMu.Lock()
		delete(hub.dashboardConns, dc.ConnID)
		hub.dashboardConnsMu.Unlock()

		hub.userDashboardsMu.Lock()
		if conns, ok := hub.userDashboards[dc.UserID]; ok {
			delete(conns, dc.ConnID)
			if len(conns) == 0 {
				delete(hub.userDashboards, dc.UserID)
			}
		}
		hub.userDashboardsMu.Unlock()

		ctx := context.Background()
		redis.RemoveWSConnection(ctx, "dashboard", dc.ConnID)

		close(dc.CloseChan)
		dc.Conn.Close()
		log.Printf("Dashboard disconnected: %s", dc.ConnID)
	}()

	dc.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	dc.Conn.SetPongHandler(func(string) error {
		dc.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := dc.Conn.ReadMessage()
		if err != nil {
			break
		}
		// Dashboard messages are ignored for now
	}
}

func (dc *DashboardConn) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		dc.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-dc.SendChan:
			if !ok {
				dc.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := dc.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			if err := dc.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}

		case <-dc.CloseChan:
			return
		}
	}
}
