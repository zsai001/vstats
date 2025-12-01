import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerManager, formatSpeed, formatUptime, type ServerState } from '../hooks/useMetrics';
import { getOsIcon, getProviderIcon } from '../components/Icons';
import { useTheme } from '../context/ThemeContext';
import type { SocialLink } from '../types';

type ViewMode = 'list' | 'grid';

const FLAGS: Record<string, string> = {
  'CN': '🇨🇳', 'HK': '🇭🇰', 'TW': '🇹🇼', 'JP': '🇯🇵', 'KR': '🇰🇷',
  'SG': '🇸🇬', 'US': '🇺🇸', 'DE': '🇩🇪', 'UK': '🇬🇧', 'FR': '🇫🇷',
  'NL': '🇳🇱', 'RU': '🇷🇺', 'AU': '🇦🇺', 'CA': '🇨🇦', 'IN': '🇮🇳',
};

// Social Icons Component
function SocialIcon({ platform }: { platform: string }) {
  const iconClass = "w-4 h-4";
  
  switch (platform.toLowerCase()) {
    case 'github':
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      );
    case 'twitter':
    case 'x':
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      );
    case 'telegram':
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
      );
    case 'discord':
      return (
        <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
        </svg>
      );
    case 'email':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      );
    case 'website':
    case 'web':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      );
  }
}

function SocialLinks({ links }: { links: SocialLink[] }) {
  if (!links || links.length === 0) return null;
  
  return (
    <div className="flex items-center justify-center gap-3 mb-3">
      {links.map((link, i) => (
        <a
          key={i}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="social-link"
          title={link.label || link.platform}
        >
          <SocialIcon platform={link.platform} />
        </a>
      ))}
    </div>
  );
}

