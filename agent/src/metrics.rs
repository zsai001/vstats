use chrono::Utc;
use sysinfo::{CpuRefreshKind, Disks, Networks, System};
use std::time::Duration;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;

use crate::types::{
    CpuMetrics, DiskMetrics, LoadAverage, MemoryMetrics, NetworkInterface, NetworkMetrics,
    OsInfo, SystemMetrics, PingMetrics, PingTarget,
};

/// Default ping targets for latency monitoring
const DEFAULT_PING_TARGETS: &[(&str, &str)] = &[
    ("Google DNS", "8.8.8.8"),
    ("Cloudflare", "1.1.1.1"),
    ("Local Gateway", ""),  // Will be detected
];

/// Metrics collector that maintains state for accurate CPU measurements
pub struct MetricsCollector {
    sys: System,
    disks: Disks,
    networks: Networks,
    hostname: String,
    os_info: OsInfo,
    // Track previous network readings for speed calculation
    last_network_rx: u64,
    last_network_tx: u64,
    last_network_time: std::time::Instant,
    // Ping metrics (updated in background)
    ping_results: Arc<Mutex<Option<PingMetrics>>>,
    gateway_ip: Option<String>,
}

impl MetricsCollector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        
        // Initial CPU refresh to get baseline
        sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        std::thread::sleep(Duration::from_millis(200));
        sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        
        let hostname = System::host_name().unwrap_or_else(|| "unknown".to_string());
        
        let os_info = OsInfo {
            name: System::name().unwrap_or_else(|| "Unknown".to_string()),
            version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
            kernel: System::kernel_version().unwrap_or_else(|| "Unknown".to_string()),
            arch: std::env::consts::ARCH.to_string(),
        };
        
        let networks = Networks::new_with_refreshed_list();
        
        // Get initial network totals
        let (init_rx, init_tx) = networks.iter().fold((0u64, 0u64), |(rx, tx), (_, data)| {
            (rx.saturating_add(data.total_received()), tx.saturating_add(data.total_transmitted()))
        });
        
        // Detect default gateway
        let gateway_ip = Self::detect_gateway();
        
        // Initialize ping results
        let ping_results = Arc::new(Mutex::new(None));
        
        // Start background ping thread
        let ping_results_clone = Arc::clone(&ping_results);
        let gateway_clone = gateway_ip.clone();
        thread::spawn(move || {
            loop {
                let results = Self::collect_ping_static(&gateway_clone);
                if let Ok(mut guard) = ping_results_clone.lock() {
                    *guard = Some(results);
                }
                thread::sleep(Duration::from_secs(10)); // Ping every 10 seconds
            }
        });
        
        Self {
            sys,
            disks: Disks::new_with_refreshed_list(),
            networks,
            hostname,
            os_info,
            last_network_rx: init_rx,
            last_network_tx: init_tx,
            last_network_time: std::time::Instant::now(),
            ping_results,
            gateway_ip,
        }
    }
    
    /// Detect default gateway IP
    fn detect_gateway() -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            if let Ok(output) = Command::new("ip")
                .args(["route", "show", "default"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Parse: default via 192.168.1.1 dev eth0
                for word in stdout.split_whitespace() {
                    if word.contains('.') && !word.contains('/') {
                        return Some(word.to_string());
                    }
                }
            }
        }
        
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = Command::new("route")
                .args(["-n", "get", "default"])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.trim().starts_with("gateway:") {
                        if let Some(ip) = line.split(':').nth(1) {
                            return Some(ip.trim().to_string());
                        }
                    }
                }
            }
        }
        
        None
    }
    
    /// Ping a host and return latency in milliseconds
    fn ping_host(host: &str) -> (Option<f64>, f64, String) {
        #[cfg(target_os = "linux")]
        let args = ["-c", "3", "-W", "2", host];
        
        #[cfg(target_os = "macos")]
        let args = ["-c", "3", "-W", "2000", host];
        
        #[cfg(target_os = "windows")]
        let args = ["-n", "3", "-w", "2000", host];
        
        match Command::new("ping").args(&args).output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                
                // Parse packet loss
                let packet_loss = if let Some(loss_line) = stdout.lines()
                    .find(|l| l.contains("packet loss") || l.contains("loss"))
                {
                    // Extract percentage like "0% packet loss" or "33.3% packet loss"
                    loss_line.split_whitespace()
                        .find(|w| w.ends_with('%'))
                        .and_then(|w| w.trim_end_matches('%').parse::<f64>().ok())
                        .unwrap_or(0.0)
                } else {
                    if output.status.success() { 0.0 } else { 100.0 }
                };
                
                // Parse average latency
                let latency = if let Some(stats_line) = stdout.lines()
                    .find(|l| l.contains("avg") || l.contains("Average"))
                {
                    // Format varies: "min/avg/max/mdev = 1.234/2.345/3.456/0.567 ms"
                    // or "Minimum = 1ms, Maximum = 3ms, Average = 2ms"
                    if stats_line.contains('/') {
                        stats_line.split('=').last()
                            .and_then(|s| s.split('/').nth(1))
                            .and_then(|s| s.trim().parse::<f64>().ok())
                    } else {
                        stats_line.split_whitespace()
                            .filter_map(|w| w.trim_end_matches("ms").parse::<f64>().ok())
                            .last()
                    }
                } else {
                    None
                };
                
                let status = if packet_loss >= 100.0 {
                    "timeout".to_string()
                } else {
                    "ok".to_string()
                };
                
                (latency, packet_loss, status)
            }
            Err(_) => (None, 100.0, "error".to_string()),
        }
    }
    
    /// Collect ping metrics (static version for background thread)
    fn collect_ping_static(gateway_ip: &Option<String>) -> PingMetrics {
        let mut targets = Vec::new();
        
        for (name, host) in DEFAULT_PING_TARGETS {
            let actual_host = if host.is_empty() {
                // Use gateway IP if available
                match gateway_ip {
                    Some(gw) => gw.clone(),
                    None => continue,
                }
            } else {
                host.to_string()
            };
            
            let (latency, packet_loss, status) = Self::ping_host(&actual_host);
            
            targets.push(PingTarget {
                name: name.to_string(),
                host: actual_host,
                latency_ms: latency,
                packet_loss,
                status,
            });
        }
        
        PingMetrics { targets }
    }
    
    /// Refresh and collect current system metrics
    pub fn collect(&mut self) -> SystemMetrics {
        // Refresh all metrics
        self.sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        self.sys.refresh_memory();
        self.disks.refresh();
        self.networks.refresh();
        
        let network = self.collect_network();
        
        // Get cached ping results
        let ping = self.ping_results.lock().ok().and_then(|guard| guard.clone());
        
        SystemMetrics {
            timestamp: Utc::now(),
            hostname: self.hostname.clone(),
            os: self.os_info.clone(),
            cpu: self.collect_cpu(),
            memory: self.collect_memory(),
            disks: self.collect_disks(),
            network,
            uptime: System::uptime(),
            load_average: self.collect_load_average(),
            ping,
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }
    }
    
    fn collect_cpu(&self) -> CpuMetrics {
        let cpus = self.sys.cpus();
        let global_usage: f32 = cpus.iter().map(|c| c.cpu_usage()).sum::<f32>() / cpus.len() as f32;
        let per_core: Vec<f32> = cpus.iter().map(|c| c.cpu_usage()).collect();
        let frequency = cpus.first().map(|c| c.frequency()).unwrap_or(0);
        let brand = cpus.first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        
        CpuMetrics {
            brand,
            cores: cpus.len(),
            usage: global_usage,
            frequency,
            per_core,
        }
    }
    
    fn collect_memory(&self) -> MemoryMetrics {
        let total = self.sys.total_memory();
        let used = self.sys.used_memory();
        let available = self.sys.available_memory();
        let swap_total = self.sys.total_swap();
        let swap_used = self.sys.used_swap();
        
        let usage_percent = if total > 0 {
            (used as f32 / total as f32) * 100.0
        } else {
            0.0
        };
        
        MemoryMetrics {
            total,
            used,
            available,
            swap_total,
            swap_used,
            usage_percent,
        }
    }
    
    fn collect_disks(&self) -> Vec<DiskMetrics> {
        self.disks
            .iter()
            .map(|disk| {
                let total = disk.total_space();
                let available = disk.available_space();
                let used = total.saturating_sub(available);
                let usage_percent = if total > 0 {
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
                    usage_percent,
                }
            })
            .collect()
    }
    
    fn collect_network(&mut self) -> NetworkMetrics {
        let mut total_rx: u64 = 0;
        let mut total_tx: u64 = 0;
        
        let interfaces: Vec<NetworkInterface> = self.networks
            .iter()
            .map(|(name, data)| {
                let rx = data.total_received();
                let tx = data.total_transmitted();
                total_rx = total_rx.saturating_add(rx);
                total_tx = total_tx.saturating_add(tx);
                
                NetworkInterface {
                    name: name.to_string(),
                    rx_bytes: rx,
                    tx_bytes: tx,
                    rx_packets: data.total_packets_received(),
                    tx_packets: data.total_packets_transmitted(),
                }
            })
            .collect();
        
        // Calculate speed (bytes per second)
        let now = std::time::Instant::now();
        let elapsed_secs = now.duration_since(self.last_network_time).as_secs_f64();
        
        let (rx_speed, tx_speed) = if elapsed_secs > 0.1 {
            // Only calculate if enough time has passed
            let rx_diff = total_rx.saturating_sub(self.last_network_rx);
            let tx_diff = total_tx.saturating_sub(self.last_network_tx);
            
            // If totals went down (counter reset), use 0 for this interval
            let rx_speed = if total_rx >= self.last_network_rx {
                (rx_diff as f64 / elapsed_secs) as u64
            } else {
                0
            };
            let tx_speed = if total_tx >= self.last_network_tx {
                (tx_diff as f64 / elapsed_secs) as u64
            } else {
                0
            };
            
            // Update tracking
            self.last_network_rx = total_rx;
            self.last_network_tx = total_tx;
            self.last_network_time = now;
            
            (rx_speed, tx_speed)
        } else {
            // Not enough time passed, return 0 to avoid spikes
            (0, 0)
        };
        
        NetworkMetrics {
            interfaces,
            total_rx,
            total_tx,
            rx_speed,
            tx_speed,
        }
    }
    
    fn collect_load_average(&self) -> LoadAverage {
        let load = System::load_average();
        LoadAverage {
            one: load.one,
            five: load.five,
            fifteen: load.fifteen,
        }
    }
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

