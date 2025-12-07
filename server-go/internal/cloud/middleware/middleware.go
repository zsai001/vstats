package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"vstats/internal/cloud/auth"
	"vstats/internal/cloud/config"
	"vstats/internal/cloud/redis"

	"github.com/gin-gonic/gin"
)

// Context keys
const (
	ContextUserID   = "user_id"
	ContextUsername = "username"
	ContextEmail    = "email"
	ContextPlan     = "plan"
	ContextClaims   = "claims"
)

// AuthMiddleware validates JWT token
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		claims, err := auth.ValidateToken(parts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		// Set claims in context
		c.Set(ContextUserID, claims.UserID)
		c.Set(ContextUsername, claims.Username)
		c.Set(ContextEmail, claims.Email)
		c.Set(ContextPlan, claims.Plan)
		c.Set(ContextClaims, claims)

		c.Next()
	}
}

// OptionalAuthMiddleware parses JWT if present but doesn't require it
func OptionalAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		claims, err := auth.ValidateToken(parts[1])
		if err != nil {
			c.Next()
			return
		}

		c.Set(ContextUserID, claims.UserID)
		c.Set(ContextUsername, claims.Username)
		c.Set(ContextEmail, claims.Email)
		c.Set(ContextPlan, claims.Plan)
		c.Set(ContextClaims, claims)

		c.Next()
	}
}

// RateLimitMiddleware limits requests per client
func RateLimitMiddleware(key string, limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Use user ID if authenticated, otherwise use IP
		identifier := c.ClientIP()
		if userID, exists := c.Get(ContextUserID); exists {
			identifier = userID.(string)
		}

		ctx := context.Background()
		remaining, err := redis.CheckRateLimit(ctx, key+":"+identifier, limit, window)
		if err != nil {
			// If Redis fails, allow request
			c.Next()
			return
		}

		c.Header("X-RateLimit-Limit", string(rune(limit)))
		c.Header("X-RateLimit-Remaining", string(rune(remaining)))

		if remaining <= 0 {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":       "Too many requests",
				"retry_after": int(window.Seconds()),
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// CORSMiddleware handles CORS
func CORSMiddleware() gin.HandlerFunc {
	cfg := config.Get()

	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")

		// Check if origin is allowed
		allowedOrigins := strings.Split(cfg.CORSOrigins, ",")
		allowed := false
		for _, ao := range allowedOrigins {
			ao = strings.TrimSpace(ao)
			if ao == "*" || ao == origin {
				allowed = true
				break
			}
		}

		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}

// RequestIDMiddleware adds request ID to context
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = generateRequestID()
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func generateRequestID() string {
	return time.Now().Format("20060102150405") + "-" + randomString(8)
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
	}
	return string(b)
}

// GetUserID extracts user ID from context
func GetUserID(c *gin.Context) string {
	if userID, exists := c.Get(ContextUserID); exists {
		return userID.(string)
	}
	return ""
}

// GetUsername extracts username from context
func GetUsername(c *gin.Context) string {
	if username, exists := c.Get(ContextUsername); exists {
		return username.(string)
	}
	return ""
}

// GetUserPlan extracts user plan from context
func GetUserPlan(c *gin.Context) string {
	if plan, exists := c.Get(ContextPlan); exists {
		return plan.(string)
	}
	return "free"
}
