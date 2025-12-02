use rand::Rng;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use std::{fs, path::PathBuf};

pub const CONFIG_FILENAME: &str = "vstats-config.json";
pub const DB_FILENAME: &str = "vstats.db";

/// Get the directory where the executable is located
fn get_exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Get the full path to the config file (in the same directory as the executable)
pub fn get_config_path() -> PathBuf {
    get_exe_dir().join(CONFIG_FILENAME)
}

/// Get the full path to the database file (in the same directory as the executable)
pub fn get_db_path() -> PathBuf {
    get_exe_dir().join(DB_FILENAME)
}

// Global JWT secret (initialized at startup from config)
static JWT_SECRET: OnceLock<String> = OnceLock::new();

pub fn get_jwt_secret() -> &'static str {
    JWT_SECRET.get().map(|s| s.as_str()).unwrap_or("fallback-secret")
}

pub fn init_jwt_secret(secret: String) {
    let _ = JWT_SECRET.set(secret);
}

/// Generate a random alphanumeric string
pub fn generate_random_string(len: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalNodeConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub tag: String,
}

impl Default for LocalNodeConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            location: String::new(),
            provider: String::new(),
            tag: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub admin_password_hash: String,
    #[serde(default = "default_jwt_secret")]
    pub jwt_secret: String,
    pub servers: Vec<RemoteServer>,
    #[serde(default)]
    pub site_settings: SiteSettings,
    #[serde(default)]
    pub local_node: LocalNodeConfig,
    #[serde(default)]
    pub probe_settings: ProbeSettings,
}

fn default_jwt_secret() -> String {
    generate_random_string(64)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SiteSettings {
    #[serde(default)]
    pub site_name: String,
    #[serde(default)]
    pub site_description: String,
    #[serde(default)]
    pub social_links: Vec<SocialLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PingTargetConfig {
    pub name: String,
    pub host: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProbeSettings {
    #[serde(default)]
    pub ping_targets: Vec<PingTargetConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialLink {
    pub platform: String,
    pub url: String,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub tag: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub ip: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        // Generate a random password - this should never be used directly,
        // use new_with_password() instead
        let hash = bcrypt::hash("admin", bcrypt::DEFAULT_COST).unwrap();
        Self {
            admin_password_hash: hash,
            jwt_secret: generate_random_string(64),
            servers: vec![],
            site_settings: SiteSettings {
                site_name: "vStats Dashboard".to_string(),
                site_description: "Real-time Server Monitoring".to_string(),
                social_links: vec![],
            },
            local_node: LocalNodeConfig::default(),
            probe_settings: ProbeSettings::default(),
        }
    }
}

impl AppConfig {
    /// Create a new config with a random password, returns (config, plain_password)
    pub fn new_with_random_password() -> (Self, String) {
        let password = generate_random_string(16);
        let hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST).unwrap();
        let config = Self {
            admin_password_hash: hash,
            jwt_secret: generate_random_string(64),
            servers: vec![],
            site_settings: SiteSettings {
                site_name: "vStats Dashboard".to_string(),
                site_description: "Real-time Server Monitoring".to_string(),
                social_links: vec![],
            },
            local_node: LocalNodeConfig::default(),
            probe_settings: ProbeSettings::default(),
        };
        (config, password)
    }
    
    /// Reset password and return the new plain password
    pub fn reset_password(&mut self) -> String {
        let password = generate_random_string(16);
        self.admin_password_hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST).unwrap();
        password
    }
}

/// Load config, returns (config, Option<initial_password>)
/// If this is first run, returns the generated password
pub fn load_config() -> (AppConfig, Option<String>) {
    let path = get_config_path();
    eprintln!("📂 Loading config from: {}", path.display());
    
    if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        let mut config: AppConfig = match serde_json::from_str(&content) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("⚠️  Failed to parse config: {}, using defaults", e);
                AppConfig::default()
            }
        };
        
        // Verify password hash looks valid (bcrypt hashes start with $2)
        if !config.admin_password_hash.starts_with("$2") {
            eprintln!("⚠️  Invalid password hash format, regenerating...");
            let password = generate_random_string(16);
            config.admin_password_hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST).unwrap();
            save_config(&config);
            eprintln!("🔑 New password: {}", password);
        } else {
            eprintln!("✅ Password hash loaded ({}... chars)", config.admin_password_hash.len());
        }
        
        // Ensure jwt_secret exists (migrate old configs)
        if config.jwt_secret.is_empty() {
            config.jwt_secret = generate_random_string(64);
            save_config(&config);
        }
        
        // Initialize global JWT secret
        init_jwt_secret(config.jwt_secret.clone());
        
        (config, None)
    } else {
        // First run - generate random password
        let (config, password) = AppConfig::new_with_random_password();
        save_config(&config);
        
        // Initialize global JWT secret
        init_jwt_secret(config.jwt_secret.clone());
        
        (config, Some(password))
    }
}

/// Reset password and return the new password
pub fn reset_admin_password() -> String {
    let path = get_config_path();
    let mut config = if path.exists() {
        let content = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppConfig::default()
    };
    
    let password = config.reset_password();
    save_config(&config);
    password
}

pub fn save_config(config: &AppConfig) {
    let path = get_config_path();
    let content = serde_json::to_string_pretty(config).unwrap();
    fs::write(&path, content).ok();
}

