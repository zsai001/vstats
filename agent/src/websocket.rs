use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::time::{interval, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};

use crate::config::AgentConfig;
use crate::metrics::MetricsCollector;
use crate::types::{AuthMessage, MetricsMessage, ServerResponse};

const INITIAL_RECONNECT_DELAY: Duration = Duration::from_secs(5);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(60);
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const PING_INTERVAL: Duration = Duration::from_secs(30);

pub struct WebSocketClient {
    config: AgentConfig,
    collector: MetricsCollector,
}

impl WebSocketClient {
    pub fn new(config: AgentConfig) -> Self {
        Self {
            config,
            collector: MetricsCollector::new(),
        }
    }
    
    /// Handle update command from server
    async fn handle_update_command(&self, download_url: Option<&str>) {
        info!("Starting self-update process...");
        
        // Get the current executable path
        let current_exe = match std::env::current_exe() {
            Ok(path) => path,
            Err(e) => {
                error!("Failed to get current executable path: {}", e);
                return;
            }
        };
        
        // Determine download URL
        let url = if let Some(url) = download_url {
            url.to_string()
        } else {
            // Default to the server's agent binary endpoint
            format!("{}/releases/vstats-agent", self.config.dashboard_url.trim_end_matches('/'))
        };
        
        info!("Downloading update from: {}", url);
        
        // Download to a temporary file
        let temp_path = current_exe.with_extension("new");
        
        match self.download_file(&url, &temp_path).await {
            Ok(_) => {
                info!("Download complete, applying update...");
                
                // On Unix, we need to set execute permissions
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = std::fs::metadata(&temp_path) {
                        let mut perms = metadata.permissions();
                        perms.set_mode(0o755);
                        if let Err(e) = std::fs::set_permissions(&temp_path, perms) {
                            error!("Failed to set permissions: {}", e);
                            return;
                        }
                    }
                }
                
                // Backup current executable
                let backup_path = current_exe.with_extension("backup");
                if let Err(e) = std::fs::rename(&current_exe, &backup_path) {
                    error!("Failed to backup current executable: {}", e);
                    // Try to cleanup
                    let _ = std::fs::remove_file(&temp_path);
                    return;
                }
                
                // Move new executable to current path
                if let Err(e) = std::fs::rename(&temp_path, &current_exe) {
                    error!("Failed to install new executable: {}", e);
                    // Try to restore backup
                    let _ = std::fs::rename(&backup_path, &current_exe);
                    return;
                }
                
                // Remove backup
                let _ = std::fs::remove_file(&backup_path);
                
                info!("Update installed successfully! Restarting...");
                
                // Restart the agent
                // Use systemctl if available (Linux with systemd)
                #[cfg(target_os = "linux")]
                {
                    let _ = std::process::Command::new("systemctl")
                        .args(["restart", "vstats-agent"])
                        .spawn();
                }
                
                // Exit to allow restart
                std::process::exit(0);
            }
            Err(e) => {
                error!("Failed to download update: {}", e);
            }
        }
    }
    
    /// Download a file from URL to path
    async fn download_file(&self, url: &str, path: &std::path::Path) -> Result<(), String> {
        let response = reqwest::get(url)
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;
        
        if !response.status().is_success() {
            return Err(format!("Download failed with status: {}", response.status()));
        }
        
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;
        
        std::fs::write(path, &bytes)
            .map_err(|e| format!("Failed to write file: {}", e))?;
        
        Ok(())
    }
    
    /// Run the WebSocket client with automatic reconnection
    pub async fn run(&mut self) {
        let mut reconnect_delay = INITIAL_RECONNECT_DELAY;
        
        loop {
            info!("Connecting to {}...", self.config.ws_url());
            
            match self.connect_and_run().await {
                Ok(()) => {
                    info!("Connection closed normally");
                    reconnect_delay = INITIAL_RECONNECT_DELAY;
                }
                Err(e) => {
                    error!("Connection error: {}", e);
                }
            }
            
            info!("Reconnecting in {:?}...", reconnect_delay);
            tokio::time::sleep(reconnect_delay).await;
            
            // Exponential backoff
            reconnect_delay = std::cmp::min(reconnect_delay * 2, MAX_RECONNECT_DELAY);
        }
    }
    
    async fn connect_and_run(&mut self) -> Result<(), String> {
        let ws_url = self.config.ws_url();
        
        // Connect to WebSocket
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| format!("Failed to connect: {}", e))?;
        
        info!("Connected to WebSocket server");
        
        let (mut write, mut read) = ws_stream.split();
        
        // Send authentication message
        let auth_msg = AuthMessage {
            msg_type: "auth".to_string(),
            server_id: self.config.server_id.clone(),
            token: self.config.agent_token.clone(),
        };
        
        let auth_json = serde_json::to_string(&auth_msg)
            .map_err(|e| format!("Failed to serialize auth message: {}", e))?;
        
        write.send(Message::Text(auth_json))
            .await
            .map_err(|e| format!("Failed to send auth message: {}", e))?;
        
        info!("Sent authentication message");
        
        // Wait for auth response with timeout
        let auth_response = timeout(AUTH_TIMEOUT, read.next())
            .await
            .map_err(|_| "Auth response timeout".to_string())?
            .ok_or("Connection closed before auth response")?
            .map_err(|e| format!("Failed to receive auth response: {}", e))?;
        
        // Parse auth response
        if let Message::Text(text) = auth_response {
            let response: ServerResponse = serde_json::from_str(&text)
                .map_err(|e| format!("Failed to parse auth response: {}", e))?;
            
            if response.status.as_deref() != Some("ok") {
                return Err(format!(
                    "Authentication failed: {}",
                    response.message.unwrap_or_else(|| "Unknown error".to_string())
                ));
            }
            
            // Update ping targets from server config if provided
            if let Some(ping_targets) = response.ping_targets {
                if !ping_targets.is_empty() {
                    info!("Received {} ping targets from server", ping_targets.len());
                    self.collector.set_ping_targets(ping_targets);
                }
            }
            
            info!("Authentication successful!");
        } else {
            return Err("Unexpected auth response type".to_string());
        }
        
        // Start metrics sending loop
        let interval_duration = Duration::from_secs(self.config.interval_secs);
        let mut metrics_interval = interval(interval_duration);
        let mut ping_interval = interval(PING_INTERVAL);
        
        loop {
            tokio::select! {
                // Send metrics at regular interval
                _ = metrics_interval.tick() => {
                    let metrics = self.collector.collect();
                    let msg = MetricsMessage {
                        msg_type: "metrics".to_string(),
                        metrics,
                    };
                    
                    match serde_json::to_string(&msg) {
                        Ok(json) => {
                            if let Err(e) = write.send(Message::Text(json)).await {
                                return Err(format!("Failed to send metrics: {}", e));
                            }
                        }
                        Err(e) => {
                            warn!("Failed to serialize metrics: {}", e);
                        }
                    }
                }
                
                // Send ping to keep connection alive
                _ = ping_interval.tick() => {
                    if let Err(e) = write.send(Message::Ping(vec![])).await {
                        return Err(format!("Failed to send ping: {}", e));
                    }
                }
                
                // Handle incoming messages
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Close(_))) => {
                            info!("Server closed connection");
                            return Ok(());
                        }
                        Some(Ok(Message::Pong(_))) => {
                            // Pong received, connection is alive
                        }
                        Some(Ok(Message::Text(text))) => {
                            // Handle server messages
                            if let Ok(response) = serde_json::from_str::<ServerResponse>(&text) {
                                match response.msg_type.as_str() {
                                    "error" => {
                                        warn!("Server error: {:?}", response.message);
                                    }
                                    "command" => {
                                        if let Some(command) = response.command.as_deref() {
                                            match command {
                                                "update" => {
                                                    info!("Received update command from server");
                                                    self.handle_update_command(response.download_url.as_deref()).await;
                                                }
                                                _ => {
                                                    warn!("Unknown command: {}", command);
                                                }
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Err(e)) => {
                            return Err(format!("WebSocket error: {}", e));
                        }
                        None => {
                            return Err("Connection closed unexpectedly".to_string());
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

