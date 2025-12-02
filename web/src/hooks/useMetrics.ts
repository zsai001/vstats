import { useEffect, useState, useRef } from 'react';
import type { SystemMetrics, SiteSettings } from '../types';

interface NetworkSpeed {
  rx_sec: number;
  tx_sec: number;
}

export interface ServerConfig {
  id: string;
  name: string;
  type: 'real' | 'local';
  location?: string;
  provider?: string;
  tag?: string;
  version?: string;
}

export interface ServerState {
  config: ServerConfig;
  metrics: SystemMetrics | null;
  speed: NetworkSpeed;
  isConnected: boolean;
  error: string | null;
}

// Message from dashboard WebSocket
interface DashboardMessage {
  type: string;
  servers: ServerMetricsUpdate[];
  site_settings?: SiteSettings;
}

interface ServerMetricsUpdate {
  server_id: string;
  server_name: string;
  location: string;
  provider: string;
  tag?: string;
  version?: string;
  online: boolean;
  metrics: SystemMetrics | null;
}

const defaultSiteSettings: SiteSettings = {
  site_name: 'vStats Dashboard',
  site_description: 'Real-time Server Monitoring',
  social_links: []
};

export function useServerManager() {
  const [servers, setServers] = useState<ServerState[]>([]);

  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);
  
  const lastMetricsMap = useRef<Map<string, { metrics: SystemMetrics, time: number }>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to dashboard WebSocket
  useEffect(() => {
    const connect = () => {
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[Dashboard] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as DashboardMessage;
            
            // Update site settings if provided
            if (data.site_settings) {
              setSiteSettings(data.site_settings);
            }
            
              if (data.type === 'metrics' && data.servers) {
              const now = Date.now();
              
              setServers(prev => {
                // Keep local server if exists
                const localServer = prev.find(s => s.config.type === 'local');
                
                const realServers: ServerState[] = data.servers.map(serverUpdate => {
                  const existingServer = prev.find(s => s.config.id === serverUpdate.server_id);
                  const lastData = lastMetricsMap.current.get(serverUpdate.server_id);
                  
                  let newSpeed = existingServer?.speed || { rx_sec: 0, tx_sec: 0 };

                  // Use pre-calculated speeds from agent if available
                  if (serverUpdate.metrics?.network.rx_speed !== undefined && 
                      serverUpdate.metrics?.network.tx_speed !== undefined) {
                    newSpeed = {
                      rx_sec: serverUpdate.metrics.network.rx_speed,
                      tx_sec: serverUpdate.metrics.network.tx_speed
                    };
                  } else if (lastData && serverUpdate.metrics) {
                    // Fallback: calculate from totals difference
                    const timeDiff = (now - lastData.time) / 1000;
                    if (timeDiff > 0) {
                      const rxDiff = serverUpdate.metrics.network.total_rx - lastData.metrics.network.total_rx;
                      const txDiff = serverUpdate.metrics.network.total_tx - lastData.metrics.network.total_tx;
                      newSpeed = {
                        rx_sec: Math.max(0, rxDiff / timeDiff),
                        tx_sec: Math.max(0, txDiff / timeDiff)
                      };
                    }
                  }

                  if (serverUpdate.metrics) {
                    lastMetricsMap.current.set(serverUpdate.server_id, { 
                      metrics: serverUpdate.metrics, 
                      time: now 
                    });
                  }

                  return {
                    config: {
                      id: serverUpdate.server_id,
                      name: serverUpdate.server_name,
                      type: 'real' as const,
                      location: serverUpdate.location,
                      provider: serverUpdate.provider,
                      tag: serverUpdate.tag,
                      version: serverUpdate.version || serverUpdate.metrics?.version,
                    },
                    metrics: serverUpdate.metrics,
                    speed: newSpeed,
                    isConnected: serverUpdate.online,
                    error: null
                  };
                });

                // Put local server first if exists
                return localServer ? [localServer, ...realServers] : realServers;
              });
            }
          } catch (e) {
            console.error('[Dashboard] Parse error', e);
          }
        };

        ws.onclose = () => {
          console.log('[Dashboard] WebSocket disconnected, reconnecting...');
          wsRef.current = null;
          setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
          console.error('[Dashboard] WebSocket error', err);
        };
      } catch (e) {
        console.error('[Dashboard] Connection error', e);
        setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Fetch local server metrics
  useEffect(() => {
    const fetchLocalMetrics = async () => {
      try {
        const res = await fetch('/api/metrics');
        if (!res.ok) return;
        const metrics: SystemMetrics = await res.json();
        const now = Date.now();
        
        setServers(prev => {
          const existingLocal = prev.find(s => s.config.type === 'local');
          const lastData = lastMetricsMap.current.get('local');
          
          let newSpeed = existingLocal?.speed || { rx_sec: 0, tx_sec: 0 };
          
          // Use pre-calculated speeds from agent if available
          if (metrics.network.rx_speed !== undefined && metrics.network.tx_speed !== undefined) {
            newSpeed = {
              rx_sec: metrics.network.rx_speed,
              tx_sec: metrics.network.tx_speed
            };
          } else if (lastData) {
            // Fallback: calculate from totals difference
            const timeDiff = (now - lastData.time) / 1000;
            if (timeDiff > 0) {
              const rxDiff = metrics.network.total_rx - lastData.metrics.network.total_rx;
              const txDiff = metrics.network.total_tx - lastData.metrics.network.total_tx;
              newSpeed = {
                rx_sec: Math.max(0, rxDiff / timeDiff),
                tx_sec: Math.max(0, txDiff / timeDiff)
              };
            }
          }
          
          lastMetricsMap.current.set('local', { metrics, time: now });
          
          const localServer: ServerState = {
            config: {
              id: 'local',
              name: metrics.hostname || 'Local Server',
              type: 'local',
              location: '',
              provider: 'Local',
            },
            metrics,
            speed: newSpeed,
            isConnected: true,
            error: null
          };
          
          const others = prev.filter(s => s.config.type !== 'local');
          return [localServer, ...others];
        });
      } catch (e) {
        console.error('[Local] Failed to fetch metrics', e);
      }
    };
    
    // Fetch immediately and then every second
    fetchLocalMetrics();
    const interval = setInterval(fetchLocalMetrics, 1000);
    
    return () => clearInterval(interval);
  }, []);

  return { servers, siteSettings };
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
