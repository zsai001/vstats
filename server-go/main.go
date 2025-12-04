package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// Version will be set at build time via -ldflags
var ServerVersion = "dev"

func main() {
	// Check for command line arguments
	args := os.Args[1:]

	if len(args) > 0 {
		switch args[0] {
		case "version", "--version", "-v":
			fmt.Printf("vstats-server version %s\n", ServerVersion)
			os.Exit(0)
		case "--check":
			showDiagnostics()
			return
		case "--reset-password":
			password := ResetAdminPassword()
			fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
			fmt.Println("║                    🔑 PASSWORD RESET                           ║")
			fmt.Println("╠════════════════════════════════════════════════════════════════╣")
			fmt.Printf("║  New admin password: %-40s ║\n", password)
			fmt.Printf("║  Config file: %-47s ║\n", GetConfigPath())
			fmt.Println("╚════════════════════════════════════════════════════════════════╝\n")
			return
		}
	}

	// Initialize database
	db, err := InitDatabase()
	if err != nil {
		fmt.Printf("Failed to initialize database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	fmt.Printf("📦 Database initialized: %s\n", GetDBPath())
	fmt.Printf("⚙️  Config file: %s\n", GetConfigPath())

	// Load config
	config, initialPassword := LoadConfig()
	if initialPassword != nil {
		fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
		fmt.Println("║              🎉 FIRST RUN - SAVE YOUR PASSWORD!               ║")
		fmt.Println("╠════════════════════════════════════════════════════════════════╣")
		fmt.Printf("║  Admin password: %-44s ║\n", *initialPassword)
		fmt.Println("║                                                                ║")
		fmt.Println("║  ⚠️  Save this password! It won't be shown again.              ║")
		fmt.Println("║  To reset: ./vstats-server --reset-password                    ║")
		fmt.Println("╚════════════════════════════════════════════════════════════════╝")
	}

	// Create app state
	state := &AppState{
		Config:           config,
		MetricsBroadcast: make(chan string, 16),
		AgentMetrics:     make(map[string]*AgentMetricsData),
		AgentConns:       make(map[string]*AgentConnection),
		LastSent: &LastSentState{
			Servers: make(map[string]*struct {
				Online  bool
				Metrics *CompactMetrics
			}),
		},
		DashboardClients: make(map[*websocket.Conn]bool),
		DB:               db,
	}

	// Start background tasks
	go metricsBroadcastLoop(state)
	go aggregationLoop(state, db)
	go cleanupLoop(db)

	// Setup routes
	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "*")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Public routes
	r.GET("/health", HealthCheck)
	r.GET("/api/metrics", state.GetMetrics)
	r.GET("/api/metrics/all", state.GetAllMetrics)
	r.GET("/api/history/:server_id", func(c *gin.Context) {
		state.GetHistory(c, db)
	})
	r.GET("/api/servers", state.GetServers)
	r.GET("/api/settings/site", state.GetSiteSettings)
	r.POST("/api/auth/login", state.Login)
	r.GET("/api/auth/verify", AuthMiddleware(), state.VerifyToken)
	r.GET("/api/install-command", AuthMiddleware(), state.GetInstallCommand)
	r.GET("/api/version", GetServerVersion)
	r.GET("/version", GetServerVersion)
	r.GET("/api/version/check", CheckLatestVersion)
	// agent.sh is now served as static file, but keep handler as fallback
	r.GET("/agent.sh", state.GetAgentScript)
	r.GET("/ws", state.HandleDashboardWS)
	r.GET("/ws/agent", state.HandleAgentWS)

	// Protected routes
	protected := r.Group("/")
	protected.Use(AuthMiddleware())
	{
		protected.POST("/api/servers", state.AddServer)
		protected.DELETE("/api/servers/:id", state.DeleteServer)
		protected.PUT("/api/servers/:id", state.UpdateServer)
		protected.POST("/api/servers/:id/update", state.UpdateAgent)
		protected.POST("/api/auth/password", state.ChangePassword)
		protected.POST("/api/agent/register", state.RegisterAgent)
		protected.PUT("/api/settings/site", state.UpdateSiteSettings)
		protected.GET("/api/settings/local-node", state.GetLocalNodeConfig)
		protected.PUT("/api/settings/local-node", state.UpdateLocalNodeConfig)
		protected.GET("/api/settings/probe", state.GetProbeSettings)
		protected.PUT("/api/settings/probe", state.UpdateProbeSettings)
		protected.POST("/api/server/upgrade", UpgradeServer)
	}

	// Static file serving
	webDir := getWebDir()
	if webDir != "" {
		// Serve static files from web directory
		r.Static("/assets", webDir+"/assets")
		r.Static("/logos", webDir+"/logos") // Serve logo files
		r.StaticFile("/favicon.ico", webDir+"/favicon.ico")
		r.StaticFile("/vite.svg", webDir+"/vite.svg")
		// Serve agent.sh script from web directory
		r.StaticFile("/agent.sh", webDir+"/agent.sh")
		r.GET("/", func(c *gin.Context) {
			c.File(webDir + "/index.html")
		})
		r.NoRoute(func(c *gin.Context) {
			// For SPA, serve index.html for all non-API routes
			if !strings.HasPrefix(c.Request.URL.Path, "/api") && 
			   !strings.HasPrefix(c.Request.URL.Path, "/ws") &&
			   !strings.HasPrefix(c.Request.URL.Path, "/agent.sh") &&
			   !strings.HasPrefix(c.Request.URL.Path, "/logos") &&
			   !strings.HasPrefix(c.Request.URL.Path, "/assets") {
				c.File(webDir + "/index.html")
			} else {
				c.Status(404)
			}
		})
	} else {
		// Fallback to embedded HTML
		r.NoRoute(func(c *gin.Context) {
			if c.Request.URL.Path == "/" || c.Request.URL.Path == "/index.html" {
				c.Header("Content-Type", "text/html")
				c.String(200, embeddedIndexHTML)
				return
			}
			c.Status(404)
		})
	}

	port := os.Getenv("VSTATS_PORT")
	if port == "" {
		port = "3001"
	}

	fmt.Printf("🚀 Server running on http://0.0.0.0:%s\n", port)
	fmt.Printf("📡 Agent WebSocket: ws://0.0.0.0:%s/ws/agent\n", port)
	fmt.Printf("🔑 Reset password: ./vstats-server --reset-password\n")

	if err := r.Run(":" + port); err != nil {
		fmt.Printf("Failed to start server: %v\n", err)
		os.Exit(1)
	}
}

func showDiagnostics() {
	configPath := GetConfigPath()
	dbPath := GetDBPath()

	fmt.Println("\n╔════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                    🔍 DIAGNOSTICS                              ║")
	fmt.Println("╠════════════════════════════════════════════════════════════════╣")

	exe, _ := os.Executable()
	fmt.Printf("║  Executable: %-48s ║\n", exe)
	fmt.Printf("║  Config: %-52s ║\n", configPath)
	fmt.Printf("║  Config exists: %-45s ║\n", boolToStr(fileExists(configPath)))
	fmt.Printf("║  Database: %-50s ║\n", dbPath)
	fmt.Printf("║  Database exists: %-43s ║\n", boolToStr(fileExists(dbPath)))

	if fileExists(configPath) {
		data, err := os.ReadFile(configPath)
		if err == nil {
			var config map[string]interface{}
			if json.Unmarshal(data, &config) == nil {
				hash, _ := config["admin_password_hash"].(string)
				hasHash := hash != "" && (hash[:3] == "$2a" || hash[:3] == "$2b")
				fmt.Printf("║  Password hash valid: %-39s ║\n", boolToStr(hasHash))

				servers, _ := config["servers"].([]interface{})
				fmt.Printf("║  Servers configured: %-40d ║\n", len(servers))
			}
		}
	}

	fmt.Println("╚════════════════════════════════════════════════════════════════╝\n")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func boolToStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func metricsBroadcastLoop(state *AppState) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		state.ConfigMu.RLock()
		config := state.Config
		state.ConfigMu.RUnlock()

		state.AgentMetricsMu.RLock()
		agentMetrics := make(map[string]*AgentMetricsData)
		for k, v := range state.AgentMetrics {
			agentMetrics[k] = v
		}
		state.AgentMetricsMu.RUnlock()

		// Collect local metrics
		localMetrics := CollectMetrics()

		// Build compact delta updates
		var deltaUpdates []CompactServerUpdate

		// Check local server
		localCompact := CompactMetricsFromSystem(&localMetrics)
		state.LastSentMu.Lock()
		localPrev := state.LastSent.Servers["local"]
		state.LastSentMu.Unlock()

		localChanged := localPrev == nil || localCompact.HasChanged(localPrev.Metrics)
		if localChanged {
			var diffMetrics *CompactMetrics
			if localPrev != nil {
				diffMetrics = localCompact.Diff(localPrev.Metrics)
			} else {
				diffMetrics = localCompact
			}

			if !diffMetrics.IsEmpty() {
				deltaUpdates = append(deltaUpdates, CompactServerUpdate{
					ID: "local",
					On: boolPtr(true),
					M:  diffMetrics,
				})
			}

			state.LastSentMu.Lock()
			state.LastSent.Servers["local"] = &struct {
				Online  bool
				Metrics *CompactMetrics
			}{
				Online:  true,
				Metrics: localCompact,
			}
			state.LastSentMu.Unlock()
		}

		// Check remote servers
		for _, server := range config.Servers {
			metricsData := agentMetrics[server.ID]
			online := false
			if metricsData != nil {
				online = time.Since(metricsData.LastUpdated).Seconds() < 30
			}

			currentMetrics := &CompactMetrics{}
			if metricsData != nil {
				currentMetrics = CompactMetricsFromSystem(&metricsData.Metrics)
			}

			state.LastSentMu.Lock()
			prev := state.LastSent.Servers[server.ID]
			state.LastSentMu.Unlock()

			prevOnline := false
			var prevMetrics *CompactMetrics
			if prev != nil {
				prevOnline = prev.Online
				prevMetrics = prev.Metrics
			} else {
				prevMetrics = &CompactMetrics{}
			}

			onlineChanged := online != prevOnline
			metricsChanged := online && currentMetrics.HasChanged(prevMetrics)

			if onlineChanged || metricsChanged {
				update := CompactServerUpdate{
					ID: server.ID,
				}

				if onlineChanged {
					update.On = &online
				}

				if metricsChanged && online {
					update.M = currentMetrics.Diff(prevMetrics)
				}

				if update.On != nil || (update.M != nil && !update.M.IsEmpty()) {
					deltaUpdates = append(deltaUpdates, update)
				}

				state.LastSentMu.Lock()
				state.LastSent.Servers[server.ID] = &struct {
					Online  bool
					Metrics *CompactMetrics
				}{
					Online:  online,
					Metrics: currentMetrics,
				}
				state.LastSentMu.Unlock()
			}
		}

		// Broadcast if there are changes
		if len(deltaUpdates) > 0 {
			msg := DeltaMessage{
				Type: "delta",
				Ts:   time.Now().Unix(),
				D:    deltaUpdates,
			}

			if data, err := json.Marshal(msg); err == nil {
				state.BroadcastMetrics(string(data))
			}
		}
	}
}

