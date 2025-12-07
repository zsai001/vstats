package handlers

import (
	"context"
	"net/http"
	"time"

	"vstats/internal/cloud/database"
	"vstats/internal/cloud/redis"

	"github.com/gin-gonic/gin"
)

// HealthCheck returns server health status
func HealthCheck(c *gin.Context) {
	c.String(http.StatusOK, "OK")
}

// HealthCheckDetailed returns detailed health status
func HealthCheckDetailed(c *gin.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	status := gin.H{
		"status": "healthy",
		"time":   time.Now().UTC().Format(time.RFC3339),
	}

	// Check database
	if err := database.HealthCheck(ctx); err != nil {
		status["status"] = "unhealthy"
		status["database"] = gin.H{"status": "down", "error": err.Error()}
	} else {
		status["database"] = gin.H{"status": "up"}
	}

	// Check Redis
	if err := redis.HealthCheck(ctx); err != nil {
		status["status"] = "unhealthy"
		status["redis"] = gin.H{"status": "down", "error": err.Error()}
	} else {
		status["redis"] = gin.H{"status": "up"}
	}

	if status["status"] == "healthy" {
		c.JSON(http.StatusOK, status)
	} else {
		c.JSON(http.StatusServiceUnavailable, status)
	}
}

// Version returns API version info
func Version(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"version": "1.0.0",
		"name":    "vstats-cloud",
	})
}
