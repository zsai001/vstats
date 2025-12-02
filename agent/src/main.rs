mod config;
mod metrics;
mod types;
mod websocket;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::config::AgentConfig;
use crate::types::{RegisterRequest, RegisterResponse};
use crate::websocket::WebSocketClient;

/// vStats Monitoring Agent - Push system metrics to dashboard
#[derive(Parser)]
#[command(name = "vstats-agent")]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
    
    /// Path to config file
    #[arg(short, long, global = true)]
    config: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the agent (default if no command specified)
    Run,
    
    /// Register with dashboard and create config
    Register {
        /// Dashboard server URL (e.g., http://dashboard:3001)
        #[arg(short, long)]
        server: String,
        
        /// Admin authentication token
        #[arg(short, long)]
        token: String,
        
        /// Server display name (default: hostname)
        #[arg(short, long)]
        name: Option<String>,
    },
    
    /// Install systemd service
    Install,
    
    /// Uninstall systemd service
    Uninstall,
    
    /// Show current configuration
    ShowConfig,
}

#[tokio::main]
async fn main() {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info"))
        )
        .init();
    
    let cli = Cli::parse();
    let config_path = cli.config.unwrap_or_else(AgentConfig::default_path);
    
    let result = match cli.command.unwrap_or(Commands::Run) {
        Commands::Run => run_agent(&config_path).await,
        Commands::Register { server, token, name } => {
            register_agent(&config_path, &server, &token, name).await
        }
        Commands::Install => install_service(&config_path),
        Commands::Uninstall => uninstall_service(),
        Commands::ShowConfig => show_config(&config_path),
    };
    
    if let Err(e) = result {
        error!("{}", e);
        std::process::exit(1);
    }
}

async fn run_agent(config_path: &PathBuf) -> Result<(), String> {
    info!("Loading config from {:?}", config_path);
    
    let config = AgentConfig::load(config_path)?;
    
    info!("Starting vStats agent");
    info!("  Server ID: {}", config.server_id);
    info!("  Dashboard: {}", config.dashboard_url);
    info!("  Interval: {}s", config.interval_secs);
    
    let mut client = WebSocketClient::new(config);
    client.run().await;
    
    Ok(())
}

async fn register_agent(
    config_path: &PathBuf,
    server_url: &str,
    admin_token: &str,
    name: Option<String>,
) -> Result<(), String> {
    let server_name = name.unwrap_or_else(|| {
        sysinfo::System::host_name().unwrap_or_else(|| "Unknown".to_string())
    });
    
    info!("Registering with dashboard at {}", server_url);
    info!("  Name: {}", server_name);
    
    let client = reqwest::Client::new();
    let register_url = format!("{}/api/agent/register", server_url.trim_end_matches('/'));
    
    let request = RegisterRequest {
        name: server_name.clone(),
        location: String::new(),
        provider: String::new(),
    };
    
    let response = client
        .post(&register_url)
        .header("Authorization", format!("Bearer {}", admin_token))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to send registration request: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Registration failed ({}): {}", status, text));
    }
    
    let register_response: RegisterResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registration response: {}", e))?;
    
    info!("Registration successful!");
    info!("  Server ID: {}", register_response.id);
    
    // Create config
    let config = AgentConfig {
        dashboard_url: server_url.to_string(),
        server_id: register_response.id,
        agent_token: register_response.token,
        server_name,
        location: String::new(),
        provider: String::new(),
        interval_secs: 1,
    };
    
    config.save(config_path)?;
    info!("Configuration saved to {:?}", config_path);
    
    println!();
    println!("✅ Agent registered successfully!");
    println!();
    println!("To start the agent, run:");
    println!("  vstats-agent run");
    println!();
    println!("Or install as a service:");
    println!("  sudo vstats-agent install");
    
    Ok(())
}

