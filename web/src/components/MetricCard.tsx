import type { ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}

export function MetricCard({ title, icon, children, className = '', delay = 0 }: MetricCardProps) {
  return (
    <div
      className={`glass-card glow-border p-6 opacity-0 animate-slide-up ${className}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-xl bg-gradient-to-br from-ember-500/20 to-arctic-500/20 text-ember-400">
          {icon}
        </div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-obsidian-400">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

