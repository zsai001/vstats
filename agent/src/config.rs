use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const CONFIG_FILENAME: &str = "vstats-agent.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub dashboard_url: String,
    pub server_id: String,
    pub agent_token: String,
    pub server_name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default = "default_interval")]
    pub interval_secs: u64,
}

fn default_interval() -> u64 {
    1
}

impl AgentConfig {
    /// Get the default config file path
    pub fn default_path() -> PathBuf {
        // Try /etc/vstats-agent/ first (for system-wide install)
        let system_path = PathBuf::from("/etc/vstats-agent").join(CONFIG_FILENAME);
        if system_path.parent().map(|p| p.exists()).unwrap_or(false) {
            return system_path;
        }
        
        // Try /opt/vstats-agent/ (for compatibility with shell agent)
        let opt_path = PathBuf::from("/opt/vstats-agent/config.json");
        if opt_path.exists() {
            return opt_path;
        }
        
        // Fall back to user config directory
        if let Some(config_dir) = dirs::config_dir() {
            return config_dir.join("vstats-agent").join(CONFIG_FILENAME);
        }
        
        // Last resort: current directory
        PathBuf::from(CONFIG_FILENAME)
    }
    
    /// Load config from file
    pub fn load(path: &PathBuf) -> Result<Self, String> {
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read config file {:?}: {}", path, e))?;
        
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))
    }
    
    /// Save config to file
    pub fn save(&self, path: &PathBuf) -> Result<(), String> {
        // Create parent directory if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        
        fs::write(path, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
        
        // Set restrictive permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
            let mut perms = metadata.permissions();
            perms.set_mode(0o600);
            fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
        }
        
        Ok(())
    }
    
    /// Get WebSocket URL from dashboard URL
    pub fn ws_url(&self) -> String {
        let url = self.dashboard_url
            .replace("http://", "ws://")
            .replace("https://", "wss://");
        format!("{}/ws/agent", url.trim_end_matches('/'))
    }
}

