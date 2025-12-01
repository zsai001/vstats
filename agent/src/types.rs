use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ============================================================================
// System Metrics Types (must match server expectations)
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

// ============================================================================
// WebSocket Message Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct AuthMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub server_id: String,
    pub token: String,
}

#[derive(Debug, Serialize)]
pub struct MetricsMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub metrics: SystemMetrics,
}

#[derive(Debug, Deserialize)]
pub struct ServerResponse {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub status: Option<String>,
    pub message: Option<String>,
}

// ============================================================================
// Registration Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct RegisterRequest {
    pub name: String,
    pub location: String,
    pub provider: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub id: String,
    pub token: String,
}

