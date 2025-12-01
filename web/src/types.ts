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
}

export interface NetworkMetrics {
  interfaces: NetworkInterface[];
  total_rx: number;
  total_tx: number;
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

