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
                            // Handle server messages if needed
                            if let Ok(response) = serde_json::from_str::<ServerResponse>(&text) {
                                if response.msg_type == "error" {
                                    warn!("Server error: {:?}", response.message);
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

