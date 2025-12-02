mod collector;
mod config;
mod db;
mod handlers;
mod middleware;
mod state;
mod types;
mod websocket;

use axum::{
    http::{Method, Uri},
    middleware as axum_middleware,
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post, put},
    Router,
};
use chrono::{Timelike, Utc};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use sysinfo::{CpuRefreshKind, Disks, Networks, System};
use tokio::sync::{broadcast, Mutex, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::{get_config_path, get_db_path, load_config, reset_admin_password};
use crate::db::{aggregate_daily, aggregate_hourly, cleanup_old_data, init_database};
use crate::handlers::{
    add_server, change_password, check_latest_version, delete_server, get_agent_script, get_all_metrics, get_history,
    get_install_command, get_local_node_config, get_metrics, get_probe_settings, get_servers, get_server_version, get_site_settings, health_check, login,
    register_agent, update_agent, update_local_node_config, update_probe_settings, update_server, update_site_settings, verify_token,
};
use crate::middleware::auth_middleware;
use crate::state::AppState;
use crate::types::{DashboardMessage, ServerMetricsUpdate};
use crate::websocket::{agent_ws_handler, ws_handler};

// ============================================================================
// Static File Serving
// ============================================================================

const EMBEDDED_INDEX_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>vStats - Server Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #e8e8e8; min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(90deg, #00d9ff, #00ff88); 
         -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #888; margin-bottom: 2rem; }
    .status { background: rgba(0,217,255,0.1); border: 1px solid rgba(0,217,255,0.3);
              border-radius: 12px; padding: 2rem; margin-top: 2rem; }
    .status h2 { color: #00d9ff; margin-bottom: 1rem; }
    code { background: rgba(0,0,0,0.3); padding: 0.5rem 1rem; border-radius: 6px; 
           display: block; margin: 0.5rem 0; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>vStats</h1>
    <p>Server Monitoring Dashboard</p>
    <div class="status">
      <h2>Server is Running</h2>
      <p>Web assets not found. API is available at:</p>
      <code>GET /api/metrics</code>
      <code>GET /api/history/:server_id?range=1h|24h|7d|30d</code>
      <code>GET /api/settings/site</code>
    </div>
  </div>
</body>
</html>"#;

fn get_web_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("VSTATS_WEB_DIR") {
        let path = PathBuf::from(&dir);
        if path.exists() && path.join("index.html").exists() {
            return path;
        }
        let dist = path.join("dist");
        if dist.exists() && dist.join("index.html").exists() {
            return dist;
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for path in &[
                exe_dir.join("../web/dist"),
                exe_dir.join("web/dist"),
                exe_dir.join("../../web/dist"),
                exe_dir.join("../dist"),
            ] {
                if path.exists() && path.join("index.html").exists() {
                    return path.clone();
                }
            }
        }
    }

    for path in &[
        PathBuf::from("./web/dist"),
        PathBuf::from("./web"),
        PathBuf::from("./dist"),
        PathBuf::from("../web/dist"),
    ] {
        if path.exists() && path.join("index.html").exists() {
            return path.clone();
        }
    }

    PathBuf::from("./web/dist")
}

async fn fallback_handler(_uri: Uri) -> Response {
    let web_dir = get_web_dir();
    let web_dir_abs = web_dir.canonicalize().unwrap_or_else(|_| web_dir.clone());
    let index_path = web_dir_abs.join("index.html");

    if index_path.exists() {
        if let Ok(content) = tokio::fs::read_to_string(&index_path).await {
            return Html(content).into_response();
        }
    }

    Html(EMBEDDED_INDEX_HTML).into_response()
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() {
    // Check for command line arguments
    let args: Vec<String> = std::env::args().collect();
    
    // --check: Show diagnostic info
    if args.iter().any(|a| a == "--check") {
        let config_path = get_config_path();
        let db_path = get_db_path();
        println!("\n╔════════════════════════════════════════════════════════════════╗");
        println!("║                    🔍 DIAGNOSTICS                              ║");
        println!("╠════════════════════════════════════════════════════════════════╣");
        println!("║  Executable: {:<48} ║", std::env::current_exe().map(|p| p.display().to_string()).unwrap_or("unknown".into()));
        println!("║  Config: {:<52} ║", config_path.display());
        println!("║  Config exists: {:<45} ║", config_path.exists());
        println!("║  Database: {:<50} ║", db_path.display());
        println!("║  Database exists: {:<43} ║", db_path.exists());
        
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
                    let has_hash = config.get("admin_password_hash")
                        .and_then(|v| v.as_str())
                        .map(|h| h.starts_with("$2"))
                        .unwrap_or(false);
                    println!("║  Password hash valid: {:<39} ║", has_hash);
                    let servers = config.get("servers")
                        .and_then(|v| v.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    println!("║  Servers configured: {:<40} ║", servers);
                } else {
                    println!("║  ⚠️  Config file is corrupted!                                 ║");
                }
            }
        }
        println!("╚════════════════════════════════════════════════════════════════╝\n");
        return;
    }
    
    // --reset-password: Reset admin password
    if args.iter().any(|a| a == "--reset-password") {
        let config_path = get_config_path();
        let new_password = reset_admin_password();
        println!("\n╔════════════════════════════════════════════════════════════════╗");
        println!("║                    🔑 PASSWORD RESET                           ║");
        println!("╠════════════════════════════════════════════════════════════════╣");
        println!("║  New admin password: {:<40} ║", new_password);
        println!("║  Config file: {:<47} ║", config_path.display());
        println!("╚════════════════════════════════════════════════════════════════╝\n");
        return;
    }

    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Initialize database
    let db = init_database().expect("Failed to initialize database");
    tracing::info!("📦 Database initialized: {}", get_db_path().display());
    tracing::info!("⚙️  Config file: {}", get_config_path().display());

    let (config, initial_password) = load_config();
    
    // If this is first run, show the generated password
    if let Some(password) = initial_password {
        tracing::info!("╔════════════════════════════════════════════════════════════════╗");
        tracing::info!("║              🎉 FIRST RUN - SAVE YOUR PASSWORD!               ║");
        tracing::info!("╠════════════════════════════════════════════════════════════════╣");
        tracing::info!("║  Admin password: {:<44} ║", password);
        tracing::info!("║                                                                ║");
        tracing::info!("║  ⚠️  Save this password! It won't be shown again.              ║");
        tracing::info!("║  To reset: ./vstats-server --reset-password                    ║");
        tracing::info!("╚════════════════════════════════════════════════════════════════╝");
    }
    
    let (tx, _) = broadcast::channel::<String>(16);

    let state = AppState {
        config: Arc::new(RwLock::new(config)),
        metrics_tx: tx.clone(),
        agent_metrics: Arc::new(RwLock::new(HashMap::new())),
        db: Arc::new(Mutex::new(db)),
        agent_connections: Arc::new(RwLock::new(HashMap::new())),
    };

    // Background task for metrics broadcasting and data aggregation
    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut sys = System::new_all();
        let mut disks = Disks::new_with_refreshed_list();
        let mut networks = Networks::new_with_refreshed_list();
        let mut last_hour = Utc::now().hour();
        let mut last_aggregation = Utc::now();

        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            sys.refresh_cpu_specifics(CpuRefreshKind::everything());
            sys.refresh_memory();
            disks.refresh();
            networks.refresh();

            // Check for hourly aggregation
            let current_hour = Utc::now().hour();
            if current_hour != last_hour {
                last_hour = current_hour;
                let db = state_clone.db.lock().await;
                if let Err(e) = aggregate_hourly(&db) {
                    tracing::warn!("Failed to aggregate hourly data: {}", e);
                }
                if let Err(e) = aggregate_daily(&db) {
                    tracing::warn!("Failed to aggregate daily data: {}", e);
                }
            }

            // Cleanup old data every hour
            if Utc::now()
                .signed_duration_since(last_aggregation)
                .num_hours()
                >= 1
            {
                last_aggregation = Utc::now();
                let db = state_clone.db.lock().await;
                if let Err(e) = cleanup_old_data(&db) {
                    tracing::warn!("Failed to cleanup old data: {}", e);
                }
            }

            // Broadcast metrics
            let config = state_clone.config.read().await;
            let agent_metrics = state_clone.agent_metrics.read().await;

            let updates: Vec<ServerMetricsUpdate> = config
                .servers
                .iter()
                .map(|server| {
                    let metrics_data = agent_metrics.get(&server.id);
                    let online = metrics_data
                        .map(|m| {
                            Utc::now()
                                .signed_duration_since(m.last_updated)
                                .num_seconds()
                                < 30
                        })
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

            if !updates.is_empty() {
                let msg = DashboardMessage {
                    msg_type: "metrics".to_string(),
                    servers: updates,
                    site_settings: None,
                };

                if let Ok(json) = serde_json::to_string(&msg) {
                    let _ = state_clone.metrics_tx.send(json);
                }
            }
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::DELETE,
            Method::PUT,
            Method::OPTIONS,
        ])
        .allow_headers(Any);

    // Protected routes
    let protected_routes = Router::new()
        .route("/api/servers", post(add_server))
        .route("/api/servers/:id", delete(delete_server))
        .route("/api/servers/:id", put(update_server))
        .route("/api/servers/:id/update", post(update_agent))
        .route("/api/auth/password", post(change_password))
        .route("/api/agent/register", post(register_agent))
        .route("/api/settings/site", put(update_site_settings))
        .route("/api/settings/local-node", get(get_local_node_config))
        .route("/api/settings/local-node", put(update_local_node_config))
        .route("/api/settings/probe", get(get_probe_settings))
        .route("/api/settings/probe", put(update_probe_settings))
        .layer(axum_middleware::from_fn(auth_middleware));

    let web_dir = get_web_dir();
    let web_dir_abs = web_dir.canonicalize().unwrap_or_else(|_| web_dir.clone());
    tracing::info!("📁 Web directory: {:?}", web_dir_abs);

    let serve_dir = ServeDir::new(&web_dir_abs).not_found_service(tower::service_fn(
        |req: axum::http::Request<axum::body::Body>| async move {
            Ok::<_, std::convert::Infallible>(fallback_handler(req.uri().clone()).await)
        },
    ));

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/metrics", get(get_metrics))
        .route("/api/metrics/all", get(get_all_metrics))
        .route("/api/history/:server_id", get(get_history))
        .route("/api/servers", get(get_servers))
        .route("/api/settings/site", get(get_site_settings))
        .route("/api/auth/login", post(login))
        .route("/api/auth/verify", get(verify_token))
        .route("/api/install-command", get(get_install_command))
        .route("/api/version", get(get_server_version))
        .route("/api/version/check", get(check_latest_version))
        .route("/agent.sh", get(get_agent_script))
        .route("/ws", get(ws_handler))
        .route("/ws/agent", get(agent_ws_handler))
        .merge(protected_routes)
        .layer(cors)
        .with_state(state)
        .fallback_service(serve_dir);

    let port: u16 = std::env::var("VSTATS_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3001);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    tracing::info!("🚀 Server running on http://{}", addr);
    tracing::info!("📡 Agent WebSocket: ws://{}:{}/ws/agent", addr.ip(), port);
    tracing::info!("🔑 Reset password: ./vstats-server --reset-password");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
