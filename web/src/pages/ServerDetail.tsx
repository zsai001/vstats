import { useParams, useNavigate } from 'react-router-dom';
import { useServerManager, formatBytes, formatSpeed, formatUptime } from '../hooks/useMetrics';
import { getOsIcon, getProviderIcon } from '../components/Icons';

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

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { servers } = useServerManager();

  const server = servers.find(s => s.config.id === id);

  if (!server) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-500 mb-4">Server not found</div>
          <button 
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const { metrics, speed, isConnected, config } = server;

  if (!metrics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          <div className="text-white/60 text-sm">Connecting to {config.name}...</div>
        </div>
      </div>
    );
  }

  const OsIcon = getOsIcon(metrics.os.name);
  const ProviderIcon = config.provider ? getProviderIcon(config.provider) : null;
  const flag = FLAGS[config.location || ''] || '🌍';

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-10 max-w-6xl mx-auto">
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
      <div className="nezha-card p-6 md:p-8 mb-6">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-5xl">
            {flag}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <h1 className="text-3xl font-bold text-white">{config.name}</h1>
              <span className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {OsIcon && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <OsIcon className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-blue-300 font-medium">{metrics.os.name}</span>
                </div>
              )}
              {ProviderIcon && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <ProviderIcon className="w-4 h-4 text-amber-400" />
                  <span className="text-xs text-amber-300 font-medium">{config.provider}</span>
                </div>
              )}
              <div className="px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <span className="text-xs text-purple-300">{metrics.os.arch}</span>
              </div>
              <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-gray-400">{metrics.cpu.cores} Cores</span>
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
                    <span className="text-sm text-gray-300 font-mono">{disk.mount_point}</span>
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
              {metrics.network.interfaces
                .filter(iface => iface.rx_bytes > 0 || iface.tx_bytes > 0)
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
        </div>
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

