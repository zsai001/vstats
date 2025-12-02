import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useServerManager, formatBytes, formatSpeed, formatUptime } from '../hooks/useMetrics';
import { getOsIcon, getProviderIcon } from '../components/Icons';
import { getProviderLogo, getDistributionLogo, LogoImage } from '../utils/logoUtils';
import type { HistoryPoint, HistoryResponse, PingHistoryTarget } from '../types';

const FLAGS: Record<string, string> = {
  'CN': '🇨🇳', 'HK': '🇭🇰', 'TW': '🇹🇼', 'JP': '🇯🇵', 'KR': '🇰🇷',
  'SG': '🇸🇬', 'US': '🇺🇸', 'DE': '🇩🇪', 'UK': '🇬🇧', 'FR': '🇫🇷',
  'NL': '🇳🇱', 'RU': '🇷🇺', 'AU': '🇦🇺', 'CA': '🇨🇦', 'IN': '🇮🇳',
};

function StatCard({ label, value, subValue, color = 'gray' }: { label: string; value: string; subValue?: string; color?: string }) {
  const colorClasses: Record<string, string> = {
    emerald: 'from-emerald-500/20 border-emerald-500/30',
    blue: 'from-blue-500/20 border-blue-500/30',
    purple: 'from-purple-500/20 border-purple-500/30',
    amber: 'from-amber-500/20 border-amber-500/30',
    gray: 'from-white/5 border-white/10',
  };

  return (
    <div className={`nezha-card p-4 bg-gradient-to-br ${colorClasses[color]} to-transparent`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-white font-mono">{value}</div>
      {subValue && <div className="text-xs text-gray-500 mt-1">{subValue}</div>}
    </div>
  );
}

// History Chart Component
type TimeRange = '1h' | '24h' | '7d' | '30d' | '1y';
type HistoryTab = 'overview' | 'cpu' | 'memory' | 'disk' | 'network' | 'ping';

function HistoryChart({ serverId }: { serverId: string }) {
  const [range, setRange] = useState<TimeRange>('24h');
  const [tab, setTab] = useState<HistoryTab>('overview');
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [pingTargets, setPingTargets] = useState<PingHistoryTarget[]>([]);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      if (isInitialLoad) {
        setIsFetching(true);
      }
      setError(null);
      try {
        const res = await fetch(`/api/history/${serverId}?range=${range}`);
        if (!res.ok) throw new Error('Failed to fetch history');
        const json: HistoryResponse = await res.json();
        setData(json.data);
        setPingTargets(json.ping_targets || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setIsFetching(false);
        setIsInitialLoad(false);
      }
    };
    fetchHistory();
  }, [serverId, range]);

  const ranges: { value: TimeRange; label: string }[] = [
    { value: '1h', label: '1H' },
    { value: '24h', label: '24H' },
    { value: '7d', label: '7D' },
    { value: '30d', label: '30D' },
    { value: '1y', label: '1Y' },
  ];

  const tabs: { value: HistoryTab; label: string; color: string }[] = [
    { value: 'overview', label: 'Overview', color: 'emerald' },
    { value: 'cpu', label: 'CPU', color: 'blue' },
    { value: 'memory', label: 'Memory', color: 'purple' },
    { value: 'disk', label: 'Disk', color: 'amber' },
    { value: 'network', label: 'Network', color: 'cyan' },
    { value: 'ping', label: 'Ping', color: 'rose' },
  ];

  // Sample data for display (max 60 points for smooth rendering)
  const sampleRate = Math.max(1, Math.floor(data.length / 60));
  const sampledData = data.filter((_, i) => i % sampleRate === 0);

  // Calculate time labels for X axis (5 labels)
  const getTimeLabels = () => {
    if (sampledData.length < 2) return [];
    const labels: { index: number; label: string }[] = [];
    const step = Math.floor((sampledData.length - 1) / 4);
    for (let i = 0; i <= 4; i++) {
      const idx = Math.min(i * step, sampledData.length - 1);
      labels.push({ index: idx, label: formatTime(sampledData[idx].timestamp) });
    }
    return labels;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    if (range === '1h' || range === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (range === '1y') {
      return date.toLocaleDateString([], { month: 'short', year: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Single chart component with X axis
  const Chart = ({ 
    data: chartData, 
    color, 
    label, 
    getValue, 
    formatValue,
    maxValue 
  }: { 
    data: HistoryPoint[]; 
    color: string; 
    label: string; 
    getValue: (d: HistoryPoint) => number;
    formatValue: (v: number) => string;
    maxValue?: number;
  }) => {
    const values = chartData.map(getValue);
    const max = maxValue ?? Math.max(...values, 1);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const timeLabels = getTimeLabels();
    
    const colorClasses: Record<string, { bg: string; hover: string; text: string }> = {
      blue: { bg: 'bg-blue-500', hover: 'hover:bg-blue-400', text: 'text-blue-400' },
      purple: { bg: 'bg-purple-500', hover: 'hover:bg-purple-400', text: 'text-purple-400' },
      amber: { bg: 'bg-amber-500', hover: 'hover:bg-amber-400', text: 'text-amber-400' },
      cyan: { bg: 'bg-cyan-500', hover: 'hover:bg-cyan-400', text: 'text-cyan-400' },
      rose: { bg: 'bg-rose-500', hover: 'hover:bg-rose-400', text: 'text-rose-400' },
      emerald: { bg: 'bg-emerald-500', hover: 'hover:bg-emerald-400', text: 'text-emerald-400' },
    };
    const c = colorClasses[color] || colorClasses.blue;

    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-xs ${c.text} font-medium`}>{label}</span>
          <span className="text-xs text-gray-500 font-mono">
            avg: {formatValue(avg)}
          </span>
        </div>
        <div className="relative">
          <div className="h-20 flex items-end gap-px bg-white/[0.02] rounded-lg p-2 overflow-hidden">
            {chartData.map((point, i) => (
              <div
                key={i}
                className={`flex-1 min-w-[2px] ${c.bg} rounded-t transition-all ${c.hover} cursor-pointer`}
                style={{ height: `${Math.max((getValue(point) / max) * 100, 1)}%` }}
                title={`${formatTime(point.timestamp)}: ${formatValue(getValue(point))}`}
              />
            ))}
          </div>
          {/* X Axis Labels */}
          <div className="flex justify-between text-[9px] text-gray-600 font-mono mt-1 px-1">
            {timeLabels.map((t, i) => (
              <span key={i} className="whitespace-nowrap">{t.label}</span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Render content based on tab
  const renderContent = () => {
    if (isInitialLoad && isFetching) {
      return (
        <div className="h-64 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          {error}
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">
          No historical data available for this period
        </div>
      );
    }

    const opacity = isFetching ? 'opacity-50' : 'opacity-100';

    switch (tab) {
      case 'overview':
        return (
          <div className={`space-y-6 transition-opacity ${opacity}`}>
            <Chart 
              data={sampledData} 
              color="blue" 
              label="CPU Usage"
              getValue={d => d.cpu}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
            <Chart 
              data={sampledData} 
              color="purple" 
              label="Memory Usage"
              getValue={d => d.memory}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
            <Chart 
              data={sampledData} 
              color="amber" 
              label="Disk Usage"
              getValue={d => d.disk}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
          </div>
        );

      case 'cpu':
        return (
          <div className={`transition-opacity ${opacity}`}>
            <Chart 
              data={sampledData} 
              color="blue" 
              label="CPU Usage"
              getValue={d => d.cpu}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Min</div>
                <div className="text-lg font-mono text-blue-400">
                  {Math.min(...data.map(d => d.cpu)).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Avg</div>
                <div className="text-lg font-mono text-blue-400">
                  {(data.reduce((a, b) => a + b.cpu, 0) / data.length).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Max</div>
                <div className="text-lg font-mono text-blue-400">
                  {Math.max(...data.map(d => d.cpu)).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        );

      case 'memory':
        return (
          <div className={`transition-opacity ${opacity}`}>
            <Chart 
              data={sampledData} 
              color="purple" 
              label="Memory Usage"
              getValue={d => d.memory}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Min</div>
                <div className="text-lg font-mono text-purple-400">
                  {Math.min(...data.map(d => d.memory)).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Avg</div>
                <div className="text-lg font-mono text-purple-400">
                  {(data.reduce((a, b) => a + b.memory, 0) / data.length).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Max</div>
                <div className="text-lg font-mono text-purple-400">
                  {Math.max(...data.map(d => d.memory)).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        );

      case 'disk':
        return (
          <div className={`transition-opacity ${opacity}`}>
            <Chart 
              data={sampledData} 
              color="amber" 
              label="Disk Usage"
              getValue={d => d.disk}
              formatValue={v => `${v.toFixed(1)}%`}
              maxValue={100}
            />
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Min</div>
                <div className="text-lg font-mono text-amber-400">
                  {Math.min(...data.map(d => d.disk)).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Avg</div>
                <div className="text-lg font-mono text-amber-400">
                  {(data.reduce((a, b) => a + b.disk, 0) / data.length).toFixed(1)}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Max</div>
                <div className="text-lg font-mono text-amber-400">
                  {Math.max(...data.map(d => d.disk)).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        );

      case 'network':
        return (
          <div className={`space-y-6 transition-opacity ${opacity}`}>
            <Chart 
              data={sampledData} 
              color="emerald" 
              label="Upload (TX)"
              getValue={d => d.net_tx}
              formatValue={v => formatBytes(v)}
            />
            <Chart 
              data={sampledData} 
              color="cyan" 
              label="Download (RX)"
              getValue={d => d.net_rx}
              formatValue={v => formatBytes(v)}
            />
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Total Upload</div>
                <div className="text-lg font-mono text-emerald-400">
                  {formatBytes(data.reduce((a, b) => a + b.net_tx, 0))}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Total Download</div>
                <div className="text-lg font-mono text-cyan-400">
                  {formatBytes(data.reduce((a, b) => a + b.net_rx, 0))}
                </div>
              </div>
            </div>
          </div>
        );

      case 'ping':
        // Colors for different ping targets
        const pingColors = ['rose', 'cyan', 'amber', 'purple', 'emerald', 'blue'];
        
        // Check if we have detailed ping target data
        if (pingTargets.length > 0) {
          return (
            <div className={`transition-opacity ${opacity}`}>
              <div className="space-y-6">
                {pingTargets.map((target, idx) => {
                  const color = pingColors[idx % pingColors.length];
                  const validData = target.data.filter(d => d.latency_ms !== null);
                  if (validData.length === 0) return null;
                  
                  const values = validData.map(d => d.latency_ms!);
                  const avg = values.reduce((a, b) => a + b, 0) / values.length;
                  const min = Math.min(...values);
                  const max = Math.max(...values);
                  
                  // Sample data for display
                  const sampleRate = Math.max(1, Math.floor(target.data.length / 60));
                  const sampledPingData = target.data.filter((_, i) => i % sampleRate === 0);
                  
                  const colorClasses: Record<string, { bg: string; text: string; border: string }> = {
                    rose: { bg: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/20' },
                    cyan: { bg: 'bg-cyan-500', text: 'text-cyan-400', border: 'border-cyan-500/20' },
                    amber: { bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/20' },
                    purple: { bg: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/20' },
                    emerald: { bg: 'bg-emerald-500', text: 'text-emerald-400', border: 'border-emerald-500/20' },
                    blue: { bg: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/20' },
                  };
                  const c = colorClasses[color];
                  
                  return (
                    <div key={target.name} className={`p-4 rounded-lg bg-white/[0.02] border ${c.border}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${c.bg}`}></span>
                          <span className={`text-sm font-medium ${c.text}`}>{target.name}</span>
                          <span className="text-xs text-gray-500 font-mono">({target.host})</span>
                        </div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-gray-500">min: <span className="text-emerald-400 font-mono">{min.toFixed(1)}ms</span></span>
                          <span className="text-gray-500">avg: <span className={`${c.text} font-mono`}>{avg.toFixed(1)}ms</span></span>
                          <span className="text-gray-500">max: <span className="text-amber-400 font-mono">{max.toFixed(1)}ms</span></span>
                        </div>
                      </div>
                      <div className="h-16 flex items-end gap-px bg-white/[0.02] rounded-lg p-2 overflow-hidden">
                        {sampledPingData.map((point, i) => {
                          const value = point.latency_ms ?? 0;
                          const maxVal = Math.max(...values, 1);
                          return (
                            <div
                              key={i}
                              className={`flex-1 min-w-[2px] ${c.bg} rounded-t transition-all hover:opacity-80 cursor-pointer ${point.status !== 'ok' ? 'opacity-30' : ''}`}
                              style={{ height: `${Math.max((value / maxVal) * 100, 1)}%` }}
                              title={`${new Date(point.timestamp).toLocaleTimeString()}: ${value.toFixed(1)} ms (${point.status})`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }
        
        // Fallback to aggregated ping_ms data
        const pingData = sampledData.filter(d => d.ping_ms !== undefined && d.ping_ms !== null);
        if (pingData.length === 0) {
          return (
            <div className={`transition-opacity ${opacity}`}>
              <div className="h-32 flex flex-col items-center justify-center text-gray-500">
                <svg className="w-12 h-12 mb-3 text-rose-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
                <span className="text-sm">No ping data available</span>
                <span className="text-xs text-gray-600 mt-1">Waiting for agent to report latency...</span>
              </div>
            </div>
          );
        }
        
        const pingValues = pingData.map(d => d.ping_ms!);
        const avgPing = pingValues.reduce((a, b) => a + b, 0) / pingValues.length;
        const minPing = Math.min(...pingValues);
        const maxPing = Math.max(...pingValues);
        
        return (
          <div className={`transition-opacity ${opacity}`}>
            <Chart 
              data={pingData} 
              color="rose" 
              label="Ping Latency (Average)"
              getValue={d => d.ping_ms ?? 0}
              formatValue={v => `${v.toFixed(1)} ms`}
            />
            <div className="mt-6 grid grid-cols-3 gap-4 text-center">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Min</div>
                <div className="text-lg font-mono text-emerald-400">
                  {minPing.toFixed(1)} ms
                </div>
              </div>
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Avg</div>
                <div className="text-lg font-mono text-rose-400">
                  {avgPing.toFixed(1)} ms
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="text-[10px] text-gray-500 uppercase">Max</div>
                <div className="text-lg font-mono text-amber-400">
                  {maxPing.toFixed(1)} ms
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="nezha-card p-6">
      {/* Header with Tabs */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-1 p-1 bg-white/5 rounded-lg">
          {tabs.map(t => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                tab === t.value
                  ? `bg-${t.color}-500 text-white`
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
              style={tab === t.value ? { backgroundColor: `var(--${t.color}-500, #10b981)` } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 p-1 bg-white/5 rounded-lg">
          {ranges.map(r => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                range === r.value
                  ? 'bg-emerald-500 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {renderContent()}
    </div>
  );
}

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { servers, loadingState, isInitialLoad } = useServerManager();
  const [showContent, setShowContent] = useState(false);

  const server = servers.find(s => s.config.id === id);

  // Delay showing content for smooth transition
  useEffect(() => {
    if (server?.metrics) {
      const timer = setTimeout(() => setShowContent(true), 50);
      return () => clearTimeout(timer);
    }
  }, [server?.metrics]);

  // Show loading state during initial load or when server data is not yet available
  if (isInitialLoad || loadingState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <div className="w-12 h-12 border-4 border-white/20 border-t-emerald-500 rounded-full animate-spin" />
          <div className="text-white/60 text-sm">Loading server data...</div>
        </div>
      </div>
    );
  }

  // If server not found after data is loaded, show a brief delay before showing error
  // This prevents flash of "not found" during navigation
  if (!server) {
    return (
      <div className="min-h-screen flex items-center justify-center animate-fadeIn">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <div className="text-gray-400 mb-2 text-lg font-medium">Server Not Available</div>
          <div className="text-gray-600 text-sm mb-6">The server may have been removed or is offline.</div>
          <button 
            onClick={() => navigate('/')}
            className="px-6 py-2.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-medium transition-all hover:scale-105"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const { metrics, speed, isConnected, config } = server;

  // Show connecting state if metrics not yet available
  if (!metrics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-white/20 border-t-emerald-500 rounded-full animate-spin" />
          <div className="text-white/60 text-sm">Connecting to {config.name}...</div>
        </div>
      </div>
    );
  }

  const OsIcon = getOsIcon(metrics.os.name);
  const ProviderIcon = config.provider ? getProviderIcon(config.provider) : null;
  const providerLogo = config.provider && config.provider !== 'Local' ? getProviderLogo(config.provider) : null;
  const distributionLogo = getDistributionLogo(metrics.os.name);
  const flag = FLAGS[config.location || ''] || '🌍';

  return (
    <div className={`min-h-screen p-4 md:p-6 lg:p-10 max-w-6xl mx-auto ${showContent ? 'animate-slideUp' : 'opacity-0'}`}>
      {/* Back Button */}
      <button 
        onClick={() => navigate('/')}
        className="mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
      >
        <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="text-sm">Back to Dashboard</span>
      </button>

      {/* Header */}
      <div className="nezha-card p-6 md:p-8 mb-6 relative overflow-hidden">
        {/* Provider Logo Background */}
        {providerLogo && (
          <div className="absolute -right-4 -bottom-4 w-32 h-32 opacity-[0.06] pointer-events-none">
            <LogoImage 
              src={providerLogo} 
              alt="" 
              className="w-full h-full object-contain transform rotate-[-15deg]" 
            />
          </div>
        )}
        
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 relative z-10">
          {/* Main Icon: OS System Logo */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 border border-blue-500/30 flex items-center justify-center overflow-hidden">
            {distributionLogo ? (
              <LogoImage src={distributionLogo} alt={metrics.os.name} className="w-14 h-14 object-contain" />
            ) : OsIcon ? (
              <OsIcon className="w-12 h-12 text-blue-400" />
            ) : (
              <svg className="w-12 h-12 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-3xl font-bold text-white">{config.name}</h1>
              <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Location with flag */}
              {config.location && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                  <span className="text-sm">{flag}</span>
                  <span className="text-xs text-cyan-300 font-medium">{config.location}</span>
                </div>
              )}
              {/* Provider */}
              {providerLogo ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <LogoImage src={providerLogo} alt={config.provider || ''} className="w-4 h-4 object-contain" />
                  <span className="text-xs text-amber-300 font-medium">{config.provider}</span>
                </div>
              ) : ProviderIcon ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <ProviderIcon className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-amber-300 font-medium">{config.provider}</span>
                </div>
              ) : null}
              {/* OS Name */}
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <span className="text-xs text-blue-300 font-medium">{metrics.os.name}</span>
              </div>
              {/* Architecture */}
              <div className="px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <span className="text-xs text-purple-300 font-medium">{metrics.os.arch}</span>
              </div>
              {/* Cores */}
              <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <span className="text-xs text-emerald-300 font-medium">{metrics.cpu.cores} Cores</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider">Uptime</div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">{formatUptime(metrics.uptime)}</div>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Kernel" value={metrics.os.kernel} color="gray" />
        <StatCard label="Load (1m)" value={metrics.load_average.one.toFixed(2)} color="purple" />
        <StatCard label="Load (5m)" value={metrics.load_average.five.toFixed(2)} color="purple" />
        <StatCard label="Load (15m)" value={metrics.load_average.fifteen.toFixed(2)} color="purple" />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* CPU Section */}
        <div className="nezha-card p-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            CPU
          </h2>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-300 truncate flex-1 mr-4">{metrics.cpu.brand}</span>
            <span className="text-3xl font-bold text-blue-400 font-mono">{metrics.cpu.usage.toFixed(1)}%</span>
          </div>
          <div className="h-3 w-full bg-gray-700/50 rounded-full overflow-hidden mb-4">
            <div 
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500" 
              style={{ width: `${metrics.cpu.usage}%` }} 
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-6">
            <span>{metrics.cpu.cores} Cores / Threads</span>
            <span>{(metrics.cpu.frequency / 1000).toFixed(2)} GHz</span>
          </div>

          {/* Per-core usage */}
          {metrics.cpu.per_core.length > 0 && (
            <div className="pt-4 border-t border-white/5">
              <div className="text-xs text-gray-500 mb-3">Per-Core Usage</div>
              <div className="grid grid-cols-5 gap-2">
                {metrics.cpu.per_core.map((usage, i) => (
                  <div key={i} className="relative h-16 rounded-lg bg-gray-800/50 overflow-hidden group" title={`Core ${i}: ${usage.toFixed(0)}%`}>
                    <div 
                      className={`absolute bottom-0 left-0 right-0 transition-all duration-500 ${usage > 80 ? 'bg-red-500' : usage > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                      style={{ height: `${usage}%` }}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-mono text-white/50">{i}</span>
                      <span className="text-xs font-mono font-bold text-white">{usage.toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Memory Section */}
        <div className="nezha-card p-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            Memory
          </h2>
          
          {/* RAM */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">RAM</span>
              <span className="text-2xl font-bold text-purple-400 font-mono">{metrics.memory.usage_percent.toFixed(1)}%</span>
            </div>
            <div className="h-3 w-full bg-gray-700/50 rounded-full overflow-hidden mb-3">
              <div 
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-400 transition-all duration-500" 
                style={{ width: `${metrics.memory.usage_percent}%` }} 
              />
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-gray-500">Used</div>
                <div className="text-sm font-mono text-white">{formatBytes(metrics.memory.used)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Available</div>
                <div className="text-sm font-mono text-emerald-400">{formatBytes(metrics.memory.available)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-sm font-mono text-white">{formatBytes(metrics.memory.total)}</div>
              </div>
            </div>
          </div>

          {/* Swap */}
          {metrics.memory.swap_total > 0 && (
            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Swap</span>
                <span className="text-lg font-bold text-gray-400 font-mono">
                  {((metrics.memory.swap_used / metrics.memory.swap_total) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full bg-gray-700/50 rounded-full overflow-hidden mb-2">
                <div 
                  className="h-full rounded-full bg-gray-500 transition-all duration-500" 
                  style={{ width: `${(metrics.memory.swap_used / metrics.memory.swap_total) * 100}%` }} 
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Used: {formatBytes(metrics.memory.swap_used)}</span>
                <span>Total: {formatBytes(metrics.memory.swap_total)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Storage Section */}
        <div className="nezha-card p-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            Storage
          </h2>
          <div className="space-y-5">
            {metrics.disks.map((disk, i) => (
              <div key={i}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-300 font-mono">{disk.name || disk.mount_point}</span>
                    <span className="text-[10px] text-gray-600 px-1.5 py-0.5 rounded bg-white/5">{disk.fs_type}</span>
                  </div>
                  <span className={`text-lg font-bold font-mono ${disk.usage_percent > 90 ? 'text-red-400' : 'text-amber-400'}`}>
                    {disk.usage_percent.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 w-full bg-gray-700/50 rounded-full overflow-hidden mb-2">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${disk.usage_percent > 90 ? 'bg-red-500' : 'bg-amber-500'}`}
                    style={{ width: `${disk.usage_percent}%` }} 
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{formatBytes(disk.used)} used</span>
                  <span>{formatBytes(disk.available)} free</span>
                  <span>{formatBytes(disk.total)} total</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Network Section */}
        <div className="nezha-card p-6">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
            Network
          </h2>

          {/* Current Speed */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-xs text-emerald-400 mb-1">↑ Upload Speed</div>
              <div className="text-2xl font-bold font-mono text-emerald-300">{formatSpeed(speed.tx_sec)}</div>
            </div>
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="text-xs text-blue-400 mb-1">↓ Download Speed</div>
              <div className="text-2xl font-bold font-mono text-blue-300">{formatSpeed(speed.rx_sec)}</div>
            </div>
          </div>

          {/* Total Traffic */}
          <div className="grid grid-cols-2 gap-4 mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/5">
            <div>
              <div className="text-xs text-gray-500 mb-1">Total Uploaded</div>
              <div className="text-lg font-bold font-mono text-white">{formatBytes(metrics.network.total_tx)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Total Downloaded</div>
              <div className="text-lg font-bold font-mono text-white">{formatBytes(metrics.network.total_rx)}</div>
            </div>
          </div>

          {/* Interfaces */}
          <div className="pt-4 border-t border-white/5">
            <div className="text-xs text-gray-500 mb-3">Network Interfaces</div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {[...metrics.network.interfaces]
                .filter(iface => iface.rx_bytes > 0 || iface.tx_bytes > 0)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((iface, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <span className="font-mono text-gray-300 text-sm">{iface.name}</span>
                    <div className="flex gap-4 text-xs font-mono">
                      <span className="text-emerald-400">↑ {formatBytes(iface.tx_bytes)}</span>
                      <span className="text-blue-400">↓ {formatBytes(iface.rx_bytes)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Ping Status */}
          {metrics.ping && metrics.ping.targets.length > 0 && (
            <div className="pt-4 border-t border-white/5 mt-4">
              <div className="text-xs text-gray-500 mb-3">Ping Latency</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {metrics.ping.targets.map((target, i) => (
                  <div 
                    key={i} 
                    className={`p-3 rounded-lg border ${
                      target.status === 'ok' 
                        ? 'bg-emerald-500/5 border-emerald-500/20' 
                        : target.status === 'timeout'
                        ? 'bg-amber-500/5 border-amber-500/20'
                        : 'bg-red-500/5 border-red-500/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{target.name}</span>
                      <span className={`w-2 h-2 rounded-full ${
                        target.status === 'ok' ? 'bg-emerald-500' : target.status === 'timeout' ? 'bg-amber-500' : 'bg-red-500'
                      }`} />
                    </div>
                    <div className="text-lg font-mono font-bold text-white">
                      {target.latency_ms !== null ? `${target.latency_ms.toFixed(1)} ms` : '--'}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1 font-mono">{target.host}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History Section - Full Width */}
      <div className="mt-6">
        <HistoryChart serverId={id!} />
      </div>

      {/* Footer */}
      <footer className="text-center mt-8 pt-6 border-t border-white/5">
        <p className="text-white/20 text-xs font-mono">
          Last updated: {new Date().toLocaleString()}
        </p>
      </footer>
    </div>
  );
}

