export interface SystemMetrics {
  timestamp: string;
  hostname: string;
  os: OsInfo;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disks: DiskMetrics[];
  network: NetworkMetrics;
  uptime: number;
  load_average: LoadAverage;
  ping?: PingMetrics;
  version?: string;
}

export interface OsInfo {
  name: string;
  version: string;
  kernel: string;
  arch: string;
}

export interface CpuMetrics {
  brand: string;
  cores: number;
  usage: number;
  frequency: number;
  per_core: number[];
}

export interface MemoryMetrics {
  total: number;
  used: number;
  available: number;
  swap_total: number;
  swap_used: number;
  usage_percent: number;
}

export interface DiskMetrics {
  name: string;
  mount_point: string;
  fs_type: string;
  total: number;
  used: number;
  available: number;
  usage_percent: number;
  disk_type?: string;  // "SSD", "HDD", "NVMe"
}

export interface NetworkMetrics {
  interfaces: NetworkInterface[];
  total_rx: number;
  total_tx: number;
  rx_speed?: number;
  tx_speed?: number;
}

export interface NetworkInterface {
  name: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
}

export interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

export interface PingMetrics {
  targets: PingTarget[];
}

export interface PingTarget {
  name: string;
  host: string;
  latency_ms: number | null;
  packet_loss: number;
  status: string;
}

// Site Settings
export interface SiteSettings {
  site_name: string;
  site_description: string;
  social_links: SocialLink[];
}

export interface SocialLink {
  platform: string;  // github, twitter, telegram, email, website, discord, etc.
  url: string;
  label?: string;
}

// History Data
export interface HistoryPoint {
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  net_rx: number;
  net_tx: number;
  ping_ms?: number;
}

export interface HistoryResponse {
  server_id: string;
  range: string;
  data: HistoryPoint[];
  ping_targets?: PingHistoryTarget[];
}

export interface PingHistoryTarget {
  name: string;
  host: string;
  data: PingHistoryPoint[];
}

export interface PingHistoryPoint {
  timestamp: string;
  latency_ms: number | null;
  status: string;
}
