package main

import (
	"database/sql"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// ============================================================================
// System Metrics Types
// ============================================================================

type SystemMetrics struct {
	Timestamp   time.Time      `json:"timestamp"`
	Hostname    string         `json:"hostname"`
	OS          OsInfo         `json:"os"`
	CPU         CpuMetrics     `json:"cpu"`
	Memory      MemoryMetrics  `json:"memory"`
	Disks       []DiskMetrics  `json:"disks"`
	Network     NetworkMetrics `json:"network"`
	Uptime      uint64         `json:"uptime"`
	LoadAverage LoadAverage    `json:"load_average"`
	Ping        *PingMetrics   `json:"ping,omitempty"`
	Version     string         `json:"version,omitempty"`
	IPAddresses []string       `json:"ip_addresses,omitempty"`
}

type OsInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Kernel  string `json:"kernel"`
	Arch    string `json:"arch"`
}

type CpuMetrics struct {
	Brand     string    `json:"brand"`
	Cores     int       `json:"cores"`
	Usage     float32   `json:"usage"`
	Frequency uint64    `json:"frequency"`
	PerCore   []float32 `json:"per_core"`
}

type MemoryMetrics struct {
	Total        uint64         `json:"total"`
	Used         uint64         `json:"used"`
	Available    uint64         `json:"available"`
	SwapTotal    uint64         `json:"swap_total"`
	SwapUsed     uint64         `json:"swap_used"`
	UsagePercent float32        `json:"usage_percent"`
	Modules      []MemoryModule `json:"modules,omitempty"`
}

type MemoryModule struct {
	Slot         string `json:"slot,omitempty"`
	Size         uint64 `json:"size"`
	MemType      string `json:"mem_type,omitempty"`
	Speed        uint32 `json:"speed,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
}

type DiskMetrics struct {
	Name         string   `json:"name"`
	Model        string   `json:"model,omitempty"`
	Serial       string   `json:"serial,omitempty"`
	Total        uint64   `json:"total"`
	DiskType     string   `json:"disk_type,omitempty"`
	MountPoints  []string `json:"mount_points,omitempty"`
	UsagePercent float32  `json:"usage_percent"`
	Used         uint64   `json:"used"`
}

type NetworkMetrics struct {
	Interfaces []NetworkInterface `json:"interfaces"`
	TotalRx    uint64             `json:"total_rx"`
	TotalTx    uint64             `json:"total_tx"`
	RxSpeed    uint64             `json:"rx_speed"`
	TxSpeed    uint64             `json:"tx_speed"`
}

type NetworkInterface struct {
	Name      string `json:"name"`
	MAC       string `json:"mac,omitempty"`
	Speed     uint32 `json:"speed,omitempty"`
	RxBytes   uint64 `json:"rx_bytes"`
	TxBytes   uint64 `json:"tx_bytes"`
	RxPackets uint64 `json:"rx_packets"`
	TxPackets uint64 `json:"tx_packets"`
}

type LoadAverage struct {
	One     float64 `json:"one"`
	Five    float64 `json:"five"`
	Fifteen float64 `json:"fifteen"`
}

type PingMetrics struct {
	Targets []PingTarget `json:"targets"`
}

type PingTarget struct {
	Name       string   `json:"name"`
	Host       string   `json:"host"`
	LatencyMs  *float64 `json:"latency_ms"`
	PacketLoss float64  `json:"packet_loss"`
	Status     string   `json:"status"`
}

// ============================================================================
// Auth Types
// ============================================================================

type Claims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

type LoginRequest struct {
	Password string `json:"password"`
}

type LoginResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ============================================================================
// OAuth Types
// ============================================================================

type OAuthStateData struct {
	Provider  string `json:"provider"`
	State     string `json:"state"`
	CreatedAt int64  `json:"created_at"`
}

type GitHubUser struct {
	ID        int    `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type GitHubTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

type GoogleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

type GoogleUserInfo struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

type OAuthLoginResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
	Provider  string    `json:"provider"`
	Username  string    `json:"username"`
}

// ============================================================================
// Server Management Types
// ============================================================================

type AddServerRequest struct {
	Name         string            `json:"name"`
	URL          string            `json:"url"`
	Location     string            `json:"location"`
	Provider     string            `json:"provider"`
	Tag          string            `json:"tag"`
	GroupID      string            `json:"group_id,omitempty"`      // Deprecated
	GroupValues  map[string]string `json:"group_values,omitempty"` // dimension_id -> option_id
	PriceAmount  string            `json:"price_amount,omitempty"`
	PricePeriod  string            `json:"price_period,omitempty"`
	PurchaseDate string            `json:"purchase_date,omitempty"`
	TipBadge     string            `json:"tip_badge,omitempty"`
}

