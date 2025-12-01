use chrono::Utc;
use sysinfo::{CpuRefreshKind, Disks, Networks, System};
use std::time::Duration;

use crate::types::{
    CpuMetrics, DiskMetrics, LoadAverage, MemoryMetrics, NetworkInterface, NetworkMetrics,
    OsInfo, SystemMetrics,
};

/// Metrics collector that maintains state for accurate CPU measurements
pub struct MetricsCollector {
    sys: System,
    disks: Disks,
    networks: Networks,
    hostname: String,
    os_info: OsInfo,
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
        
        Self {
            sys,
            disks: Disks::new_with_refreshed_list(),
            networks: Networks::new_with_refreshed_list(),
            hostname,
            os_info,
        }
    }
    
    /// Refresh and collect current system metrics
    pub fn collect(&mut self) -> SystemMetrics {
        // Refresh all metrics
        self.sys.refresh_cpu_specifics(CpuRefreshKind::everything());
        self.sys.refresh_memory();
        self.disks.refresh();
        self.networks.refresh();
        
        SystemMetrics {
            timestamp: Utc::now(),
            hostname: self.hostname.clone(),
            os: self.os_info.clone(),
            cpu: self.collect_cpu(),
            memory: self.collect_memory(),
            disks: self.collect_disks(),
            network: self.collect_network(),
            uptime: System::uptime(),
            load_average: self.collect_load_average(),
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
    
    fn collect_network(&self) -> NetworkMetrics {
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
        
        NetworkMetrics {
            interfaces,
            total_rx,
            total_tx,
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

