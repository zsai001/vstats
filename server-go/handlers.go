package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// OAuth state storage (in-memory, should use Redis in production)
var (
	oauthStates   = make(map[string]*OAuthStateData)
	oauthStatesMu sync.RWMutex
)

// ServerVersion is defined in main.go and set at build time

// ============================================================================
// Auth Handlers
// ============================================================================

func (s *AppState) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.RLock()
	passwordHash := s.Config.AdminPasswordHash
	s.ConfigMu.RUnlock()

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		// If password verification fails, try reloading config from disk
		// This handles the case where password was reset while server is running
		if newConfig, _ := LoadConfig(); newConfig != nil {
			s.ConfigMu.Lock()
			oldHash := s.Config.AdminPasswordHash
			s.Config.AdminPasswordHash = newConfig.AdminPasswordHash
			s.ConfigMu.Unlock()
			
			// Try again with reloaded password hash
			if err := bcrypt.CompareHashAndPassword([]byte(newConfig.AdminPasswordHash), []byte(req.Password)); err != nil {
				// Still failed, restore old hash and return error
				s.ConfigMu.Lock()
				s.Config.AdminPasswordHash = oldHash
				s.ConfigMu.Unlock()
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid password"})
				return
			}
			// Success after reload, continue with login
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid password"})
			return
		}
	}

	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "admin",
		"exp": expiresAt.Unix(),
	})

	tokenString, err := token.SignedString([]byte(GetJWTSecret()))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		Token:     tokenString,
		ExpiresAt: expiresAt,
	})
}

func (s *AppState) VerifyToken(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "valid"})
}

func (s *AppState) ChangePassword(c *gin.Context) {
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	if err := bcrypt.CompareHashAndPassword([]byte(s.Config.AdminPasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid current password"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	s.Config.AdminPasswordHash = string(hash)
	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}

// ============================================================================
// OAuth 2.0 Handlers
// ============================================================================

const CentralizedOAuthURL = "https://vstats-oauth-proxy.zsai001.workers.dev"

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

// OAuth helper functions
func getCallbackURL(c *gin.Context, provider string) string {
	protocol := "https"
	if c.Request.TLS == nil {
		// Check X-Forwarded-Proto header
		if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
			protocol = proto
		} else if strings.Contains(c.Request.Host, "localhost") || strings.HasPrefix(c.Request.Host, "127.") {
			protocol = "http"
		}
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

// ============================================================================
// Site Settings Handlers
// ============================================================================

func (s *AppState) GetSiteSettings(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.SiteSettings)
}

func (s *AppState) UpdateSiteSettings(c *gin.Context) {
	var settings SiteSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.SiteSettings = settings
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.Status(http.StatusOK)
}

// ============================================================================
// Local Node Configuration Handlers
// ============================================================================

func (s *AppState) GetLocalNodeConfig(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.LocalNode)
}

func (s *AppState) UpdateLocalNodeConfig(c *gin.Context) {
	var config LocalNodeConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.LocalNode = config
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, config)
}

// ============================================================================
// Probe Settings Handlers
// ============================================================================

func (s *AppState) GetProbeSettings(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.ProbeSettings)
}

func (s *AppState) UpdateProbeSettings(c *gin.Context) {
	var settings ProbeSettings
	if err := c.ShouldBindJSON(&settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	s.Config.ProbeSettings = settings
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	// Update local collector's ping targets
	localCollector := GetLocalCollector()
	localCollector.SetPingTargets(settings.PingTargets)

	c.Status(http.StatusOK)
}

// ============================================================================
// Server Management Handlers
// ============================================================================

func (s *AppState) GetServers(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.Servers)
}

func (s *AppState) AddServer(c *gin.Context) {
	var req AddServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	server := RemoteServer{
		ID:           uuid.New().String(),
		Name:         req.Name,
		URL:          req.URL,
		Location:     req.Location,
		Provider:     req.Provider,
		Tag:          req.Tag,
		Token:        uuid.New().String(),
		GroupID:      req.GroupID,
		GroupValues:  req.GroupValues,
		PriceAmount:  req.PriceAmount,
		PricePeriod:  req.PricePeriod,
		PurchaseDate: req.PurchaseDate,
		TipBadge:     req.TipBadge,
	}

	s.ConfigMu.Lock()
	s.Config.Servers = append(s.Config.Servers, server)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, server)
}

