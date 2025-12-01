interface ProgressRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
}

export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 8,
  label,
  sublabel,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  const getColor = (val: number) => {
    if (val < 50) return { stroke: '#10b981', glow: 'rgba(16, 185, 129, 0.4)' };
    if (val < 80) return { stroke: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' };
    return { stroke: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)' };
  };

  const colors = getColor(value);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-obsidian-800"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease-out, stroke 0.3s ease',
            filter: `drop-shadow(0 0 8px ${colors.glow})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold counter" style={{ color: colors.stroke }}>
          {value.toFixed(1)}%
        </span>
        {label && <span className="text-xs text-obsidian-400 mt-1">{label}</span>}
        {sublabel && <span className="text-[10px] text-obsidian-500">{sublabel}</span>}
      </div>
    </div>
  );
}

