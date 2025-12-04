/**
 * Logo工具函数 - 根据名称匹配logo文件
 */

import React from 'react';

// Logo索引数据（从index.json加载）
let logoIndex: {
  providers: Array<{ name: string; filename: string; path: string; format: string }>;
  distributions: Array<{ name: string; filename: string; path: string; format: string }>;
} | null = null;
let loadingPromise: Promise<any> | null = null;

// 加载logo索引
function loadLogoIndex(): Promise<typeof logoIndex> {
  if (logoIndex) {
    return Promise.resolve(logoIndex);
  }
  
  if (loadingPromise) {
    return loadingPromise;
  }
  
  loadingPromise = fetch('/logos/index.json')
    .then(response => {
      if (response.ok) {
        return response.json();
      }
      throw new Error('Failed to fetch logo index');
    })
    .then(data => {
      logoIndex = data;
      return logoIndex;
    })
    .catch(error => {
      console.warn('Failed to load logo index:', error);
      return null;
    })
    .finally(() => {
      loadingPromise = null;
    });
  
  return loadingPromise;
}

// 初始化加载（不阻塞）
loadLogoIndex();

/**
 * 标准化名称用于匹配
 */
function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace('cloud', '')
    .replace('linux', '')
    .trim();
}

/**
 * 获取厂商logo路径（同步版本，如果索引未加载则返回null）
 */
export function getProviderLogo(providerName: string): string | null {
  if (!providerName || providerName === 'Unknown') {
    return null;
  }

  // 如果索引未加载，返回null（会在下次渲染时重试）
  if (!logoIndex) {
    return null;
  }

  const normalized = normalizeName(providerName);
  
  // 直接匹配
  const match = logoIndex.providers.find(p => {
    const pNormalized = normalizeName(p.name);
    return pNormalized === normalized || 
           pNormalized.includes(normalized) || 
           normalized.includes(pNormalized);
  });

  if (match) {
    return `/${match.path}`;
  }

  // 特殊匹配规则
  const specialMatches: Record<string, string> = {
    'aws': 'aws',
    'amazon': 'aws',
    'amazonaws': 'aws',
    'aliyun': 'alibaba_cloud',
    'alibaba': 'alibaba_cloud',
    'tencent': 'tencent_cloud',
    'vultr': 'vultr',
    'digitalocean': 'digitalocean',
    'do': 'digitalocean',
    'linode': 'linode',
    'akamai': 'linode',
    'bandwagon': 'bandwagon',
    'bwh': 'bandwagon',
    '搬瓦工': 'bandwagon',
    'huawei': 'huawei_cloud',
    '华为': 'huawei_cloud',
    'google': 'google_cloud',
    'gcp': 'google_cloud',
    'azure': 'azure',
    'microsoft': 'azure',
    'oracle': 'oracle_cloud',
    'ibm': 'ibm_cloud',
    'cloudflare': 'cloudflare',
    'ovh': 'ovh',
    'hetzner': 'hetzner',
    'scaleway': 'scaleway',
    'contabo': 'contabo',
    'kamatera': 'kamatera',
    'rackspace': 'rackspace',
    'joyent': 'joyent',
  };

  const specialMatch = specialMatches[normalized];
  if (specialMatch) {
    const found = logoIndex.providers.find(p => 
      normalizeName(p.name) === normalizeName(specialMatch)
    );
    if (found) {
      return `/${found.path}`;
    }
  }

  return null;
}

/**
 * 获取发行版logo路径（同步版本，如果索引未加载则返回null）
 */
export function getDistributionLogo(osName: string): string | null {
  if (!osName) return null;

  // 如果索引未加载，返回null（会在下次渲染时重试）
  if (!logoIndex) {
    return null;
  }

  const normalized = normalizeName(osName);
  
  // 直接匹配
  const match = logoIndex.distributions.find(d => {
    const dNormalized = normalizeName(d.name);
    return dNormalized === normalized || 
           dNormalized.includes(normalized) || 
           normalized.includes(dNormalized);
  });

  if (match) {
    return `/${match.path}`;
  }

  // 特殊匹配规则
  const specialMatches: Record<string, string> = {
    'ubuntu': 'ubuntu',
    'debian': 'debian',
    'centos': 'centos',
    'rocky': 'rocky_linux',
    'rockylinux': 'rocky_linux',
    'alma': 'almalinux',
    'almalinux': 'almalinux',
    'fedora': 'fedora',
    'redhat': 'red_hat',
    'red': 'red_hat',
    'suse': 'suse',
    'opensuse': 'opensuse',
    'arch': 'arch_linux',
    'archlinux': 'arch_linux',
    'manjaro': 'manjaro',
    'gentoo': 'gentoo',
    'slackware': 'slackware',
    'mint': 'mint',
    'linuxmint': 'mint',
    'elementary': 'elementary_os',
    'pop': 'pop!_os',
    'popos': 'pop!_os',
    'kali': 'kali_linux',
    'kalilinux': 'kali_linux',
    'parrot': 'parrot_os',
    'parrotos': 'parrot_os',
    'windows': 'windows',
    'macos': 'macos',
    'mac': 'macos',
    'darwin': 'macos',
    'freebsd': 'freebsd',
    'openbsd': 'openbsd',
    'netbsd': 'netbsd',
    'dragonfly': 'dragonfly_bsd',
    'dragonflybsd': 'dragonfly_bsd',
  };

  const specialMatch = specialMatches[normalized];
  if (specialMatch) {
    const found = logoIndex.distributions.find(d => 
      normalizeName(d.name) === normalizeName(specialMatch)
    );
    if (found) {
      return `/${found.path}`;
    }
  }

  return null;
}

/**
 * Logo图片组件
 */
export function LogoImage({ 
  src, 
  alt, 
  className = "w-5 h-5",
  fallback 
}: { 
  src: string | null; 
  alt: string; 
  className?: string;
  fallback?: React.ReactNode;
}) {
  if (!src) {
    return fallback ? (fallback as React.ReactElement) : null;
  }

  return React.createElement('img', {
    src: src,
    alt: alt,
    className: className,
    onError: (e: React.SyntheticEvent<HTMLImageElement>) => {
      // 如果图片加载失败，隐藏图片
      e.currentTarget.style.display = 'none';
    }
  });
}

