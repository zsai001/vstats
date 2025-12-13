package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"vstats/internal/cloud/config"
	"vstats/internal/cloud/database"
	"vstats/internal/cloud/handlers"
	"vstats/internal/cloud/middleware"
	cloudredis "vstats/internal/cloud/redis"
	"vstats/internal/cloud/websocket"

	"github.com/gin-gonic/gin"
)

var Version = "dev"

func main() {
	// Handle version flag
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "--version", "-v":
			fmt.Printf("vstats-cloud version %s\n", Version)
			os.Exit(0)
		}
	}

	// Load configuration
	cfg := config.Load()

	fmt.Println("╔════════════════════════════════════════════════════════════════╗")
	fmt.Println("║                   VStats Cloud Server                          ║")
	fmt.Println("╠════════════════════════════════════════════════════════════════╣")
	fmt.Printf("║  Version: %-52s ║\n", Version)
	fmt.Printf("║  Environment: %-48s ║\n", cfg.Env)
	fmt.Println("╚════════════════════════════════════════════════════════════════╝")

	// Connect to PostgreSQL
	fmt.Println("\n📦 Connecting to PostgreSQL...")
	_, err := database.Connect(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()
	fmt.Println("   ✓ PostgreSQL connected")

	// Connect to Redis
	fmt.Println("📦 Connecting to Redis...")
	_, err = cloudredis.Connect(cfg)
	if err != nil {
		log.Fatalf("Failed to connect to Redis: %v", err)
	}
	defer cloudredis.Close()
	fmt.Println("   ✓ Redis connected")

	// Initialize WebSocket hub
	fmt.Println("📡 Initializing WebSocket hub...")
	websocket.InitHub()
	fmt.Println("   ✓ WebSocket hub ready")

	// Setup Gin
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(middleware.CORSMiddleware())
	r.Use(middleware.RequestIDMiddleware())

	// ============================================================================
	// Public Routes
	// ============================================================================

	// Health check
	r.GET("/health", handlers.HealthCheck)
	r.GET("/health/detailed", handlers.HealthCheckDetailed)
	r.GET("/version", handlers.Version)

	// Release/Download endpoints (for install scripts)
	r.GET("/api/release/latest", handlers.GetLatestVersion)
	r.GET("/api/release/version", handlers.GetLatestVersionText)
	r.GET("/api/release/assets", handlers.ListAssets)
	r.GET("/api/release/refresh", handlers.RefreshCache)
	r.GET("/download/latest/:name", handlers.DownloadBinary)
	r.GET("/download/:version/:name", handlers.DownloadBinaryVersion)

	// OAuth
	r.GET("/api/auth/providers", handlers.GetOAuthProviders)
	r.GET("/api/auth/oauth/github", handlers.GitHubOAuthStart)
	r.GET("/api/auth/oauth/github/callback", handlers.GitHubOAuthCallback)
	r.GET("/api/auth/oauth/google", handlers.GoogleOAuthStart)
	r.GET("/api/auth/oauth/google/callback", handlers.GoogleOAuthCallback)
	r.POST("/api/auth/exchange", handlers.ExchangeToken) // Exchange OAuth info for JWT (for external OAuth proxy)

	// Auth Reports (public endpoint for sites to report auth events)
	r.POST("/api/auth/report", handlers.ReportAuth)

	// Agent WebSocket (authenticated by agent_key)
	r.GET("/ws/agent", websocket.HandleAgentWS)

	// ============================================================================
	// Protected Routes (require JWT)
	// ============================================================================

	auth := r.Group("/api")
	auth.Use(middleware.AuthMiddleware())
	{
		// Auth
		auth.GET("/auth/verify", handlers.VerifyToken)
		auth.GET("/auth/me", handlers.GetCurrentUser)
		auth.POST("/auth/logout", handlers.Logout)

		// Servers
		auth.GET("/servers", handlers.ListServers)
		auth.POST("/servers", handlers.CreateServer)
		auth.GET("/servers/:id", handlers.GetServer)
		auth.PUT("/servers/:id", handlers.UpdateServer)
		auth.DELETE("/servers/:id", handlers.DeleteServer)
		auth.POST("/servers/:id/regenerate-key", handlers.RegenerateAgentKey)
		auth.GET("/servers/:id/install-command", handlers.GetInstallCommand)

		// Metrics
		auth.GET("/servers/:id/metrics", handlers.GetServerMetrics)
		auth.GET("/servers/:id/history", handlers.GetServerHistory)

		// Dashboard WebSocket
		auth.GET("/ws", func(c *gin.Context) {
			userID := middleware.GetUserID(c)
			websocket.HandleDashboardWS(c, userID)
		})

		// Auth Reports Stats (admin endpoints)
		auth.GET("/admin/auth-stats", handlers.GetAuthOverallStats)
		auth.GET("/admin/auth-stats/daily", handlers.GetAuthDailyStats)
		auth.GET("/admin/auth-stats/sites", handlers.GetAuthSiteStats)
		auth.GET("/admin/auth-stats/sites/:site_host", handlers.GetAuthUsersBySite)
		auth.GET("/admin/auth-stats/date/:date", handlers.GetAuthUsersByDate)

		// User Management (admin endpoints)
		auth.GET("/admin/users", handlers.ListUsers)
		auth.GET("/admin/users/stats", handlers.GetUserStats)
		auth.GET("/admin/users/:id", handlers.GetUser)
		auth.PUT("/admin/users/:id", handlers.UpdateUser)
		auth.DELETE("/admin/users/:id", handlers.DeleteUser)
	}

	// ============================================================================
	// Static File Serving (SPA support)
	// ============================================================================

	if cfg.StaticDir != "" {
		fmt.Printf("📁 Serving static files from: %s\n", cfg.StaticDir)

		// Serve static files for SPA
		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path

			// Skip API routes
			if strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws/") ||
				path == "/health" || path == "/health/detailed" || path == "/version" ||
				strings.HasPrefix(path, "/download/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
				return
			}

			// Try to serve the file directly
			filePath := filepath.Join(cfg.StaticDir, path)
			if _, err := os.Stat(filePath); err == nil {
				c.File(filePath)
				return
			}

			// For SPA: serve index.html for all other routes
			indexPath := filepath.Join(cfg.StaticDir, "index.html")
			if _, err := os.Stat(indexPath); err == nil {
				c.File(indexPath)
				return
			}

			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
		})
	}

	// ============================================================================
	// Start Server
	// ============================================================================

	fmt.Printf("\n🚀 Server running on http://0.0.0.0:%s\n", cfg.Port)
	fmt.Printf("📡 Agent WebSocket: ws://0.0.0.0:%s/ws/agent\n", cfg.Port)
	fmt.Printf("🌐 Dashboard WebSocket: ws://0.0.0.0:%s/api/ws\n", cfg.Port)
	if cfg.StaticDir != "" {
		fmt.Printf("📁 Static files: %s\n", cfg.StaticDir)
	}
	fmt.Println()

	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
