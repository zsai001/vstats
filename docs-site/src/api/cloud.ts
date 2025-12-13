// Cloud API Service
// 后端 API 基础 URL
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// OAuth Proxy URL (Cloudflare Worker)
const OAUTH_PROXY_URL = 'https://vstats-oauth-proxy.zsai001.workers.dev';

// 存储 token
let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('vstats_token', token);
  } else {
    localStorage.removeItem('vstats_token');
  }
}

export function getToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem('vstats_token');
  }
  return authToken;
}

// 通用请求方法
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Types
// ============================================================================

export interface User {
  id: string;
  username: string;
  email?: string;
  avatar_url?: string;
  plan: string;
  server_limit: number;
  status: string;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  hostname?: string;
  ip_address?: string;
  agent_key: string;
  agent_version?: string;
  os_type?: string;
  os_version?: string;
  status: 'online' | 'offline' | 'warning' | 'error';
  last_seen_at?: string;
  metrics?: ServerMetrics;
  created_at: string;
}

export interface ServerMetrics {
  cpu_usage?: number;
  memory_used?: number;
  memory_total?: number;
  disk_used?: number;
  disk_total?: number;
  network_rx_bytes?: number;
  network_tx_bytes?: number;
}

export interface OAuthProviders {
  providers: Record<string, boolean>;
}

// ============================================================================
// Auth API
// ============================================================================

export async function getOAuthProviders(): Promise<OAuthProviders> {
  return request('/auth/providers');
}

export async function startOAuth(provider: 'github' | 'google'): Promise<{ url: string }> {
  // Use Cloudflare OAuth Proxy directly instead of backend API
  const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback?from=cloud');
  const state = encodeURIComponent(Date.now().toString());
  const url = `${OAUTH_PROXY_URL}/oauth/${provider}?redirect_uri=${redirectUri}&state=${state}`;
  return { url };
}

// Exchange OAuth user info for JWT token from backend
export async function exchangeForToken(provider: string, username: string, email?: string): Promise<{ token: string; expires_at: number }> {
  const response = await fetch(`${API_BASE}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, username, email }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Token exchange failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  return response.json();
}

export async function verifyToken(): Promise<{ valid: boolean; user_id: string; username: string; plan: string }> {
  return request('/auth/verify');
}

export async function getCurrentUser(): Promise<{ user: User; server_count: number; server_limit: number }> {
  return request('/auth/me');
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' });
  setToken(null);
}

// ============================================================================
// Server API
// ============================================================================

export async function listServers(): Promise<Server[]> {
  return request('/servers');
}

export async function createServer(name: string): Promise<Server> {
  return request('/servers', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function getServer(id: string): Promise<Server> {
  return request(`/servers/${id}`);
}

export async function updateServer(id: string, data: { name?: string }): Promise<Server> {
  return request(`/servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteServer(id: string): Promise<void> {
  await request(`/servers/${id}`, { method: 'DELETE' });
}

export async function regenerateAgentKey(id: string): Promise<{ agent_key: string }> {
  return request(`/servers/${id}/regenerate-key`, { method: 'POST' });
}

export async function getInstallCommand(id: string): Promise<{ command: string; agent_key: string }> {
  return request(`/servers/${id}/install-command`);
}

export async function getServerMetrics(id: string): Promise<{ metrics: ServerMetrics | null }> {
  return request(`/servers/${id}/metrics`);
}

export async function getServerHistory(id: string, range: '1h' | '24h' | '7d' | '30d' = '1h'): Promise<{ data: ServerMetrics[] }> {
  return request(`/servers/${id}/history?range=${range}`);
}

// ============================================================================
// Auth Reports API (Admin)
// ============================================================================

export interface AuthDailyStats {
  date: string;
  unique_sites: number;
  unique_users: number;
  total_auths: number;
  github_users: number;
  google_users: number;
}

export interface AuthSiteStats {
  site_host: string;
  site_url: string;
  unique_users: number;
  total_auths: number;
  first_seen: string;
  last_seen: string;
  active_days: number;
}

export interface AuthOverallStats {
  total_sites: number;
  total_users: number;
  total_auths: number;
  today_sites: number;
  today_users: number;
  today_auths: number;
  github_users: number;
  google_users: number;
}

export interface AuthReport {
  id: number;
  site_url: string;
  site_host: string;
  provider: string;
  username: string;
  ip_address?: string;
  user_agent?: string;
  reported_at: string;
}

export async function getAuthOverallStats(): Promise<AuthOverallStats> {
  return request('/admin/auth-stats');
}

export async function getAuthDailyStats(days: number = 30): Promise<{ stats: AuthDailyStats[] }> {
  return request(`/admin/auth-stats/daily?days=${days}`);
}

export async function getAuthSiteStats(limit: number = 100): Promise<{ sites: AuthSiteStats[] }> {
  return request(`/admin/auth-stats/sites?limit=${limit}`);
}

export async function getAuthUsersBySite(siteHost: string, limit: number = 100): Promise<{ reports: AuthReport[] }> {
  return request(`/admin/auth-stats/sites/${encodeURIComponent(siteHost)}?limit=${limit}`);
}

export async function getAuthUsersByDate(date: string, limit: number = 100): Promise<{ reports: AuthReport[] }> {
  return request(`/admin/auth-stats/date/${date}?limit=${limit}`);
}

// ============================================================================
// User Management API (Admin)
// ============================================================================

export interface AdminUser {
  id: string;
  username: string;
  email?: string;
  email_verified: boolean;
  avatar_url?: string;
  plan: string;
  server_limit: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
  server_count: number;
  oauth_provider?: string;
}

export interface UserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface UserStats {
  total_users: number;
  active_users: number;
  suspended_users: number;
  free_users: number;
  pro_users: number;
  enterprise_users: number;
  new_today: number;
  total_servers: number;
  online_servers: number;
}

export async function listUsers(page: number = 1, pageSize: number = 20, search?: string): Promise<UserListResponse> {
  let url = `/admin/users?page=${page}&page_size=${pageSize}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  return request(url);
}

export async function getUserStats(): Promise<UserStats> {
  return request('/admin/users/stats');
}

export async function getUser(id: string): Promise<{ user: AdminUser }> {
  return request(`/admin/users/${id}`);
}

export async function updateUser(id: string, data: { plan?: string; status?: string }): Promise<{ user: AdminUser; message: string }> {
  return request(`/admin/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<{ message: string }> {
  return request(`/admin/users/${id}`, { method: 'DELETE' });
}

// ============================================================================
// WebSocket
// ============================================================================

export function connectDashboardWS(onMessage: (data: any) => void): WebSocket | null {
  const token = getToken();
  if (!token) return null;

  const wsBase = API_BASE.replace(/^http/, 'ws').replace('/api', '');
  const ws = new WebSocket(`${wsBase}/api/ws?token=${token}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('WebSocket message parse error:', e);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  return ws;
}
