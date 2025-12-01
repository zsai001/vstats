use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    http::{Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, delete},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration as StdDuration};
use sysinfo::{CpuRefreshKind, Disks, Networks, System};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

// ============================================================================
// Configuration
// ============================================================================

const JWT_SECRET: &str = "xprob-super-secret-key-change-in-production";
const CONFIG_FILE: &str = "xprob-config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub admin_password_hash: String,
    pub servers: Vec<RemoteServer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    pub url: String,
    pub location: String,
    pub provider: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        // Default password: admin
        let hash = bcrypt::hash("admin", bcrypt::DEFAULT_COST).unwrap();
        Self {
            admin_password_hash: hash,
            servers: vec![],
        }
    }
}

fn load_config() -> AppConfig {
    let path = PathBuf::from(CONFIG_FILE);
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        let config = AppConfig::default();
        save_config(&config);
        config
    }
}

fn save_config(config: &AppConfig) {
    let content = serde_json::to_string_pretty(config).unwrap();
    fs::write(CONFIG_FILE, content).ok();
}

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
    pub url: String,
    pub location: String,
    pub provider: String,
}

// ============================================================================
// App State
// ============================================================================

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<AppConfig>>,
    pub metrics_tx: broadcast::Sender<String>,
}

// ============================================================================
// Data Models (System Metrics)
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
// System Info Collector
// ============================================================================

fn collect_metrics(sys: &mut System, disks: &Disks, networks: &Networks) -> SystemMetrics {
    sys.refresh_all();

    let cpu_usage: Vec<f32> = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();
    let avg_cpu = if cpu_usage.is_empty() {
        0.0
    } else {
        cpu_usage.iter().sum::<f32>() / cpu_usage.len() as f32
    };

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let cpu_freq = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);

    let disk_metrics: Vec<DiskMetrics> = disks
        .list()
        .iter()
        .map(|disk| {
            let total = disk.total_space();
            let available = disk.available_space();
            let used = total.saturating_sub(available);
            let usage = if total > 0 {
                (used as f32 / total as f32) * 100.0
            } else {
                0.0
            };

            DiskMetrics {
                name: disk.name().to_string_lossy().to_string(),
                mount_point: disk.mount_point().to_string_lossy().to_string(),
                fs_type: disk.file_system().to_string_lossy().to_string(),
                total,
                used,
                available,
                usage_percent: usage,
            }
        })
        .collect();

    let mut total_rx = 0u64;
    let mut total_tx = 0u64;
    let interfaces: Vec<NetworkInterface> = networks
        .list()
        .iter()
        .map(|(name, data)| {
            total_rx += data.total_received();
            total_tx += data.total_transmitted();
            NetworkInterface {
                name: name.clone(),
                rx_bytes: data.total_received(),
                tx_bytes: data.total_transmitted(),
                rx_packets: data.total_packets_received(),
                tx_packets: data.total_packets_transmitted(),
            }
        })
        .collect();

    let total_mem = sys.total_memory();
    let used_mem = sys.used_memory();
    let mem_usage = if total_mem > 0 {
        (used_mem as f32 / total_mem as f32) * 100.0
    } else {
        0.0
    };

    let load_avg = System::load_average();

    SystemMetrics {
        timestamp: Utc::now(),
        hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
        os: OsInfo {
            name: System::name().unwrap_or_else(|| "Unknown".to_string()),
            version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
            kernel: System::kernel_version().unwrap_or_else(|| "Unknown".to_string()),
            arch: std::env::consts::ARCH.to_string(),
        },
        cpu: CpuMetrics {
            brand: cpu_brand,
            cores: sys.cpus().len(),
            usage: avg_cpu,
            frequency: cpu_freq,
            per_core: cpu_usage,
        },
        memory: MemoryMetrics {
            total: total_mem,
            used: used_mem,
            available: sys.available_memory(),
            swap_total: sys.total_swap(),
            swap_used: sys.used_swap(),
            usage_percent: mem_usage,
        },
        disks: disk_metrics,
        network: NetworkMetrics {
            interfaces,
            total_rx,
            total_tx,
        },
        uptime: System::uptime(),
        load_average: LoadAverage {
            one: load_avg.one,
            five: load_avg.five,
            fifteen: load_avg.fifteen,
        },
    }
}

// ============================================================================
// Auth Handlers
// ============================================================================

async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, StatusCode> {
    let config = state.config.read().await;
    
    if bcrypt::verify(&req.password, &config.admin_password_hash).unwrap_or(false) {
        let expires_at = Utc::now() + Duration::hours(24);
        let claims = Claims {
            sub: "admin".to_string(),
            exp: expires_at.timestamp(),
        };
        
        let token = encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(JWT_SECRET.as_bytes()),
        ).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        
        Ok(Json(LoginResponse { token, expires_at }))
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn verify_token(
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
        &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
        &Validation::default(),
    ).map_err(|_| StatusCode::UNAUTHORIZED)?;
    
    let mut result = HashMap::new();
    result.insert("status".to_string(), "valid".to_string());
    Ok(Json(result))
}

