import { useState, useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useServerManager, formatSpeed, formatUptime, type ServerState } from '../hooks/useMetrics';
import { getOsIcon } from '../components/Icons';
import { getProviderLogo, getDistributionLogo, LogoImage } from '../utils/logoUtils';
import { useTheme } from '../context/ThemeContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import type { SocialLink, GroupOption } from '../types';

type ViewMode = 'list' | 'grid' | 'compact';

// Convert ISO 3166-1 alpha-2 country code to flag emoji
// Each letter becomes a regional indicator symbol (A=🇦, B=🇧, etc.)
const getFlag = (code: string | undefined): string | null => {
  if (!code || code.length !== 2) return null;
  const upper = code.toUpperCase();
  const offset = 0x1F1E6 - 65; // 65 is char code for 'A'
  try {
    return String.fromCodePoint(
      upper.charCodeAt(0) + offset,
      upper.charCodeAt(1) + offset
    );
  } catch {
    return null;
  }
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

function SocialLinks({ links, className = '', isDark }: { links: SocialLink[]; className?: string; isDark: boolean }) {
  if (!links || links.length === 0) return null;
  
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {links.map((link, i) => (
        <a
          key={i}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`vps-btn ${isDark ? 'vps-btn-outline-dark' : 'vps-btn-outline-light'}`}
          title={link.label || link.platform}
        >
          <SocialIcon platform={link.platform} />
        </a>
      ))}
    </div>
  );
}

// Helper functions
// Extract currency symbol from price string (e.g., "$89.99" -> "$", "¥199" -> "¥")
const extractCurrency = (amount: string): string => {
  const match = amount.match(/^[^\d]+/);
  return match ? match[0] : '$';
};

// Format price display consistently
const formatPrice = (amount: string): string => {
  const currency = extractCurrency(amount);
  const numMatch = amount.match(/[\d.]+/);
  if (!numMatch) return amount;
  const num = parseFloat(numMatch[0]);
  return `${currency}${Math.round(num)}`;
};

// Format purchase date to YYYY-MM-DD
const formatPurchaseDate = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return dateStr;
  }
};

// Format latency to 1 decimal place
const formatLatency = (ms: number | null): string => {
  if (ms === null) return 'N/A';
  return `${ms.toFixed(1)}ms`;
};

// Calculate remaining value based on price and purchase date
const calculateRemainingValue = (price?: { amount: string; period: 'month' | 'year' }, purchaseDate?: string): string | null => {
  if (!price || !purchaseDate) return null;
  
  try {
    // Extract currency symbol and numeric value
    const currency = extractCurrency(price.amount);
    const priceMatch = price.amount.match(/[\d.]+/);
    if (!priceMatch) return null;
    
    const priceValue = parseFloat(priceMatch[0]);
    if (isNaN(priceValue)) return null;
    
    const purchase = new Date(purchaseDate);
    const now = new Date();
    
    if (purchase > now) return null; // Invalid date
    
    // Calculate days elapsed
    const daysElapsed = Math.floor((now.getTime() - purchase.getTime()) / (1000 * 60 * 60 * 24));
    
    if (price.period === 'month') {
      // Monthly billing: calculate based on days in month
      const daysInMonth = 30; // Approximate
      const monthsElapsed = daysElapsed / daysInMonth;
      const remainingMonths = Math.max(0, 1 - monthsElapsed);
      const remainingValue = priceValue * remainingMonths;
      
      if (remainingValue <= 0) return null;
      return `${currency}${Math.round(remainingValue)}`;
    } else if (price.period === 'year') {
      // Yearly billing: calculate based on days in year
      const daysInYear = 365;
      const yearsElapsed = daysElapsed / daysInYear;
      const remainingYears = Math.max(0, 1 - yearsElapsed);
      const remainingValue = priceValue * remainingYears;
      
      if (remainingValue <= 0) return null;
      return `${currency}${Math.round(remainingValue)}`;
    }
  } catch (e) {
    console.error('Failed to calculate remaining value', e);
  }
  
  return null;
};

const getShortCpuBrand = (brand: string) => {
  return brand
    .replace(/\(R\)|\(TM\)|CPU|Processor|@.*$/gi, '')
    .replace(/Intel Core |AMD Ryzen |AMD EPYC |Intel Xeon /gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
};

const formatDiskSize = (bytes: number) => {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  const tb = gb * 1024;
  
  if (bytes >= tb) return `${(bytes / tb).toFixed(0)}T`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(0)}G`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(0)}M`;
  return `${(bytes / kb).toFixed(0)}K`;
};

const getResourceState = (value: number, thresholds: [number, number]): 'ok' | 'warn' | 'bad' => {
  if (value > thresholds[1]) return 'bad';
  if (value > thresholds[0]) return 'warn';
  return 'ok';
};

