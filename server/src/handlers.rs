use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::params;
use std::{collections::HashMap, time::Duration as StdDuration};
use sysinfo::{CpuRefreshKind, Disks, Networks, System};

use crate::collector::collect_metrics;
use crate::config::{get_jwt_secret, save_config, LocalNodeConfig, RemoteServer, SiteSettings};
use crate::state::AppState;
use crate::types::{
    AddServerRequest, AgentRegisterRequest, AgentRegisterResponse, ChangePasswordRequest, Claims,
    HistoryPoint, HistoryQuery, HistoryResponse, InstallCommand, LoginRequest, LoginResponse,
    ServerMetricsUpdate, SystemMetrics, UpdateAgentRequest, UpdateAgentResponse, UpdateServerRequest,
};

// Version constants
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// ============================================================================
// Auth Handlers
// ============================================================================

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    // Read latest password hash from config file (supports hot reload after reset)
    let password_hash = {
        let config_path = crate::config::get_config_path();
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(file_config) = serde_json::from_str::<serde_json::Value>(&content) {
                    file_config.get("admin_password_hash")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };
    
    // Fall back to in-memory config if file read fails
    let password_hash = match password_hash {
        Some(h) if h.starts_with("$2") => h,
        _ => {
            let config = state.config.read().await;
            config.admin_password_hash.clone()
        }
    };
    
    let verify_result = bcrypt::verify(&req.password, &password_hash);
    tracing::debug!("bcrypt verify result: {:?}", verify_result);

    if verify_result.unwrap_or(false) {
        // Token valid for 7 days
        let expires_at = Utc::now() + Duration::days(7);
        let claims = Claims {
            sub: "admin".to_string(),
            exp: expires_at.timestamp(),
        };

        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(get_jwt_secret().as_bytes()),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        Ok(Json(LoginResponse { token, expires_at }))
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

pub async fn verify_token(
    State(_state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<HashMap<String, String>>, StatusCode> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(get_jwt_secret().as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let mut result = HashMap::new();
    result.insert("status".to_string(), "valid".to_string());
    Ok(Json(result))
}

pub async fn change_password(
    State(state): State<AppState>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode, StatusCode> {
    // Read latest password hash from config file (supports hot reload after reset)
    let password_hash = {
        let config_path = crate::config::get_config_path();
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(file_config) = serde_json::from_str::<serde_json::Value>(&content) {
                    file_config.get("admin_password_hash")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };
    
    // Fall back to in-memory config if file read fails
    let password_hash = match password_hash {
        Some(h) if h.starts_with("$2") => h,
        _ => {
            let config = state.config.read().await;
            config.admin_password_hash.clone()
        }
    };
    
    // Verify current password
    if !bcrypt::verify(&req.current_password, &password_hash).unwrap_or(false) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    
    // Update password
    let mut config = state.config.write().await;
    config.admin_password_hash = bcrypt::hash(&req.new_password, bcrypt::DEFAULT_COST)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    save_config(&config);
    
    Ok(StatusCode::OK)
}

// ============================================================================
// Site Settings Handlers
// ============================================================================

pub async fn get_site_settings(State(state): State<AppState>) -> Json<SiteSettings> {
    let config = state.config.read().await;
    Json(config.site_settings.clone())
}

pub async fn update_site_settings(
    State(state): State<AppState>,
    Json(settings): Json<SiteSettings>,
) -> StatusCode {
    let mut config = state.config.write().await;
    config.site_settings = settings;
    save_config(&config);
    StatusCode::OK
}

// ============================================================================
// Local Node Configuration Handlers
// ============================================================================

pub async fn get_local_node_config(State(state): State<AppState>) -> Json<LocalNodeConfig> {
    let config = state.config.read().await;
    Json(config.local_node.clone())
}

pub async fn update_local_node_config(
    State(state): State<AppState>,
    Json(req): Json<LocalNodeConfig>,
) -> Result<Json<LocalNodeConfig>, StatusCode> {
    let mut config = state.config.write().await;
    config.local_node = req;
    let local_node = config.local_node.clone();
    save_config(&config);
    Ok(Json(local_node))
}

// ============================================================================
// Server Management Handlers
// ============================================================================

pub async fn get_servers(State(state): State<AppState>) -> Json<Vec<RemoteServer>> {
    let config = state.config.read().await;
    Json(config.servers.clone())
}

pub async fn add_server(
    State(state): State<AppState>,
    Json(req): Json<AddServerRequest>,
) -> Result<Json<RemoteServer>, StatusCode> {
    let mut config = state.config.write().await;
    let agent_token = uuid::Uuid::new_v4().to_string();

    let server = RemoteServer {
        id: uuid::Uuid::new_v4().to_string(),
        name: req.name,
        url: req.url,
        location: req.location,
        provider: req.provider,
        tag: req.tag,
        token: agent_token,
        version: String::new(),
        ip: String::new(),
    };

    config.servers.push(server.clone());
    save_config(&config);
    Ok(Json(server))
}

pub async fn delete_server(State(state): State<AppState>, Path(id): Path<String>) -> StatusCode {
    let mut config = state.config.write().await;
    config.servers.retain(|s| s.id != id);
    save_config(&config);

    let mut metrics = state.agent_metrics.write().await;
    metrics.remove(&id);

    StatusCode::OK
}

pub async fn update_server(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateServerRequest>,
) -> Result<Json<RemoteServer>, StatusCode> {
    let mut config = state.config.write().await;
    
    let server = config.servers.iter_mut()
        .find(|s| s.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    if let Some(name) = req.name {
        server.name = name;
    }
    if let Some(location) = req.location {
        server.location = location;
    }
    if let Some(provider) = req.provider {
        server.provider = provider;
    }
    if let Some(tag) = req.tag {
        server.tag = tag;
    }
    
    let server_clone = server.clone();
    save_config(&config);
    Ok(Json(server_clone))
}

// ============================================================================
// Agent Registration Handler
// ============================================================================

pub async fn register_agent(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AgentRegisterRequest>,
) -> Result<Json<AgentRegisterResponse>, StatusCode> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(get_jwt_secret().as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let mut config = state.config.write().await;
    let server_id = uuid::Uuid::new_v4().to_string();
    let agent_token = uuid::Uuid::new_v4().to_string();

    let server = RemoteServer {
        id: server_id.clone(),
        name: req.name,
        url: String::new(),
        location: req.location,
        provider: req.provider,
        tag: String::new(),
        token: agent_token.clone(),
        version: String::new(),
        ip: String::new(),
    };

    config.servers.push(server);
    save_config(&config);

    Ok(Json(AgentRegisterResponse {
        id: server_id,
        token: agent_token,
    }))
}

// ============================================================================
// History Handlers
// ============================================================================

pub async fn get_history(
    State(state): State<AppState>,
    Path(server_id): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<HistoryResponse>, StatusCode> {
    let db = state.db.lock().await;

    let data = match query.range.as_str() {
        "1h" => {
            let cutoff = (Utc::now() - Duration::hours(1)).to_rfc3339();
            let mut stmt = db
                .prepare(
                    r#"SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, ping_ms
                   FROM metrics_raw WHERE server_id = ?1 AND timestamp >= ?2
                   ORDER BY timestamp ASC"#,
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let rows = stmt
                .query_map(params![&server_id, &cutoff], |row| {
                    Ok(HistoryPoint {
                        timestamp: row.get(0)?,
                        cpu: row.get(1)?,
                        memory: row.get(2)?,
                        disk: row.get(3)?,
                        net_rx: row.get(4)?,
                        net_tx: row.get(5)?,
                        ping_ms: row.get(6).ok(),
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "24h" => {
            let cutoff = (Utc::now() - Duration::hours(24)).to_rfc3339();
            let mut stmt = db
                .prepare(
                    r#"SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, ping_ms
                   FROM metrics_raw WHERE server_id = ?1 AND timestamp >= ?2
                   AND (CAST(strftime('%s', timestamp) AS INTEGER) % 300) < 60
                   ORDER BY timestamp ASC"#,
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let rows = stmt
                .query_map(params![&server_id, &cutoff], |row| {
                    Ok(HistoryPoint {
                        timestamp: row.get(0)?,
                        cpu: row.get(1)?,
                        memory: row.get(2)?,
                        disk: row.get(3)?,
                        net_rx: row.get(4)?,
                        net_tx: row.get(5)?,
                        ping_ms: row.get(6).ok(),
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "7d" => {
            let cutoff = (Utc::now() - Duration::days(7)).to_rfc3339();
            let mut stmt = db
                .prepare(
                    r#"SELECT hour_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
                   FROM metrics_hourly WHERE server_id = ?1 AND hour_start >= ?2
                   ORDER BY hour_start ASC"#,
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let rows = stmt
                .query_map(params![&server_id, &cutoff], |row| {
                    Ok(HistoryPoint {
                        timestamp: row.get(0)?,
                        cpu: row.get(1)?,
                        memory: row.get(2)?,
                        disk: row.get(3)?,
                        net_rx: row.get(4)?,
                        net_tx: row.get(5)?,
                        ping_ms: row.get(6).ok(),
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "30d" => {
            let cutoff = (Utc::now() - Duration::days(30))
                .format("%Y-%m-%d")
                .to_string();
            let mut stmt = db
                .prepare(
                    r#"SELECT date, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
                   FROM metrics_daily WHERE server_id = ?1 AND date >= ?2
                   ORDER BY date ASC"#,
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let rows = stmt
                .query_map(params![&server_id, &cutoff], |row| {
                    Ok(HistoryPoint {
                        timestamp: row.get(0)?,
                        cpu: row.get(1)?,
                        memory: row.get(2)?,
                        disk: row.get(3)?,
                        net_rx: row.get(4)?,
                        net_tx: row.get(5)?,
                        ping_ms: row.get(6).ok(),
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "1y" | _ => {
            // Get daily data from last 365 days
            let cutoff = (Utc::now() - Duration::days(365))
                .format("%Y-%m-%d")
                .to_string();
            let mut stmt = db
                .prepare(
                    r#"SELECT date, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
                   FROM metrics_daily WHERE server_id = ?1 AND date >= ?2
                   ORDER BY date ASC"#,
                )
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let rows = stmt
                .query_map(params![&server_id, &cutoff], |row| {
                    Ok(HistoryPoint {
                        timestamp: row.get(0)?,
                        cpu: row.get(1)?,
                        memory: row.get(2)?,
                        disk: row.get(3)?,
                        net_rx: row.get(4)?,
                        net_tx: row.get(5)?,
                        ping_ms: row.get(6).ok(),
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
    };

    Ok(Json(HistoryResponse {
        server_id,
        range: query.range,
        data,
    }))
}

// ============================================================================
// Metrics Handlers
// ============================================================================

#[derive(Debug, Serialize)]
pub struct LocalMetricsResponse {
    #[serde(flatten)]
    pub metrics: SystemMetrics,
    pub local_node: LocalNodeConfig,
}

pub async fn get_metrics(State(state): State<AppState>) -> Json<LocalMetricsResponse> {
    let mut sys = System::new_all();
    let disks = Disks::new_with_refreshed_list();
    let networks = Networks::new_with_refreshed_list();

    std::thread::sleep(StdDuration::from_millis(200));
    sys.refresh_cpu_specifics(CpuRefreshKind::everything());

    let metrics = collect_metrics(&mut sys, &disks, &networks);
    let config = state.config.read().await;
    
    Json(LocalMetricsResponse {
        metrics,
        local_node: config.local_node.clone(),
    })
}

pub async fn get_all_metrics(State(state): State<AppState>) -> Json<Vec<ServerMetricsUpdate>> {
    let config = state.config.read().await;
    let agent_metrics = state.agent_metrics.read().await;

    let updates: Vec<ServerMetricsUpdate> = config
        .servers
        .iter()
        .map(|server| {
            let metrics_data = agent_metrics.get(&server.id);
            let online = metrics_data
                .map(|m| Utc::now().signed_duration_since(m.last_updated).num_seconds() < 30)
                .unwrap_or(false);

            let version = metrics_data
                .and_then(|m| m.metrics.version.clone())
                .unwrap_or_else(|| server.version.clone());

            ServerMetricsUpdate {
                server_id: server.id.clone(),
                server_name: server.name.clone(),
                location: server.location.clone(),
                provider: server.provider.clone(),
                tag: server.tag.clone(),
                version,
                ip: server.ip.clone(),
                online,
                metrics: metrics_data.map(|m| m.metrics.clone()),
            }
        })
        .collect();

    Json(updates)
}

// ============================================================================
// Installation Script Handlers
// ============================================================================

const AGENT_SCRIPT: &str = include_str!("../scripts/agent.sh");

pub async fn get_agent_script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        AGENT_SCRIPT,
    )
}

pub async fn get_install_command(
    State(_state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<InstallCommand>, StatusCode> {
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(get_jwt_secret().as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("localhost:3001");
    let protocol = if host.starts_with("localhost") || host.starts_with("127.") {
        "http"
    } else {
        "https"
    };
    let base_url = format!("{}://{}", protocol, host);

    let command = format!(
        r#"curl -fsSL {}/agent.sh | sudo bash -s -- --server {} --token "{}" --name "$(hostname)""#,
        base_url, base_url, token
    );

    Ok(Json(InstallCommand {
        command,
        script_url: format!("{}/agent.sh", base_url),
    }))
}

// ============================================================================
// Update Agent Handler
// ============================================================================

pub async fn update_agent(
    State(state): State<AppState>,
    Path(server_id): Path<String>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<Json<UpdateAgentResponse>, StatusCode> {
    use crate::types::AgentCommand;
    use axum::extract::ws::Message;

    // Check if agent is connected
    let connections = state.agent_connections.read().await;
    
    if let Some(sender) = connections.get(&server_id) {
        // Send update command to agent
        let cmd = AgentCommand {
            cmd_type: "command".to_string(),
            command: "update".to_string(),
            download_url: req.download_url,
        };
        
        if let Ok(json) = serde_json::to_string(&cmd) {
            if sender.send(Message::Text(json.into())).await.is_ok() {
                tracing::info!("Update command sent to agent {}", server_id);
                return Ok(Json(UpdateAgentResponse {
                    success: true,
                    message: "Update command sent to agent".to_string(),
                }));
            }
        }
        
        Ok(Json(UpdateAgentResponse {
            success: false,
            message: "Failed to send update command".to_string(),
        }))
    } else {
        Ok(Json(UpdateAgentResponse {
            success: false,
            message: "Agent is not connected".to_string(),
        }))
    }
}

// ============================================================================
// Health Check
// ============================================================================

pub async fn health_check() -> &'static str {
    "OK"
}

// ============================================================================
// Version Check Handlers
// ============================================================================

#[derive(Debug, Serialize)]
pub struct VersionInfo {
    pub current: String,
    pub latest: Option<String>,
    pub update_available: bool,
}

#[derive(Debug, Serialize)]
pub struct ServerVersionInfo {
    pub version: String,
}

pub async fn get_server_version() -> Json<ServerVersionInfo> {
    Json(ServerVersionInfo {
        version: SERVER_VERSION.to_string(),
    })
}

pub async fn check_latest_version() -> Result<Json<VersionInfo>, StatusCode> {
    let current = SERVER_VERSION.to_string();
    
    // Fetch latest version from GitHub releases
    let latest = match fetch_latest_github_version("zsai001", "vstats").await {
        Ok(version) => Some(version),
        Err(_) => None,
    };
    
    let update_available = latest.as_ref()
        .map(|v| v != &current)
        .unwrap_or(false);
    
    Ok(Json(VersionInfo {
        current,
        latest,
        update_available,
    }))
}

async fn fetch_latest_github_version(owner: &str, repo: &str) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
    let client = reqwest::Client::builder()
        .user_agent("vstats-server")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }
    
    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;
    
    let tag_name = json.get("tag_name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No tag_name in response".to_string())?;
    
    // Remove 'v' prefix if present
    Ok(tag_name.trim_start_matches('v').to_string())
}

