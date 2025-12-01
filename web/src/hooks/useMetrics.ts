import { useEffect, useState, useRef, useCallback } from 'react';
import type { SystemMetrics } from '../types';

interface NetworkSpeed {
  rx_sec: number;
  tx_sec: number;
}

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  type: 'real' | 'demo'; // 'real' connects to WebSocket, 'demo' generates fake data
  location?: string;     // e.g., "US", "HK", "CN"
  provider?: string;     // e.g., "AWS", "Aliyun", "Vultr"
}

export interface ServerState {
  config: ServerConfig;
  metrics: SystemMetrics | null;
  speed: NetworkSpeed;
  isConnected: boolean;
  error: string | null;
}

// Initial fake data for demo servers
const createFakeMetrics = (_id: string, name: string): SystemMetrics => ({
  timestamp: new Date().toISOString(),
  hostname: name,
  os: { name: 'Ubuntu', version: '22.04 LTS', kernel: '5.15.0', arch: 'x86_64' },
  cpu: { brand: 'Virtual CPU', cores: 4, usage: Math.random() * 100, frequency: 2400, per_core: [] },
  memory: { total: 8589934592, used: Math.random() * 8589934592, available: 0, swap_total: 0, swap_used: 0, usage_percent: Math.random() * 100 },
  disks: [{ name: 'vda1', mount_point: '/', fs_type: 'ext4', total: 100000000000, used: Math.random() * 100000000000, available: 0, usage_percent: Math.random() * 100 }],
  network: { interfaces: [], total_rx: Math.random() * 1000000000, total_tx: Math.random() * 1000000000 },
  uptime: Math.floor(Math.random() * 1000000),
  load_average: { one: Math.random() * 2, five: Math.random() * 2, fifteen: Math.random() * 2 }
});

export function useServerManager() {
  // Default server list including localhost and demos
  const [servers, setServers] = useState<ServerState[]>([
    {
      config: { id: 'local', name: 'Local Dev', url: `ws://${window.location.host}/ws`, type: 'real', location: 'CN', provider: '' },
      metrics: null,
      speed: { rx_sec: 0, tx_sec: 0 },
      isConnected: false,
      error: null
    },
    {
      config: { id: 'demo1', name: 'US-SJC-Vultr', url: '', type: 'demo', location: 'US', provider: 'Vultr' },
      metrics: createFakeMetrics('demo1', 'US-SJC-Vultr'),
      speed: { rx_sec: 1024 * 1024 * 1.5, tx_sec: 1024 * 1024 * 0.5 },
      isConnected: true,
      error: null
    },
    {
      config: { id: 'demo2', name: 'HK-Aliyun', url: '', type: 'demo', location: 'HK', provider: 'Aliyun' },
      metrics: createFakeMetrics('demo2', 'HK-Aliyun'),
      speed: { rx_sec: 1024 * 500, tx_sec: 1024 * 200 },
      isConnected: true,
      error: null
    },
    {
      config: { id: 'demo3', name: 'JP-TYO-AWS', url: '', type: 'demo', location: 'JP', provider: 'AWS' },
      metrics: createFakeMetrics('demo3', 'JP-TYO-AWS'),
      speed: { rx_sec: 1024 * 800, tx_sec: 1024 * 300 },
      isConnected: true,
      error: null
    }
  ]);

  // Refs to store websocket instances and previous metrics for speed calculation
  const wsRefs = useRef<Map<string, WebSocket>>(new Map());
  const lastMetricsMap = useRef<Map<string, { metrics: SystemMetrics, time: number }>>(new Map());

  // Function to update a specific server's state
  const updateServerState = useCallback((id: string, updates: Partial<ServerState>) => {
    setServers(prev => prev.map(s => s.config.id === id ? { ...s, ...updates } : s));
  }, []);

  // Handle Real Connections
  useEffect(() => {
    servers.forEach(server => {
      if (server.config.type !== 'real') return;
      if (wsRefs.current.has(server.config.id)) return; // Already connected

      const connect = () => {
        try {
          // Determine WebSocket URL
          let wsUrl = server.config.url;
          if (wsUrl.startsWith('/')) {
             const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
             wsUrl = `${protocol}//${window.location.host}${wsUrl}`;
          }

          const ws = new WebSocket(wsUrl);
          wsRefs.current.set(server.config.id, ws);

          ws.onopen = () => {
            updateServerState(server.config.id, { isConnected: true, error: null });
          };

          ws.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data) as SystemMetrics;
              const now = Date.now();
              const last = lastMetricsMap.current.get(server.config.id);
              
              let newSpeed = { rx_sec: 0, tx_sec: 0 };

              if (last) {
                const timeDiff = (now - last.time) / 1000;
                if (timeDiff > 0) {
                  const rxDiff = data.network.total_rx - last.metrics.network.total_rx;
                  const txDiff = data.network.total_tx - last.metrics.network.total_tx;
                  newSpeed = {
                    rx_sec: Math.max(0, rxDiff / timeDiff),
                    tx_sec: Math.max(0, txDiff / timeDiff)
                  };
                }
              }

              lastMetricsMap.current.set(server.config.id, { metrics: data, time: now });
              updateServerState(server.config.id, { metrics: data, speed: newSpeed });
            } catch (e) {
              console.error('Parse error', e);
            }
          };

          ws.onclose = () => {
            updateServerState(server.config.id, { isConnected: false });
            wsRefs.current.delete(server.config.id);
            setTimeout(connect, 3000); // Reconnect
          };

          ws.onerror = () => {
            updateServerState(server.config.id, { error: 'Connection failed', isConnected: false });
          };
        } catch (e) {
           console.error(e);
        }
      };

      connect();
    });

    // Cleanup
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      wsRefs.current.forEach(ws => ws.close());
    };
  }, []); // Only run once on mount for now

  // Simulate Demo Data Updates
  useEffect(() => {
    const interval = setInterval(() => {
      setServers(prev => prev.map(s => {
        if (s.config.type !== 'demo' || !s.metrics) return s;
        
        // Fluctuate values slightly
        const newCpu = Math.min(100, Math.max(0, s.metrics.cpu.usage + (Math.random() - 0.5) * 10));
        const newMem = Math.min(100, Math.max(0, s.metrics.memory.usage_percent + (Math.random() - 0.5) * 5));
        
        return {
          ...s,
          metrics: {
            ...s.metrics,
            cpu: { ...s.metrics.cpu, usage: newCpu },
            memory: { ...s.metrics.memory, usage_percent: newMem }
          },
          speed: {
            rx_sec: Math.max(0, s.speed.rx_sec + (Math.random() - 0.5) * 1024 * 100),
            tx_sec: Math.max(0, s.speed.tx_sec + (Math.random() - 0.5) * 1024 * 50),
          }
        };
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return { servers };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(seconds / 60)}m`;
}
