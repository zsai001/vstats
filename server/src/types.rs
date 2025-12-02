use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::config::SiteSettings;

// ============================================================================
// Auth Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: i64,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct AddServerRequest {
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub tag: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
}

// ============================================================================
// Agent Registration Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct AgentRegisterRequest {
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub provider: String,
}

#[derive(Debug, Serialize)]
pub struct AgentRegisterResponse {
    pub id: String,
    pub token: String,
}

// ============================================================================
// Historical Data Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryPoint {
    pub timestamp: String,
    pub cpu: f32,
    pub memory: f32,
    pub disk: f32,
    pub net_rx: i64,
    pub net_tx: i64,
    #[serde(default)]
    pub ping_ms: Option<f64>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    #[serde(default = "default_range")]
    pub range: String,
}

fn default_range() -> String {
    "24h".to_string()
}

#[derive(Debug, Serialize)]
pub struct HistoryResponse {
    pub server_id: String,
    pub range: String,
    pub data: Vec<HistoryPoint>,
}

// ============================================================================
// System Metrics Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemMetrics {
    pub timestamp: DateTime<Utc>,
    pub hostname: String,
    pub os: OsInfo,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disks: Vec<DiskMetrics>,
    pub network: NetworkMetrics,
    pub uptime: u64,
    pub load_average: LoadAverage,
    #[serde(default)]
    pub ping: Option<PingMetrics>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub ip_addresses: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OsInfo {
    pub name: String,
    pub version: String,
    pub kernel: String,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuMetrics {
    pub brand: String,
    pub cores: usize,
    pub usage: f32,
    pub frequency: u64,
    pub per_core: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMetrics {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskMetrics {
    pub name: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkMetrics {
    pub interfaces: Vec<NetworkInterface>,
    pub total_rx: u64,
    pub total_tx: u64,
    #[serde(default)]
    pub rx_speed: u64,
    #[serde(default)]
    pub tx_speed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_packets: u64,
    pub tx_packets: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingMetrics {
    pub targets: Vec<PingTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingTarget {
    pub name: String,
    pub host: String,
    pub latency_ms: Option<f64>,
    pub packet_loss: f64,
    pub status: String,
}

// ============================================================================
// Dashboard/WebSocket Message Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetricsData {
    pub server_id: String,
    pub metrics: SystemMetrics,
    pub last_updated: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub servers: Vec<ServerMetricsUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site_settings: Option<SiteSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerMetricsUpdate {
    pub server_id: String,
    pub server_name: String,
    pub location: String,
    pub provider: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub ip: String,
    pub online: bool,
    pub metrics: Option<SystemMetrics>,
}

#[derive(Debug, Deserialize)]
pub struct AgentMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub server_id: Option<String>,
    pub token: Option<String>,
    pub metrics: Option<SystemMetrics>,
}

// ============================================================================
// Installation Script Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct InstallCommand {
    pub command: String,
    pub script_url: String,
}

// ============================================================================
// Update Agent Types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct UpdateAgentRequest {
    #[serde(default)]
    pub download_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpdateAgentResponse {
    pub success: bool,
    pub message: String,
}

/// Command message sent to agent
#[derive(Debug, Serialize)]
pub struct AgentCommand {
    #[serde(rename = "type")]
    pub cmd_type: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

