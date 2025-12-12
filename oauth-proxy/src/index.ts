/**
 * vStats OAuth Proxy - Cloudflare Worker
 * 
 * This worker handles OAuth 2.0 authentication for self-deployed vStats instances.
 * It acts as a centralized OAuth proxy so users don't need to configure their own OAuth apps.
 * 
 * Flow:
 * 1. User's vStats instance redirects to: /oauth/github?redirect_uri=https://their-instance.com/api/auth/oauth/proxy/callback&state=xxx
 * 2. This worker redirects to GitHub/Google OAuth
 * 3. After auth, this worker gets the user info and redirects back to the original instance
 */

export interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

// CORS headers for preflight requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // GitHub OAuth start
      if (path === '/oauth/github') {
        return handleGitHubStart(url, env);
      }

      // GitHub OAuth callback
      if (path === '/oauth/github/callback') {
        return await handleGitHubCallback(url, env);
      }

      // Google OAuth start
      if (path === '/oauth/google') {
        return handleGoogleStart(url, env);
      }

      // Google OAuth callback
      if (path === '/oauth/google/callback') {
        return await handleGoogleCallback(url, env);
      }

      // Health check
      if (path === '/health' || path === '/') {
        return new Response(JSON.stringify({
          status: 'ok',
          service: 'vStats OAuth Proxy',
          endpoints: ['/oauth/github', '/oauth/google']
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },
};

// ============================================================================
// GitHub OAuth
// ============================================================================

function handleGitHubStart(url: URL, env: Env): Response {
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');

  if (!redirectUri || !state) {
    return new Response('Missing redirect_uri or state parameter', { status: 400 });
  }

  // Validate redirect_uri is a valid URL
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return new Response('Invalid redirect_uri', { status: 400 });
  }

  // Allow HTTP only for localhost/127.0.0.1 (for local development)
  // Production redirect_uris should use HTTPS
  const isLocalhost = redirectUrl.hostname === 'localhost' || 
                      redirectUrl.hostname === '127.0.0.1' ||
                      redirectUrl.hostname.startsWith('192.168.') ||
                      redirectUrl.hostname.startsWith('10.') ||
                      redirectUrl.hostname.endsWith('.local');
  
  if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
    return new Response('redirect_uri must use http or https protocol', { status: 400 });
  }

  if (redirectUrl.protocol === 'http:' && !isLocalhost) {
    return new Response('redirect_uri must use https protocol for non-localhost addresses', { status: 400 });
  }

  // Store the original redirect_uri in state (base64 encoded)
  const proxyState = btoa(JSON.stringify({
    redirect_uri: redirectUri,
    original_state: state,
    provider: 'github'
  }));

  // Use the same protocol as the incoming request for callback URL
  // This allows HTTP for local development (localhost)
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set('redirect_uri', `${url.origin}/oauth/github/callback`);
  githubAuthUrl.searchParams.set('scope', 'read:user user:email');
  githubAuthUrl.searchParams.set('state', proxyState);

  return Response.redirect(githubAuthUrl.toString(), 302);
}

