use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    response::IntoResponse,
};
use chrono::Utc;
use futures::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::sync::mpsc;

use crate::db::store_metrics;
use crate::state::AppState;
use crate::types::{AgentMessage, AgentMetricsData, DashboardMessage, ServerMetricsUpdate};

// ============================================================================
// Dashboard WebSocket Handler
// ============================================================================

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_dashboard_socket(socket, state))
}

async fn handle_dashboard_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.metrics_tx.subscribe();

    // Send initial state with site settings
    {
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

        let msg = DashboardMessage {
            msg_type: "metrics".to_string(),
            servers: updates,
            site_settings: Some(config.site_settings.clone()),
        };

        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = sender.send(Message::Text(json.into())).await;
        }
    }

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

// ============================================================================
// Agent WebSocket Handler
// ============================================================================

pub async fn agent_ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    let client_ip = addr.ip().to_string();
    ws.on_upgrade(move |socket| handle_agent_socket(socket, state, client_ip))
}

async fn handle_agent_socket(socket: WebSocket, state: AppState, client_ip: String) {
    let (mut sender, mut receiver) = socket.split();
    let mut authenticated_server_id: Option<String> = None;
    
    // Create channel for sending commands to this agent
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<Message>(16);
    
    tracing::debug!("Agent connection from IP: {}", client_ip);

    loop {
        tokio::select! {
            // Handle incoming messages from agent
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(agent_msg) = serde_json::from_str::<AgentMessage>(&text) {
                            match agent_msg.msg_type.as_str() {
                                "auth" => {
                                    if let (Some(server_id), Some(token)) =
                                        (agent_msg.server_id, agent_msg.token)
                                    {
                                        let config = state.config.read().await;
                                        if let Some(server) =
                                            config.servers.iter().find(|s| s.id == server_id)
                                        {
                                            if server.token == token {
                                                authenticated_server_id = Some(server_id.clone());
                                                
                                                // Register this agent's command channel
                                                {
                                                    let mut connections = state.agent_connections.write().await;
                                                    connections.insert(server_id.clone(), cmd_tx.clone());
                                                }
                                                
                                                let _ = sender
                                                    .send(Message::Text(
                                                        r#"{"type":"auth","status":"ok"}"#.into(),
                                                    ))
                                                    .await;
                                                tracing::info!("Agent {} authenticated and registered", server_id);
                                            } else {
                                                let _ = sender
                                                    .send(Message::Text(
                                                        r#"{"type":"auth","status":"error","message":"Invalid token"}"#
                                                            .into(),
                                                    ))
                                                    .await;
                                            }
                                        } else {
                                            let _ = sender
                                                .send(Message::Text(
                                                    r#"{"type":"auth","status":"error","message":"Server not found"}"#
                                                        .into(),
                                                ))
                                                .await;
                                        }
                                    }
                                }
                                "metrics" => {
                                    if let Some(ref server_id) = authenticated_server_id {
                                        if let Some(metrics) = agent_msg.metrics {
                                            // Store to database
                                            {
                                                let db = state.db.lock().await;
                                                if let Err(e) = store_metrics(&db, server_id, &metrics) {
                                                    tracing::warn!("Failed to store metrics: {}", e);
                                                }
                                            }

                                            // Determine the IP address to use:
                                            // 1. Use agent-reported IPs if available
                                            // 2. Fall back to client connection IP
                                            let agent_ip = metrics.ip_addresses
                                                .as_ref()
                                                .and_then(|ips| ips.first().cloned())
                                                .unwrap_or_else(|| client_ip.clone());

                                            // Update version and IP in server config if provided
                                            {
                                                let mut config = state.config.write().await;
                                                if let Some(server) = config.servers.iter_mut().find(|s| s.id == *server_id) {
                                                    let mut changed = false;
                                                    
                                                    if let Some(ref version) = metrics.version {
                                                        if server.version != *version {
                                                            server.version = version.clone();
                                                            changed = true;
                                                        }
                                                    }
                                                    
                                                    // Update IP if changed
                                                    if server.ip != agent_ip {
                                                        server.ip = agent_ip.clone();
                                                        changed = true;
                                                        tracing::info!("Agent {} IP updated to: {}", server_id, agent_ip);
                                                    }
                                                    
                                                    if changed {
                                                        crate::config::save_config(&config);
                                                    }
                                                }
                                            }

                                            // Update in-memory state
                                            let mut agent_metrics = state.agent_metrics.write().await;
                                            agent_metrics.insert(
                                                server_id.clone(),
                                                AgentMetricsData {
                                                    server_id: server_id.clone(),
                                                    metrics: metrics.clone(),
                                                    last_updated: Utc::now(),
                                                },
                                            );

                                            // Broadcast to dashboard clients
                                            let config = state.config.read().await;
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

                                            let msg = DashboardMessage {
                                                msg_type: "metrics".to_string(),
                                                servers: updates,
                                                site_settings: None,
                                            };

                                            if let Ok(json) = serde_json::to_string(&msg) {
                                                let _ = state.metrics_tx.send(json);
                                            }
                                        }
                                    } else {
                                        let _ = sender
                                            .send(Message::Text(
                                                r#"{"type":"error","message":"Not authenticated"}"#.into(),
                                            ))
                                            .await;
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            
            // Handle commands from server to agent
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(message) => {
                        if sender.send(message).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    // Cleanup on disconnect
    if let Some(server_id) = authenticated_server_id {
        tracing::info!("Agent {} disconnected", server_id);
        
        // Remove from active connections
        {
            let mut connections = state.agent_connections.write().await;
            connections.remove(&server_id);
        }
        
        let config = state.config.read().await;
        let agent_metrics = state.agent_metrics.read().await;

        let updates: Vec<ServerMetricsUpdate> = config
            .servers
            .iter()
            .map(|server| {
                let metrics_data = agent_metrics.get(&server.id);
                let online = if server.id == server_id {
                    false
                } else {
                    metrics_data
                        .map(|m| {
                            Utc::now()
                                .signed_duration_since(m.last_updated)
                                .num_seconds()
                                < 30
                        })
                        .unwrap_or(false)
                };

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

        let msg = DashboardMessage {
            msg_type: "metrics".to_string(),
            servers: updates,
            site_settings: None,
        };

        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = state.metrics_tx.send(json);
        }
    }
}

