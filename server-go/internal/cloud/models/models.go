package models

import (
	"encoding/json"
	"time"
)

// ============================================================================
// User Models
// ============================================================================

type User struct {
	ID            string          `json:"id" db:"id"`
	Username      string          `json:"username" db:"username"`
	Email         *string         `json:"email,omitempty" db:"email"`
	EmailVerified bool            `json:"email_verified" db:"email_verified"`
	AvatarURL     *string         `json:"avatar_url,omitempty" db:"avatar_url"`
	Plan          string          `json:"plan" db:"plan"`
	ServerLimit   int             `json:"server_limit" db:"server_limit"`
	Status        string          `json:"status" db:"status"`
	Metadata      json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	CreatedAt     time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at" db:"updated_at"`
	LastLoginAt   *time.Time      `json:"last_login_at,omitempty" db:"last_login_at"`
}

type OAuthProvider struct {
	ID               string          `json:"id" db:"id"`
	UserID           string          `json:"user_id" db:"user_id"`
	Provider         string          `json:"provider" db:"provider"`
	ProviderUserID   string          `json:"provider_user_id" db:"provider_user_id"`
	ProviderUsername *string         `json:"provider_username,omitempty" db:"provider_username"`
	ProviderEmail    *string         `json:"provider_email,omitempty" db:"provider_email"`
	ProviderAvatar   *string         `json:"provider_avatar_url,omitempty" db:"provider_avatar_url"`
	RawData          json.RawMessage `json:"raw_data,omitempty" db:"raw_data"`
	CreatedAt        time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at" db:"updated_at"`
}

// ============================================================================
// Server Models
// ============================================================================

type Server struct {
	ID           string          `json:"id" db:"id"`
	UserID       string          `json:"user_id" db:"user_id"`
	Name         string          `json:"name" db:"name"`
	Hostname     *string         `json:"hostname,omitempty" db:"hostname"`
	IPAddress    *string         `json:"ip_address,omitempty" db:"ip_address"`
	AgentKey     string          `json:"agent_key" db:"agent_key"`
	AgentVersion *string         `json:"agent_version,omitempty" db:"agent_version"`
	OSType       *string         `json:"os_type,omitempty" db:"os_type"`
	OSVersion    *string         `json:"os_version,omitempty" db:"os_version"`
	Status       string          `json:"status" db:"status"`
	LastSeenAt   *time.Time      `json:"last_seen_at,omitempty" db:"last_seen_at"`
	Metadata     json.RawMessage `json:"metadata,omitempty" db:"metadata"`
	CreatedAt    time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at" db:"updated_at"`
}

type ServerMetrics struct {
	ID          int64     `json:"id" db:"id"`
	ServerID    string    `json:"server_id" db:"server_id"`
	CollectedAt time.Time `json:"collected_at" db:"collected_at"`

	// CPU
	CPUUsage  *float64 `json:"cpu_usage,omitempty" db:"cpu_usage"`
	CPUCores  *int     `json:"cpu_cores,omitempty" db:"cpu_cores"`
	LoadAvg1  *float64 `json:"load_avg_1,omitempty" db:"load_avg_1"`
	LoadAvg5  *float64 `json:"load_avg_5,omitempty" db:"load_avg_5"`
	LoadAvg15 *float64 `json:"load_avg_15,omitempty" db:"load_avg_15"`

	// Memory
	MemoryTotal   *int64 `json:"memory_total,omitempty" db:"memory_total"`
	MemoryUsed    *int64 `json:"memory_used,omitempty" db:"memory_used"`
	MemoryFree    *int64 `json:"memory_free,omitempty" db:"memory_free"`
	MemoryCached  *int64 `json:"memory_cached,omitempty" db:"memory_cached"`
	MemoryBuffers *int64 `json:"memory_buffers,omitempty" db:"memory_buffers"`
	SwapTotal     *int64 `json:"swap_total,omitempty" db:"swap_total"`
	SwapUsed      *int64 `json:"swap_used,omitempty" db:"swap_used"`

	// Disk
	DiskTotal *int64 `json:"disk_total,omitempty" db:"disk_total"`
	DiskUsed  *int64 `json:"disk_used,omitempty" db:"disk_used"`
	DiskFree  *int64 `json:"disk_free,omitempty" db:"disk_free"`

	// Network
	NetworkRxBytes   *int64 `json:"network_rx_bytes,omitempty" db:"network_rx_bytes"`
	NetworkTxBytes   *int64 `json:"network_tx_bytes,omitempty" db:"network_tx_bytes"`
	NetworkRxPackets *int64 `json:"network_rx_packets,omitempty" db:"network_rx_packets"`
	NetworkTxPackets *int64 `json:"network_tx_packets,omitempty" db:"network_tx_packets"`

	// Process
	ProcessCount *int `json:"process_count,omitempty" db:"process_count"`

	// Raw data
	RawData json.RawMessage `json:"raw_data,omitempty" db:"raw_data"`
}

