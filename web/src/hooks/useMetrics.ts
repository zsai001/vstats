import { useEffect, useState, useRef, useCallback } from 'react';
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
  // Extended metadata
  price?: {
    amount: string;
    period: 'month' | 'year';
  };
  purchase_date?: string; // ISO date string (YYYY-MM-DD)
  remaining_value?: string; // Currency string
  tip_badge?: string; // Override tip badge type (cn3-opt, cn3-gia, big-disk, perf, landing, dufu)
}

export interface ServerState {
  config: ServerConfig;
  metrics: SystemMetrics | null;
  speed: NetworkSpeed;
  isConnected: boolean;
  error: string | null;
}

// Loading state for initial data fetch
export type LoadingState = 'idle' | 'loading' | 'ready' | 'error';

// Full state message from dashboard WebSocket
interface DashboardMessage {
  type: string;
  servers: ServerMetricsUpdate[];
  site_settings?: SiteSettings;
}

// Compact delta message
interface DeltaMessage {
  type: 'delta';
  ts: number;
  d: CompactServerUpdate[];
}

// Compact server update
interface CompactServerUpdate {
  id: string;
  on?: boolean;
  m?: CompactMetrics;
}

// Compact metrics
interface CompactMetrics {
  c?: number;  // CPU %
  m?: number;  // Memory %
  d?: number;  // Disk %
  rx?: number; // RX speed
  tx?: number; // TX speed
  up?: number; // Uptime
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

// LocalStorage key for caching server metrics
const METRICS_CACHE_KEY = 'vstats-metrics-cache';

// Load cached metrics from localStorage
const loadCachedMetrics = (): Map<string, SystemMetrics> => {
  try {
    const cached = localStorage.getItem(METRICS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return new Map(Object.entries(parsed));
    }
  } catch (e) {
    console.warn('Failed to load cached metrics', e);
  }
  return new Map();
};

// Save metrics to localStorage
const saveCachedMetrics = (metricsMap: Map<string, SystemMetrics>) => {
  try {
    const obj: Record<string, SystemMetrics> = {};
    metricsMap.forEach((value, key) => {
      obj[key] = value;
    });
    localStorage.setItem(METRICS_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn('Failed to save metrics cache', e);
  }
};

export function useServerManager() {
  const [servers, setServers] = useState<ServerState[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const lastMetricsMap = useRef<Map<string, { metrics: SystemMetrics, time: number }>>(new Map());
  const serversCache = useRef<Map<string, ServerState>>(new Map());
  const cachedMetricsRef = useRef<Map<string, SystemMetrics>>(loadCachedMetrics());
  const wsRef = useRef<WebSocket | null>(null);
  const initialDataReceived = useRef(false);

  // Apply delta update to cached server state
  const applyDelta = useCallback((delta: CompactServerUpdate) => {
    const cached = serversCache.current.get(delta.id);
    if (!cached) return null;
    
    const updated = { ...cached };
    
    // Update online status
    if (delta.on !== undefined) {
      updated.isConnected = delta.on;
    }
    
    // Update metrics from delta
    if (delta.m && updated.metrics) {
      const m = delta.m;
      updated.metrics = { ...updated.metrics };
      
      if (m.c !== undefined) {
        updated.metrics.cpu = { ...updated.metrics.cpu, usage: m.c };
      }
      if (m.m !== undefined) {
        updated.metrics.memory = { ...updated.metrics.memory, usage_percent: m.m };
      }
      if (m.d !== undefined && updated.metrics.disks[0]) {
        updated.metrics.disks = [{ ...updated.metrics.disks[0], usage_percent: m.d }];
      }
      if (m.rx !== undefined || m.tx !== undefined) {
        updated.metrics.network = { 
          ...updated.metrics.network,
          rx_speed: m.rx ?? updated.metrics.network.rx_speed,
          tx_speed: m.tx ?? updated.metrics.network.tx_speed,
        };
        updated.speed = {
          rx_sec: m.rx ?? updated.speed.rx_sec,
          tx_sec: m.tx ?? updated.speed.tx_sec,
        };
      }
      if (m.up !== undefined) {
        updated.metrics.uptime = m.up;
      }
    }
    
    return updated;
  }, []);

  // Connect to dashboard WebSocket - all data (local + remote) comes through here
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
            const data = JSON.parse(event.data);
            
            // Handle full state message
            if (data.type === 'metrics' && data.servers) {
              const fullData = data as DashboardMessage;
              
              // Update site settings if provided
              if (fullData.site_settings) {
                setSiteSettings(fullData.site_settings);
              }
              
              // Mark initial data as received
              if (!initialDataReceived.current) {
                initialDataReceived.current = true;
                setLoadingState('ready');
                setIsInitialLoad(false);
              }
              const now = Date.now();
              
              // All servers (local + remote) come through WebSocket
              const allServers: ServerState[] = fullData.servers.map(serverUpdate => {
                const lastData = lastMetricsMap.current.get(serverUpdate.server_id);
                
                let newSpeed = { rx_sec: 0, tx_sec: 0 };

                // Use pre-calculated speeds from server if available
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

                // Cache metrics when online, use cache when offline
                let metricsToUse = serverUpdate.metrics;
                if (serverUpdate.metrics) {
                  lastMetricsMap.current.set(serverUpdate.server_id, { 
                    metrics: serverUpdate.metrics, 
                    time: now 
                  });
                  // Save to persistent cache
                  cachedMetricsRef.current.set(serverUpdate.server_id, serverUpdate.metrics);
                } else if (!serverUpdate.online) {
                  // Server is offline, use cached metrics if available
                  const cachedMetrics = cachedMetricsRef.current.get(serverUpdate.server_id);
                  if (cachedMetrics) {
                    metricsToUse = cachedMetrics;
                    newSpeed = { rx_sec: 0, tx_sec: 0 }; // Reset speed for offline servers
                  }
                }

                // Determine if this is the local server
                const isLocal = serverUpdate.server_id === 'local';

                const serverState: ServerState = {
                  config: {
                    id: serverUpdate.server_id,
                    name: serverUpdate.server_name,
                    type: isLocal ? 'local' as const : 'real' as const,
                    location: serverUpdate.location,
                    provider: serverUpdate.provider,
                    tag: serverUpdate.tag,
                    version: serverUpdate.version || serverUpdate.metrics?.version,
                  },
                  metrics: metricsToUse,
                  speed: newSpeed,
                  isConnected: serverUpdate.online,
                  error: null
                };
                
                // Cache for delta updates
                serversCache.current.set(serverUpdate.server_id, serverState);
                
                return serverState;
              });

              // Save cached metrics to localStorage periodically
              saveCachedMetrics(cachedMetricsRef.current);

              setServers(allServers);
            }
            // Handle delta update message
            else if (data.type === 'delta') {
              const deltaData = data as DeltaMessage;
              
              if (deltaData.d && deltaData.d.length > 0) {
                setServers(prev => {
                  let hasChanges = false;
                  const updated = prev.map(server => {
                    const delta = deltaData.d.find(d => d.id === server.config.id);
                    if (delta) {
                      const newState = applyDelta(delta);
                      if (newState) {
                        hasChanges = true;
                        serversCache.current.set(server.config.id, newState);
                        // Update persistent cache if metrics changed and server is online
                        if (newState.metrics && newState.isConnected) {
                          cachedMetricsRef.current.set(server.config.id, newState.metrics);
                        }
                        return newState;
                      }
                    }
                    return server;
                  });
                  // Periodically save to localStorage
                  if (hasChanges) {
                    saveCachedMetrics(cachedMetricsRef.current);
                  }
                  return hasChanges ? updated : prev;
                });
              }
            }
          } catch (e) {
            console.error('[Dashboard] Parse error', e);
          }
        };

        ws.onclose = () => {
          console.log('[Dashboard] WebSocket disconnected, reconnecting...');
          wsRef.current = null;
          // Don't reset loading state on reconnect if we already have data
          if (!initialDataReceived.current) {
            setLoadingState('loading');
          }
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
  }, [applyDelta]);

  // Get a server by ID (with cached lookup)
  const getServerById = useCallback((id: string): ServerState | undefined => {
    return servers.find(s => s.config.id === id);
  }, [servers]);

  return { servers, siteSettings, loadingState, isInitialLoad, getServerById };
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