func aggregationLoop(state *AppState, db *sql.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	lastHour := time.Now().Hour()

	for range ticker.C {
		currentHour := time.Now().Hour()
		if currentHour != lastHour {
			lastHour = currentHour
			if err := AggregateHourly(db); err != nil {
				fmt.Printf("Failed to aggregate hourly data: %v\n", err)
			}
			if err := AggregateDaily(db); err != nil {
				fmt.Printf("Failed to aggregate daily data: %v\n", err)
			}
		}
	}
}

func cleanupLoop(db *sql.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		if err := CleanupOldData(db); err != nil {
			fmt.Printf("Failed to cleanup old data: %v\n", err)
		}
	}
}

func boolPtr(b bool) *bool {
	return &b
}

// getWebDir finds the web directory containing the frontend assets
func getWebDir() string {
	// Check VSTATS_WEB_DIR environment variable
	if webDir := os.Getenv("VSTATS_WEB_DIR"); webDir != "" {
		if _, err := os.Stat(filepath.Join(webDir, "index.html")); err == nil {
			return webDir
		}
		if _, err := os.Stat(filepath.Join(webDir, "dist", "index.html")); err == nil {
			return filepath.Join(webDir, "dist")
		}
	}

	// Check relative to executable
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		paths := []string{
			filepath.Join(exeDir, "..", "web", "dist"),
			filepath.Join(exeDir, "web", "dist"),
			filepath.Join(exeDir, "..", "..", "web", "dist"),
			filepath.Join(exeDir, "..", "dist"),
		}
		for _, p := range paths {
			if abs, err := filepath.Abs(p); err == nil {
				if _, err := os.Stat(filepath.Join(abs, "index.html")); err == nil {
					return abs
				}
			}
		}
	}

	// Check common locations
	paths := []string{
		"./web/dist",
		"./web",
		"./dist",
		"../web/dist",
		"/opt/vstats/web",
	}
	for _, p := range paths {
		if abs, err := filepath.Abs(p); err == nil {
			if _, err := os.Stat(filepath.Join(abs, "index.html")); err == nil {
				return abs
			}
		}
	}

	return ""
}

const embeddedIndexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>vStats - Server Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(90deg, #00d9ff, #00ff88); 
         -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #888; margin-bottom: 2rem; }
    .status { background: rgba(0,217,255,0.1); border: 1px solid rgba(0,217,255,0.3);
              border-radius: 12px; padding: 2rem; margin-top: 2rem; }
    .status h2 { color: #00d9ff; margin-bottom: 1rem; }
    code { background: rgba(0,0,0,0.3); padding: 0.5rem 1rem; border-radius: 6px; 
           display: block; margin: 0.5rem 0; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>vStats</h1>
    <p>Server Monitoring Dashboard</p>
    <div class="status">
      <h2>Server is Running</h2>
      <p>Web assets not found. API is available at:</p>
      <code>GET /api/metrics</code>
      <code>GET /api/history/:server_id?range=1h|24h|7d|30d</code>
      <code>GET /api/settings/site</code>
    </div>
  </div>
</body>
</html>`