// ============================================================================
// Alert Models
// ============================================================================

type AlertRule struct {
	ID                   string          `json:"id" db:"id"`
	UserID               string          `json:"user_id" db:"user_id"`
	ServerID             *string         `json:"server_id,omitempty" db:"server_id"`
	Name                 string          `json:"name" db:"name"`
	Description          *string         `json:"description,omitempty" db:"description"`
	MetricType           string          `json:"metric_type" db:"metric_type"`
	Condition            string          `json:"condition" db:"condition"`
	Threshold            float64         `json:"threshold" db:"threshold"`
	DurationSeconds      int             `json:"duration_seconds" db:"duration_seconds"`
	NotificationChannels json.RawMessage `json:"notification_channels" db:"notification_channels"`
	IsEnabled            bool            `json:"is_enabled" db:"is_enabled"`
	CooldownSeconds      int             `json:"cooldown_seconds" db:"cooldown_seconds"`
	CreatedAt            time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt            time.Time       `json:"updated_at" db:"updated_at"`
}

type AlertHistory struct {
	ID               string     `json:"id" db:"id"`
	RuleID           string     `json:"rule_id" db:"rule_id"`
	ServerID         string     `json:"server_id" db:"server_id"`
	Status           string     `json:"status" db:"status"`
	TriggeredValue   *float64   `json:"triggered_value,omitempty" db:"triggered_value"`
	TriggeredAt      time.Time  `json:"triggered_at" db:"triggered_at"`
	ResolvedAt       *time.Time `json:"resolved_at,omitempty" db:"resolved_at"`
	AcknowledgedAt   *time.Time `json:"acknowledged_at,omitempty" db:"acknowledged_at"`
	AcknowledgedBy   *string    `json:"acknowledged_by,omitempty" db:"acknowledged_by"`
	NotificationSent bool       `json:"notification_sent" db:"notification_sent"`
	Notes            *string    `json:"notes,omitempty" db:"notes"`
}

// ============================================================================
// API Key Models
// ============================================================================

type APIKey struct {
	ID          string          `json:"id" db:"id"`
	UserID      string          `json:"user_id" db:"user_id"`
	Name        string          `json:"name" db:"name"`
	KeyPrefix   string          `json:"key_prefix" db:"key_prefix"`
	KeyHash     string          `json:"-" db:"key_hash"`
	Permissions json.RawMessage `json:"permissions" db:"permissions"`
	RateLimit   int             `json:"rate_limit" db:"rate_limit"`
	LastUsedAt  *time.Time      `json:"last_used_at,omitempty" db:"last_used_at"`
	ExpiresAt   *time.Time      `json:"expires_at,omitempty" db:"expires_at"`
	IsActive    bool            `json:"is_active" db:"is_active"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
}

// ============================================================================
// Plan Limits
// ============================================================================

var PlanLimits = map[string]int{
	"free":       5,
	"pro":        50,
	"enterprise": 500,
}

func GetServerLimit(plan string) int {
	if limit, ok := PlanLimits[plan]; ok {
		return limit
	}
	return PlanLimits["free"]
}