async fn change_password(
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
// Server Management Handlers
// ============================================================================

async fn get_servers(
    State(state): State<AppState>,
) -> Json<Vec<RemoteServer>> {
    let config = state.config.read().await;
    Json(config.servers.clone())
}

async fn add_server(
    State(state): State<AppState>,
    Json(req): Json<AddServerRequest>,
) -> Result<Json<RemoteServer>, StatusCode> {
    let mut config = state.config.write().await;
    
    let server = RemoteServer {
        id: uuid::Uuid::new_v4().to_string(),
        name: req.name,
        url: req.url,
        location: req.location,
        provider: req.provider,
    };
    
    config.servers.push(server.clone());
    save_config(&config);
    
    Ok(Json(server))
}

async fn delete_server(
    State(state): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> StatusCode {
    let mut config = state.config.write().await;
    config.servers.retain(|s| s.id != id);
    save_config(&config);
    StatusCode::OK
}

// ============================================================================
// Metrics Handlers
// ============================================================================

async fn get_metrics() -> Json<SystemMetrics> {
    let mut sys = System::new_all();
    let disks = Disks::new_with_refreshed_list();
    let networks = Networks::new_with_refreshed_list();

    std::thread::sleep(StdDuration::from_millis(200));
    sys.refresh_cpu_specifics(CpuRefreshKind::everything());

    Json(collect_metrics(&mut sys, &disks, &networks))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state.metrics_tx))
}

async fn handle_socket(socket: WebSocket, tx: broadcast::Sender<String>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = tx.subscribe();

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }
}

async fn health_check() -> &'static str {
    "OK"
}

// ============================================================================
// Installation Script Handlers
// ============================================================================

const AGENT_SCRIPT: &str = include_str!("../../scripts/agent.sh");

#[derive(Debug, Serialize)]
pub struct InstallCommand {
    pub command: String,
    pub script_url: String,
}

async fn get_agent_script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        AGENT_SCRIPT,
    )
}

async fn get_install_command(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<InstallCommand>, StatusCode> {
    // Extract token from header
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    // Verify token
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
        &Validation::default(),
    ).map_err(|_| StatusCode::UNAUTHORIZED)?;
    
    // Get host from request or config
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
    let script_url = format!("{}/agent.sh", base_url);
    
    let command = format!(
        r#"curl -fsSL {}/agent.sh | bash -s -- \
  --server {} \
  --token "{}" \
  --name "$(hostname)" \
  --location "Unknown" \
  --provider "Unknown""#,
        base_url, base_url, token
    );
    
    Ok(Json(InstallCommand { command, script_url }))
}

// ============================================================================
// Auth Middleware
// ============================================================================

async fn auth_middleware(
    headers: axum::http::HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());
    
    if let Some(auth) = auth_header {
        if let Some(token) = auth.strip_prefix("Bearer ") {
            if decode::<Claims>(
                token,
                &DecodingKey::from_secret(JWT_SECRET.as_bytes()),
                &Validation::default(),
            ).is_ok() {
                return next.run(request).await;
            }
        }
    }
    
    StatusCode::UNAUTHORIZED.into_response()
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = load_config();
    let (tx, _) = broadcast::channel::<String>(16);
    
    let state = AppState {
        config: Arc::new(RwLock::new(config)),
        metrics_tx: tx.clone(),
    };

    // Background task to broadcast metrics
    let tx_clone = tx.clone();
    tokio::spawn(async move {
        let mut sys = System::new_all();
        let mut disks = Disks::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();

        loop {
            tokio::time::sleep(StdDuration::from_secs(1)).await;

            sys.refresh_cpu_specifics(CpuRefreshKind::everything());
            sys.refresh_memory();
            disks.refresh();
            networks.refresh();

            let metrics = collect_metrics(&mut sys, &disks, &networks);
            if let Ok(json) = serde_json::to_string(&metrics) {
                let _ = tx_clone.send(json);
            }
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    // Protected routes (require auth)
    let protected_routes = Router::new()
        .route("/api/servers", post(add_server))
        .route("/api/servers/{id}", delete(delete_server))
        .route("/api/auth/password", post(change_password))
        .layer(middleware::from_fn(auth_middleware));

    // Public routes
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/metrics", get(get_metrics))
        .route("/api/servers", get(get_servers))
        .route("/api/auth/login", post(login))
        .route("/api/auth/verify", get(verify_token))
        .route("/api/install-command", get(get_install_command))
        .route("/agent.sh", get(get_agent_script))
        .route("/ws", get(ws_handler))
        .merge(protected_routes)
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    tracing::info!("🚀 Server running on http://{}", addr);
    tracing::info!("📝 Default password: admin");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
