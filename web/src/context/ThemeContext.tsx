import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { sanitizeUrl } from '../utils/security';

// 主题类型定义
export type ThemeId = 
  | 'midnight'       // 午夜深蓝 - 经典科技风
  | 'daylight'       // 晴空日光 - 清新简约
  | 'cyberpunk'      // 赛博朋克 - 霓虹科幻
  | 'terminal'       // 终端黑客 - 复古终端
  | 'glassmorphism'  // 毛玻璃 - 现代透明
  | 'neumorphism'    // 新拟态 - 软UI风格
  | 'brutalist'      // 野兽派 - 大胆粗犷
  | 'minimal'        // 极简主义 - 纯净留白
  | 'retro'          // 复古风 - 怀旧暖色
  | 'tape'           // 磁带未来 - 模拟磁带
  | 'handdrawn'      // 手绘风 - 涂鸦手稿
  | 'memphis'        // 孟菲斯 - 几何拼贴
  | 'skeuomorphic'   // 拟物风 - 真实质感
  | 'aesthetic'      // 少女审美 - 梦幻粉彩
  | 'magazine'       // 杂志风 - 大胆排版
  | 'industrial';    // 工业风 - 硬核机械

// 背景类型
export type BackgroundType = 'gradient' | 'bing' | 'unsplash' | 'custom' | 'solid';

export interface BackgroundConfig {
  type: BackgroundType;
  customUrl?: string;
  unsplashQuery?: string;
  solidColor?: string;
  blur?: number;
  opacity?: number;
}

