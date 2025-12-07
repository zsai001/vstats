package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	// Server
	Port     string
	Env      string
	AppURL   string
	LogLevel string

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// Auth
	JWTSecret     string
	JWTExpiry     time.Duration
	SessionSecret string
	SessionMaxAge time.Duration

	// OAuth - GitHub
	GitHubClientID     string
	GitHubClientSecret string

	// OAuth - Google
	GoogleClientID     string
	GoogleClientSecret string

	// CORS
	CORSOrigins string

	// Rate Limiting
	RateLimitWindow  time.Duration
	RateLimitMaxReqs int

	// Metrics
	MetricsRetentionDays int
}

var cfg *Config

func Load() *Config {
	cfg = &Config{
		// Server
		Port:     getEnv("PORT", "3001"),
		Env:      getEnv("APP_ENV", "production"),
		AppURL:   getEnv("APP_URL", "https://vstats.example.com"),
		LogLevel: getEnv("LOG_LEVEL", "info"),

		// Database
		DatabaseURL: getEnv("DATABASE_URL", "postgres://vstats:vstats@postgres:5432/vstats_cloud?sslmode=disable"),

		// Redis
		RedisURL: getEnv("REDIS_URL", "redis://:vstats@redis:6379/0"),

		// Auth
		JWTSecret:     getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiry:     getDurationEnv("JWT_EXPIRES_IN", 7*24*time.Hour),
		SessionSecret: getEnv("SESSION_SECRET", "change-me-in-production"),
		SessionMaxAge: getDurationEnv("SESSION_MAX_AGE", 7*24*time.Hour),

		// OAuth - GitHub
		GitHubClientID:     getEnv("GITHUB_CLIENT_ID", ""),
		GitHubClientSecret: getEnv("GITHUB_CLIENT_SECRET", ""),

		// OAuth - Google
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),

		// CORS
		CORSOrigins: getEnv("CORS_ORIGINS", "*"),

		// Rate Limiting
		RateLimitWindow:  getDurationEnv("RATE_LIMIT_WINDOW", time.Minute),
		RateLimitMaxReqs: getIntEnv("RATE_LIMIT_MAX_REQUESTS", 100),

		// Metrics
		MetricsRetentionDays: getIntEnv("METRICS_RETENTION_DAYS", 30),
	}
	return cfg
}

func Get() *Config {
	if cfg == nil {
		return Load()
	}
	return cfg
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

func getDurationEnv(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			return d
		}
	}
	return defaultValue
}

func (c *Config) IsProduction() bool {
	return c.Env == "production"
}