async function handleGitHubCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  const proxyState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return redirectWithError(proxyState, `GitHub OAuth error: ${error}`);
  }

  if (!code || !proxyState) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Decode the proxy state
  let stateData: { redirect_uri: string; original_state: string; provider: string };
  try {
    stateData = JSON.parse(atob(proxyState));
  } catch {
    return new Response('Invalid state parameter', { status: 400 });
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: code,
      redirect_uri: `${url.origin}/oauth/github/callback`,
    }),
  });

  const tokenText = await tokenResponse.text();
  
  if (!tokenResponse.ok) {
    console.error('GitHub token exchange failed:', tokenResponse.status, tokenText);
    return redirectWithError(proxyState, `GitHub token exchange failed: ${tokenResponse.status}`);
  }

  let tokenData: { access_token?: string; error?: string; error_description?: string };
  try {
    tokenData = JSON.parse(tokenText);
  } catch (e) {
    console.error('Failed to parse token response:', tokenText);
    return redirectWithError(proxyState, 'Failed to parse GitHub token response');
  }

  if (tokenData.error) {
    console.error('GitHub OAuth error:', tokenData.error, tokenData.error_description);
    return redirectWithError(proxyState, `GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  if (!tokenData.access_token) {
    console.error('No access token in response:', JSON.stringify(tokenData));
    return redirectWithError(proxyState, 'Failed to get access token from GitHub');
  }

  // Get user info
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Accept': 'application/json',
      'User-Agent': 'vStats-OAuth-Proxy',
    },
  });

  const userText = await userResponse.text();
  
  if (!userResponse.ok) {
    console.error('GitHub user fetch failed:', userResponse.status, userText);
    return redirectWithError(proxyState, `Failed to get GitHub user info: ${userResponse.status}`);
  }

  let userData: { login?: string; email?: string };
  try {
    userData = JSON.parse(userText);
  } catch (e) {
    console.error('Failed to parse user response:', userText);
    return redirectWithError(proxyState, 'Failed to parse GitHub user response');
  }

  if (!userData.login) {
    console.error('No login in user data:', userText);
    return redirectWithError(proxyState, 'Failed to get GitHub username');
  }

  // Try to get user's primary email if not public
  let userEmail = userData.email;
  if (!userEmail) {
    try {
      const emailsResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Accept': 'application/json',
          'User-Agent': 'vStats-OAuth-Proxy',
        },
      });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primaryEmail = emails.find(e => e.primary && e.verified);
        if (primaryEmail) {
          userEmail = primaryEmail.email;
        }
      }
    } catch (e) {
      // Ignore email fetch errors - email is optional
      console.warn('Failed to fetch user emails:', e);
    }
  }

  // Redirect back to the original instance with user info
  const callbackUrl = new URL(stateData.redirect_uri);
  callbackUrl.searchParams.set('state', stateData.original_state);
  callbackUrl.searchParams.set('provider', 'github');
  callbackUrl.searchParams.set('user', userData.login);
  if (userEmail) {
    callbackUrl.searchParams.set('email', userEmail);
  }

  return Response.redirect(callbackUrl.toString(), 302);
}

// ============================================================================
// Google OAuth
// ============================================================================

function handleGoogleStart(url: URL, env: Env): Response {
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');

  if (!redirectUri || !state) {
    return new Response('Missing redirect_uri or state parameter', { status: 400 });
  }

  // Validate redirect_uri is a valid URL
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectUri);
  } catch {
    return new Response('Invalid redirect_uri', { status: 400 });
  }

  // Allow HTTP only for localhost/127.0.0.1 (for local development)
  // Production redirect_uris should use HTTPS
  const isLocalhost = redirectUrl.hostname === 'localhost' || 
                      redirectUrl.hostname === '127.0.0.1' ||
                      redirectUrl.hostname.startsWith('192.168.') ||
                      redirectUrl.hostname.startsWith('10.') ||
                      redirectUrl.hostname.endsWith('.local');
  
  if (redirectUrl.protocol !== 'https:' && redirectUrl.protocol !== 'http:') {
    return new Response('redirect_uri must use http or https protocol', { status: 400 });
  }

  if (redirectUrl.protocol === 'http:' && !isLocalhost) {
    return new Response('redirect_uri must use https protocol for non-localhost addresses', { status: 400 });
  }

  // Store the original redirect_uri in state (base64 encoded)
  const proxyState = btoa(JSON.stringify({
    redirect_uri: redirectUri,
    original_state: state,
    provider: 'google'
  }));

  // Use the same protocol as the incoming request for callback URL
  // This allows HTTP for local development (localhost)
  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set('redirect_uri', `${url.origin}/oauth/google/callback`);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', proxyState);
  googleAuthUrl.searchParams.set('access_type', 'offline');

  return Response.redirect(googleAuthUrl.toString(), 302);
}

async function handleGoogleCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  const proxyState = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return redirectWithError(proxyState, `Google OAuth error: ${error}`);
  }

  if (!code || !proxyState) {
    return new Response('Missing code or state', { status: 400 });
  }

  // Decode the proxy state
  let stateData: { redirect_uri: string; original_state: string; provider: string };
  try {
    stateData = JSON.parse(atob(proxyState));
  } catch {
    return new Response('Invalid state parameter', { status: 400 });
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: code,
      redirect_uri: `${url.origin}/oauth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };

  if (!tokenData.access_token) {
    return redirectWithError(proxyState, `Failed to get access token: ${tokenData.error || 'unknown error'}`);
  }

  // Get user info
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
    },
  });

  const userData = await userResponse.json() as { email?: string; name?: string };

  if (!userData.email) {
    return redirectWithError(proxyState, 'Failed to get user info');
  }

  // Redirect back to the original instance with user info
  const callbackUrl = new URL(stateData.redirect_uri);
  callbackUrl.searchParams.set('state', stateData.original_state);
  callbackUrl.searchParams.set('provider', 'google');
  callbackUrl.searchParams.set('user', userData.email);

  return Response.redirect(callbackUrl.toString(), 302);
}

// ============================================================================
// Helpers
// ============================================================================

function redirectWithError(proxyState: string | null, errorMessage: string): Response {
  if (!proxyState) {
    return new Response(errorMessage, { status: 400 });
  }

  try {
    const stateData = JSON.parse(atob(proxyState)) as { redirect_uri: string; original_state: string };
    const callbackUrl = new URL(stateData.redirect_uri);
    callbackUrl.searchParams.set('state', stateData.original_state);
    callbackUrl.searchParams.set('error', errorMessage);
    return Response.redirect(callbackUrl.toString(), 302);
  } catch {
    return new Response(errorMessage, { status: 400 });
  }
}