// 主题配置
export interface ThemeConfig {
  id: ThemeId;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  isDark: boolean;
  style: 'flat' | 'glass' | 'neumorphic' | 'brutalist' | 'minimal';
  preview: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  fonts: {
    heading: string;
    body: string;
    mono: string;
  };
  borderRadius: string;
  cardStyle: string;
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'midnight',
    name: 'Midnight Tech',
    nameZh: '午夜科技',
    description: 'Classic dark tech theme with blue accents',
    descriptionZh: '深邃蓝黑渐变，科技蓝光，毛玻璃卡片',
    isDark: true,
    style: 'glass',
    preview: {
      primary: '#020617',
      secondary: '#0f172a',
      accent: '#3b82f6',
      background: '#020617'
    },
    fonts: {
      heading: '"SF Pro Display", -apple-system, sans-serif',
      body: '"Inter", system-ui, sans-serif',
      mono: '"SF Mono", "Fira Code", monospace'
    },
    borderRadius: '16px',
    cardStyle: 'glass'
  },
  {
    id: 'daylight',
    name: 'Daylight',
    nameZh: '晴空日光',
    description: 'Clean and bright with soft shadows',
    descriptionZh: '纯净白色，天蓝渐变，柔和阴影',
    isDark: false,
    style: 'flat',
    preview: {
      primary: '#ffffff',
      secondary: '#f8fafc',
      accent: '#0ea5e9',
      background: '#e0f2fe'
    },
    fonts: {
      heading: '"Plus Jakarta Sans", sans-serif',
      body: '"Inter", system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace'
    },
    borderRadius: '20px',
    cardStyle: 'elevated'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2077',
    nameZh: '赛博朋克',
    description: 'Neon lights, glitch effects, futuristic',
    descriptionZh: '霓虹渐变边框，故障艺术，扫描动画',
    isDark: true,
    style: 'brutalist',
    preview: {
      primary: '#0a0a0f',
      secondary: '#1a1a2e',
      accent: '#ff00ff',
      background: '#0a0a0f'
    },
    fonts: {
      heading: '"Orbitron", "Rajdhani", sans-serif',
      body: '"Rajdhani", "Share Tech Mono", sans-serif',
      mono: '"Share Tech Mono", monospace'
    },
    borderRadius: '4px',
    cardStyle: 'neon'
  },
  {
    id: 'terminal',
    name: 'Hacker Terminal',
    nameZh: '黑客终端',
    description: 'Retro terminal with scanlines',
    descriptionZh: '纯绿磷光，CRT扫描线，光标闪烁',
    isDark: true,
    style: 'minimal',
    preview: {
      primary: '#050505',
      secondary: '#0a0a0a',
      accent: '#00ff41',
      background: '#050505'
    },
    fonts: {
      heading: '"VT323", "Fira Code", monospace',
      body: '"Fira Code", "IBM Plex Mono", monospace',
      mono: '"Fira Code", monospace'
    },
    borderRadius: '0px',
    cardStyle: 'terminal'
  },
  {
    id: 'glassmorphism',
    name: 'Glass UI',
    nameZh: '毛玻璃',
    description: 'Frosted glass with vibrant backgrounds',
    descriptionZh: '强烈毛玻璃，彩色渐变，浮动光斑',
    isDark: true,
    style: 'glass',
    preview: {
      primary: 'rgba(255,255,255,0.12)',
      secondary: 'rgba(255,255,255,0.08)',
      accent: '#a855f7',
      background: '#667eea'
    },
    fonts: {
      heading: '"Poppins", sans-serif',
      body: '"Inter", system-ui, sans-serif',
      mono: '"JetBrains Mono", monospace'
    },
    borderRadius: '24px',
    cardStyle: 'frosted'
  },
  {
    id: 'neumorphism',
    name: 'Soft UI',
    nameZh: '新拟态',
    description: 'Soft shadows and embossed elements',
    descriptionZh: '柔和凸起阴影，同色背景，无边框',
    isDark: false,
    style: 'neumorphic',
    preview: {
      primary: '#e0e5ec',
      secondary: '#e0e5ec',
      accent: '#6366f1',
      background: '#e0e5ec'
    },
    fonts: {
      heading: '"Nunito", sans-serif',
      body: '"Nunito", system-ui, sans-serif',
      mono: '"Source Code Pro", monospace'
    },
    borderRadius: '20px',
    cardStyle: 'neumorphic'
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    nameZh: '野兽派',
    description: 'Bold, raw, unapologetic design',
    descriptionZh: '纯黑白极端对比，超粗边框，硬阴影',
    isDark: false,
    style: 'brutalist',
    preview: {
      primary: '#ffffff',
      secondary: '#f5f5f5',
      accent: '#ff0000',
      background: '#ffffff'
    },
    fonts: {
      heading: '"Archivo Black", "Impact", sans-serif',
      body: '"Space Mono", monospace',
      mono: '"Space Mono", monospace'
    },
    borderRadius: '0px',
    cardStyle: 'brutalist'
  },
  {
    id: 'minimal',
    name: 'Minimal Zen',
    nameZh: '极简禅意',
    description: 'Maximum whitespace, minimal elements',
    descriptionZh: '大量留白，极细边框，微妙阴影',
    isDark: false,
    style: 'minimal',
    preview: {
      primary: '#fafafa',
      secondary: '#ffffff',
      accent: '#18181b',
      background: '#fafafa'
    },
    fonts: {
      heading: '"DM Sans", sans-serif',
      body: '"DM Sans", system-ui, sans-serif',
      mono: '"DM Mono", monospace'
    },
    borderRadius: '6px',
    cardStyle: 'minimal'
  },
  {
    id: 'retro',
    name: 'Retro',
    nameZh: '复古风',
    description: 'Nostalgic warm colors and serif fonts',
    descriptionZh: 'Solarized配色，打字机字体，纸张纹理',
    isDark: false,
    style: 'flat',
    preview: {
      primary: '#fdf6e3',
      secondary: '#eee8d5',
      accent: '#cb4b16',
      background: '#fdf6e3'
    },
    fonts: {
      heading: '"Merriweather", "Georgia", serif',
      body: '"Merriweather", "Georgia", serif',
      mono: '"Courier New", monospace'
    },
    borderRadius: '4px',
    cardStyle: 'retro'
  },
  {
    id: 'tape',
    name: 'Tape Futurism',
    nameZh: '磁带未来',
    description: 'Analog cassette aesthetics',
    descriptionZh: '磁带纹理，VU表，暖色调，卷轴装饰',
    isDark: true,
    style: 'flat',
    preview: {
      primary: '#1e1814',
      secondary: '#2b211c',
      accent: '#d75f27',
      background: '#1e1814'
    },
    fonts: {
      heading: '"Space Mono", monospace',
      body: '"Space Mono", monospace',
      mono: '"Space Mono", monospace'
    },
    borderRadius: '8px',
    cardStyle: 'tape'
  },
  {
    id: 'handdrawn',
    name: 'Hand-drawn',
    nameZh: '手绘风',
    description: 'Sketchy borders and comic fonts',
    descriptionZh: '不规则手绘边框，涂鸦装饰，手写字体',
    isDark: false,
    style: 'flat',
    preview: {
      primary: '#fffef8',
      secondary: '#fff9e8',
      accent: '#2c2c2c',
      background: '#fffef8'
    },
    fonts: {
      heading: '"Patrick Hand", "Comic Sans MS", sans-serif',
      body: '"Patrick Hand", "Comic Sans MS", sans-serif',
      mono: '"Patrick Hand", monospace'
    },
    borderRadius: '255px 15px 225px 15px/15px 225px 15px 255px',
    cardStyle: 'handdrawn'
  },
  {
    id: 'memphis',
    name: 'Memphis',
    nameZh: '孟菲斯',
    description: 'Geometric shapes and vibrant colors',
    descriptionZh: '几何图形装饰，鲜艳撞色，波普艺术',
    isDark: false,
    style: 'flat',
    preview: {
      primary: '#fff5f8',
      secondary: '#ffffff',
      accent: '#ff00cc',
      background: '#fff5f8'
    },
    fonts: {
      heading: '"Work Sans", sans-serif',
      body: '"Work Sans", sans-serif',
      mono: '"Fira Code", monospace'
    },
    borderRadius: '0px',
    cardStyle: 'memphis'
  },
  {
    id: 'skeuomorphic',
    name: 'Skeuomorphic',
    nameZh: '拟物风',
    description: 'Realistic textures and depth',
    descriptionZh: '真实质感，光泽渐变，立体按钮，iOS6风格',
    isDark: false,
    style: 'neumorphic',
    preview: {
      primary: '#f5f5f5',
      secondary: '#e0e0e0',
      accent: '#2e7d32',
      background: '#c0c0c0'
    },
    fonts: {
      heading: '"Helvetica Neue", sans-serif',
      body: '"Helvetica Neue", sans-serif',
      mono: '"Menlo", monospace'
    },
    borderRadius: '10px',
    cardStyle: 'skeuomorphic'
  },
  {
    id: 'aesthetic',
    name: 'Aesthetic',
    nameZh: '少女审美',
    description: 'Soft pastels and dreamy vibes',
    descriptionZh: '梦幻渐变背景，柔和粉彩，星星装饰',
    isDark: false,
    style: 'glass',
    preview: {
      primary: 'rgba(255,255,255,0.65)',
      secondary: '#ffe4ec',
      accent: '#ff69b4',
      background: '#ffecd2'
    },
    fonts: {
      heading: '"Quicksand", sans-serif',
      body: '"Quicksand", sans-serif',
      mono: '"Fira Code", monospace'
    },
    borderRadius: '24px',
    cardStyle: 'aesthetic'
  },
  {
    id: 'magazine',
    name: 'Magazine',
    nameZh: '杂志排版',
    description: 'Bold typography and grid layout',
    descriptionZh: '大胆排版，衬线字体，分栏线，报纸风格',
    isDark: false,
    style: 'flat',
    preview: {
      primary: '#ffffff',
      secondary: '#fafaf8',
      accent: '#cc0000',
      background: '#fafaf8'
    },
    fonts: {
      heading: '"Playfair Display", serif',
      body: '"Inter", sans-serif',
      mono: '"Courier New", monospace'
    },
    borderRadius: '0px',
    cardStyle: 'magazine'
  },
  {
    id: 'industrial',
    name: 'Industrial',
    nameZh: '工业科技',
    description: 'Rugged, metallic, functional',
    descriptionZh: '警示条纹，金属质感，铆钉装饰，锐角设计',
    isDark: true,
    style: 'brutalist',
    preview: {
      primary: '#202020',
      secondary: '#252525',
      accent: '#f59e0b',
      background: '#1a1a1a'
    },
    fonts: {
      heading: '"Rajdhani", sans-serif',
      body: '"Roboto Condensed", sans-serif',
      mono: '"Share Tech Mono", monospace'
    },
    borderRadius: '2px',
    cardStyle: 'industrial'
  }
];

