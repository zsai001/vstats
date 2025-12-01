interface ProgressBarProps {
  value: number;
  label?: string;
  sublabel?: string;
  showValue?: boolean;
}

export function ProgressBar({ value, label, sublabel, showValue = true }: ProgressBarProps) {
  const getGradient = (val: number) => {
    if (val < 50) return { start: '#10b981', end: '#34d399' };
    if (val < 80) return { start: '#f59e0b', end: '#fbbf24' };
    return { start: '#ef4444', end: '#f87171' };
  };

  const colors = getGradient(value);

  return (
    <div className="space-y-2">
      {(label || showValue) && (
        <div className="flex justify-between items-baseline">
          <div>
            {label && <span className="text-sm text-obsidian-200">{label}</span>}
            {sublabel && (
              <span className="text-xs text-obsidian-500 ml-2">{sublabel}</span>
            )}
          </div>
          {showValue && (
            <span
              className="text-sm font-mono font-semibold counter"
              style={{ color: colors.start }}
            >
              {value.toFixed(1)}%
            </span>
          )}
        </div>
      )}
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{
            width: `${Math.min(100, value)}%`,
            '--bar-color-start': colors.start,
            '--bar-color-end': colors.end,
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

