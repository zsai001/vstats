package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// OAuth state storage (in-memory, should use Redis in production)
var (
	oauthStates   = make(map[string]*OAuthStateData)
	oauthStatesMu sync.RWMutex
)

const CentralizedOAuthURL = "https://vstats-oauth-proxy.zsai001.workers.dev"

// ============================================================================
// OAuth 2.0 Handlers
// ============================================================================

// GetOAuthProviders returns available OAuth providers (public)
func (s *AppState) GetOAuthProviders(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()

	providers := make(map[string]bool)
	centralized := false

	if s.Config.OAuth != nil {
		// Check centralized OAuth first
		if s.Config.OAuth.UseCentralized {
			centralized = true
			providers["github"] = true
			providers["google"] = true
		} else {
			// Self-hosted OAuth
			if s.Config.OAuth.GitHub != nil && s.Config.OAuth.GitHub.Enabled && s.Config.OAuth.GitHub.ClientID != "" {
				providers["github"] = true
			}
			if s.Config.OAuth.Google != nil && s.Config.OAuth.Google.Enabled && s.Config.OAuth.Google.ClientID != "" {
				providers["google"] = true
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"providers":   providers,
		"centralized": centralized,
	})
}

// GetOAuthSettings returns OAuth configuration (admin only)
func (s *AppState) GetOAuthSettings(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()

	// Return safe version without secrets
	response := gin.H{
		"use_centralized": false,
		"allowed_users":   []string{},
	}

	if s.Config.OAuth != nil {
		response["use_centralized"] = s.Config.OAuth.UseCentralized
		response["allowed_users"] = s.Config.OAuth.AllowedUsers

		if s.Config.OAuth.GitHub != nil {
			response["github"] = gin.H{
				"enabled":       s.Config.OAuth.GitHub.Enabled,
				"client_id":     s.Config.OAuth.GitHub.ClientID,
				"has_secret":    s.Config.OAuth.GitHub.ClientSecret != "",
				"allowed_users": s.Config.OAuth.GitHub.AllowedUsers,
			}
		}
		if s.Config.OAuth.Google != nil {
			response["google"] = gin.H{
				"enabled":       s.Config.OAuth.Google.Enabled,
				"client_id":     s.Config.OAuth.Google.ClientID,
				"has_secret":    s.Config.OAuth.Google.ClientSecret != "",
				"allowed_users": s.Config.OAuth.Google.AllowedUsers,
			}
		}
	}

	c.JSON(http.StatusOK, response)
}

// UpdateOAuthSettings updates OAuth configuration
func (s *AppState) UpdateOAuthSettings(c *gin.Context) {
	var req struct {
		UseCentralized *bool    `json:"use_centralized,omitempty"`
		AllowedUsers   []string `json:"allowed_users,omitempty"`
		GitHub         *struct {
			Enabled      bool     `json:"enabled"`
			ClientID     string   `json:"client_id"`
			ClientSecret string   `json:"client_secret,omitempty"`
			AllowedUsers []string `json:"allowed_users"`
		} `json:"github,omitempty"`
		Google *struct {
			Enabled      bool     `json:"enabled"`
			ClientID     string   `json:"client_id"`
			ClientSecret string   `json:"client_secret,omitempty"`
			AllowedUsers []string `json:"allowed_users"`
		} `json:"google,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	if s.Config.OAuth == nil {
		s.Config.OAuth = &OAuthConfig{}
	}

	// Update centralized OAuth settings
	if req.UseCentralized != nil {
		s.Config.OAuth.UseCentralized = *req.UseCentralized
	}
	if req.AllowedUsers != nil {
		s.Config.OAuth.AllowedUsers = req.AllowedUsers
	}

	// Update self-hosted OAuth settings
	if req.GitHub != nil {
		if s.Config.OAuth.GitHub == nil {
			s.Config.OAuth.GitHub = &OAuthProvider{}
		}
		s.Config.OAuth.GitHub.Enabled = req.GitHub.Enabled
		s.Config.OAuth.GitHub.ClientID = req.GitHub.ClientID
		if req.GitHub.ClientSecret != "" {
			s.Config.OAuth.GitHub.ClientSecret = req.GitHub.ClientSecret
		}
		s.Config.OAuth.GitHub.AllowedUsers = req.GitHub.AllowedUsers
	}

	if req.Google != nil {
		if s.Config.OAuth.Google == nil {
			s.Config.OAuth.Google = &OAuthProvider{}
		}
		s.Config.OAuth.Google.Enabled = req.Google.Enabled
		s.Config.OAuth.Google.ClientID = req.Google.ClientID
		if req.Google.ClientSecret != "" {
			s.Config.OAuth.Google.ClientSecret = req.Google.ClientSecret
		}
		s.Config.OAuth.Google.AllowedUsers = req.Google.AllowedUsers
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, gin.H{"status": "updated"})
}

// GitHub OAuth handlers
func (s *AppState) GitHubOAuthStart(c *gin.Context) {
	s.ConfigMu.RLock()
	oauth := s.Config.OAuth
	s.ConfigMu.RUnlock()

	if oauth == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OAuth not configured"})
		return
	}

	state := uuid.New().String()

	oauthStatesMu.Lock()
	oauthStates[state] = &OAuthStateData{
		Provider:  "github",
		State:     state,
		CreatedAt: time.Now().Unix(),
	}
	oauthStatesMu.Unlock()

	// Clean up old states (older than 10 minutes)
	go cleanupOAuthStates()

	var authURL string

	if oauth.UseCentralized {
		// Use centralized OAuth proxy
		callbackURL := getCallbackURL(c, "proxy")
		authURL = fmt.Sprintf(
			"%s/oauth/github?redirect_uri=%s&state=%s",
			CentralizedOAuthURL,
			url.QueryEscape(callbackURL),
			state,
		)
	} else {
		// Self-hosted OAuth
		if oauth.GitHub == nil || !oauth.GitHub.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "GitHub OAuth not configured"})
			return
		}
		authURL = fmt.Sprintf(
			"https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=read:user user:email&state=%s",
			oauth.GitHub.ClientID,
			url.QueryEscape(getCallbackURL(c, "github")),
			state,
		)
	}

	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

func (s *AppState) GitHubOAuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		redirectWithError(c, "Missing code or state parameter")
		return
	}

	// Verify state
	oauthStatesMu.Lock()
	stateData, exists := oauthStates[state]
	if exists {
		delete(oauthStates, state)
	}
	oauthStatesMu.Unlock()

	if !exists || stateData.Provider != "github" {
		redirectWithError(c, "Invalid state parameter")
		return
	}

	s.ConfigMu.RLock()
	oauth := s.Config.OAuth
	s.ConfigMu.RUnlock()

	if oauth == nil || oauth.GitHub == nil {
		redirectWithError(c, "GitHub OAuth not configured")
		return
	}

	// Exchange code for token
	tokenResp, err := exchangeGitHubCode(code, oauth.GitHub.ClientID, oauth.GitHub.ClientSecret, getCallbackURL(c, "github"))
	if err != nil {
		redirectWithError(c, "Failed to exchange code: "+err.Error())
		return
	}

	// Get user info
	user, err := getGitHubUser(tokenResp.AccessToken)
	if err != nil {
		redirectWithError(c, "Failed to get user info: "+err.Error())
		return
	}

	// Check if user is allowed
	if !isUserAllowed(oauth.GitHub.AllowedUsers, user.Login) {
		redirectWithError(c, "User not authorized: "+user.Login)
		return
	}

	// Generate JWT token
	token, expiresAt, err := generateJWTToken(user.Login, "github")
	if err != nil {
		redirectWithError(c, "Failed to generate token")
		return
	}

	// Redirect to frontend with token
	redirectWithToken(c, token, expiresAt, "github", user.Login)
}

// Google OAuth handlers
func (s *AppState) GoogleOAuthStart(c *gin.Context) {
	s.ConfigMu.RLock()
	oauth := s.Config.OAuth
	s.ConfigMu.RUnlock()

	if oauth == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OAuth not configured"})
		return
	}

	state := uuid.New().String()

	oauthStatesMu.Lock()
	oauthStates[state] = &OAuthStateData{
		Provider:  "google",
		State:     state,
		CreatedAt: time.Now().Unix(),
	}
	oauthStatesMu.Unlock()

	go cleanupOAuthStates()

	var authURL string

	if oauth.UseCentralized {
		// Use centralized OAuth proxy
		callbackURL := getCallbackURL(c, "proxy")
		authURL = fmt.Sprintf(
			"%s/oauth/google?redirect_uri=%s&state=%s",
			CentralizedOAuthURL,
			url.QueryEscape(callbackURL),
			state,
		)
	} else {
		// Self-hosted OAuth
		if oauth.Google == nil || !oauth.Google.Enabled {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Google OAuth not configured"})
			return
		}
		authURL = fmt.Sprintf(
			"https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=openid email profile&state=%s&access_type=offline",
			oauth.Google.ClientID,
			url.QueryEscape(getCallbackURL(c, "google")),
			state,
		)
	}

	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

func (s *AppState) GoogleOAuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		redirectWithError(c, "Missing code or state parameter")
		return
	}

	// Verify state
	oauthStatesMu.Lock()
	stateData, exists := oauthStates[state]
	if exists {
		delete(oauthStates, state)
	}
	oauthStatesMu.Unlock()

	if !exists || stateData.Provider != "google" {
		redirectWithError(c, "Invalid state parameter")
		return
	}

	s.ConfigMu.RLock()
	oauth := s.Config.OAuth
	s.ConfigMu.RUnlock()

	if oauth == nil || oauth.Google == nil {
		redirectWithError(c, "Google OAuth not configured")
		return
	}

	// Exchange code for token
	tokenResp, err := exchangeGoogleCode(code, oauth.Google.ClientID, oauth.Google.ClientSecret, getCallbackURL(c, "google"))
	if err != nil {
		redirectWithError(c, "Failed to exchange code: "+err.Error())
		return
	}

	// Get user info
	user, err := getGoogleUser(tokenResp.AccessToken)
	if err != nil {
		redirectWithError(c, "Failed to get user info: "+err.Error())
		return
	}

	// Check if user is allowed
	if !isUserAllowed(oauth.Google.AllowedUsers, user.Email) {
		redirectWithError(c, "User not authorized: "+user.Email)
		return
	}

	// Generate JWT token
	token, expiresAt, err := generateJWTToken(user.Email, "google")
	if err != nil {
		redirectWithError(c, "Failed to generate token")
		return
	}

	// Redirect to frontend with token
	redirectWithToken(c, token, expiresAt, "google", user.Email)
}

// ProxyOAuthCallback handles OAuth callback from centralized OAuth proxy (vstats.zsoft.cc)
func (s *AppState) ProxyOAuthCallback(c *gin.Context) {
	state := c.Query("state")
	provider := c.Query("provider")
	user := c.Query("user")
	errorMsg := c.Query("error")

	// If there's an error from the proxy
	if errorMsg != "" {
		redirectWithError(c, errorMsg)
		return
	}

	if state == "" || provider == "" || user == "" {
		redirectWithError(c, "Missing required parameters")
		return
	}

	// Verify state
	oauthStatesMu.Lock()
	stateData, exists := oauthStates[state]
	if exists {
		delete(oauthStates, state)
	}
	oauthStatesMu.Unlock()

	if !exists {
		redirectWithError(c, "Invalid or expired state parameter")
		return
	}

	// Verify the provider matches what we initiated
	expectedProvider := stateData.Provider
	if provider != expectedProvider {
		redirectWithError(c, "Provider mismatch")
		return
	}

	// Check if user is allowed
	s.ConfigMu.RLock()
	oauth := s.Config.OAuth
	s.ConfigMu.RUnlock()

	if oauth == nil {
		redirectWithError(c, "OAuth not configured")
		return
	}

	// Check allowed users (from centralized config)
	if !isUserAllowed(oauth.AllowedUsers, user) {
		redirectWithError(c, "User not authorized: "+user)
		return
	}

	// Generate JWT token
	token, expiresAt, err := generateJWTToken(user, provider)
	if err != nil {
		redirectWithError(c, "Failed to generate token")
		return
	}

	// Redirect to frontend with token
	redirectWithToken(c, token, expiresAt, provider, user)
}

// ============================================================================
// OAuth Helper Functions
// ============================================================================

func getCallbackURL(c *gin.Context, provider string) string {
	protocol := "https"

	// Priority: X-Forwarded-Proto header > TLS detection > localhost fallback
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		// Trust the X-Forwarded-Proto header from nginx
		protocol = proto
	} else if c.Request.TLS != nil {
		// Direct TLS connection
		protocol = "https"
	} else if strings.Contains(c.Request.Host, "localhost") || strings.HasPrefix(c.Request.Host, "127.") {
		// Localhost fallback
		protocol = "http"
	}

	return fmt.Sprintf("%s://%s/api/auth/oauth/%s/callback", protocol, c.Request.Host, provider)
}

func exchangeGitHubCode(code, clientID, clientSecret, redirectURI string) (*GitHubTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)

	req, _ := http.NewRequest("POST", "https://github.com/login/oauth/access_token", strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var tokenResp GitHubTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("no access token in response")
	}

	return &tokenResp, nil
}

func getGitHubUser(accessToken string) (*GitHubUser, error) {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var user GitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	return &user, nil
}

func exchangeGoogleCode(code, clientID, clientSecret, redirectURI string) (*GoogleTokenResponse, error) {
	data := url.Values{}
	data.Set("client_id", clientID)
	data.Set("client_secret", clientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	req, _ := http.NewRequest("POST", "https://oauth2.googleapis.com/token", strings.NewReader(data.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var tokenResp GoogleTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("no access token in response")
	}

	return &tokenResp, nil
}

func getGoogleUser(accessToken string) (*GoogleUserInfo, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var user GoogleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}

	return &user, nil
}

func isUserAllowed(allowedUsers []string, identifier string) bool {
	// If no allowed users specified, deny all users
	if len(allowedUsers) == 0 {
		return false
	}

	for _, u := range allowedUsers {
		if strings.EqualFold(u, identifier) {
			return true
		}
	}
	return false
}

func generateJWTToken(sub, provider string) (string, time.Time, error) {
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":      sub,
		"provider": provider,
		"exp":      expiresAt.Unix(),
	})

	tokenString, err := token.SignedString([]byte(GetJWTSecret()))
	if err != nil {
		return "", time.Time{}, err
	}

	return tokenString, expiresAt, nil
}

func redirectWithToken(c *gin.Context, token string, expiresAt time.Time, provider, username string) {
	// Redirect to frontend OAuth callback page
	redirectURL := fmt.Sprintf("/oauth-callback?token=%s&expires=%d&provider=%s&user=%s",
		url.QueryEscape(token),
		expiresAt.Unix(),
		provider,
		url.QueryEscape(username),
	)
	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

func redirectWithError(c *gin.Context, message string) {
	redirectURL := fmt.Sprintf("/oauth-callback?error=%s", url.QueryEscape(message))
	c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

func cleanupOAuthStates() {
	oauthStatesMu.Lock()
	defer oauthStatesMu.Unlock()

	now := time.Now().Unix()
	for state, data := range oauthStates {
		// Remove states older than 10 minutes
		if now-data.CreatedAt > 600 {
			delete(oauthStates, state)
		}
	}
}