fn install_service(config_path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::fs;
        use std::process::Command;
        
        // Get the path to the current executable
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        let config_path_str = config_path.to_string_lossy();
        
        let service_content = format!(
            r#"[Unit]
Description=vStats Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart={} run --config {}
Restart=always
RestartSec=10
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
"#,
            exe_path.display(),
            config_path_str
        );
        
        let service_path = "/etc/systemd/system/vstats-agent.service";
        
        fs::write(service_path, service_content)
            .map_err(|e| format!("Failed to write service file: {}. Try running with sudo.", e))?;
        
        info!("Service file created at {}", service_path);
        
        // Reload systemd
        Command::new("systemctl")
            .args(["daemon-reload"])
            .status()
            .map_err(|e| format!("Failed to reload systemd: {}", e))?;
        
        // Enable service
        Command::new("systemctl")
            .args(["enable", "vstats-agent"])
            .status()
            .map_err(|e| format!("Failed to enable service: {}", e))?;
        
        // Start service
        Command::new("systemctl")
            .args(["start", "vstats-agent"])
            .status()
            .map_err(|e| format!("Failed to start service: {}", e))?;
        
        println!();
        println!("✅ Service installed and started!");
        println!();
        println!("Useful commands:");
        println!("  systemctl status vstats-agent   # Check status");
        println!("  systemctl restart vstats-agent  # Restart");
        println!("  systemctl stop vstats-agent     # Stop");
        println!("  journalctl -u vstats-agent -f   # View logs");
        
        Ok(())
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Failed to get executable path: {}", e))?;
        
        let config_path_str = config_path.to_string_lossy();
        
        let plist_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>cc.zsoft.vstats-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
        <string>run</string>
        <string>--config</string>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/vstats-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/vstats-agent.error.log</string>
</dict>
</plist>
"#,
            exe_path.display(),
            config_path_str
        );
        
        let plist_path = "/Library/LaunchDaemons/cc.zsoft.vstats-agent.plist";
        
        fs::write(plist_path, plist_content)
            .map_err(|e| format!("Failed to write plist file: {}. Try running with sudo.", e))?;
        
        info!("LaunchDaemon plist created at {}", plist_path);
        
        // Load the service
        std::process::Command::new("launchctl")
            .args(["load", plist_path])
            .status()
            .map_err(|e| format!("Failed to load service: {}", e))?;
        
        println!();
        println!("✅ Service installed and started!");
        println!();
        println!("Useful commands:");
        println!("  sudo launchctl list | grep vstats    # Check if running");
        println!("  sudo launchctl unload {}   # Stop", plist_path);
        println!("  tail -f /tmp/vstats-agent.log        # View logs");
        
        Ok(())
    }
    
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err("Service installation is only supported on Linux and macOS".to_string())
    }
}

fn uninstall_service() -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use std::fs;
        use std::process::Command;
        
        // Stop service
        let _ = Command::new("systemctl")
            .args(["stop", "vstats-agent"])
            .status();
        
        // Disable service
        let _ = Command::new("systemctl")
            .args(["disable", "vstats-agent"])
            .status();
        
        // Remove service file
        let service_path = "/etc/systemd/system/vstats-agent.service";
        if std::path::Path::new(service_path).exists() {
            fs::remove_file(service_path)
                .map_err(|e| format!("Failed to remove service file: {}. Try running with sudo.", e))?;
        }
        
        // Reload systemd
        Command::new("systemctl")
            .args(["daemon-reload"])
            .status()
            .map_err(|e| format!("Failed to reload systemd: {}", e))?;
        
        println!("✅ Service uninstalled successfully!");
        
        Ok(())
    }
    
    #[cfg(target_os = "macos")]
    {
        use std::fs;
        
        let plist_path = "/Library/LaunchDaemons/cc.zsoft.vstats-agent.plist";
        
        // Unload the service
        let _ = std::process::Command::new("launchctl")
            .args(["unload", plist_path])
            .status();
        
        // Remove plist file
        if std::path::Path::new(plist_path).exists() {
            fs::remove_file(plist_path)
                .map_err(|e| format!("Failed to remove plist file: {}. Try running with sudo.", e))?;
        }
        
        println!("✅ Service uninstalled successfully!");
        
        Ok(())
    }
    
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err("Service uninstallation is only supported on Linux and macOS".to_string())
    }
}

fn show_config(config_path: &PathBuf) -> Result<(), String> {
    let config = AgentConfig::load(config_path)?;
    
    println!("Configuration file: {:?}", config_path);
    println!();
    println!("  Dashboard URL:  {}", config.dashboard_url);
    println!("  WebSocket URL:  {}", config.ws_url());
    println!("  Server ID:      {}", config.server_id);
    println!("  Server Name:    {}", config.server_name);
    println!("  Location:       {}", config.location);
    println!("  Provider:       {}", config.provider);
    println!("  Interval:       {}s", config.interval_secs);
    
    Ok(())
}