func (s *AppState) DeleteServer(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	servers := make([]RemoteServer, 0)
	for _, srv := range s.Config.Servers {
		if srv.ID != id {
			servers = append(servers, srv)
		}
	}
	s.Config.Servers = servers
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	s.AgentMetricsMu.Lock()
	delete(s.AgentMetrics, id)
	s.AgentMetricsMu.Unlock()

	c.Status(http.StatusOK)
}

func (s *AppState) UpdateServer(c *gin.Context) {
	id := c.Param("id")

	var req UpdateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *RemoteServer
	for i := range s.Config.Servers {
		if s.Config.Servers[i].ID == id {
			if req.Name != nil {
				s.Config.Servers[i].Name = *req.Name
			}
			if req.Location != nil {
				s.Config.Servers[i].Location = *req.Location
			}
			if req.Provider != nil {
				s.Config.Servers[i].Provider = *req.Provider
			}
			if req.Tag != nil {
				s.Config.Servers[i].Tag = *req.Tag
			}
			if req.GroupID != nil {
				s.Config.Servers[i].GroupID = *req.GroupID
			}
			if req.GroupValues != nil {
				s.Config.Servers[i].GroupValues = *req.GroupValues
			}
			if req.PriceAmount != nil {
				s.Config.Servers[i].PriceAmount = *req.PriceAmount
			}
			if req.PricePeriod != nil {
				s.Config.Servers[i].PricePeriod = *req.PricePeriod
			}
			if req.PurchaseDate != nil {
				s.Config.Servers[i].PurchaseDate = *req.PurchaseDate
			}
			if req.TipBadge != nil {
				s.Config.Servers[i].TipBadge = *req.TipBadge
			}
			updated = &s.Config.Servers[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

// ============================================================================
// Group Management Handlers
// ============================================================================

func (s *AppState) GetGroups(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	
	groups := s.Config.Groups
	if groups == nil {
		groups = []ServerGroup{}
	}
	c.JSON(http.StatusOK, groups)
}

func (s *AppState) AddGroup(c *gin.Context) {
	var req AddGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	group := ServerGroup{
		ID:        uuid.New().String(),
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}

	s.ConfigMu.Lock()
	if s.Config.Groups == nil {
		s.Config.Groups = []ServerGroup{}
	}
	s.Config.Groups = append(s.Config.Groups, group)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, group)
}

func (s *AppState) UpdateGroup(c *gin.Context) {
	id := c.Param("id")

	var req UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *ServerGroup
	for i := range s.Config.Groups {
		if s.Config.Groups[i].ID == id {
			if req.Name != nil {
				s.Config.Groups[i].Name = *req.Name
			}
			if req.SortOrder != nil {
				s.Config.Groups[i].SortOrder = *req.SortOrder
			}
			updated = &s.Config.Groups[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteGroup(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	
	// Remove group
	groups := make([]ServerGroup, 0)
	for _, g := range s.Config.Groups {
		if g.ID != id {
			groups = append(groups, g)
		}
	}
	s.Config.Groups = groups
	
	// Clear group_id from servers that had this group
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupID == id {
			s.Config.Servers[i].GroupID = ""
		}
	}
	
	// Clear group_id from local node if it had this group
	if s.Config.LocalNode.GroupID == id {
		s.Config.LocalNode.GroupID = ""
	}
	
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.Status(http.StatusOK)
}

// ============================================================================
// Dimension Management Handlers
// ============================================================================

func (s *AppState) GetDimensions(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	
	dimensions := s.Config.GroupDimensions
	if dimensions == nil {
		dimensions = []GroupDimension{}
	}
	c.JSON(http.StatusOK, dimensions)
}

func (s *AppState) AddDimension(c *gin.Context) {
	var req AddDimensionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	// Check if key already exists
	for _, d := range s.Config.GroupDimensions {
		if d.Key == req.Key {
			c.JSON(http.StatusConflict, gin.H{"error": "Dimension key already exists"})
			return
		}
	}

	dimension := GroupDimension{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Key:       req.Key,
		Enabled:   req.Enabled,
		SortOrder: req.SortOrder,
		Options:   []GroupOption{},
	}

	if s.Config.GroupDimensions == nil {
		s.Config.GroupDimensions = []GroupDimension{}
	}
	s.Config.GroupDimensions = append(s.Config.GroupDimensions, dimension)
	SaveConfig(s.Config)

	c.JSON(http.StatusOK, dimension)
}

func (s *AppState) UpdateDimension(c *gin.Context) {
	id := c.Param("id")

	var req UpdateDimensionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *GroupDimension
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == id {
			if req.Name != nil {
				s.Config.GroupDimensions[i].Name = *req.Name
			}
			if req.Enabled != nil {
				s.Config.GroupDimensions[i].Enabled = *req.Enabled
			}
			if req.SortOrder != nil {
				s.Config.GroupDimensions[i].SortOrder = *req.SortOrder
			}
			updated = &s.Config.GroupDimensions[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dimension not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteDimension(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	// Remove dimension
	dimensions := make([]GroupDimension, 0)
	for _, d := range s.Config.GroupDimensions {
		if d.ID != id {
			dimensions = append(dimensions, d)
		}
	}
	s.Config.GroupDimensions = dimensions

	// Clear group values from servers
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupValues != nil {
			delete(s.Config.Servers[i].GroupValues, id)
		}
	}

	// Clear from local node
	if s.Config.LocalNode.GroupValues != nil {
		delete(s.Config.LocalNode.GroupValues, id)
	}

	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}

// ============================================================================
// Dimension Option Handlers
// ============================================================================

func (s *AppState) AddOption(c *gin.Context) {
	dimID := c.Param("id")

	var req AddOptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var dimension *GroupDimension
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			dimension = &s.Config.GroupDimensions[i]
			break
		}
	}

	if dimension == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dimension not found"})
		return
	}

	option := GroupOption{
		ID:        uuid.New().String(),
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}

	dimension.Options = append(dimension.Options, option)
	SaveConfig(s.Config)

	c.JSON(http.StatusOK, option)
}

func (s *AppState) UpdateOption(c *gin.Context) {
	dimID := c.Param("id")
	optID := c.Param("option_id")

	var req UpdateOptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *GroupOption
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			for j := range s.Config.GroupDimensions[i].Options {
				if s.Config.GroupDimensions[i].Options[j].ID == optID {
					if req.Name != nil {
						s.Config.GroupDimensions[i].Options[j].Name = *req.Name
					}
					if req.SortOrder != nil {
						s.Config.GroupDimensions[i].Options[j].SortOrder = *req.SortOrder
					}
					updated = &s.Config.GroupDimensions[i].Options[j]
					break
				}
			}
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Option not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteOption(c *gin.Context) {
	dimID := c.Param("id")
	optID := c.Param("option_id")

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	found := false
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			options := make([]GroupOption, 0)
			for _, o := range s.Config.GroupDimensions[i].Options {
				if o.ID != optID {
					options = append(options, o)
				} else {
					found = true
				}
			}
			s.Config.GroupDimensions[i].Options = options
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Option not found"})
		return
	}

	// Clear this option from servers
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupValues != nil {
			for k, v := range s.Config.Servers[i].GroupValues {
				if v == optID {
					delete(s.Config.Servers[i].GroupValues, k)
				}
			}
		}
	}

	// Clear from local node
	if s.Config.LocalNode.GroupValues != nil {
		for k, v := range s.Config.LocalNode.GroupValues {
			if v == optID {
				delete(s.Config.LocalNode.GroupValues, k)
			}
		}
	}

	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}

// ============================================================================
// Agent Registration Handler
// ============================================================================

func (s *AppState) RegisterAgent(c *gin.Context) {
	var req AgentRegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	serverID := uuid.New().String()
	agentToken := uuid.New().String()

	server := RemoteServer{
		ID:       serverID,
		Name:     req.Name,
		Location: req.Location,
		Provider: req.Provider,
		Token:    agentToken,
	}

	s.ConfigMu.Lock()
	s.Config.Servers = append(s.Config.Servers, server)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, AgentRegisterResponse{
		ID:    serverID,
		Token: agentToken,
	})
}

// ============================================================================
// History Handler
// ============================================================================

func (s *AppState) GetHistory(c *gin.Context, db *sql.DB) {
	serverID := c.Param("server_id")
	rangeStr := c.DefaultQuery("range", "24h")

	data, err := GetHistory(db, serverID, rangeStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch history"})
		return
	}

	var pingTargets []PingHistoryTarget
	if rangeStr == "1h" || rangeStr == "24h" {
		pingTargets, _ = GetPingHistory(db, serverID, rangeStr)
	}

	c.JSON(http.StatusOK, HistoryResponse{
		ServerID:    serverID,
		Range:       rangeStr,
		Data:        data,
		PingTargets: pingTargets,
	})
}

// ============================================================================
// Metrics Handlers
// ============================================================================

type LocalMetricsResponse struct {
	SystemMetrics
	LocalNode LocalNodeConfig `json:"local_node"`
}

func (s *AppState) GetMetrics(c *gin.Context) {
	metrics := CollectMetrics()

	s.ConfigMu.RLock()
	localNode := s.Config.LocalNode
	s.ConfigMu.RUnlock()

	c.JSON(http.StatusOK, LocalMetricsResponse{
		SystemMetrics: metrics,
		LocalNode:     localNode,
	})
}

func (s *AppState) GetAllMetrics(c *gin.Context) {
	s.ConfigMu.RLock()
	servers := s.Config.Servers
	s.ConfigMu.RUnlock()

	s.AgentMetricsMu.RLock()
	defer s.AgentMetricsMu.RUnlock()

	var updates []ServerMetricsUpdate
	for _, server := range servers {
		metricsData := s.AgentMetrics[server.ID]
		online := false
		if metricsData != nil {
			online = time.Since(metricsData.LastUpdated).Seconds() < 30
		}

		version := server.Version
		if metricsData != nil && metricsData.Metrics.Version != "" {
			version = metricsData.Metrics.Version
		}

		var metrics *SystemMetrics
		if metricsData != nil {
			metrics = &metricsData.Metrics
		}

		updates = append(updates, ServerMetricsUpdate{
			ServerID:     server.ID,
			ServerName:   server.Name,
			Location:     server.Location,
			Provider:     server.Provider,
			Tag:          server.Tag,
			GroupID:      server.GroupID,
			Version:      version,
			IP:           server.IP,
			Online:       online,
			Metrics:      metrics,
			PriceAmount:  server.PriceAmount,
			PricePeriod:  server.PricePeriod,
			PurchaseDate: server.PurchaseDate,
			TipBadge:     server.TipBadge,
		})
	}

	c.JSON(http.StatusOK, updates)
}

// ============================================================================
// Installation Script Handler
// ============================================================================

func (s *AppState) GetAgentScript(c *gin.Context) {
	// Try to read from web directory first (production)
	webDir := getWebDir()
	if webDir != "" {
		scriptPath := webDir + "/agent.sh"
		if data, err := os.ReadFile(scriptPath); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}
	
	// Fallback: try relative paths (development)
	paths := []string{
		"./web/dist/agent.sh",
		"./web/public/agent.sh",
		"../web/dist/agent.sh",
		"../web/public/agent.sh",
	}
	
	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}
	
	// Last resort: return error
	c.JSON(http.StatusNotFound, gin.H{"error": "Agent script not found"})
}

func (s *AppState) GetAgentPowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent.ps1")
}

func (s *AppState) GetAgentUpgradePowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent-upgrade.ps1")
}