type UpdateServerRequest struct {
	Name         *string            `json:"name,omitempty"`
	Location     *string            `json:"location,omitempty"`
	Provider     *string            `json:"provider,omitempty"`
	Tag          *string            `json:"tag,omitempty"`
	GroupID      *string            `json:"group_id,omitempty"`      // Deprecated
	GroupValues  *map[string]string `json:"group_values,omitempty"` // dimension_id -> option_id
	PriceAmount  *string            `json:"price_amount,omitempty"`
	PricePeriod  *string            `json:"price_period,omitempty"`
	PurchaseDate *string            `json:"purchase_date,omitempty"`
	TipBadge     *string            `json:"tip_badge,omitempty"`
}

// ============================================================================
// Group Management Types (Deprecated - for backward compatibility)
// ============================================================================

type AddGroupRequest struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateGroupRequest struct {
	Name      *string `json:"name,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

// ============================================================================
// Dimension Management Types
// ============================================================================

type AddDimensionRequest struct {
	Name      string `json:"name"`
	Key       string `json:"key"`
	Enabled   bool   `json:"enabled"`
	SortOrder int    `json:"sort_order"`
}

type UpdateDimensionRequest struct {
	Name      *string `json:"name,omitempty"`
	Enabled   *bool   `json:"enabled,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

type AddOptionRequest struct {
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type UpdateOptionRequest struct {
	Name      *string `json:"name,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

type AgentRegisterRequest struct {
	Name     string `json:"name"`
	Location string `json:"location"`
	Provider string `json:"provider"`
}

type AgentRegisterResponse struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

// ============================================================================
// History Types
// ============================================================================

type HistoryPoint struct {
	Timestamp string   `json:"timestamp"`
	CPU       float32  `json:"cpu"`
	Memory    float32  `json:"memory"`
	Disk      float32  `json:"disk"`
	NetRx     int64    `json:"net_rx"`
	NetTx     int64    `json:"net_tx"`
	PingMs    *float64 `json:"ping_ms,omitempty"`
}

type HistoryResponse struct {
	ServerID    string              `json:"server_id"`
	Range       string              `json:"range"`
	Data        []HistoryPoint      `json:"data"`
	PingTargets []PingHistoryTarget `json:"ping_targets,omitempty"`
}

type PingHistoryTarget struct {
	Name string             `json:"name"`
	Host string             `json:"host"`
	Data []PingHistoryPoint `json:"data"`
}

type PingHistoryPoint struct {
	Timestamp string   `json:"timestamp"`
	LatencyMs *float64 `json:"latency_ms"`
	Status    string   `json:"status"`
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

type AgentMetricsData struct {
	ServerID    string
	Metrics     SystemMetrics
	LastUpdated time.Time
}

type DashboardMessage struct {
	Type            string                `json:"type"`
	Servers         []ServerMetricsUpdate `json:"servers"`
	Groups          []ServerGroup         `json:"groups,omitempty"`          // Deprecated
	GroupDimensions []GroupDimension      `json:"group_dimensions,omitempty"`
	SiteSettings    *SiteSettings         `json:"site_settings,omitempty"`
}

type ServerMetricsUpdate struct {
	ServerID     string            `json:"server_id"`
	ServerName   string            `json:"server_name"`
	Location     string            `json:"location"`
	Provider     string            `json:"provider"`
	Tag          string            `json:"tag"`
	GroupID      string            `json:"group_id,omitempty"`      // Deprecated
	GroupValues  map[string]string `json:"group_values,omitempty"` // dimension_id -> option_id
	Version      string            `json:"version"`
	IP           string            `json:"ip"`
	Online       bool              `json:"online"`
	Metrics      *SystemMetrics    `json:"metrics"`
	PriceAmount  string            `json:"price_amount,omitempty"`
	PricePeriod  string            `json:"price_period,omitempty"`
	PurchaseDate string            `json:"purchase_date,omitempty"`
	TipBadge     string            `json:"tip_badge,omitempty"`
}

type DeltaMessage struct {
	Type string                `json:"type"`
	Ts   int64                 `json:"ts"`
	D    []CompactServerUpdate `json:"d,omitempty"`
}

type CompactServerUpdate struct {
	ID string          `json:"id"`
	On *bool           `json:"on,omitempty"`
	M  *CompactMetrics `json:"m,omitempty"`
}

type CompactMetrics struct {
	C  *uint8  `json:"c,omitempty"`
	M  *uint8  `json:"m,omitempty"`
	D  *uint8  `json:"d,omitempty"`
	Rx *uint64 `json:"rx,omitempty"`
	Tx *uint64 `json:"tx,omitempty"`
	Up *uint64 `json:"up,omitempty"`
}

func (cm *CompactMetrics) IsEmpty() bool {
	return cm.C == nil && cm.M == nil && cm.D == nil && cm.Rx == nil && cm.Tx == nil && cm.Up == nil
}

func (cm *CompactMetrics) HasChanged(other *CompactMetrics) bool {
	return cm.C != other.C || cm.M != other.M || cm.D != other.D || cm.Rx != other.Rx || cm.Tx != other.Tx
}

func (cm *CompactMetrics) Diff(prev *CompactMetrics) *CompactMetrics {
	diff := &CompactMetrics{}
	if cm.C != nil && (prev.C == nil || *cm.C != *prev.C) {
		diff.C = cm.C
	}
	if cm.M != nil && (prev.M == nil || *cm.M != *prev.M) {
		diff.M = cm.M
	}
	if cm.D != nil && (prev.D == nil || *cm.D != *prev.D) {
		diff.D = cm.D
	}
	if cm.Rx != nil && (prev.Rx == nil || *cm.Rx != *prev.Rx) {
		diff.Rx = cm.Rx
	}
	if cm.Tx != nil && (prev.Tx == nil || *cm.Tx != *prev.Tx) {
		diff.Tx = cm.Tx
	}
	return diff
}

func CompactMetricsFromSystem(m *SystemMetrics) *CompactMetrics {
	cpu := uint8(m.CPU.Usage)
	mem := uint8(m.Memory.UsagePercent)
	var disk *uint8
	if len(m.Disks) > 0 {
		d := uint8(m.Disks[0].UsagePercent)
		disk = &d
	}
	rx := m.Network.RxSpeed
	tx := m.Network.TxSpeed
	up := m.Uptime
	return &CompactMetrics{
		C:  &cpu,
		M:  &mem,
		D:  disk,
		Rx: &rx,
		Tx: &tx,
		Up: &up,
	}
}

type AgentMessage struct {
	Type     string         `json:"type"`
	ServerID string         `json:"server_id,omitempty"`
	Token    string         `json:"token,omitempty"`
	Version  string         `json:"version,omitempty"`
	Metrics  *SystemMetrics `json:"metrics,omitempty"`
}

type AgentCommand struct {
	Type        string `json:"type"`
	Command     string `json:"command"`
	DownloadURL string `json:"download_url,omitempty"`
}

type UpdateAgentRequest struct {
	DownloadURL string `json:"download_url,omitempty"`
}

type UpdateAgentResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type InstallCommand struct {
	Command   string `json:"command"`
	ScriptURL string `json:"script_url"`
}

type VersionInfo struct {
	Current         string  `json:"current"`
	Latest          *string `json:"latest,omitempty"`
	UpdateAvailable bool    `json:"update_available"`
}

// ============================================================================
// App State
// ============================================================================

type LastSentState struct {
	Servers map[string]*struct {
		Online  bool
		Metrics *CompactMetrics
	}
}

type AgentConnection struct {
	Conn     *websocket.Conn
	SendChan chan []byte
}

// DashboardClient represents a connected dashboard client with its IP
type DashboardClient struct {
	Conn *websocket.Conn
	IP   string
}

type AppState struct {
	Config           *AppConfig
	ConfigMu         sync.RWMutex
	MetricsBroadcast chan string
	AgentMetrics     map[string]*AgentMetricsData
	AgentMetricsMu   sync.RWMutex
	AgentConns       map[string]*AgentConnection
	AgentConnsMu     sync.RWMutex
	LastSent         *LastSentState
	LastSentMu       sync.RWMutex
	DashboardClients map[*websocket.Conn]*DashboardClient
	DashboardMu      sync.RWMutex
	DB               *sql.DB
}

// GetOnlineUsersCount returns the number of unique IPs connected to the dashboard
func (s *AppState) GetOnlineUsersCount() int {
	s.DashboardMu.RLock()
	defer s.DashboardMu.RUnlock()

	uniqueIPs := make(map[string]bool)
	for _, client := range s.DashboardClients {
		if client != nil && client.IP != "" {
			uniqueIPs[client.IP] = true
		}
	}
	return len(uniqueIPs)
}

