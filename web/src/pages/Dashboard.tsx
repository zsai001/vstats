import { useNavigate } from 'react-router-dom';
import { useServerManager, formatSpeed, formatUptime, type ServerState } from '../hooks/useMetrics';
import { getOsIcon, getProviderIcon } from '../components/Icons';

const FLAGS: Record<string, string> = {
  'CN': '🇨🇳', 'HK': '🇭🇰', 'TW': '🇹🇼', 'JP': '🇯🇵', 'KR': '🇰🇷',
  'SG': '🇸🇬', 'US': '🇺🇸', 'DE': '🇩🇪', 'UK': '🇬🇧', 'FR': '🇫🇷',
  'NL': '🇳🇱', 'RU': '🇷🇺', 'AU': '🇦🇺', 'CA': '🇨🇦', 'IN': '🇮🇳',
};

function ServerCard({ server, onClick }: { server: ServerState; onClick: () => void }) {
  const { metrics, speed, isConnected, config } = server;
  
  const OsIcon = metrics ? getOsIcon(metrics.os.name) : null;
  const ProviderIcon = config.provider ? getProviderIcon(config.provider) : null;
  const flag = FLAGS[config.location || ''] || '🌍';

  if (!metrics) {
    return (
      <div className="nezha-card p-4 flex items-center gap-4 animate-pulse cursor-pointer" onClick={onClick}>
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg">{flag}</div>
        <div className="flex-1">
          <div className="h-4 bg-white/10 rounded w-32 mb-2"></div>
          <div className="h-3 bg-white/5 rounded w-24"></div>
        </div>
        <div className="text-gray-500 text-sm">Connecting...</div>
      </div>
    );
  }

  return (
    <div 
      className="nezha-card p-4 md:p-5 flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-6 hover:scale-[1.005] hover:border-white/20 transition-all cursor-pointer group"
      onClick={onClick}
    >
      {/* Column 1: Identity with Icons */}
      <div className="w-full lg:w-56 shrink-0 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 group-hover:border-white/20 flex items-center justify-center text-xl shrink-0 transition-colors">
          {flag}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white truncate text-sm group-hover:text-emerald-300 transition-colors">{config.name}</h3>
            <span className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            {OsIcon && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/20" title={metrics.os.name}>
                <OsIcon className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-[10px] text-blue-300 font-medium">{metrics.os.name.split(' ')[0]}</span>
              </div>
            )}
            {ProviderIcon && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20" title={config.provider}>
                <ProviderIcon className="w-3.5 h-3.5 text-amber-400" />
              </div>
            )}
            <span className="text-[10px] text-gray-500">{formatUptime(metrics.uptime)}</span>
          </div>
        </div>
      </div>

      {/* Column 2: Resources */}
      <div className="flex-1 w-full grid grid-cols-3 gap-3 lg:gap-6">
        {[
          { label: 'CPU', value: metrics.cpu.usage, thresholds: [50, 80] },
          { label: 'RAM', value: metrics.memory.usage_percent, thresholds: [50, 80] },
          { label: 'Disk', value: metrics.disks[0]?.usage_percent || 0, thresholds: [70, 90] },
        ].map(({ label, value, thresholds }) => (
          <div key={label} className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-gray-500">{label}</span>
              <span className={`font-mono font-bold ${value > thresholds[1] ? 'text-red-400' : value > thresholds[0] ? 'text-yellow-400' : 'text-emerald-400'}`}>
                {value.toFixed(0)}%
              </span>
            </div>
            <div className="h-1 w-full bg-gray-700/50 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${value > thresholds[1] ? 'bg-red-500' : value > thresholds[0] ? 'bg-yellow-500' : 'bg-emerald-500'}`} 
                style={{ width: `${value}%` }} 
              />
            </div>
          </div>
        ))}
      </div>

      {/* Column 3: Network */}
      <div className="w-full lg:w-40 flex flex-row lg:flex-col justify-between lg:justify-center items-end lg:items-end gap-1 shrink-0 border-t lg:border-t-0 lg:border-l border-white/5 pt-3 lg:pt-0 lg:pl-4">
        <div className="text-right">
          <div className="text-[10px] text-gray-600 uppercase tracking-wider">Up</div>
          <div className="text-xs font-mono text-emerald-400 font-semibold">↑ {formatSpeed(speed.tx_sec)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-gray-600 uppercase tracking-wider">Down</div>
          <div className="text-xs font-mono text-blue-400 font-semibold">↓ {formatSpeed(speed.rx_sec)}</div>
        </div>
      </div>

      {/* Expand Indicator */}
      <div className="hidden lg:flex items-center justify-center w-6 text-gray-600 group-hover:text-white group-hover:translate-x-1 transition-all">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { servers } = useServerManager();

  const onlineCount = servers.filter(s => s.isConnected).length;
  const totalBandwidthRx = servers.reduce((acc, s) => acc + s.speed.rx_sec, 0);
  const totalBandwidthTx = servers.reduce((acc, s) => acc + s.speed.tx_sec, 0);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-10 max-w-6xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="text-emerald-500">⚡</span> xProb Dashboard
          </h1>
          <p className="text-gray-500 text-xs mt-0.5 font-mono">Real-time Server Monitoring</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[10px] text-gray-600 uppercase tracking-wider">Servers</div>
            <div className="text-2xl font-bold text-white">{servers.length}</div>
          </div>
          <button
            onClick={() => navigate('/login')}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white transition-all"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="nezha-card p-3 md:p-4 bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5">Online</div>
          <div className="text-xl md:text-2xl font-bold text-white">{onlineCount}</div>
        </div>
        <div className="nezha-card p-3 md:p-4 bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
          <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-0.5">Offline</div>
          <div className="text-xl md:text-2xl font-bold text-white">{servers.length - onlineCount}</div>
        </div>
        <div className="nezha-card p-3 md:p-4 bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20">
          <div className="text-[10px] text-blue-400 font-bold uppercase tracking-wider mb-0.5">↓ Download</div>
          <div className="text-lg md:text-xl font-bold text-white font-mono">{formatSpeed(totalBandwidthRx)}</div>
        </div>
        <div className="nezha-card p-3 md:p-4 bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
          <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5">↑ Upload</div>
          <div className="text-lg md:text-xl font-bold text-white font-mono">{formatSpeed(totalBandwidthTx)}</div>
        </div>
      </div>

      {/* Server List */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1 text-[10px] font-bold text-gray-600 uppercase tracking-wider">
          <span>Server Details</span>
          <span className="font-mono text-gray-700">{new Date().toLocaleTimeString()}</span>
        </div>
        {servers.map(server => (
          <ServerCard 
            key={server.config.id} 
            server={server} 
            onClick={() => navigate(`/server/${server.config.id}`)}
          />
        ))}
      </div>

      {/* Footer */}
      <footer className="text-center mt-auto pt-6 pb-2">
        <p className="text-white/10 text-[10px] font-mono">
          xProb Monitor v0.2.0 • Inspired by Nezha
        </p>
      </footer>
    </div>
  );
}