// 默认背景配置
const DEFAULT_BACKGROUND: BackgroundConfig = {
  type: 'gradient',
  blur: 0,
  opacity: 100
};

// Server theme settings interface (matches backend and types.ts)
interface ServerThemeSettings {
  theme_id: string;
  background?: {
    type: BackgroundType;
    custom_url?: string;
    unsplash_query?: string;
    solid_color?: string;
    blur?: number;
    opacity?: number;
  };
}

interface ThemeContextType {
  themeId: ThemeId;
  theme: ThemeConfig;
  isDark: boolean;
  setTheme: (themeId: ThemeId) => void;
  themes: ThemeConfig[];
  background: BackgroundConfig;
  setBackground: (config: BackgroundConfig) => void;
  backgroundUrl: string | null;
  refreshBackground: () => void;
  // Sync from server
  applyServerSettings: (settings: ServerThemeSettings | null) => void;
  // For saving to server (returns the server format)
  getServerSettings: () => ServerThemeSettings;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Fetch Bing wallpaper through our proxy API (server-side proxy to avoid CORS)
const fetchBingWallpaper = async (): Promise<string> => {
  try {
    const response = await fetch('/api/wallpaper/bing');
    
    if (!response.ok) {
      console.warn(`Bing wallpaper proxy returned ${response.status}: ${response.statusText}`);
      // Use fallback image if proxy fails
      return 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80';
    }
    
    const data = await response.json();
    if (data && data.url) {
      return data.url;
    }
    
    console.warn('Bing wallpaper proxy returned invalid response:', data);
  } catch (e) {
    console.error('Failed to fetch Bing wallpaper through proxy:', e);
    // Never directly call Bing API - always use fallback
  }
  // Fallback image (Unsplash)
  return 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=80';
};

// Fetch custom wallpaper URL through our proxy API to avoid CORS
const fetchCustomWallpaper = async (imageURL: string): Promise<string> => {
  try {
    // Check if it's a relative URL or same-origin - use directly
    try {
      const url = new URL(imageURL, window.location.origin);
      if (url.origin === window.location.origin) {
        // Same origin, use directly
        return imageURL;
      }
    } catch {
      // If URL parsing fails, it might be a relative URL
      if (!imageURL.startsWith('http://') && !imageURL.startsWith('https://')) {
        return imageURL;
      }
    }

    // For external URLs, check if we need proxy
    const response = await fetch(`/api/wallpaper/proxy?url=${encodeURIComponent(imageURL)}`);
    
    if (!response.ok) {
      console.warn(`Custom wallpaper proxy returned ${response.status}: ${response.statusText}`);
      // Fallback to original URL - might work if CORS headers are present
      return imageURL;
    }
    
    const data = await response.json();
    if (data && data.url) {
      return data.url;
    }
    
    console.warn('Custom wallpaper proxy returned invalid response:', data);
  } catch (e) {
    console.error('Failed to fetch custom wallpaper through proxy:', e);
    // Fallback to original URL
  }
  return imageURL;
};

// Fetch Unsplash image through our proxy API (server-side proxy to avoid CORS)
const fetchUnsplashImage = async (query: string = 'nature,landscape'): Promise<string> => {
  try {
    const keywords = query || 'nature,landscape,abstract';
    const response = await fetch(`/api/wallpaper/unsplash?query=${encodeURIComponent(keywords)}`);
    
    if (!response.ok) {
      console.warn(`Unsplash wallpaper proxy returned ${response.status}: ${response.statusText}`);
      // Use fallback if proxy fails
      return `https://source.unsplash.com/1920x1080/?${encodeURIComponent(keywords)}&t=${Date.now()}`;
    }
    
    const data = await response.json();
    if (data && data.url) {
      return data.url;
    }
    
    console.warn('Unsplash wallpaper proxy returned invalid response:', data);
  } catch (e) {
    console.error('Failed to fetch Unsplash image through proxy:', e);
    // Never directly call Unsplash API - use fallback URL
  }
  // Fallback: return the redirect URL directly with timestamp to avoid caching
  const keywords = query || 'nature,landscape,abstract';
  return `https://source.unsplash.com/1920x1080/?${encodeURIComponent(keywords)}&t=${Date.now()}`;
};

// Convert server format to local format
const serverToLocalBackground = (serverBg: ServerThemeSettings['background']): BackgroundConfig => {
  if (!serverBg) return DEFAULT_BACKGROUND;
  const validTypes: BackgroundType[] = ['gradient', 'bing', 'unsplash', 'custom', 'solid'];
  const bgType = validTypes.includes(serverBg.type as BackgroundType) ? serverBg.type : 'gradient';
  const safeCustomUrl = sanitizeUrl(serverBg.custom_url) || undefined;
  return {
    type: bgType,
    customUrl: safeCustomUrl,
    unsplashQuery: serverBg.unsplash_query,
    solidColor: serverBg.solid_color,
    blur: serverBg.blur ?? 0,
    opacity: serverBg.opacity ?? 100,
  };
};

// Convert local format to server format
const localToServerBackground = (localBg: BackgroundConfig): ServerThemeSettings['background'] => {
  const safeCustomUrl = sanitizeUrl(localBg.customUrl);
  return {
    type: localBg.type as BackgroundType,
    custom_url: safeCustomUrl || undefined,
    unsplash_query: localBg.unsplashQuery,
    solid_color: localBg.solidColor,
    blur: localBg.blur,
    opacity: localBg.opacity,
  };
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    const stored = localStorage.getItem('vstats-theme-id') as ThemeId;
    if (stored && THEMES.find(t => t.id === stored)) {
      return stored;
    }
    // Legacy migration
    const oldTheme = localStorage.getItem('vstats-theme');
    if (oldTheme === 'light') return 'daylight';
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'daylight';
    return 'midnight';
  });

  const [background, setBackgroundState] = useState<BackgroundConfig>(() => {
    const stored = localStorage.getItem('vstats-background');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch { /* ignore */ }
    }
    return DEFAULT_BACKGROUND;
  });

  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [serverSettingsApplied, setServerSettingsApplied] = useState(false);

  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];

  // 获取背景图
  const refreshBackground = useCallback(async () => {
    if (background.type === 'bing') {
      const url = await fetchBingWallpaper();
      setBackgroundUrl(url);
    } else if (background.type === 'unsplash') {
      const url = await fetchUnsplashImage(background.unsplashQuery);
      setBackgroundUrl(url);
    } else if (background.type === 'custom' && background.customUrl) {
      const url = await fetchCustomWallpaper(background.customUrl);
      setBackgroundUrl(url);
    } else {
      setBackgroundUrl(null);
    }
  }, [background.type, background.customUrl, background.unsplashQuery]);

  useEffect(() => {
    refreshBackground();
  }, [refreshBackground]);

  useEffect(() => {
    localStorage.setItem('vstats-theme-id', themeId);
    localStorage.setItem('vstats-theme', theme.isDark ? 'dark' : 'light');
    
    // 移除所有主题类
    const classList = document.documentElement.classList;
    THEMES.forEach(t => classList.remove(`theme-${t.id}`));
    classList.remove('light-theme', 'dark-theme');
    
    // 添加新主题类
    classList.add(`theme-${themeId}`);
    classList.add(theme.isDark ? 'dark-theme' : 'light-theme');
    
    // 设置 CSS 变量
    document.documentElement.style.setProperty('--theme-border-radius', theme.borderRadius);
    document.documentElement.style.setProperty('--theme-font-heading', theme.fonts.heading);
    document.documentElement.style.setProperty('--theme-font-body', theme.fonts.body);
    document.documentElement.style.setProperty('--theme-font-mono', theme.fonts.mono);
  }, [themeId, theme]);

  useEffect(() => {
    localStorage.setItem('vstats-background', JSON.stringify(background));
  }, [background]);

  const setTheme = (newThemeId: ThemeId) => setThemeId(newThemeId);
  
  const setBackground = (config: BackgroundConfig) => setBackgroundState(config);

  // Apply settings from server (called when WebSocket receives site_settings)
  const applyServerSettings = useCallback((settings: ServerThemeSettings | null) => {
    if (!settings) return;
    
    // Apply theme ID
    if (settings.theme_id && THEMES.find(t => t.id === settings.theme_id)) {
      setThemeId(settings.theme_id as ThemeId);
    }
    
    // Apply background settings
    if (settings.background) {
      setBackgroundState(serverToLocalBackground(settings.background));
    }
    
    setServerSettingsApplied(true);
  }, []);

  // Get settings in server format (for saving)
  const getServerSettings = useCallback((): ServerThemeSettings => {
    return {
      theme_id: themeId,
      background: localToServerBackground(background),
    };
  }, [themeId, background]);

  // Fetch initial settings from server on mount
  useEffect(() => {
    if (serverSettingsApplied) return;
    
    const fetchServerSettings = async () => {
      try {
        const response = await fetch('/api/settings/site');
        if (response.ok) {
          const data = await response.json();
          if (data.theme) {
            applyServerSettings(data.theme);
          }
        }
      } catch (e) {
        console.error('Failed to fetch site settings:', e);
      }
    };
    
    fetchServerSettings();
  }, [applyServerSettings, serverSettingsApplied]);

  // Listen for WebSocket site settings updates
  useEffect(() => {
    const handleSiteSettingsUpdate = (event: CustomEvent) => {
      const siteSettings = event.detail;
      if (siteSettings?.theme) {
        applyServerSettings(siteSettings.theme);
      }
    };
    
    window.addEventListener('vstats-site-settings', handleSiteSettingsUpdate as EventListener);
    return () => {
      window.removeEventListener('vstats-site-settings', handleSiteSettingsUpdate as EventListener);
    };
  }, [applyServerSettings]);

  return (
    <ThemeContext.Provider value={{ 
      themeId, 
      theme, 
      isDark: theme.isDark, 
      setTheme, 
      themes: THEMES,
      background,
      setBackground,
      backgroundUrl,
      refreshBackground,
      applyServerSettings,
      getServerSettings,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