func (s *AppState) GetAgentUninstallPowerShellScript(c *gin.Context) {
	s.servePowerShellScript(c, "agent-uninstall.ps1")
}

func (s *AppState) servePowerShellScript(c *gin.Context, filename string) {
	// Try to read from web directory first (production)
	webDir := getWebDir()
	if webDir != "" {
		scriptPath := webDir + "/" + filename
		if data, err := os.ReadFile(scriptPath); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Fallback: try relative paths (development)
	paths := []string{
		"./web/dist/" + filename,
		"./web/public/" + filename,
		"../web/dist/" + filename,
		"../web/public/" + filename,
	}

	for _, path := range paths {
		if data, err := os.ReadFile(path); err == nil {
			c.Header("Content-Type", "text/plain; charset=utf-8")
			c.String(http.StatusOK, string(data))
			return
		}
	}

	// Last resort: return error
	c.JSON(http.StatusNotFound, gin.H{"error": "PowerShell script not found: " + filename})
}

func (s *AppState) GetInstallCommand(c *gin.Context) {
	host := c.Request.Host
	protocol := "https"
	if host == "localhost" || host[:4] == "127." || host[:10] == "localhost:" {
		protocol = "http"
	}
	baseURL := fmt.Sprintf("%s://%s", protocol, host)

	authHeader := c.GetHeader("Authorization")
	token := ""
	if len(authHeader) > 7 {
		token = authHeader[7:]
	}

	command := fmt.Sprintf(
		`curl -fsSL %s/agent.sh | sudo bash -s -- --server %s --token "%s" --name "$(hostname)"`,
		baseURL, baseURL, token,
	)

	c.JSON(http.StatusOK, InstallCommand{
		Command:   command,
		ScriptURL: fmt.Sprintf("%s/agent.sh", baseURL),
	})
}

// ============================================================================
// Update Agent Handler
// ============================================================================

func (s *AppState) UpdateAgent(c *gin.Context) {
	serverID := c.Param("id")

	var req UpdateAgentRequest
	c.ShouldBindJSON(&req)

	s.AgentConnsMu.RLock()
	conn := s.AgentConns[serverID]
	s.AgentConnsMu.RUnlock()

	if conn == nil {
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: false,
			Message: "Agent is not connected",
		})
		return
	}

	cmd := AgentCommand{
		Type:        "command",
		Command:     "update",
		DownloadURL: req.DownloadURL,
	}

	data, _ := json.Marshal(cmd)
	select {
	case conn.SendChan <- data:
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: true,
			Message: "Update command sent to agent",
		})
	default:
		c.JSON(http.StatusOK, UpdateAgentResponse{
			Success: false,
			Message: "Failed to send update command",
		})
	}
}

