import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { showToast } from '../components/Toast';
import type { SiteSettings, SocialLink, ServerGroup, GroupDimension } from '../types';

// Universal copy to clipboard function that works in all contexts
const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    // Try modern clipboard API first (requires secure context)
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for non-secure contexts (http://localhost, etc.)
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch (e) {
    console.error('Failed to copy', e);
    // Last resort fallback
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      return success;
    } catch {
      return false;
    }
  }
};

interface RemoteServer {
  id: string;
  name: string;
  url: string;
  location: string;
  provider: string;
  tag?: string;
  group_id?: string; // Deprecated
  group_values?: Record<string, string>; // dimension_id -> option_id
  version?: string;
  token?: string;
  ip?: string;
  // Extended metadata
  price_amount?: string;
  price_period?: string;
  purchase_date?: string;
  remaining_value?: string;
  tip_badge?: string;
}

interface PingTargetConfig {
  name: string;
  host: string;
}

interface ProbeSettings {
  ping_targets: PingTargetConfig[];
}

const PLATFORM_OPTIONS = [
  { value: 'github', label: 'GitHub' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'email', label: 'Email' },
  { value: 'website', label: 'Website' },
];

export default function Settings() {
  const { t } = useTranslation();
  const { isAuthenticated, token, logout, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentStatus, setAgentStatus] = useState<Record<string, boolean>>({});
  const [updatingAgents, setUpdatingAgents] = useState<Record<string, boolean>>({});
  
  // Site settings
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({
    site_name: '',
    site_description: '',
    social_links: []
  });
  const [showSiteSettings, setShowSiteSettings] = useState(false);
  const [siteSettingsSaving, setSiteSettingsSaving] = useState(false);
  const [siteSettingsSuccess, setSiteSettingsSuccess] = useState(false);
  
  // New server form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', url: '', location: '', provider: '', tag: '', group_id: '' });
  const [addLoading, setAddLoading] = useState(false);
  
  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  
  // Install command
  const [showInstallCommand, setShowInstallCommand] = useState(false);
  const [installCommand, setInstallCommand] = useState('');
  const [windowsInstallCommand, setWindowsInstallCommand] = useState('');
  const [copied, setCopied] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<'linux' | 'windows'>('linux');
  
  // Version info
  const [serverVersion, setServerVersion] = useState<string>('');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  
  // OAuth settings
  const [showOAuthSettings, setShowOAuthSettings] = useState(false);
  const [, setOauthSettings] = useState<{
    use_centralized?: boolean;
    allowed_users?: string[];
    github?: { enabled: boolean; client_id: string; has_secret: boolean; allowed_users: string[] };
    google?: { enabled: boolean; client_id: string; has_secret: boolean; allowed_users: string[] };
  }>({});
  const [oauthForm, setOauthForm] = useState({
    use_centralized: true,
    allowed_users: '',
    github: { enabled: false, client_id: '', client_secret: '', allowed_users: '' },
    google: { enabled: false, client_id: '', client_secret: '', allowed_users: '' }
  });
  const [oauthSaving, setOauthSaving] = useState(false);
  const [oauthSuccess, setOauthSuccess] = useState(false);
  // Used to track if self-hosted OAuth was previously configured
  const [, setShowAdvancedOAuth] = useState(false);
  
  // Edit server
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ 
    name: '', 
    location: '', 
    provider: '', 
    tag: '',
    group_id: '',
    price_amount: '',
    price_period: 'month' as 'month' | 'year',
    purchase_date: '',
    tip_badge: ''
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  
  // Local node config
  const [localNodeConfig, setLocalNodeConfig] = useState({ 
    name: '', 
    location: '', 
    provider: '', 
    tag: '',
    group_id: '',
    price_amount: '',
    price_period: 'month' as 'month' | 'year',
    purchase_date: '',
    tip_badge: ''
  });
  const [showLocalNodeForm, setShowLocalNodeForm] = useState(false);
  const [localNodeSaving, setLocalNodeSaving] = useState(false);
  const [localNodeSuccess, setLocalNodeSuccess] = useState(false);
  
  // Probe settings
  const [probeSettings, setProbeSettings] = useState<ProbeSettings>({ ping_targets: [] });
  const [showProbeSettings, setShowProbeSettings] = useState(false);
  const [probeSaving, setProbeSaving] = useState(false);
  
  // Group management (deprecated - kept for backward compatibility)
  interface ServerGroupLocal {
    id: string;
    name: string;
    sort_order: number;
  }
  const [groups, setGroups] = useState<ServerGroupLocal[]>([]);
  const [probeSuccess, setProbeSuccess] = useState(false);
  
  // Suppress unused warnings for deprecated group management
  const [_groups] = useState<ServerGroup[]>([]);
  void [_groups];
  
  // Dimension management
  const [dimensions, setDimensions] = useState<GroupDimension[]>([]);
  const [showDimensionsSection, setShowDimensionsSection] = useState(false);
  const [expandedDimension, setExpandedDimension] = useState<string | null>(null);
  const [newOptionName, setNewOptionName] = useState<Record<string, string>>({});
  const [addingOption, setAddingOption] = useState<Record<string, boolean>>({});
  const [editingOption, setEditingOption] = useState<{ dimId: string; optId: string } | null>(null);
  const [editOptionName, setEditOptionName] = useState('');
  
  // Add/Edit dimension
  const [showAddDimensionForm, setShowAddDimensionForm] = useState(false);
  const [newDimension, setNewDimension] = useState({ name: '', key: '', enabled: true });
  const [addingDimension, setAddingDimension] = useState(false);
  const [editingDimension, setEditingDimension] = useState<string | null>(null);
  const [editDimensionName, setEditDimensionName] = useState('');
  const [deletingDimension, setDeletingDimension] = useState<string | null>(null);

  useEffect(() => {
    // Wait for auth check to complete before redirecting
    if (authLoading) return;
    
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    fetchServers();
    fetchSiteSettings();
    fetchLocalNodeConfig();
    fetchProbeSettings();
    fetchDimensions();
    generateInstallCommand();
    fetchAgentStatus();
    fetchServerVersion();
    checkLatestVersion();
    fetchOAuthSettings();
  }, [isAuthenticated, authLoading, navigate]);
  
  // Refresh agent status periodically
  useEffect(() => {
    const interval = setInterval(fetchAgentStatus, 5000);
    return () => clearInterval(interval);
  }, []);
  
  const fetchAgentStatus = async () => {
    try {
      const res = await fetch('/api/metrics/all');
      if (res.ok) {
        const data = await res.json();
        const status: Record<string, boolean> = {};
        data.forEach((s: { server_id: string; online: boolean }) => {
          status[s.server_id] = s.online;
        });
        setAgentStatus(status);
      }
    } catch (e) {
      console.error('Failed to fetch agent status', e);
    }
  };
  
  const updateAgent = async (serverId: string) => {
    setUpdatingAgents(prev => ({ ...prev, [serverId]: true }));
    
    try {
      const res = await fetch(`/api/servers/${serverId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          showToast(t('settings.updateSent'), 'success');
        } else {
          showToast(`${t('settings.updateFailed')}: ${data.message}`, 'error');
        }
      } else {
        showToast(t('settings.updateFailed'), 'error');
      }
    } catch (e) {
      console.error('Failed to update agent', e);
      showToast(t('settings.updateFailed'), 'error');
    }
    
    setUpdatingAgents(prev => ({ ...prev, [serverId]: false }));
  };
  
  const fetchSiteSettings = async () => {
    try {
      const res = await fetch('/api/settings/site');
      if (res.ok) {
        const data = await res.json();
        setSiteSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch site settings', e);
    }
  };
  
  const fetchLocalNodeConfig = async () => {
    try {
      const res = await fetch('/api/settings/local-node', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setLocalNodeConfig(data);
      }
    } catch (e) {
      console.error('Failed to fetch local node config', e);
    }
  };
  
  const saveLocalNodeConfig = async () => {
    setLocalNodeSaving(true);
    setLocalNodeSuccess(false);
    
    try {
      const res = await fetch('/api/settings/local-node', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(localNodeConfig)
      });
      
      if (res.ok) {
        setLocalNodeSuccess(true);
        setTimeout(() => {
          setShowLocalNodeForm(false);
          setLocalNodeSuccess(false);
        }, 1500);
      }
    } catch (e) {
      console.error('Failed to save local node config', e);
    }
    
    setLocalNodeSaving(false);
  };
  
  const fetchProbeSettings = async () => {
    try {
      const res = await fetch('/api/settings/probe', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setProbeSettings(data);
      }
    } catch (e) {
      console.error('Failed to fetch probe settings', e);
    }
  };
  
  const fetchOAuthSettings = async () => {
    try {
      const res = await fetch('/api/settings/oauth', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setOauthSettings(data);
        // Populate form with existing data
        setOauthForm({
          use_centralized: data.use_centralized ?? true,
          allowed_users: data.allowed_users?.join(', ') || '',
          github: {
            enabled: data.github?.enabled || false,
            client_id: data.github?.client_id || '',
            client_secret: '',
            allowed_users: data.github?.allowed_users?.join(', ') || ''
          },
          google: {
            enabled: data.google?.enabled || false,
            client_id: data.google?.client_id || '',
            client_secret: '',
            allowed_users: data.google?.allowed_users?.join(', ') || ''
          }
        });
        // Show advanced settings if self-hosted is configured
        if (!data.use_centralized && (data.github?.enabled || data.google?.enabled)) {
          setShowAdvancedOAuth(true);
        }
      }
    } catch (e) {
      console.error('Failed to fetch OAuth settings', e);
    }
  };
  
  const saveOAuthSettings = async () => {
    setOauthSaving(true);
    setOauthSuccess(false);
    
    try {
      const payload: Record<string, any> = {
        use_centralized: oauthForm.use_centralized,
        allowed_users: oauthForm.allowed_users
          .split(',')
          .map(u => u.trim())
          .filter(u => u.length > 0)
      };
      
      // Only include self-hosted OAuth if not using centralized
      if (!oauthForm.use_centralized) {
        // GitHub settings
        payload.github = {
          enabled: oauthForm.github.enabled,
          client_id: oauthForm.github.client_id,
          allowed_users: oauthForm.github.allowed_users
            .split(',')
            .map(u => u.trim())
            .filter(u => u.length > 0)
        };
        if (oauthForm.github.client_secret) {
          payload.github.client_secret = oauthForm.github.client_secret;
        }
        
        // Google settings
        payload.google = {
          enabled: oauthForm.google.enabled,
          client_id: oauthForm.google.client_id,
          allowed_users: oauthForm.google.allowed_users
            .split(',')
            .map(u => u.trim())
            .filter(u => u.length > 0)
        };
        if (oauthForm.google.client_secret) {
          payload.google.client_secret = oauthForm.google.client_secret;
        }
      }
      
      const res = await fetch('/api/settings/oauth', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        setOauthSuccess(true);
        fetchOAuthSettings(); // Refresh to get updated state
        setTimeout(() => setOauthSuccess(false), 3000);
      }
    } catch (e) {
      console.error('Failed to save OAuth settings', e);
    }
    
    setOauthSaving(false);
  };
  
  const saveProbeSettings = async () => {
    setProbeSaving(true);
    setProbeSuccess(false);
    
    try {
      const res = await fetch('/api/settings/probe', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(probeSettings)
      });
      
      if (res.ok) {
        setProbeSuccess(true);
        setTimeout(() => {
          setProbeSuccess(false);
        }, 2000);
      }
    } catch (e) {
      console.error('Failed to save probe settings', e);
    }
    
    setProbeSaving(false);
  };
  
  const addPingTarget = () => {
    setProbeSettings({
      ...probeSettings,
      ping_targets: [...probeSettings.ping_targets, { name: '', host: '' }]
    });
  };
  
  // ============================================================================
  // Dimension Management Functions
  // ============================================================================
  
  const fetchDimensions = async () => {
    try {
      const res = await fetch('/api/dimensions', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDimensions(data || []);
        // Also fetch groups for backward compatibility
        const groupsRes = await fetch('/api/groups', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (groupsRes.ok) {
          setGroups(await groupsRes.json() || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch dimensions', e);
    }
  };
  
  const toggleDimensionEnabled = async (dimId: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/dimensions/${dimId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ enabled })
      });
      
      if (res.ok) {
        const updated = await res.json();
        setDimensions(dimensions.map(d => d.id === dimId ? updated : d));
        showToast(enabled ? t('common.enabled') : t('common.disabled'), 'success');
      } else {
        showToast(t('settings.saveFailed'), 'error');
      }
    } catch (e) {
      console.error('Failed to update dimension', e);
      showToast(t('settings.saveFailed'), 'error');
    }
  };
  
  const addOption = async (dimId: string) => {
    const name = newOptionName[dimId]?.trim();
    if (!name) return;
    
    setAddingOption({ ...addingOption, [dimId]: true });
    try {
      const dim = dimensions.find(d => d.id === dimId);
      const res = await fetch(`/api/dimensions/${dimId}/options`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name,
          sort_order: dim?.options?.length || 0
        })
      });
      
      if (res.ok) {
        const option = await res.json();
        setDimensions(dimensions.map(d => 
          d.id === dimId 
            ? { ...d, options: [...(d.options || []), option] }
            : d
        ));
        setNewOptionName({ ...newOptionName, [dimId]: '' });
        showToast(t('settings.saved'), 'success');
      } else {
        showToast(t('settings.saveFailed'), 'error');
      }
    } catch (e) {
      console.error('Failed to add option', e);
      showToast(t('settings.saveFailed'), 'error');
    }
    setAddingOption({ ...addingOption, [dimId]: false });
  };
  
  const updateOption = async (dimId: string, optId: string) => {
    if (!editOptionName.trim()) return;
    
    try {
      const res = await fetch(`/api/dimensions/${dimId}/options/${optId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: editOptionName.trim() })
      });
      
      if (res.ok) {
        const updated = await res.json();
        setDimensions(dimensions.map(d => 
          d.id === dimId 
            ? { ...d, options: d.options.map(o => o.id === optId ? updated : o) }
            : d
        ));
        setEditingOption(null);
        setEditOptionName('');
        showToast('选项已更新', 'success');
      } else {
        showToast('更新失败', 'error');
      }
    } catch (e) {
      console.error('Failed to update option', e);
      showToast('更新失败', 'error');
    }
  };
  
  const deleteOption = async (dimId: string, optId: string) => {
    if (!confirm('确定要删除此选项吗？使用此选项的服务器将变为未分配状态。')) {
      return;
    }
    
    try {
      const res = await fetch(`/api/dimensions/${dimId}/options/${optId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (res.ok) {
        setDimensions(dimensions.map(d => 
          d.id === dimId 
            ? { ...d, options: d.options.filter(o => o.id !== optId) }
            : d
        ));
        showToast('选项已删除', 'success');
      } else {
        showToast('删除失败', 'error');
      }
    } catch (e) {
      console.error('Failed to delete option', e);
      showToast('删除失败', 'error');
    }
  };
  
  // Get count of servers using a specific option
  const getOptionServerCount = (dimId: string, optId: string) => {
    return servers.filter(s => s.group_values?.[dimId] === optId).length;
  };
  
  // Add new dimension
  const addDimension = async () => {
    if (!newDimension.name.trim() || !newDimension.key.trim()) return;
    
    setAddingDimension(true);
    try {
      const res = await fetch('/api/dimensions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          name: newDimension.name.trim(),
          key: newDimension.key.trim().toLowerCase().replace(/\s+/g, '_'),
          enabled: newDimension.enabled,
          sort_order: dimensions.length
        })
      });
      
      if (res.ok) {
        const dimension = await res.json();
        setDimensions([...dimensions, dimension]);
        setNewDimension({ name: '', key: '', enabled: true });
        setShowAddDimensionForm(false);
        showToast('维度已添加', 'success');
      } else {
        const data = await res.json();
        showToast(data.error || '添加失败', 'error');
      }
    } catch (e) {
      console.error('Failed to add dimension', e);
      showToast('添加失败', 'error');
    }
    setAddingDimension(false);
  };
  
  // Update dimension name
  const updateDimensionName = async (dimId: string) => {
    if (!editDimensionName.trim()) return;
    
    try {
      const res = await fetch(`/api/dimensions/${dimId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: editDimensionName.trim() })
      });
      
      if (res.ok) {
        const updated = await res.json();
        setDimensions(dimensions.map(d => d.id === dimId ? updated : d));
        setEditingDimension(null);
        setEditDimensionName('');
        showToast('维度已更新', 'success');
      } else {
        showToast('更新失败', 'error');
      }
    } catch (e) {
      console.error('Failed to update dimension', e);
      showToast('更新失败', 'error');
    }
  };
  
  // Delete dimension
  const deleteDimension = async (dimId: string) => {
    const dimension = dimensions.find(d => d.id === dimId);
    if (!dimension) return;
    
    // Check if any servers are using this dimension
    const serversUsingDimension = servers.filter(s => s.group_values?.[dimId]);
    const confirmMessage = serversUsingDimension.length > 0
      ? `确定要删除维度"${dimension.name}"吗？\n${serversUsingDimension.length} 台服务器正在使用此维度，删除后将清除其分组设置。`
      : `确定要删除维度"${dimension.name}"吗？`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    setDeletingDimension(dimId);
    try {
      const res = await fetch(`/api/dimensions/${dimId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (res.ok) {
        setDimensions(dimensions.filter(d => d.id !== dimId));
        showToast('维度已删除', 'success');
      } else {
        showToast('删除失败', 'error');
      }
    } catch (e) {
      console.error('Failed to delete dimension', e);
      showToast('删除失败', 'error');
    }
    setDeletingDimension(null);
  };
  
  const removePingTarget = (index: number) => {
    setProbeSettings({
      ...probeSettings,
      ping_targets: probeSettings.ping_targets.filter((_, i) => i !== index)
    });
  };
  
  const updatePingTarget = (index: number, field: 'name' | 'host', value: string) => {
    const newTargets = [...probeSettings.ping_targets];
    newTargets[index] = { ...newTargets[index], [field]: value };
    setProbeSettings({ ...probeSettings, ping_targets: newTargets });
  };
  
  const saveSiteSettings = async () => {
    setSiteSettingsSaving(true);
    setSiteSettingsSuccess(false);
    
    try {
      const res = await fetch('/api/settings/site', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(siteSettings)
      });
      
      if (res.ok) {
        setSiteSettingsSuccess(true);
        setTimeout(() => setSiteSettingsSuccess(false), 3000);
      }
    } catch (e) {
      console.error('Failed to save site settings', e);
    }
    
    setSiteSettingsSaving(false);
  };
  
  const addSocialLink = () => {
    setSiteSettings({
      ...siteSettings,
      social_links: [...siteSettings.social_links, { platform: 'github', url: '', label: '' }]
    });
  };
  
  const removeSocialLink = (index: number) => {
    setSiteSettings({
      ...siteSettings,
      social_links: siteSettings.social_links.filter((_, i) => i !== index)
    });
  };
  
  const updateSocialLink = (index: number, field: keyof SocialLink, value: string) => {
    const updated = [...siteSettings.social_links];
    updated[index] = { ...updated[index], [field]: value };
    setSiteSettings({ ...siteSettings, social_links: updated });
  };
  
  const generateInstallCommand = async () => {
    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;
    
    // Linux/macOS command
    const linuxCommand = `curl -fsSL ${baseUrl}/agent.sh | sudo bash -s -- \\
  --server ${baseUrl} \\
  --token "${token}" \\
  --name "$(hostname)"`;
    
    // Windows PowerShell command (with TLS 1.2 and execution policy bypass)
    const windowsCommand = `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; iex (irm ${baseUrl}/agent.ps1); Install-VStatsAgent -Server "${baseUrl}" -Token "${token}"`;
    
    setInstallCommand(linuxCommand);
    setWindowsInstallCommand(windowsCommand);
  };
  
  const copyToClipboard = useCallback(async () => {
    const commandToCopy = installPlatform === 'windows' ? windowsInstallCommand : installCommand;
    const success = await copyTextToClipboard(commandToCopy);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [installCommand, windowsInstallCommand, installPlatform]);
  
  // Copy token to clipboard with feedback
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copyToken = useCallback(async (token: string) => {
    const success = await copyTextToClipboard(token);
    if (success) {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    }
  }, []);

  const fetchServers = async () => {
    try {
      const res = await fetch('/api/servers');
      if (res.ok) {
        const data = await res.json();
        setServers(data);
      }
    } catch (e) {
      console.error('Failed to fetch servers', e);
    }
    setLoading(false);
  };
  
  const fetchServerVersion = async () => {
    try {
      const res = await fetch('/api/version');
      if (res.ok) {
        const data = await res.json();
        setServerVersion(data.version);
      }
    } catch (e) {
      console.error('Failed to fetch server version', e);
    }
  };
  
  const checkLatestVersion = async () => {
    setCheckingVersion(true);
    try {
      const res = await fetch('/api/version/check');
      if (res.ok) {
        const data = await res.json();
        setLatestVersion(data.latest);
        setUpdateAvailable(data.update_available);
      }
    } catch (e) {
      console.error('Failed to check latest version', e);
    } finally {
      setCheckingVersion(false);
    }
  };

  const upgradeServer = async (force: boolean = false) => {
    const message = force 
      ? 'Are you sure you want to force reinstall the server? This will restart the service.'
      : 'Are you sure you want to upgrade the server? This will restart the service.';
    
    if (!confirm(message)) {
      return;
    }

    setUpgrading(true);
    
    try {
      const res = await fetch('/api/server/upgrade', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ force })
      });
      
      if (res.ok) {
        const data = await res.json();
        
        if (data.success) {
          const successMsg = force 
            ? 'Force reinstall executed successfully! The server will restart.'
            : 'Upgrade command executed successfully! The server will restart.';
          showToast(successMsg, 'success');
          // Refresh version after a delay
          setTimeout(() => {
            fetchServerVersion();
            checkLatestVersion();
          }, 3000);
        } else {
          showToast(`Upgrade failed: ${data.message}`, 'error');
        }
      } else {
        showToast('Failed to execute upgrade command', 'error');
      }
    } catch (e) {
      console.error('Failed to upgrade server', e);
      showToast('Failed to execute upgrade command', 'error');
    } finally {
      setUpgrading(false);
    }
  };
  
  const startEditServer = (server: RemoteServer) => {
    setEditingServer(server.id);
    setEditForm({
      name: server.name,
      location: server.location,
      provider: server.provider,
      tag: server.tag || '',
      group_id: server.group_id || '',
      price_amount: server.price_amount || '',
      price_period: (server.price_period as 'month' | 'year') || 'month',
      purchase_date: server.purchase_date || '',
      tip_badge: server.tip_badge || ''
    });
  };
  
  const saveEditServer = async () => {
    if (!editingServer) return;
    
    // 验证必填字段
    if (!editForm.name.trim()) {
      setEditError('Server name is required');
      return;
    }
    
    setEditLoading(true);
    setEditSuccess(false);
    setEditError(null);
    
    try {
      // 发送所有字段，空字符串表示清空该字段（除了name）
      const updateData: Record<string, any> = {
        name: editForm.name.trim(),
        location: editForm.location.trim(),
        provider: editForm.provider.trim(),
        tag: editForm.tag.trim(),
        group_id: editForm.group_id || '',
      };
      
      // Add price fields if provided
      if (editForm.price_amount.trim()) {
        updateData.price_amount = editForm.price_amount.trim();
        updateData.price_period = editForm.price_period;
      }
      
      // Add other optional fields
      if (editForm.purchase_date.trim()) {
        updateData.purchase_date = editForm.purchase_date.trim();
      }
      if (editForm.tip_badge.trim()) {
        updateData.tip_badge = editForm.tip_badge.trim();
      }
      
      const res = await fetch(`/api/servers/${editingServer}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(updateData)
      });
      
      if (res.ok) {
        const updated = await res.json();
        setServers(servers.map(s => s.id === editingServer ? updated : s));
        setEditSuccess(true);
        setTimeout(() => {
          setEditingServer(null);
          setEditForm({ 
            name: '', 
            location: '', 
            provider: '', 
            tag: '',
            group_id: '',
            price_amount: '',
            price_period: 'month',
            purchase_date: '',
            tip_badge: ''
          });
          setEditSuccess(false);
        }, 1500);
      } else {
        const errorData = await res.json().catch(() => ({ message: 'Failed to update server' }));
        setEditError(errorData.message || 'Failed to update server');
      }
    } catch (e) {
      console.error('Failed to update server', e);
      setEditError('Network error: Failed to update server');
    } finally {
      setEditLoading(false);
    }
  };

  const addServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddLoading(true);
    
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(newServer)
      });
      
      if (res.ok) {
        const server = await res.json();
        setServers([...servers, server]);
        setNewServer({ name: '', url: '', location: '', provider: '', tag: '', group_id: '' });
        setShowAddForm(false);
      }
    } catch (e) {
      console.error('Failed to add server', e);
    }
    
    setAddLoading(false);
  };

  const deleteServer = async (id: string) => {
    if (!confirm('Are you sure you want to delete this server?')) return;
    
    try {
      const res = await fetch(`/api/servers/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        setServers(servers.filter(s => s.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete server', e);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    
    if (passwords.new !== passwords.confirm) {
      setPasswordError('Passwords do not match');
      return;
    }
    
    if (passwords.new.length < 4) {
      setPasswordError('Password must be at least 4 characters');
      return;
    }
    
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          current_password: passwords.current,
          new_password: passwords.new
        })
      });
      
      if (res.ok) {
        setPasswordSuccess(true);
        setPasswords({ current: '', new: '', confirm: '' });
        setShowPasswordForm(false);
      } else {
        setPasswordError('Current password is incorrect');
      }
    } catch (e) {
      setPasswordError('Failed to change password');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-10 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            title={t('settings.backToDashboard')}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">{t('settings.title')}</h1>
            <p className="text-gray-500 text-sm">{t('settings.serverManagement')}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors"
        >
          {t('settings.logout')}
        </button>
      </div>

      {/* Site Settings Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            {t('settings.siteSettings')}
          </h2>
          <button
            onClick={() => setShowSiteSettings(!showSiteSettings)}
            className="px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm font-medium transition-colors"
          >
            {showSiteSettings ? t('common.close') : t('common.edit')}
          </button>
        </div>
        
        {siteSettingsSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            {t('settings.saved')}
          </div>
        )}
        
        {showSiteSettings && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('settings.siteName')}</label>
                <input
                  type="text"
                  value={siteSettings.site_name}
                  onChange={(e) => setSiteSettings({ ...siteSettings, site_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                  placeholder="vStats Dashboard"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">{t('settings.siteDescription')}</label>
                <input
                  type="text"
                  value={siteSettings.site_description}
                  onChange={(e) => setSiteSettings({ ...siteSettings, site_description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                  placeholder="Real-time Server Monitoring"
                />
              </div>
            </div>
            
            {/* Social Links */}
            <div className="pt-4 border-t border-white/5">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs text-gray-500 uppercase tracking-wider">{t('settings.socialLinks')}</label>
                <button
                  type="button"
                  onClick={addSocialLink}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  + {t('settings.addSocialLink')}
                </button>
              </div>
              
              {siteSettings.social_links.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-4">{t('common.none')}</p>
              ) : (
                <div className="space-y-3">
                  {siteSettings.social_links.map((link, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <select
                        value={link.platform}
                        onChange={(e) => updateSocialLink(index, 'platform', e.target.value)}
                        className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                      >
                        {PLATFORM_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={link.url}
                        onChange={(e) => updateSocialLink(index, 'url', e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                        placeholder="https://..."
                      />
                      <input
                        type="text"
                        value={link.label || ''}
                        onChange={(e) => updateSocialLink(index, 'label', e.target.value)}
                        className="w-24 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                        placeholder="Label"
                      />
                      <button
                        type="button"
                        onClick={() => removeSocialLink(index)}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex justify-end pt-4">
              <button
                onClick={saveSiteSettings}
                disabled={siteSettingsSaving}
                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {siteSettingsSaving ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Probe Settings Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500"></span>
            {t('settings.probeSettings')}
          </h2>
          <button
            onClick={() => setShowProbeSettings(!showProbeSettings)}
            className="px-4 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-sm font-medium transition-colors"
          >
            {showProbeSettings ? t('common.close') : t('common.edit')}
          </button>
        </div>
        
        <p className="text-gray-400 text-sm mb-4">
          Configure ping targets for latency monitoring. Agents will ping these IPs and report latency.
          Common use case: monitor latency to major carriers for return routes.
        </p>
        
        {probeSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            Probe settings saved! Agents will update on next connection.
          </div>
        )}
        
        {showProbeSettings && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Ping Targets</label>
              <button
                type="button"
                onClick={addPingTarget}
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
              >
                + Add Target
              </button>
            </div>
            
            {probeSettings.ping_targets.length === 0 ? (
              <div className="text-gray-600 text-sm text-center py-4 border border-dashed border-white/10 rounded-lg">
                No ping targets configured. Using defaults (Google DNS, Cloudflare).
              </div>
            ) : (
              <div className="space-y-3">
                {probeSettings.ping_targets.map((target, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={target.name}
                      onChange={(e) => updatePingTarget(index, 'name', e.target.value)}
                      className="w-40 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
                      placeholder="Name (e.g., CT)"
                    />
                    <input
                      type="text"
                      value={target.host}
                      onChange={(e) => updatePingTarget(index, 'host', e.target.value)}
                      className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50 font-mono"
                      placeholder="IP Address (e.g., 202.97.1.1)"
                    />
                    <button
                      type="button"
                      onClick={() => removePingTarget(index)}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="pt-4 border-t border-white/5 text-xs text-gray-500">
              <p className="mb-2">Common China carrier IPs for reference:</p>
              <div className="grid grid-cols-3 gap-2 font-mono text-gray-400">
                <span>CT: 202.97.1.1</span>
                <span>CU: 219.158.1.1</span>
                <span>CM: 223.120.2.1</span>
              </div>
            </div>
            
            <div className="flex justify-end pt-4">
              <button
                onClick={saveProbeSettings}
                disabled={probeSaving}
                className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {probeSaving ? 'Saving...' : 'Save Probe Settings'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* OAuth Settings Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            OAuth 2.0 登录
          </h2>
          <button
            onClick={() => setShowOAuthSettings(!showOAuthSettings)}
            className="px-4 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-sm font-medium transition-colors"
          >
            {showOAuthSettings ? '收起' : '配置'}
          </button>
        </div>
        
        <p className="text-gray-400 text-sm mb-4">
          启用 GitHub 和 Google 账号登录，无需配置即可使用统一认证服务。
        </p>
        
        {oauthSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            OAuth 设置已保存！
          </div>
        )}
        
        {showOAuthSettings && (
          <div className="space-y-6">
            {/* Centralized OAuth - Simple Toggle */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-orange-500/10 to-transparent border border-orange-500/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-white">启用 OAuth 登录</h3>
                    <p className="text-xs text-gray-500">使用 GitHub 或 Google 账号登录（推荐）</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={oauthForm.use_centralized}
                    onChange={(e) => setOauthForm({
                      ...oauthForm,
                      use_centralized: e.target.checked
                    })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
              
              {oauthForm.use_centralized && (
                <div className="space-y-4 pt-4 border-t border-orange-500/10">
                  <div className="flex items-center gap-2 text-sm text-emerald-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    已启用 GitHub 和 Google 登录
                  </div>
                  
                  <div>
                    <label className="block text-xs text-gray-500 mb-2">
                      允许的用户 <span className="text-gray-600">（GitHub 用户名或 Google 邮箱，逗号分隔，留空所有人都不能登录）</span>
                    </label>
                    <input
                      type="text"
                      value={oauthForm.allowed_users}
                      onChange={(e) => setOauthForm({
                        ...oauthForm,
                        allowed_users: e.target.value
                      })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-orange-500/50"
                      placeholder="github_user, user@gmail.com"
                    />
                  </div>
                  
                  <div className="text-xs text-gray-500 bg-black/20 rounded-lg p-3">
                    <p className="font-medium text-gray-400 mb-1">💡 使用说明：</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>启用后，登录页面将显示 GitHub 和 Google 登录按钮</li>
                      <li>OAuth 认证由 vstats.zsoft.cc 统一处理，无需额外配置</li>
                      <li>设置允许的用户可以限制谁能登录</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-end">
              <button
                onClick={saveOAuthSettings}
                disabled={oauthSaving}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {oauthSaving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dimension Management Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            分组维度
          </h2>
          <div className="flex items-center gap-2">
            {showDimensionsSection && (
              <button
                onClick={() => setShowAddDimensionForm(true)}
                className="px-4 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors"
              >
                添加维度
              </button>
            )}
            <button
              onClick={() => setShowDimensionsSection(!showDimensionsSection)}
              className="px-4 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-sm font-medium transition-colors"
            >
              {showDimensionsSection ? '收起' : '管理'}
            </button>
          </div>
        </div>
        
        <p className="text-gray-400 text-sm mb-4">
          管理服务器分组维度。启用的维度会显示在 Dashboard 上供筛选分组。
        </p>
        
        {showDimensionsSection && (
          <div className="space-y-4">
            {/* Add Dimension Form */}
            {showAddDimensionForm && (
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  添加新维度
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">维度名称</label>
                    <input
                      type="text"
                      value={newDimension.name}
                      onChange={(e) => setNewDimension({ ...newDimension, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="例如：地区、用途、类型..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">唯一标识 (key)</label>
                    <input
                      type="text"
                      value={newDimension.key}
                      onChange={(e) => setNewDimension({ ...newDimension, key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="例如：region、purpose..."
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newDimension.enabled}
                      onChange={(e) => setNewDimension({ ...newDimension, enabled: e.target.checked })}
                      className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500/20"
                    />
                    <span className="text-sm text-gray-400">创建后立即启用</span>
                  </label>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={addDimension}
                    disabled={addingDimension || !newDimension.name.trim() || !newDimension.key.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {addingDimension ? '添加中...' : '确认添加'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAddDimensionForm(false);
                      setNewDimension({ name: '', key: '', enabled: true });
                    }}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm font-medium transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            
            {dimensions.length === 0 && !showAddDimensionForm ? (
              <div className="text-gray-600 text-sm text-center py-4 border border-dashed border-white/10 rounded-lg">
                暂无分组维度，点击上方"添加维度"创建
              </div>
            ) : (
              <div className="space-y-3">
                {dimensions.sort((a, b) => a.sort_order - b.sort_order).map((dimension) => (
                  <div
                    key={dimension.id}
                    className="rounded-lg bg-white/[0.02] border border-white/5 overflow-hidden"
                  >
                    {/* Dimension Header */}
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setExpandedDimension(expandedDimension === dimension.id ? null : dimension.id)}
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                        >
                          <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedDimension === dimension.id ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                          <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          {editingDimension === dimension.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editDimensionName}
                                onChange={(e) => setEditDimensionName(e.target.value)}
                                className="px-2 py-1 rounded bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-orange-500/50"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') updateDimensionName(dimension.id);
                                  if (e.key === 'Escape') {
                                    setEditingDimension(null);
                                    setEditDimensionName('');
                                  }
                                }}
                              />
                              <button
                                onClick={() => updateDimensionName(dimension.id)}
                                className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs transition-colors"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => {
                                  setEditingDimension(null);
                                  setEditDimensionName('');
                                }}
                                className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{dimension.name}</span>
                                <button
                                  onClick={() => {
                                    setEditingDimension(dimension.id);
                                    setEditDimensionName(dimension.name);
                                  }}
                                  className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
                                  title="编辑名称"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                              <div className="text-xs text-gray-500">
                                <span className="text-gray-600">{dimension.key}</span>
                                <span className="mx-2">·</span>
                                {dimension.options?.length || 0} 个选项
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <span className={`text-xs ${dimension.enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                            {dimension.enabled ? '已启用' : '已禁用'}
                          </span>
                          <button
                            onClick={() => toggleDimensionEnabled(dimension.id, !dimension.enabled)}
                            className={`relative w-10 h-5 rounded-full transition-colors ${
                              dimension.enabled ? 'bg-emerald-500' : 'bg-gray-700'
                            }`}
                          >
                            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                              dimension.enabled ? 'translate-x-5' : ''
                            }`} />
                          </button>
                        </label>
                        <button
                          onClick={() => deleteDimension(dimension.id)}
                          disabled={deletingDimension === dimension.id}
                          className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors disabled:opacity-50"
                          title="删除维度"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    
                    {/* Dimension Options (Expanded) */}
                    {expandedDimension === dimension.id && (
                      <div className="border-t border-white/5 p-3 bg-black/20">
                        <div className="space-y-2">
                          {/* Add New Option */}
                          <div className="flex items-center gap-2 mb-3">
                            <input
                              type="text"
                              value={newOptionName[dimension.id] || ''}
                              onChange={(e) => setNewOptionName({ ...newOptionName, [dimension.id]: e.target.value })}
                              className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-orange-500/50"
                              placeholder="新选项名称..."
                              onKeyDown={(e) => e.key === 'Enter' && addOption(dimension.id)}
                            />
                            <button
                              onClick={() => addOption(dimension.id)}
                              disabled={addingOption[dimension.id] || !newOptionName[dimension.id]?.trim()}
                              className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
                            >
                              {addingOption[dimension.id] ? '添加中...' : '添加'}
                            </button>
                          </div>
                          
                          {/* Options List */}
                          {(!dimension.options || dimension.options.length === 0) ? (
                            <div className="text-gray-600 text-xs text-center py-3">
                              暂无选项，请添加
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {dimension.options.sort((a, b) => a.sort_order - b.sort_order).map((option) => (
                                <div
                                  key={option.id}
                                  className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                                >
                                  {editingOption?.dimId === dimension.id && editingOption?.optId === option.id ? (
                                    <div className="flex items-center gap-2 flex-1">
                                      <input
                                        type="text"
                                        value={editOptionName}
                                        onChange={(e) => setEditOptionName(e.target.value)}
                                        className="flex-1 px-2 py-1 rounded bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-orange-500/50"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') updateOption(dimension.id, option.id);
                                          if (e.key === 'Escape') {
                                            setEditingOption(null);
                                            setEditOptionName('');
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => updateOption(dimension.id, option.id)}
                                        className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs transition-colors"
                                      >
                                        保存
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingOption(null);
                                          setEditOptionName('');
                                        }}
                                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 text-xs transition-colors"
                                      >
                                        取消
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-300">{option.name}</span>
                                        <span className="text-xs text-gray-600">
                                          ({getOptionServerCount(dimension.id, option.id)} 台)
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() => {
                                            setEditingOption({ dimId: dimension.id, optId: option.id });
                                            setEditOptionName(option.name);
                                          }}
                                          className="p-1.5 rounded hover:bg-blue-500/10 text-gray-500 hover:text-blue-400 transition-colors"
                                          title="编辑"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                          </svg>
                                        </button>
                                        <button
                                          onClick={() => deleteOption(dimension.id, option.id)}
                                          className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                                          title="删除"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Quick Install Section */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
            Quick Install Agent
          </h2>
          <button
            onClick={() => setShowInstallCommand(!showInstallCommand)}
            className="px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {showInstallCommand ? 'Hide' : 'Show'} Command
          </button>
        </div>
        
        <p className="text-gray-400 text-sm mb-4">
          Run this command on any server to install the monitoring agent.
        </p>
        
        {showInstallCommand && (
          <div>
            {/* Platform Tabs */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setInstallPlatform('linux')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  installPlatform === 'linux'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-transparent'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.002c-.06-.135-.12-.2-.181-.265-.193-.135-.512-.266-.925-.4-.332-.066-.503-.2-.656-.336l-.003-.005c-.083-.066-.167-.133-.335-.2a1.086 1.086 0 00-.5-.134c-.124 0-.27.044-.405.134-.453.332-.892.27-1.323.27-.663 0-.875-.27-1.455-.8a2.473 2.473 0 00-.584-.4 1.232 1.232 0 00-.407-.134 1.315 1.315 0 00-.396.06c-.179.067-.336.133-.483.267-.05.05-.1.066-.148.066-.013 0-.026-.003-.038-.003a2.4 2.4 0 00-.406-.003c-.135.018-.27.06-.405.135-.262.133-.534.27-.936.4-.402.066-.795.2-1.164.2-.176 0-.349-.018-.518-.067a.671.671 0 00-.594.2c-.09.132-.132.2-.132.266 0 .066.023.133.053.2.066.134.2.2.332.266.066 0 .2.067.267.067.135 0 .27-.067.405-.067.135-.066.265-.066.4-.2.132-.066.265-.2.467-.2.135 0 .27.067.402.133.135.066.269.2.403.2.135.066.266.133.4.133.134 0 .265-.067.4-.067.135 0 .27.067.4.067.135 0 .265.067.4.067.265 0 .535-.066.8-.133.266-.066.534-.133.8-.133.135 0 .265.066.4.066.265.066.534.133.8.2.268.066.535.067.802.067h.265c.266 0 .534-.066.8-.133.534-.133.935-.266 1.403-.533.534-.2.935-.465 1.2-.6.201-.134.336-.2.336-.267 0-.066-.068-.133-.202-.2-.268-.066-.602-.266-.87-.533a2.84 2.84 0 01-.403-.467c-.067-.067-.201-.2-.27-.2-.066 0-.133.067-.2.134-.27.266-.535.466-.935.533a2.05 2.05 0 01-.936-.134c-.201-.066-.4-.2-.602-.333a1.4 1.4 0 00-.47-.333 1.358 1.358 0 00-.467-.134c-.066 0-.135 0-.203.067-.27.067-.534.2-.8.267a2.97 2.97 0 01-.87.2c-.066 0-.135-.067-.201-.067-.2-.133-.334-.2-.535-.333a2.3 2.3 0 00-.535-.2 1.536 1.536 0 00-.467-.067c-.2 0-.335.067-.535.134-.2.066-.334.2-.535.266-.066.067-.2.067-.267.134h-.069c-.2-.133-.334-.2-.468-.333-.134-.067-.202-.134-.336-.2-.068-.067-.135-.067-.203-.134a3.19 3.19 0 01-.468-.467c-.135-.133-.269-.266-.402-.533-.134-.2-.202-.465-.27-.732v-.068c0-.135.068-.2.27-.2.2 0 .468.068.735.2.069.066.135.066.203.133.2.067.4.2.602.267.135.067.27.133.402.2.134.066.27.066.4.066.335 0 .536-.133.67-.266a.69.69 0 00.2-.4c.002-.2-.066-.4-.2-.534-.134-.066-.27-.2-.469-.333-.2-.2-.402-.333-.602-.467-.2-.066-.335-.2-.535-.266-.2-.133-.402-.2-.602-.333-.2-.068-.4-.202-.535-.268a.642.642 0 00-.269-.066c-.135 0-.2.066-.268.133-.202.2-.27.467-.27.735a2.1 2.1 0 00.135.666c.068.2.135.4.27.534.066.133.133.2.2.266.066.068.133.134.268.2.2.135.4.267.6.4.068.067.135.067.27.134.135.133.268.2.402.266.135.067.27.134.4.2.07.068.136.068.2.134v.067c-.066.2-.2.4-.334.6-.2.2-.4.4-.735.4h-.066c-.135-.067-.2-.134-.336-.134-.2-.133-.335-.2-.535-.2-.2-.067-.4-.133-.602-.133-.2-.067-.4-.067-.6-.067-.2.067-.335.067-.536.134-.2 0-.335.066-.535.066-.2.067-.335.067-.535.134-.134 0-.27.066-.402.066-.066 0-.135.067-.2.067-.068.067-.136.067-.27.134-.068.066-.136.066-.27.133a1.315 1.315 0 00-.268.2 3.476 3.476 0 00-.27.266c-.066.2-.133.335-.133.535 0 .133.067.266.133.4.068.2.135.333.268.533.135.133.269.267.4.4.202.133.402.2.67.266.2.067.4.134.67.067.2 0 .4-.067.6-.2.2-.067.4-.2.535-.333.068-.067.135-.133.27-.2h.002c.066-.2.2-.334.332-.467.135-.133.27-.2.47-.266.134-.067.334-.067.467-.067.2 0 .335.067.535.134.2.066.335.2.535.333.135.133.27.2.402.333.066.067.133.067.2.134.135.066.202.2.336.266.2.134.4.2.6.267.203.066.403.133.67.133h.002c.2 0 .4-.067.602-.133.134-.067.27-.134.402-.2.133-.067.2-.134.332-.2.135-.134.203-.2.336-.334.135-.133.202-.266.336-.4.133-.133.2-.266.267-.4.133-.2.2-.4.2-.6 0-.135-.067-.2-.067-.335 0-.066-.068-.2-.068-.266-.066-.067-.066-.2-.133-.266-.067-.134-.134-.2-.2-.334-.068-.133-.135-.2-.27-.333a3.19 3.19 0 00-.266-.267c-.135-.067-.203-.133-.336-.133-.135-.067-.27-.067-.4-.134-.135-.066-.27-.066-.403-.066-.2 0-.335.066-.468.066-.135.067-.27.067-.402.134-.135.066-.202.133-.336.2-.133.066-.2.133-.332.2-.07.133-.203.2-.27.333z"/>
                </svg>
                Linux / macOS
              </button>
              <button
                onClick={() => setInstallPlatform('windows')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                  installPlatform === 'windows'
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-transparent'
                }`}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/>
                </svg>
                Windows
              </button>
            </div>
            
            <div className="relative">
              <pre className="p-4 rounded-xl bg-black/40 border border-white/10 text-sm text-emerald-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {installPlatform === 'windows' ? windowsInstallCommand : installCommand}
              </pre>
              <button
                onClick={copyToClipboard}
                className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  copied 
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : 'bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            
            {installPlatform === 'windows' && (
              <p className="mt-3 text-xs text-gray-500">
                💡 命令已包含 TLS 1.2 设置，并自动处理执行策略。请以管理员身份运行 PowerShell。
              </p>
            )}
          </div>
        )}
      </div>

      {/* Server Management Section - Combined Local + Agents */}
      <div className="nezha-card p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Server Management
          </h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Agent
          </button>
        </div>

        {/* Success messages */}
        {localNodeSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            Configuration saved successfully!
          </div>
        )}

        {showAddForm && (
          <form onSubmit={addServer} className="mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Server Name</label>
                <input
                  type="text"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., US-West-1"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tag</label>
                <input
                  type="text"
                  value={newServer.tag}
                  onChange={(e) => setNewServer({ ...newServer, tag: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., Production, Test"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Location Code</label>
                <input
                  type="text"
                  value={newServer.location}
                  onChange={(e) => setNewServer({ ...newServer, location: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., US, HK, JP"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                <input
                  type="text"
                  value={newServer.provider}
                  onChange={(e) => setNewServer({ ...newServer, provider: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g., AWS, Vultr"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Group</label>
                <select
                  value={newServer.group_id}
                  onChange={(e) => setNewServer({ ...newServer, group_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="">No Group</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={addLoading} className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {addLoading ? 'Adding...' : 'Add Server'}
              </button>
            </div>
          </form>
        )}

        {/* Server List - Local Node First, then Agents */}
        <div className="space-y-3">
          {/* Local Node (Dashboard Server) */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/5 to-transparent border border-emerald-500/20 hover:border-emerald-500/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{localNodeConfig.name || 'Dashboard Server'}</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase">Local</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {localNodeConfig.location && (
                      <span className="text-xs text-gray-500">{localNodeConfig.location}</span>
                    )}
                    {localNodeConfig.provider && (
                      <span className="text-xs text-gray-600">{localNodeConfig.provider}</span>
                    )}
                    {localNodeConfig.tag && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs">
                        {localNodeConfig.tag}
                      </span>
                    )}
                    {localNodeConfig.price_amount && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-xs">
                        {localNodeConfig.price_amount}/{localNodeConfig.price_period === 'year' ? 'yr' : 'mo'}
                      </span>
                    )}
                    {localNodeConfig.tip_badge && (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-xs">
                        {localNodeConfig.tip_badge === 'cn3-opt' ? '三网优化' :
                         localNodeConfig.tip_badge === 'cn3-gia' ? '三网 GIA' :
                         localNodeConfig.tip_badge === 'big-disk' ? '大盘鸡' :
                         localNodeConfig.tip_badge === 'perf' ? '性能机' :
                         localNodeConfig.tip_badge === 'landing' ? '落地机' :
                         localNodeConfig.tip_badge === 'dufu' ? '杜甫' :
                         localNodeConfig.tip_badge}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowLocalNodeForm(!showLocalNodeForm)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs transition-colors"
              >
                {showLocalNodeForm ? 'Cancel' : 'Edit'}
              </button>
            </div>
            
            {/* Local Node Edit Form */}
            {showLocalNodeForm && (
              <div className="mt-4 pt-4 border-t border-emerald-500/10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                    <input
                      type="text"
                      value={localNodeConfig.name}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g., Dashboard Server"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tag</label>
                    <input
                      type="text"
                      value={localNodeConfig.tag}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, tag: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g., Dashboard, Main"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Location</label>
                    <input
                      type="text"
                      value={localNodeConfig.location}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, location: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g., US, CN, HK"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Provider</label>
                    <input
                      type="text"
                      value={localNodeConfig.provider}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, provider: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g., AWS, Vultr, Self-hosted"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tip Badge</label>
                    <select
                      value={localNodeConfig.tip_badge}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, tip_badge: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Auto (from tag)</option>
                      <option value="cn3-opt">三网优化</option>
                      <option value="cn3-gia">三网 GIA</option>
                      <option value="big-disk">大盘鸡</option>
                      <option value="perf">性能机</option>
                      <option value="landing">落地机</option>
                      <option value="dufu">杜甫</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Group</label>
                    <select
                      value={localNodeConfig.group_id}
                      onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, group_id: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">No Group</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* Extended Metadata Section */}
                <div className="pt-4 border-t border-emerald-500/10 mb-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Extended Metadata</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Price Amount</label>
                      <input
                        type="text"
                        value={localNodeConfig.price_amount}
                        onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, price_amount: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                        placeholder="e.g., $89.99"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Price Period</label>
                      <select
                        value={localNodeConfig.price_period}
                        onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, price_period: e.target.value as 'month' | 'year' })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="month">Monthly</option>
                        <option value="year">Yearly</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                      <input
                        type="date"
                        value={localNodeConfig.purchase_date}
                        onChange={(e) => setLocalNodeConfig({ ...localNodeConfig, purchase_date: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                      />
                      <p className="text-xs text-gray-600 mt-1">Remaining value will be calculated automatically</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex justify-end">
                  <button
                    onClick={saveLocalNodeConfig}
                    disabled={localNodeSaving}
                    className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {localNodeSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Remote Agents */}
          {servers.length === 0 ? (
            <div className="text-center py-6 text-gray-500 border border-dashed border-white/10 rounded-xl">
              <p>No remote agents connected</p>
              <p className="text-sm mt-1">Install the agent on a server using the command above</p>
            </div>
          ) : (
            servers.map((server) => {
              const isOnline = agentStatus[server.id] || false;
              const isUpdating = updatingAgents[server.id] || false;
              
              return (
                <div key={server.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-sm font-bold text-blue-400">
                        {server.location || '??'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white">{server.name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase">Agent</span>
                          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-gray-500'}`} />
                          <span className={`text-xs ${isOnline ? 'text-emerald-400' : 'text-gray-500'}`}>
                            {isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <div className="text-xs text-gray-500 font-mono">ID: {server.id.slice(0, 8)}...</div>
                          {server.ip && (
                            <span className="text-xs text-cyan-400 font-mono">{server.ip}</span>
                          )}
                          {server.version && (
                            <span className="text-xs text-gray-600 font-mono">v{server.version}</span>
                          )}
                          {server.tag && (
                            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 text-xs">
                              {server.tag}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {server.provider && (
                        <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-400 text-xs">
                          {server.provider}
                        </span>
                      )}
                      {/* Edit Button */}
                      <button
                        onClick={() => startEditServer(server)}
                        className="p-2 rounded-lg hover:bg-blue-500/10 text-gray-500 hover:text-blue-400 transition-colors"
                        title="Edit Server"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      {/* Update Button */}
                      <button
                        onClick={() => updateAgent(server.id)}
                        disabled={!isOnline || isUpdating}
                        className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                          isOnline && !isUpdating
                            ? 'hover:bg-cyan-500/10 text-gray-500 hover:text-cyan-400 border border-transparent hover:border-cyan-500/30'
                            : 'text-gray-600 cursor-not-allowed'
                        }`}
                        title={isOnline ? '升级 Agent' : 'Agent 离线'}
                      >
                        {isUpdating ? '升级中...' : '升级'}
                      </button>
                      <button
                        onClick={() => deleteServer(server.id)}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
                        title="Delete Server"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* Edit Form */}
                  {editingServer === server.id && (
                    <div className="mt-4 pt-4 border-t border-white/5">
                      {editSuccess && (
                        <div className="mb-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                          ✓ Server information updated successfully!
                        </div>
                      )}
                      {editError && (
                        <div className="mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                          ✗ {editError}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Name <span className="text-red-400">*</span></label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            placeholder="Server name"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Tag</label>
                          <input
                            type="text"
                            value={editForm.tag}
                            onChange={(e) => setEditForm({ ...editForm, tag: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            placeholder="e.g., Production, Test"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Location</label>
                          <input
                            type="text"
                            value={editForm.location}
                            onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            placeholder="e.g., US, CN, HK"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Provider</label>
                          <input
                            type="text"
                            value={editForm.provider}
                            onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            placeholder="e.g., AWS, Vultr"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Tip Badge</label>
                          <select
                            value={editForm.tip_badge}
                            onChange={(e) => setEditForm({ ...editForm, tip_badge: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                          >
                            <option value="">Auto (from tag)</option>
                            <option value="cn3-opt">三网优化</option>
                            <option value="cn3-gia">三网 GIA</option>
                            <option value="big-disk">大盘鸡</option>
                            <option value="perf">性能机</option>
                            <option value="landing">落地机</option>
                            <option value="dufu">杜甫</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">Group</label>
                          <select
                            value={editForm.group_id}
                            onChange={(e) => setEditForm({ ...editForm, group_id: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                          >
                            <option value="">No Group</option>
                            {groups.map(g => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      
                      {/* Extended Metadata Section */}
                      <div className="pt-3 border-t border-white/5 mb-3">
                        <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">Extended Metadata</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Price Amount</label>
                            <input
                              type="text"
                              value={editForm.price_amount}
                              onChange={(e) => setEditForm({ ...editForm, price_amount: e.target.value })}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                              placeholder="e.g., $89.99"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Price Period</label>
                            <select
                              value={editForm.price_period}
                              onChange={(e) => setEditForm({ ...editForm, price_period: e.target.value as 'month' | 'year' })}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            >
                              <option value="month">Monthly</option>
                              <option value="year">Yearly</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Purchase Date</label>
                            <input
                              type="date"
                              value={editForm.purchase_date}
                              onChange={(e) => setEditForm({ ...editForm, purchase_date: e.target.value })}
                              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-blue-500/50"
                            />
                            <p className="text-xs text-gray-600 mt-1">Remaining value will be calculated automatically</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingServer(null);
                            setEditForm({ 
                              name: '', 
                              location: '', 
                              provider: '', 
                              tag: '',
                              group_id: '',
                              price_amount: '',
                              price_period: 'month',
                              purchase_date: '',
                              tip_badge: ''
                            });
                          }}
                          className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveEditServer}
                          disabled={editLoading}
                          className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {editLoading ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {server.token && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Agent Token</div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-2 py-1 rounded bg-black/20 text-xs text-emerald-400 font-mono truncate">{server.token}</code>
                        <button 
                          onClick={() => copyToken(server.token || '')} 
                          className={`px-2 py-1 rounded text-xs transition-colors ${
                            copiedToken === server.token 
                              ? 'bg-emerald-500/20 text-emerald-400' 
                              : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white'
                          }`}
                        >
                          {copiedToken === server.token ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Version Info Section */}
      <div className="nezha-card p-6 mb-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
          Version Information
        </h2>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400">Current Version</div>
              <div className="text-lg font-mono text-white">{serverVersion || 'Loading...'}</div>
            </div>
            <button
              onClick={checkLatestVersion}
              disabled={checkingVersion}
              className="px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {checkingVersion ? 'Checking...' : 'Check Update'}
            </button>
          </div>
          
          {latestVersion && (
            <div className="pt-3 border-t border-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400">Latest Version</div>
                  <div className="text-lg font-mono text-white">{latestVersion}</div>
                </div>
                {updateAvailable ? (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">
                      Update Available
                    </span>
                    <button
                      onClick={() => upgradeServer(false)}
                      disabled={upgrading}
                      className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {upgrading ? 'Upgrading...' : 'Execute Upgrade'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-lg bg-gray-500/10 text-gray-400 text-xs font-medium">
                      Up to Date
                    </span>
                    <button
                      onClick={() => upgradeServer(true)}
                      disabled={upgrading}
                      className="px-4 py-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Force reinstall the same version"
                    >
                      {upgrading ? 'Reinstalling...' : 'Force Reinstall'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Security Section */}
      <div className="nezha-card p-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          Security
        </h2>

        {passwordSuccess && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
            Password changed successfully!
          </div>
        )}

        {showPasswordForm ? (
          <form onSubmit={changePassword} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Current Password</label>
              <input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">New Password</label>
              <input type="password" value={passwords.new} onChange={(e) => setPasswords({ ...passwords, new: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50" required />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confirm New Password</label>
              <input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50" required />
            </div>
            {passwordError && <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{passwordError}</div>}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setShowPasswordForm(false); setPasswords({ current: '', new: '', confirm: '' }); setPasswordError(''); }} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition-colors">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium transition-colors">Change Password</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowPasswordForm(true)} className="px-4 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 text-sm font-medium transition-colors">
            Change Password
          </button>
        )}
      </div>
    </div>
  );
}
