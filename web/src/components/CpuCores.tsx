interface CpuCoresProps {
  cores: number[];
}

export function CpuCores({ cores }: CpuCoresProps) {
  const getColor = (usage: number) => {
    if (usage < 30) return 'bg-success-500/60';
    if (usage < 60) return 'bg-warning-500/60';
    return 'bg-danger-500/60';
  };

  const getGlow = (usage: number) => {
    if (usage < 30) return 'shadow-success-500/30';
    if (usage < 60) return 'shadow-warning-500/30';
    return 'shadow-danger-500/30';
  };

  return (
    <div className="grid grid-cols-4 gap-2 mt-4">
      {cores.map((usage, i) => (
        <div key={i} className="relative group">
          <div
            className={`h-8 rounded-lg ${getColor(usage)} shadow-lg ${getGlow(usage)} 
              transition-all duration-300 flex items-center justify-center`}
            style={{
              background: `linear-gradient(180deg, 
                rgba(255,255,255,0.1) 0%, 
                transparent 50%,
                rgba(0,0,0,0.2) 100%
              ), ${usage < 30 ? '#10b981' : usage < 60 ? '#f59e0b' : '#ef4444'}`,
              opacity: 0.3 + (usage / 100) * 0.7,
            }}
          >
            <span className="text-xs font-mono font-medium text-white/90">
              {usage.toFixed(0)}%
            </span>
          </div>
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 
            bg-obsidian-800 rounded text-xs opacity-0 group-hover:opacity-100 
            transition-opacity pointer-events-none whitespace-nowrap z-10">
            Core {i}
          </div>
        </div>
      ))}
    </div>
  );
}