function ServerCard({ server, onClick }: { server: ServerState; onClick: () => void }) {
  const { metrics, speed, isConnected, config } = server;
  
  const OsIcon = metrics ? getOsIcon(metrics.os.name) : null;
  const ProviderIcon = config.provider && config.provider !== 'Local' ? getProviderIcon(config.provider) : null;
  const flag = config.type === 'local' ? '🏠' : (FLAGS[config.location || ''] || '🌍');

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

// Grid Card Component for compact grid view
function ServerGridCard({ server, onClick }: { server: ServerState; onClick: () => void }) {
  const { metrics, speed, isConnected, config } = server;
  
  const OsIcon = metrics ? getOsIcon(metrics.os.name) : null;
  const flag = FLAGS[config.location || ''] || (config.type === 'local' ? '🏠' : '🌍');

  if (!metrics) {
    return (
      <div className="nezha-card p-4 animate-pulse cursor-pointer aspect-square flex flex-col" onClick={onClick}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">{flag}</span>
          <div className="h-4 skeleton-bg rounded flex-1"></div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-xs">Connecting...</div>
        </div>
      </div>
    );
  }

  const cpuColor = metrics.cpu.usage > 80 ? 'text-red-500' : metrics.cpu.usage > 50 ? 'text-amber-500' : 'text-emerald-500';
  const memColor = metrics.memory.usage_percent > 80 ? 'text-red-500' : metrics.memory.usage_percent > 50 ? 'text-amber-500' : 'text-emerald-500';
  const diskUsage = metrics.disks[0]?.usage_percent || 0;
  const diskColor = diskUsage > 90 ? 'text-red-500' : diskUsage > 70 ? 'text-amber-500' : 'text-emerald-500';

  const cpuStroke = metrics.cpu.usage > 80 ? 'stroke-red-500' : metrics.cpu.usage > 50 ? 'stroke-amber-500' : 'stroke-emerald-500';
  const memStroke = metrics.memory.usage_percent > 80 ? 'stroke-red-500' : metrics.memory.usage_percent > 50 ? 'stroke-amber-500' : 'stroke-emerald-500';
  const diskStroke = diskUsage > 90 ? 'stroke-red-500' : diskUsage > 70 ? 'stroke-amber-500' : 'stroke-emerald-500';

  return (
    <div 
      className="nezha-card p-4 hover:scale-[1.02] transition-all cursor-pointer group flex flex-col"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{flag}</span>
        <h3 className="font-bold truncate text-sm flex-1 group-hover:text-emerald-500 transition-colors" style={{ color: 'var(--text-primary)' }}>
          {config.name}
        </h3>
        <span className={`w-2 h-2 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
      </div>

      {/* Resource Rings */}
      <div className="flex-1 flex items-center justify-center gap-3 my-2">
        {/* CPU Ring */}
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="ring-track" />
            <circle 
              cx="18" cy="18" r="15" fill="none" strokeWidth="3" strokeLinecap="round"
              className={cpuStroke}
              strokeDasharray={`${metrics.cpu.usage * 0.94} 94`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xs font-bold font-mono ${cpuColor}`}>{metrics.cpu.usage.toFixed(0)}%</span>
            <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>CPU</span>
          </div>
        </div>

        {/* Memory Ring */}
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="ring-track" />
            <circle 
              cx="18" cy="18" r="15" fill="none" strokeWidth="3" strokeLinecap="round"
              className={memStroke}
              strokeDasharray={`${metrics.memory.usage_percent * 0.94} 94`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xs font-bold font-mono ${memColor}`}>{metrics.memory.usage_percent.toFixed(0)}%</span>
            <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>RAM</span>
          </div>
        </div>

        {/* Disk Ring */}
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="ring-track" />
            <circle 
              cx="18" cy="18" r="15" fill="none" strokeWidth="3" strokeLinecap="round"
              className={diskStroke}
              strokeDasharray={`${diskUsage * 0.94} 94`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xs font-bold font-mono ${diskColor}`}>{diskUsage.toFixed(0)}%</span>
            <span className="text-[8px]" style={{ color: 'var(--text-muted)' }}>Disk</span>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between pt-2 text-[10px] border-theme" style={{ borderTopWidth: '1px' }}>
        <div className="flex items-center gap-1">
          {OsIcon && <OsIcon className="w-3 h-3 text-blue-500" />}
          <span style={{ color: 'var(--text-muted)' }}>{formatUptime(metrics.uptime)}</span>
        </div>
        <div className="flex gap-2 font-mono">
          <span className="text-emerald-600">↑{formatSpeed(speed.tx_sec)}</span>
          <span className="text-blue-600">↓{formatSpeed(speed.rx_sec)}</span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { servers, siteSettings } = useServerManager();
  const { theme, toggleTheme } = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Persist view mode preference
    return (localStorage.getItem('vstats-view-mode') as ViewMode) || 'list';
  });

  const toggleViewMode = () => {
    const newMode = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(newMode);
    localStorage.setItem('vstats-view-mode', newMode);
  };

  const onlineCount = servers.filter(s => s.isConnected).length;
  const totalBandwidthRx = servers.reduce((acc, s) => acc + s.speed.rx_sec, 0);
  const totalBandwidthTx = servers.reduce((acc, s) => acc + s.speed.tx_sec, 0);

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-10 max-w-6xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span className="text-emerald-500">⚡</span> {siteSettings.site_name || 'xProb Dashboard'}
          </h1>
          <p className="text-gray-500 text-xs mt-0.5 font-mono">{siteSettings.site_description || 'Real-time Server Monitoring'}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <button
            onClick={toggleViewMode}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white transition-all"
            title={`Switch to ${viewMode === 'list' ? 'grid' : 'list'} view`}
          >
            {viewMode === 'list' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-gray-400 hover:text-white transition-all"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
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
        
        {viewMode === 'list' ? (
          // List View
          <div className="flex flex-col gap-3">
            {servers.map(server => (
              <ServerCard 
                key={server.config.id} 
                server={server} 
                onClick={() => navigate(`/server/${server.config.id}`)}
              />
            ))}
          </div>
        ) : (
          // Grid View
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {servers.map(server => (
              <ServerGridCard 
                key={server.config.id} 
                server={server} 
                onClick={() => navigate(`/server/${server.config.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer with Social Links */}
      <footer className="text-center mt-auto pt-6 pb-2">
        <SocialLinks links={siteSettings.social_links} />
        <p className="text-gray-600 text-[10px] font-mono">
          xProb Monitor v0.3.0 • Powered by vStats
        </p>
      </footer>
    </div>
  );
}