// VPS Grid Card Component
function VpsGridCard({ server, onClick, isDark }: { server: ServerState; onClick: () => void; isDark: boolean }) {
  const { t } = useTranslation();
  const { metrics, speed, isConnected, config } = server;
  const themeClass = isDark ? 'dark' : 'light';
  
  const OsIcon = metrics ? getOsIcon(metrics.os.name) : null;
  const distributionLogo = metrics ? getDistributionLogo(metrics.os.name) : null;
  const providerLogo = config.provider ? getProviderLogo(config.provider) : null;
  const flag = getFlag(config.location);

  if (!metrics) {
    return (
      <div className={`vps-card vps-card--${themeClass} animate-pulse cursor-pointer`} onClick={onClick}>
        <div className="vps-card-header">
          <div className="vps-card-identity">
            <div className={`vps-card-avatar vps-card-avatar--${themeClass}`}>
              <div className="w-6 h-6 skeleton-bg rounded" />
            </div>
            <div className="vps-card-info">
              <div className="h-4 skeleton-bg rounded w-3/4 mb-2" />
              <div className="h-3 skeleton-bg rounded w-1/2" />
            </div>
          </div>
        </div>
        <div className="space-y-3 mt-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="vps-resource-row">
              <div className="h-3 skeleton-bg rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const diskUsage = metrics.disks?.[0]?.usage_percent || 0;
  const totalDisk = (metrics.disks || []).reduce((acc, d) => acc + d.total, 0);
  const memoryModules = metrics.memory.modules;
  const memoryType = memoryModules?.[0]?.mem_type;
  const memorySpeed = memoryModules?.[0]?.speed;
  const memoryDetail = `${formatDiskSize(metrics.memory.total)}${memoryType ? ` · ${memoryType}` : ''}${memorySpeed ? `-${memorySpeed}MHz` : ''}`;
  const diskDetail = `${metrics.disks?.[0]?.disk_type || 'Storage'} · ${formatDiskSize(totalDisk)} total`;
  
  const networkMbps = ((speed.rx_sec + speed.tx_sec) * 8) / 1_000_000;
  const networkValue = Math.min(100, Math.round(networkMbps));
  const networkSubtitle = `↑ ${formatSpeed(speed.tx_sec)} · ↓ ${formatSpeed(speed.rx_sec)}`;

  const metricIcons: Record<string, ReactElement> = {
    CPU: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9z" />
      </svg>
    ),
    RAM: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M3 7a2 2 0 012-2h14a2 2 0 012 2v9H3z" />
        <path strokeWidth={1.6} d="M6 18v2m4-2v2m4-2v2m4-2v2M7 7v5m10-5v5" />
      </svg>
    ),
    Disk: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7c0 2.21-3.582 4-8 4S4 9.21 4 7z" />
        <path strokeWidth={1.6} d="M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
    Network: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
  };

  const metricRows = [
    { label: 'CPU', subtitle: `${getShortCpuBrand(metrics.cpu.brand)} · ${metrics.cpu.cores} cores`, value: metrics.cpu.usage, thresholds: [50, 80] as [number, number] },
    { label: 'RAM', subtitle: memoryDetail, value: metrics.memory.usage_percent, thresholds: [50, 80] as [number, number] },
    { label: 'Disk', subtitle: diskDetail, value: diskUsage, thresholds: [70, 90] as [number, number] },
    { label: 'Network', subtitle: networkSubtitle, value: networkValue, thresholds: [40, 70] as [number, number] },
  ];

  // Tip badge mapping
  const getTipBadgeClass = (tag?: string) => {
    if (!tag) return null;
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('cn3-opt') || tagLower.includes('三网优化')) return 'cn3-opt';
    if (tagLower.includes('cn3-gia') || tagLower.includes('三网gia')) return 'cn3-gia';
    if (tagLower.includes('big-disk') || tagLower.includes('大盘')) return 'big-disk';
    if (tagLower.includes('perf') || tagLower.includes('性能')) return 'perf';
    if (tagLower.includes('landing') || tagLower.includes('落地')) return 'landing';
    if (tagLower.includes('dufu') || tagLower.includes('杜甫')) return 'dufu';
    return null;
  };

  const getTipBadgeLabel = (tag?: string) => {
    if (!tag) return null;
    const badgeClass = getTipBadgeClass(tag);
    if (badgeClass) return t(`dashboard.tipBadge.${badgeClass}`);
    return null;
  };

  // Tip badge: use config.tip_badge if set, otherwise infer from tag
  const tipBadgeClass = config.tip_badge || getTipBadgeClass(config.tag);
  const tipBadgeLabel = config.tip_badge 
    ? t(`dashboard.tipBadge.${config.tip_badge}`)
    : getTipBadgeLabel(config.tag);
  const pingMetrics = metrics.ping;
  const remainingValue = calculateRemainingValue(config.price, config.purchase_date);

  return (
    <div className={`vps-card vps-card--${themeClass} group cursor-pointer relative`} onClick={onClick}>
      {/* Tip Badge */}
      {tipBadgeClass && tipBadgeLabel && (
        <div className={`vps-tip-badge ${tipBadgeClass}`}>{tipBadgeLabel}</div>
      )}

      {/* Header */}
      <div className="vps-card-header">
        <div className="vps-card-identity">
          <div className={`vps-card-avatar vps-card-avatar--${themeClass}`}>
            {distributionLogo ? (
              <LogoImage src={distributionLogo} alt={metrics.os.name} className="w-6 h-6 object-contain" />
            ) : OsIcon ? (
              <OsIcon className="w-5 h-5 text-blue-500" />
            ) : null}
          </div>
          <div className="vps-card-info">
            <div className={`vps-card-title vps-card-title--${themeClass}`}>
              {config.name}
            </div>
            <div className="vps-card-meta">
              {flag && (
                <span className={`vps-location vps-location--${themeClass}`}>
                  <span className="text-base">{flag}</span>
                  <span>{config.location}</span>
                </span>
              )}
              {providerLogo && (
                <span className={`vps-provider-logo vps-provider-logo--${themeClass}`}>
                  <LogoImage src={providerLogo} alt={config.provider || ''} className="w-4 h-4 object-contain" />
                </span>
              )}
            </div>
          </div>
        </div>
        <span className={`vps-chip ${isConnected ? `vps-chip--running-${themeClass}` : `vps-chip--stopped-${themeClass}`}`}>
          <span className={`vps-chip-dot ${isConnected ? 'vps-chip-dot--running' : 'vps-chip-dot--stopped'}`} />
        </span>
      </div>

      {/* Resource Metrics */}
      <div className="vps-resources">
        {metricRows.map(({ label, subtitle, value, thresholds }) => {
          const state = getResourceState(value, thresholds);
          return (
            <div key={label} className="vps-resource-row">
              <div className={`vps-resource-icon vps-resource-icon--${themeClass} vps-resource-icon--${state}`}>
                {metricIcons[label]}
              </div>
              <div className="vps-resource-content">
                <div className="vps-resource-info">
                  <div className="vps-resource-title-row">
                    <span className={`vps-resource-label vps-resource-label--${themeClass}`}>{label.toUpperCase()}</span>
                    <span className={`vps-resource-detail vps-resource-detail--${themeClass}`}>{subtitle}</span>
                  </div>
                  <span className={`vps-resource-percent vps-resource-percent--${state}-${themeClass}`}>
                    {Math.round(value)}%
                  </span>
                </div>
                <div className={`vps-resource-bar-track vps-resource-bar-track--${themeClass}`}>
                  <div 
                    className={`vps-resource-bar-fill vps-resource-bar-fill--${state}-${themeClass}`}
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`vps-card-footer vps-card-footer--${themeClass}`}>
        {(config.price || config.purchase_date) && (
          <div className="vps-footer-row-price">
            {config.price && (
              <div className={`vps-price vps-price--${themeClass}`}>
                <span className="vps-price-amount">{formatPrice(config.price.amount)}</span>
                <span className="vps-price-period">/{config.price.period === 'month' ? '月' : '年'}</span>
              </div>
            )}
            {remainingValue && (
              <div className={`vps-footer-info-item vps-footer-info-item--${themeClass}`}>
                <span className="vps-footer-info-label">剩余</span>
                <span className="vps-footer-info-value">{remainingValue}</span>
              </div>
            )}
            {config.purchase_date && (
              <div className={`vps-footer-info-item vps-footer-info-item--${themeClass}`}>
                <span className="vps-footer-info-label">购买</span>
                <span className="vps-footer-info-value">{formatPurchaseDate(config.purchase_date)}</span>
              </div>
            )}
          </div>
        )}
        <div className="vps-footer-row-status">
          <div className={`vps-uptime-item vps-uptime-item--${themeClass}`}>
            <span className="vps-uptime-label">运行</span>
            <span className="vps-uptime-value">{formatUptime(metrics.uptime)}</span>
          </div>
          {pingMetrics && pingMetrics.targets && pingMetrics.targets.length > 0 && (
            <div className="vps-latency">
              {pingMetrics.targets.slice(0, 3).map((target, idx) => (
                <div key={idx} className={`vps-latency-item vps-latency-item--${themeClass}`}>
                  <span className="vps-latency-label">{target.name}</span>
                  <span className={`vps-latency-value vps-latency-value--${themeClass}`}>
                    {formatLatency(target.latency_ms)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// VPS List Card Component
function VpsListCard({ server, onClick, isDark }: { server: ServerState; onClick: () => void; isDark: boolean }) {
  const { t } = useTranslation();
  const { metrics, speed, isConnected, config } = server;
  const themeClass = isDark ? 'dark' : 'light';
  
  const OsIcon = metrics ? getOsIcon(metrics.os.name) : null;
  const providerLogo = config.provider ? getProviderLogo(config.provider) : null;
  const distributionLogo = metrics ? getDistributionLogo(metrics.os.name) : null;
  const flag = getFlag(config.location);

  if (!metrics) {
    return (
      <div className={`vps-list-card vps-list-card--${themeClass} animate-pulse cursor-pointer`} onClick={onClick}>
        <div className={`vps-card-avatar vps-card-avatar--${themeClass}`}>
          <div className="w-6 h-6 skeleton-bg rounded" />
        </div>
        <div className="flex-1">
          <div className="h-4 skeleton-bg rounded w-32 mb-2" />
          <div className="h-3 skeleton-bg rounded w-24" />
        </div>
        <div className={`text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{t('common.connecting')}</div>
      </div>
    );
  }

  const totalDisk = (metrics.disks || []).reduce((acc, d) => acc + d.total, 0);

  // Tip badge mapping
  const getTipBadgeClass = (tag?: string) => {
    if (!tag) return null;
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('cn3-opt') || tagLower.includes('三网优化')) return 'cn3-opt';
    if (tagLower.includes('cn3-gia') || tagLower.includes('三网gia')) return 'cn3-gia';
    if (tagLower.includes('big-disk') || tagLower.includes('大盘')) return 'big-disk';
    if (tagLower.includes('perf') || tagLower.includes('性能')) return 'perf';
    if (tagLower.includes('landing') || tagLower.includes('落地')) return 'landing';
    if (tagLower.includes('dufu') || tagLower.includes('杜甫')) return 'dufu';
    return null;
  };

  const getTipBadgeLabel = (tag?: string) => {
    if (!tag) return null;
    const badgeClass = getTipBadgeClass(tag);
    if (badgeClass) return t(`dashboard.tipBadge.${badgeClass}`);
    return null;
  };

  // Tip badge: use config.tip_badge if set, otherwise infer from tag
  const tipBadgeClass = config.tip_badge || getTipBadgeClass(config.tag);
  const tipBadgeLabel = config.tip_badge 
    ? t(`dashboard.tipBadge.${config.tip_badge}`)
    : getTipBadgeLabel(config.tag);
  const pingMetrics = metrics.ping;
  const remainingValue = calculateRemainingValue(config.price, config.purchase_date);
  
  // Calculate metrics details (same as Grid card)
  const diskUsage = metrics.disks?.[0]?.usage_percent || 0;
  const diskDetail = `${metrics.disks?.[0]?.disk_type || 'SSD'} · ${formatDiskSize(totalDisk)} total`;
  const memoryDetail = `${formatDiskSize(metrics.memory.total)}`;
  const networkValue = Math.min(100, Math.round(((speed.rx_sec + speed.tx_sec) * 8) / 1_000_000));
  const networkSubtitle = `↑ ${formatSpeed(speed.tx_sec)} · ↓ ${formatSpeed(speed.rx_sec)}`;

  const listMetricIcons: Record<string, ReactElement> = {
    CPU: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9z" />
      </svg>
    ),
    RAM: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M3 7a2 2 0 012-2h14a2 2 0 012 2v9H3z" />
        <path strokeWidth={1.6} d="M6 18v2m4-2v2m4-2v2m4-2v2M7 7v5m10-5v5" />
      </svg>
    ),
    Disk: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7c0 2.21-3.582 4-8 4S4 9.21 4 7z" />
        <path strokeWidth={1.6} d="M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
    Network: (
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" className="w-3 h-3">
        <path strokeWidth={1.6} d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    ),
  };

  const metricRows = [
    { label: 'CPU', subtitle: `${getShortCpuBrand(metrics.cpu.brand)} · ${metrics.cpu.cores} cores`, value: metrics.cpu.usage, thresholds: [50, 80] as [number, number] },
    { label: 'RAM', subtitle: memoryDetail, value: metrics.memory.usage_percent, thresholds: [50, 80] as [number, number] },
    { label: 'Disk', subtitle: diskDetail, value: diskUsage, thresholds: [70, 90] as [number, number] },
    { label: 'Network', subtitle: networkSubtitle, value: networkValue, thresholds: [40, 70] as [number, number] },
  ];

  return (
    <div 
      className={`vps-list-card vps-list-card--${themeClass} cursor-pointer group relative overflow-hidden`}
      onClick={onClick}
    >
      {/* List Tip Badge */}
      {tipBadgeClass && tipBadgeLabel && (
        <div className={`vps-list-tip-badge ${tipBadgeClass}`}>{tipBadgeLabel}</div>
      )}

      {/* Column 1: Identity */}
      <div className="vps-list-identity">
        <div className={`vps-card-avatar vps-card-avatar--${themeClass}`}>
          {distributionLogo ? (
            <LogoImage src={distributionLogo} alt={metrics.os.name} className="w-6 h-6 object-contain" />
          ) : OsIcon ? (
            <OsIcon className="w-5 h-5 text-blue-500" />
          ) : null}
        </div>
        <div className="vps-list-info">
          <div className={`vps-list-title vps-list-title--${themeClass}`}>
            {config.name}
            <span className={`vps-chip-dot ${isConnected ? 'vps-chip-dot--running' : 'vps-chip-dot--stopped'}`} />
          </div>
          <div className="vps-list-meta">
            {flag && (
              <span className={`vps-location vps-location--${themeClass}`}>
                <span className="text-xs">{flag}</span>
                <span>{config.location}</span>
              </span>
            )}
            {providerLogo && (
              <span className={`vps-provider-logo vps-provider-logo--${themeClass}`}>
                <LogoImage src={providerLogo} alt={config.provider || ''} className="w-4 h-4 object-contain" />
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Column 2: Resources (same style as Grid card) */}
      <div className="vps-list-specs">
        <div className="vps-list-resources">
          {metricRows.map(({ label, subtitle, value, thresholds }) => {
            const state = getResourceState(value, thresholds);
            return (
              <div key={label} className="vps-resource-row">
                <div className={`vps-resource-icon vps-resource-icon--${themeClass} vps-resource-icon--${state}`}>
                  {listMetricIcons[label]}
                </div>
                <div className="vps-resource-content">
                  <div className="vps-resource-info">
                    <div className="vps-resource-title-row">
                      <span className={`vps-resource-label vps-resource-label--${themeClass}`}>{label.toUpperCase()}</span>
                      <span className={`vps-resource-detail vps-resource-detail--${themeClass}`}>{subtitle}</span>
                    </div>
                    <span className={`vps-resource-percent vps-resource-percent--${state}-${themeClass}`}>
                      {Math.round(value)}%
                    </span>
                  </div>
                  <div className={`vps-resource-bar-track vps-resource-bar-track--${themeClass}`}>
                    <div 
                      className={`vps-resource-bar-fill vps-resource-bar-fill--${state}-${themeClass}`}
                      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Column 3: Footer */}
      <div className={`vps-list-footer vps-list-footer--${themeClass}`}>
        {(config.price || config.purchase_date) && (
          <div className="vps-footer-row-price">
            {config.price && (
              <div className={`vps-price vps-price--${themeClass}`}>
                <span className="vps-price-amount">{formatPrice(config.price.amount)}</span>
                <span className="vps-price-period">{config.price.period === 'month' ? t('dashboard.perMonth') : t('dashboard.perYear')}</span>
              </div>
            )}
            {remainingValue && (
              <div className={`vps-footer-info-item vps-footer-info-item--${themeClass}`}>
                <span className="vps-footer-info-label">{t('dashboard.remaining')}</span>
                <span className="vps-footer-info-value">{remainingValue}</span>
              </div>
            )}
            {config.purchase_date && (
              <div className={`vps-footer-info-item vps-footer-info-item--${themeClass}`}>
                <span className="vps-footer-info-label">{t('dashboard.purchased')}</span>
                <span className="vps-footer-info-value">{formatPurchaseDate(config.purchase_date)}</span>
              </div>
            )}
          </div>
        )}
        <div className="vps-footer-row-status">
          <div className={`vps-uptime-item vps-uptime-item--${themeClass}`}>
            <span className="vps-uptime-label">{t('dashboard.running')}</span>
            <span className="vps-uptime-value">{formatUptime(metrics.uptime)}</span>
          </div>
          {pingMetrics && pingMetrics.targets && pingMetrics.targets.length > 0 && (
            <div className="vps-latency">
              {pingMetrics.targets.slice(0, 3).map((target, idx) => (
                <div key={idx} className={`vps-latency-item vps-latency-item--${themeClass}`}>
                  <span className="vps-latency-label">{target.name}</span>
                  <span className={`vps-latency-value vps-latency-value--${themeClass}`}>
                    {formatLatency(target.latency_ms)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Format traffic (total bytes transferred)
const formatTraffic = (bytes: number): string => {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  const tb = gb * 1024;
  
  if (bytes >= tb) return `${(bytes / tb).toFixed(2)}T`;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)}G`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(0)}M`;
  if (bytes >= kb) return `${(bytes / kb).toFixed(0)}K`;
  return `${bytes}B`;
};

// Format uptime as days
const formatUptimeDays = (seconds: number, t: (key: string) => string): string => {
  const days = Math.floor(seconds / 86400);
  return `${days} ${t('dashboard.days')}`;
};

// VPS Compact Table Header
function VpsCompactTableHeader({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation();
  const themeClass = isDark ? 'dark' : 'light';
  return (
    <div className={`vps-compact-header vps-compact-header--${themeClass}`}>
      <div className="vps-compact-col vps-compact-col--node">{t('dashboard.node')}</div>
      <div className="vps-compact-col vps-compact-col--type">{t('dashboard.type')}</div>
      <div className="vps-compact-col vps-compact-col--uptime">{t('dashboard.uptime')}</div>
      <div className="vps-compact-col vps-compact-col--network">{t('dashboard.network')}</div>
      <div className="vps-compact-col vps-compact-col--traffic">{t('dashboard.traffic')}</div>
      <div className="vps-compact-col vps-compact-col--cpu">{t('dashboard.cpu')}</div>
      <div className="vps-compact-col vps-compact-col--mem">{t('dashboard.mem')}</div>
      <div className="vps-compact-col vps-compact-col--hdd">{t('dashboard.hdd')}</div>
    </div>
  );
}

// VPS Compact Row Component
function VpsCompactCard({ server, onClick, isDark }: { 
  server: ServerState; 
  onClick: () => void; 
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const { metrics, speed, isConnected, config } = server;
  const themeClass = isDark ? 'dark' : 'light';
  
  const flag = getFlag(config.location);

  if (!metrics) {
    return (
      <div className={`vps-compact-row vps-compact-row--${themeClass} animate-pulse`} onClick={onClick}>
        <div className="vps-compact-col vps-compact-col--node">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 skeleton-bg rounded-full" />
            <div className="w-9 h-9 skeleton-bg rounded-xl" />
            <div className="space-y-1">
              <div className="h-3.5 skeleton-bg rounded w-20" />
              <div className="h-3 skeleton-bg rounded w-14" />
            </div>
          </div>
        </div>
        <div className="vps-compact-col vps-compact-col--type">
          <div className="h-3 skeleton-bg rounded w-16" />
        </div>
        <div className="vps-compact-col vps-compact-col--uptime">
          <div className="h-3 skeleton-bg rounded w-14" />
        </div>
        <div className="vps-compact-col vps-compact-col--network">
          <div className="h-3 skeleton-bg rounded w-20" />
        </div>
        <div className="vps-compact-col vps-compact-col--traffic">
          <div className="h-3 skeleton-bg rounded w-24" />
        </div>
        <div className="vps-compact-col vps-compact-col--cpu">
          <div className="h-3 skeleton-bg rounded w-12" />
        </div>
        <div className="vps-compact-col vps-compact-col--mem">
          <div className="h-3 skeleton-bg rounded w-12" />
        </div>
        <div className="vps-compact-col vps-compact-col--hdd">
          <div className="h-3 skeleton-bg rounded w-12" />
        </div>
      </div>
    );
  }

  const diskUsage = metrics.disks?.[0]?.usage_percent || 0;
  
  // Get virtualization type from config tag or default
  const getVirtType = () => {
    if (config.tag) return config.tag;
    // Check kernel for hints about virtualization
    const kernel = metrics.os.kernel?.toLowerCase() || '';
    if (kernel.includes('kvm')) return 'KVM';
    if (kernel.includes('vmware')) return 'VMware';
    if (kernel.includes('xen')) return 'Xen';
    if (kernel.includes('hyper-v')) return 'Hyper-V';
    if (kernel.includes('lxc')) return 'LXC';
    if (kernel.includes('openvz')) return 'OpenVZ';
    return 'VPS';
  };

  // Calculate total traffic from network metrics
  const totalTxTraffic = metrics.network?.total_tx || 0;
  const totalRxTraffic = metrics.network?.total_rx || 0;

  const getBarColor = (value: number, thresholds: [number, number]) => {
    if (value > thresholds[1]) return 'var(--compact-bar-bad)';
    if (value > thresholds[0]) return 'var(--compact-bar-warn)';
    return 'var(--compact-bar-ok)';
  };

  return (
    <div className={`vps-compact-row vps-compact-row--${themeClass}`} onClick={onClick}>
      {/* NODE */}
      <div className="vps-compact-col vps-compact-col--node">
        <span className={`vps-compact-status ${isConnected ? 'is-online' : 'is-offline'}`} />
        {/* Country Flag as main icon */}
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          isDark ? 'bg-white/5 border border-white/10' : 'bg-gray-100 border border-gray-200'
        }`}>
          {flag ? (
            <span className="text-xl">{flag}</span>
          ) : (
            <span className="text-xl">🌍</span>
          )}
        </div>
        <div className="vps-compact-node-info">
          <span className={`vps-compact-node-name vps-compact-node-name--${themeClass}`}>
            {config.name}
          </span>
          <span className={`vps-compact-node-location vps-compact-node-location--${themeClass}`}>
            {config.location || 'Unknown'}
          </span>
        </div>
      </div>

      {/* TYPE */}
      <div className={`vps-compact-col vps-compact-col--type vps-compact-text--${themeClass}`}>
        {getVirtType()}
      </div>

      {/* UPTIME */}
      <div className={`vps-compact-col vps-compact-col--uptime vps-compact-text--${themeClass}`}>
        {formatUptimeDays(metrics.uptime, t)}
      </div>

      {/* NETWORK */}
      <div className={`vps-compact-col vps-compact-col--network vps-compact-text--${themeClass}`}>
        <span>{formatSpeed(speed.tx_sec)}↑</span>
        <span>{formatSpeed(speed.rx_sec)}↓</span>
      </div>

      {/* TRAFFIC */}
      <div className={`vps-compact-col vps-compact-col--traffic vps-compact-text--${themeClass}`}>
        <span>{formatTraffic(totalTxTraffic)}↑</span>
        <span>{formatTraffic(totalRxTraffic)}↓</span>
      </div>

      {/* CPU */}
      <div className="vps-compact-col vps-compact-col--cpu">
        <div className={`vps-compact-meter vps-compact-meter--${themeClass}`}>
          <div 
            className="vps-compact-meter-fill"
            style={{ 
              width: `${Math.min(100, metrics.cpu.usage)}%`,
              backgroundColor: getBarColor(metrics.cpu.usage, [50, 80])
            }}
          />
        </div>
        <span className={`vps-compact-meter-text vps-compact-meter-text--${themeClass}`}>
          {Math.round(metrics.cpu.usage)}%
        </span>
      </div>

      {/* MEM */}
      <div className="vps-compact-col vps-compact-col--mem">
        <div className={`vps-compact-meter vps-compact-meter--${themeClass}`}>
          <div 
            className="vps-compact-meter-fill"
            style={{ 
              width: `${Math.min(100, metrics.memory.usage_percent)}%`,
              backgroundColor: getBarColor(metrics.memory.usage_percent, [50, 80])
            }}
          />
        </div>
        <span className={`vps-compact-meter-text vps-compact-meter-text--${themeClass}`}>
          {Math.round(metrics.memory.usage_percent)}%
        </span>
      </div>

      {/* HDD */}
      <div className="vps-compact-col vps-compact-col--hdd">
        <div className={`vps-compact-meter vps-compact-meter--${themeClass}`}>
          <div 
            className="vps-compact-meter-fill"
            style={{ 
              width: `${Math.min(100, diskUsage)}%`,
              backgroundColor: getBarColor(diskUsage, [70, 90])
            }}
          />
        </div>
        <span className={`vps-compact-meter-text vps-compact-meter-text--${themeClass}`}>
          {Math.round(diskUsage)}%
        </span>
      </div>
    </div>
  );
}

// Loading skeletons
function VpsListCardSkeleton({ isDark }: { isDark: boolean }) {
  const themeClass = isDark ? 'dark' : 'light';
  return (
    <div className={`vps-card vps-card--${themeClass} p-4 md:p-5 flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-6 animate-pulse`}>
      <div className="w-full lg:w-56 shrink-0 flex items-center gap-3">
        <div className={`vps-card-avatar vps-card-avatar--${themeClass}`} />
        <div className="flex-1">
          <div className="h-4 skeleton-bg rounded w-32 mb-2" />
          <div className="h-3 skeleton-bg rounded w-24" />
        </div>
      </div>
      <div className="flex-1 w-full grid grid-cols-3 gap-3 lg:gap-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-1">
            <div className="h-3 skeleton-bg rounded w-12" />
            <div className={`vps-resource-bar-track vps-resource-bar-track--${themeClass}`} />
          </div>
        ))}
      </div>
      <div className="w-full lg:w-40 flex flex-row lg:flex-col justify-between lg:justify-center items-end lg:items-end gap-1 shrink-0">
        <div className="h-4 skeleton-bg rounded w-16" />
        <div className="h-4 skeleton-bg rounded w-16" />
      </div>
    </div>
  );
}

function VpsGridCardSkeleton({ isDark }: { isDark: boolean }) {
  const themeClass = isDark ? 'dark' : 'light';
  return (
    <div className={`vps-card vps-card--${themeClass} animate-pulse`}>
      <div className="vps-card-header">
        <div className="vps-card-identity">
          <div className={`vps-card-avatar vps-card-avatar--${themeClass}`} />
          <div className="vps-card-info space-y-2">
            <div className="h-4 skeleton-bg rounded w-3/4" />
            <div className="h-3 skeleton-bg rounded w-1/2" />
          </div>
        </div>
      </div>
      <div className="space-y-3 mt-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="vps-resource-row">
            <div className="flex justify-between mb-1">
              <div className="h-3 skeleton-bg rounded w-16" />
              <div className="h-3 skeleton-bg rounded w-10" />
            </div>
            <div className={`vps-resource-bar-track vps-resource-bar-track--${themeClass}`} />
          </div>
        ))}
      </div>
      <div className={`vps-divider vps-divider--${themeClass}`} />
      <div className="flex justify-between">
        <div className="h-3 skeleton-bg rounded w-24" />
        <div className="h-3 skeleton-bg rounded w-20" />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { servers, groupDimensions, siteSettings, isInitialLoad } = useServerManager();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const themeClass = isDark ? 'dark' : 'light';
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('vstats-view-mode') as ViewMode) || 'grid';
  });
  const [serverVersion, setServerVersion] = useState<string>('');
  const [onlineUsers, setOnlineUsers] = useState<number>(0);
  
  // Selected dimension for grouping (null = no grouping)
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(() => {
    return localStorage.getItem('vstats-group-dimension') || null;
  });
  
  // Get enabled dimensions only
  const enabledDimensions = groupDimensions.filter(d => d.enabled);

  useEffect(() => {
    const fetchServerVersion = async () => {
      try {
        const res = await fetch('/api/version');
        if (res.ok) {
          const data = await res.json();
          setServerVersion(data.version || '');
        }
      } catch (e) {
        console.error('Failed to fetch server version', e);
      }
    };
    fetchServerVersion();
  }, []);

  // Fetch online users count
  useEffect(() => {
    const fetchOnlineUsers = async () => {
      try {
        const res = await fetch('/api/online-users');
        if (res.ok) {
          const data = await res.json();
          setOnlineUsers(data.count || 0);
        }
      } catch (e) {
        console.error('Failed to fetch online users', e);
      }
    };
    
    // Fetch initially
    fetchOnlineUsers();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchOnlineUsers, 30000);
    return () => clearInterval(interval);
  }, []);

  const toggleViewMode = () => {
    const modes: ViewMode[] = ['grid', 'list', 'compact'];
    const currentIndex = modes.indexOf(viewMode);
    const newMode = modes[(currentIndex + 1) % modes.length];
    setViewMode(newMode);
    localStorage.setItem('vstats-view-mode', newMode);
  };

  const onlineCount = servers.filter(s => s.isConnected).length;
  const totalBandwidthRx = servers.reduce((acc, s) => acc + s.speed.rx_sec, 0);
  const totalBandwidthTx = servers.reduce((acc, s) => acc + s.speed.tx_sec, 0);

  const showSkeleton = isInitialLoad && servers.length === 0;

  // Get the selected dimension
  const selectedDimension = enabledDimensions.find(d => d.id === selectedDimensionId) || null;
  
  // Handle dimension selection
  const handleDimensionSelect = (dimId: string | null) => {
    setSelectedDimensionId(dimId);
    if (dimId) {
      localStorage.setItem('vstats-group-dimension', dimId);
    } else {
      localStorage.removeItem('vstats-group-dimension');
    }
  };
  
  // Organize servers by selected dimension
  const serversByOption = new Map<string | null, typeof servers>();
  const sortedOptions: GroupOption[] = selectedDimension 
    ? [...selectedDimension.options].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  
  // Initialize options
  for (const option of sortedOptions) {
    serversByOption.set(option.id, []);
  }
  serversByOption.set(null, []); // Ungrouped/Unassigned
  
  // Distribute servers to options based on selected dimension
  if (selectedDimension) {
    for (const server of servers) {
      const optionId = server.config.group_values?.[selectedDimension.id] || null;
      if (serversByOption.has(optionId)) {
        serversByOption.get(optionId)!.push(server);
      } else {
        // Option doesn't exist (shouldn't happen normally)
        serversByOption.get(null)!.push(server);
      }
    }
  } else {
    // No dimension selected, all servers go to ungrouped
    serversByOption.set(null, [...servers]);
  }
  
  // Check if we have any options with servers
  const hasGroupedServers = selectedDimension && sortedOptions.some(o => (serversByOption.get(o.id)?.length || 0) > 0);
  const ungroupedServers = serversByOption.get(null) || [];

  return (
    <div className={`vps-page vps-page--${themeClass}`}>
      {/* Background Blobs */}
      <div className="vps-page-blobs">
        {isDark ? (
          <>
            <div className="vps-blobs-dark-1" />
            <div className="vps-blobs-dark-2" />
            <div className="vps-blobs-dark-3" />
          </>
        ) : (
          <>
            <div className="vps-blobs-light-1" />
            <div className="vps-blobs-light-2" />
            <div className="vps-blobs-light-3" />
          </>
        )}
      </div>

      <div className="vps-page-inner flex flex-col gap-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className={`text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                <span className="text-emerald-500">⚡</span> {siteSettings.site_name || t('dashboard.title')}
              </h1>
              <p className={`text-xs mt-0.5 font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                {siteSettings.site_description || t('dashboard.subtitle')}
              </p>
            </div>
            <SocialLinks links={siteSettings.social_links} className="hidden sm:flex" isDark={isDark} />
          </div>
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <button
              onClick={toggleViewMode}
              className={`vps-btn ${isDark ? 'vps-btn-outline-dark' : 'vps-btn-outline-light'} p-2.5`}
              title={`${t('dashboard.switchView')} (${viewMode === 'grid' ? t('dashboard.viewModeGrid') : viewMode === 'list' ? t('dashboard.viewModeList') : t('dashboard.viewModeCompact')})`}
            >
              {viewMode === 'grid' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              ) : viewMode === 'list' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              )}
            </button>
            {/* Language Switcher */}
            <LanguageSwitcher isDark={isDark} />
            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`vps-btn ${isDark ? 'vps-btn-outline-dark' : 'vps-btn-outline-light'} p-2.5`}
              title={t('dashboard.switchTheme', { mode: isDark ? t('dashboard.lightMode') : t('dashboard.darkMode') })}
            >
              {isDark ? (
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
              onClick={() => navigate('/settings')}
              className={`vps-btn ${isDark ? 'vps-btn-outline-dark' : 'vps-btn-outline-light'} p-2.5`}
              title={t('dashboard.settings')}
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
          <div className={`vps-overview-card vps-overview-card--online-${themeClass}`}>
            <div className="vps-overview-label vps-overview-label--online">{t('dashboard.online')}</div>
            <div className={`vps-overview-value vps-overview-value--${themeClass}`}>{onlineCount}</div>
          </div>
          <div className={`vps-overview-card vps-overview-card--offline-${themeClass}`}>
            <div className="vps-overview-label vps-overview-label--offline">{t('dashboard.offline')}</div>
            <div className={`vps-overview-value vps-overview-value--${themeClass}`}>{servers.length - onlineCount}</div>
          </div>
          <div className={`vps-overview-card vps-overview-card--download-${themeClass}`}>
            <div className="vps-overview-label vps-overview-label--download">↓ {t('dashboard.download')}</div>
            <div className={`vps-overview-value vps-overview-value--${themeClass} text-lg md:text-xl font-mono`}>{formatSpeed(totalBandwidthRx)}</div>
          </div>
          <div className={`vps-overview-card vps-overview-card--upload-${themeClass}`}>
            <div className="vps-overview-label vps-overview-label--upload">↑ {t('dashboard.upload')}</div>
            <div className={`vps-overview-value vps-overview-value--${themeClass} text-lg md:text-xl font-mono`}>{formatSpeed(totalBandwidthTx)}</div>
          </div>
        </div>

        {/* Dimension Selector */}
        {enabledDimensions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{t('dashboard.groupBy')}</span>
            <button
              onClick={() => handleDimensionSelect(null)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                selectedDimensionId === null
                  ? isDark 
                    ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                  : isDark
                    ? 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {t('common.all')}
            </button>
            {enabledDimensions.map(dim => (
              <button
                key={dim.id}
                onClick={() => handleDimensionSelect(dim.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  selectedDimensionId === dim.id
                    ? isDark 
                      ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                      : 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                    : isDark
                      ? 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {dim.name}
              </button>
            ))}
          </div>
        )}

        {/* Server List */}
        <div className="flex flex-col gap-3">
          <div className={`flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            <span>{t('dashboard.serverDetails')}</span>
            <span className={`font-mono ${isDark ? 'text-gray-700' : 'text-gray-400'}`}>{new Date().toLocaleTimeString()}</span>
          </div>
          
          {showSkeleton ? (
            viewMode === 'list' ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map(i => <VpsListCardSkeleton key={i} isDark={isDark} />)}
              </div>
            ) : viewMode === 'compact' ? (
              <div className="vps-compact-table">
                <VpsCompactTableHeader isDark={isDark} />
                <div className="vps-compact-body">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={`vps-compact-row vps-compact-row--${themeClass} animate-pulse`}>
                      <div className="vps-compact-col vps-compact-col--node">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 skeleton-bg rounded" />
                          <div className="h-3 skeleton-bg rounded w-20" />
                        </div>
                      </div>
                      <div className="vps-compact-col vps-compact-col--type"><div className="h-3 skeleton-bg rounded w-16" /></div>
                      <div className="vps-compact-col vps-compact-col--uptime"><div className="h-3 skeleton-bg rounded w-14" /></div>
                      <div className="vps-compact-col vps-compact-col--network"><div className="h-3 skeleton-bg rounded w-20" /></div>
                      <div className="vps-compact-col vps-compact-col--traffic"><div className="h-3 skeleton-bg rounded w-24" /></div>
                      <div className="vps-compact-col vps-compact-col--cpu"><div className="h-3 skeleton-bg rounded w-12" /></div>
                      <div className="vps-compact-col vps-compact-col--mem"><div className="h-3 skeleton-bg rounded w-12" /></div>
                      <div className="vps-compact-col vps-compact-col--hdd"><div className="h-3 skeleton-bg rounded w-12" /></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4].map(i => <VpsGridCardSkeleton key={i} isDark={isDark} />)}
              </div>
            )
          ) : hasGroupedServers && selectedDimension ? (
            // Display servers grouped by dimension options
            <div className="space-y-6">
              {sortedOptions.map((option) => {
                const optionServers = serversByOption.get(option.id) || [];
                if (optionServers.length === 0) return null;
                
                return (
                  <div key={option.id}>
                    {/* Option Header */}
                    <div className={`flex items-center gap-2 mb-3 px-1`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${isDark ? 'bg-orange-400' : 'bg-orange-500'}`} />
                      <span className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                        {option.name}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                        ({optionServers.length})
                      </span>
                    </div>
                    
                    {/* Option Servers */}
                    {viewMode === 'compact' ? (
                      <div className="vps-compact-view">
                        {optionServers.map((server, index) => (
                          <div 
                            key={server.config.id}
                            className="animate-fadeIn"
                            style={{ animationDelay: `${index * 20}ms` }}
                          >
                            <VpsCompactCard 
                              server={server} 
                              onClick={() => navigate(`/server/${server.config.id}`)}
                              isDark={isDark}
                            />
                          </div>
                        ))}
                      </div>
                    ) : viewMode === 'list' ? (
                      <div className="vps-list-view">
                        {optionServers.map((server, index) => (
                          <div 
                            key={server.config.id}
                            className="animate-fadeIn"
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <VpsListCard 
                              server={server} 
                              onClick={() => navigate(`/server/${server.config.id}`)}
                              isDark={isDark}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {optionServers.map((server, index) => (
                          <div 
                            key={server.config.id}
                            className="animate-fadeIn"
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            <VpsGridCard 
                              server={server} 
                              onClick={() => navigate(`/server/${server.config.id}`)}
                              isDark={isDark}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {/* Unassigned Servers */}
              {ungroupedServers.length > 0 && (
                <div>
                  {/* Unassigned Header */}
                  <div className={`flex items-center gap-2 mb-3 px-1`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${isDark ? 'bg-gray-500' : 'bg-gray-400'}`} />
                    <span className={`text-sm font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {t('common.unassigned')}
                    </span>
                    <span className={`text-xs ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                      ({ungroupedServers.length})
                    </span>
                  </div>
                  
                  {/* Unassigned Servers */}
                  {viewMode === 'compact' ? (
                    <div className="vps-compact-view">
                      {ungroupedServers.map((server, index) => (
                        <div 
                          key={server.config.id}
                          className="animate-fadeIn"
                          style={{ animationDelay: `${index * 20}ms` }}
                        >
                          <VpsCompactCard 
                            server={server} 
                            onClick={() => navigate(`/server/${server.config.id}`)}
                            isDark={isDark}
                          />
                        </div>
                      ))}
                    </div>
                  ) : viewMode === 'list' ? (
                    <div className="vps-list-view">
                      {ungroupedServers.map((server, index) => (
                        <div 
                          key={server.config.id}
                          className="animate-fadeIn"
                          style={{ animationDelay: `${index * 30}ms` }}
                        >
                          <VpsListCard 
                            server={server} 
                            onClick={() => navigate(`/server/${server.config.id}`)}
                            isDark={isDark}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {ungroupedServers.map((server, index) => (
                        <div 
                          key={server.config.id}
                          className="animate-fadeIn"
                          style={{ animationDelay: `${index * 30}ms` }}
                        >
                          <VpsGridCard 
                            server={server} 
                            onClick={() => navigate(`/server/${server.config.id}`)}
                            isDark={isDark}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : viewMode === 'compact' ? (
            <div className="vps-compact-table">
              <VpsCompactTableHeader isDark={isDark} />
              <div className="vps-compact-body">
                {servers.map((server, index) => (
                  <div 
                    key={server.config.id}
                    className="animate-fadeIn"
                    style={{ animationDelay: `${index * 20}ms` }}
                  >
                    <VpsCompactCard 
                      server={server} 
                      onClick={() => navigate(`/server/${server.config.id}`)}
                      isDark={isDark}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : viewMode === 'list' ? (
            <div className="vps-list-view">
              {servers.map((server, index) => (
                <div 
                  key={server.config.id}
                  className="animate-fadeIn"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <VpsListCard 
                    server={server} 
                    onClick={() => navigate(`/server/${server.config.id}`)}
                    isDark={isDark}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {servers.map((server, index) => (
                <div 
                  key={server.config.id}
                  className="animate-fadeIn"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <VpsGridCard 
                    server={server} 
                    onClick={() => navigate(`/server/${server.config.id}`)}
                    isDark={isDark}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center mt-auto pt-6 pb-2">
          <p className={`text-[10px] font-mono ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
            vStats Monitor {serverVersion && `v${serverVersion}`}
            {serverVersion && ' · '}
            {onlineUsers > 0 && (
              <>
                <span className={`inline-flex items-center gap-1 ${isDark ? 'text-emerald-500' : 'text-emerald-600'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {onlineUsers} {t('dashboard.onlineUsers')}
                </span>
                {' · '}
              </>
            )}
            {t('dashboard.madeWith')} <span className="text-red-500">❤️</span> {t('dashboard.by')}{' '}
            <a 
              href="https://vstats.zsoft.cc" 
              target="_blank" 
              rel="noopener noreferrer"
              className={`hover:underline ${isDark ? 'text-gray-500 hover:text-gray-400' : 'text-gray-400 hover:text-gray-500'}`}
            >
              vstats.zsoft.cc
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