// ============================================================================
// Health Check
// ============================================================================

func HealthCheck(c *gin.Context) {
	c.String(http.StatusOK, "OK")
}

// ============================================================================
// Online Users Handler
// ============================================================================

type OnlineUsersResponse struct {
	Count int `json:"count"`
}

func (s *AppState) GetOnlineUsers(c *gin.Context) {
	count := s.GetOnlineUsersCount()
	c.JSON(http.StatusOK, OnlineUsersResponse{Count: count})
}

// ============================================================================
// Version Check Handlers
// ============================================================================

type ServerVersionInfo struct {
	Version string `json:"version"`
}

func GetServerVersion(c *gin.Context) {
	c.JSON(http.StatusOK, ServerVersionInfo{Version: ServerVersion})
}

func CheckLatestVersion(c *gin.Context) {
	latest, err := fetchLatestGitHubVersion("zsai001", "vstats")
	updateAvailable := false
	if err == nil && latest != nil && *latest != ServerVersion {
		updateAvailable = true
	}

	c.JSON(http.StatusOK, VersionInfo{
		Current:         ServerVersion,
		Latest:          latest,
		UpdateAvailable: updateAvailable,
	})
}

// ============================================================================
// Server Upgrade Handler
// ============================================================================

type UpgradeServerRequest struct {
	Force bool `json:"force"`
}

type UpgradeServerResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Output  string `json:"output,omitempty"`
}

func UpgradeServer(c *gin.Context) {
	var req UpgradeServerRequest
	c.ShouldBindJSON(&req)
	
	// Build upgrade command with optional --force flag
	upgradeCmd := "curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- --upgrade"
	if req.Force {
		upgradeCmd = "curl -fsSL https://vstats.zsoft.cc/install.sh | sudo bash -s -- --upgrade --force"
	}
	
	// Execute upgrade command
	cmd := exec.Command("bash", "-c", upgradeCmd)

	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		c.JSON(http.StatusOK, UpgradeServerResponse{
			Success: false,
			Message: fmt.Sprintf("Upgrade failed: %v", err),
			Output:  outputStr,
		})
		return
	}

	c.JSON(http.StatusOK, UpgradeServerResponse{
		Success: true,
		Message: "Upgrade command executed successfully",
		Output:  outputStr,
	})
}

func fetchLatestGitHubVersion(owner, repo string) (*string, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)

	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "vstats-server")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API returned status: %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	tagName, ok := result["tag_name"].(string)
	if !ok {
		return nil, fmt.Errorf("no tag_name in response")
	}

	// Remove 'v' prefix if present
	if len(tagName) > 0 && tagName[0] == 'v' {
		tagName = tagName[1:]
	}

	return &tagName, nil
}
