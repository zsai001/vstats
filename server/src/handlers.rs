use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rusqlite::params;
use std::{collections::HashMap, time::Duration as StdDuration};
use sysinfo::{CpuRefreshKind, Disks, Networks, System};

use crate::collector::collect_metrics;
use crate::config::{get_jwt_secret, save_config, RemoteServer, SiteSettings};
use crate::state::AppState;
use crate::types::{
    AddServerRequest, AgentRegisterRequest, AgentRegisterResponse, ChangePasswordRequest, Claims,
    HistoryPoint, HistoryQuery, HistoryResponse, InstallCommand, LoginRequest, LoginResponse,
    ServerMetricsUpdate, SystemMetrics,
};

// ============================================================================
// Auth Handlers
// ============================================================================

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    let config = state.config.read().await;

    if bcrypt::verify(&req.password, &config.admin_password_hash).unwrap_or(false) {
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
    let mut config = state.config.write().await;

    if bcrypt::verify(&req.current_password, &config.admin_password_hash).unwrap_or(false) {
        config.admin_password_hash = bcrypt::hash(&req.new_password, bcrypt::DEFAULT_COST)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        save_config(&config);
        Ok(StatusCode::OK)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
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
        token: agent_token,
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
        token: agent_token.clone(),
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
                    r#"SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx
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
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "24h" => {
            let cutoff = (Utc::now() - Duration::hours(24)).to_rfc3339();
            let mut stmt = db
                .prepare(
                    r#"SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx
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
                    })
                })
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            rows.filter_map(|r| r.ok()).collect()
        }
        "7d" => {
            let cutoff = (Utc::now() - Duration::days(7)).to_rfc3339();
            let mut stmt = db
                .prepare(
                    r#"SELECT hour_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total
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
                    r#"SELECT date, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total
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
                    r#"SELECT date, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total
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

pub async fn get_metrics() -> Json<SystemMetrics> {
    let mut sys = System::new_all();
    let disks = Disks::new_with_refreshed_list();
    let networks = Networks::new_with_refreshed_list();

    std::thread::sleep(StdDuration::from_millis(200));
    sys.refresh_cpu_specifics(CpuRefreshKind::everything());

    Json(collect_metrics(&mut sys, &disks, &networks))
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

            ServerMetricsUpdate {
                server_id: server.id.clone(),
                server_name: server.name.clone(),
                location: server.location.clone(),
                provider: server.provider.clone(),
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
        r#"curl -fsSL {}/agent.sh | sudo bash -s -- --server {} --token "{}" --name "$(hostname)" --location "Unknown" --provider "Unknown""#,
        base_url, base_url, token
    );

    Ok(Json(InstallCommand {
        command,
        script_url: format!("{}/agent.sh", base_url),
    }))
}

// ============================================================================
// Health Check
// ============================================================================

pub async fn health_check() -> &'static str {
    "OK"
}

