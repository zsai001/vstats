package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"vstats/internal/cloud/auth"
	"vstats/internal/cloud/config"
	"vstats/internal/cloud/models"
	"vstats/internal/cloud/database"
	"vstats/internal/cloud/middleware"
	"vstats/internal/cloud/redis"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ============================================================================
// OAuth Handlers
// ============================================================================

// GetOAuthProviders returns available OAuth providers
func GetOAuthProviders(c *gin.Context) {
	cfg := config.Get()

	providers := make(map[string]bool)
	if cfg.GitHubClientID != "" {
		providers["github"] = true
	}
	if cfg.GoogleClientID != "" {
		providers["google"] = true
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

// GitHubOAuthStart initiates GitHub OAuth flow
func GitHubOAuthStart(c *gin.Context) {
	cfg := config.Get()
	if cfg.GitHubClientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "GitHub OAuth not configured"})
		return
	}

	state := uuid.New().String()
	redirectURI := getOAuthCallbackURL(c, "github")

	// Store state in Redis
	ctx := context.Background()
	stateData := &redis.OAuthStateData{
		Provider:    "github",
		RedirectURL: sanitizeRedirectURL(c.Query("redirect_uri")),
		CreatedAt:   time.Now().Unix(),
	}
	if err := redis.SetOAuthState(ctx, state, stateData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store OAuth state"})
		return
	}

	authURL := auth.GetGitHubAuthURL(state, redirectURI)
	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

// GitHubOAuthCallback handles GitHub OAuth callback
func GitHubOAuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		redirectWithError(c, "Missing code or state parameter")
		return
	}

	ctx := context.Background()

	// Verify state
	stateData, err := redis.GetOAuthState(ctx, state)
	if err != nil || stateData.Provider != "github" {
		redirectWithError(c, "Invalid or expired state")
		return
	}

	// Exchange code for token
	redirectURI := getOAuthCallbackURL(c, "github")
	tokenResp, err := auth.ExchangeGitHubCode(ctx, code, redirectURI)
	if err != nil {
		redirectWithError(c, "Failed to exchange code: "+err.Error())
		return
	}

	// Get user info
	githubUser, err := auth.GetGitHubUser(ctx, tokenResp.AccessToken)
	if err != nil {
		redirectWithError(c, "Failed to get user info: "+err.Error())
		return
	}

	// Find or create user
	rawData, _ := json.Marshal(githubUser)
	var email *string
	if githubUser.Email != "" {
		email = &githubUser.Email
	}
	var avatar *string
	if githubUser.AvatarURL != "" {
		avatar = &githubUser.AvatarURL
	}

	user, err := database.FindOrCreateUserByOAuth(ctx, "github", fmt.Sprintf("%d", githubUser.ID), githubUser.Login, email, avatar, rawData)
	if err != nil {
		redirectWithError(c, "Failed to create user: "+err.Error())
		return
	}

	// Generate JWT token
	emailStr := ""
	if user.Email != nil {
		emailStr = *user.Email
	}
	token, expiresAt, err := auth.GenerateToken(user.ID, user.Username, emailStr, user.Plan)
	if err != nil {
		redirectWithError(c, "Failed to generate token")
		return
	}

	// Redirect to frontend
	redirectWithToken(c, token, expiresAt, "github", user.Username, stateData.RedirectURL)
}

// GoogleOAuthStart initiates Google OAuth flow
func GoogleOAuthStart(c *gin.Context) {
	cfg := config.Get()
	if cfg.GoogleClientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Google OAuth not configured"})
		return
	}

	state := uuid.New().String()
	redirectURI := getOAuthCallbackURL(c, "google")

	ctx := context.Background()
	stateData := &redis.OAuthStateData{
		Provider:    "google",
		RedirectURL: sanitizeRedirectURL(c.Query("redirect_uri")),
		CreatedAt:   time.Now().Unix(),
	}
	if err := redis.SetOAuthState(ctx, state, stateData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store OAuth state"})
		return
	}

	authURL := auth.GetGoogleAuthURL(state, redirectURI)
	c.JSON(http.StatusOK, gin.H{"url": authURL})
}

// GoogleOAuthCallback handles Google OAuth callback
func GoogleOAuthCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")

	if code == "" || state == "" {
		redirectWithError(c, "Missing code or state parameter")
		return
	}

	ctx := context.Background()

	stateData, err := redis.GetOAuthState(ctx, state)
	if err != nil || stateData.Provider != "google" {
		redirectWithError(c, "Invalid or expired state")
		return
	}

	redirectURI := getOAuthCallbackURL(c, "google")
	tokenResp, err := auth.ExchangeGoogleCode(ctx, code, redirectURI)
	if err != nil {
		redirectWithError(c, "Failed to exchange code: "+err.Error())
		return
	}

	googleUser, err := auth.GetGoogleUser(ctx, tokenResp.AccessToken)
	if err != nil {
		redirectWithError(c, "Failed to get user info: "+err.Error())
		return
	}

	rawData, _ := json.Marshal(googleUser)
	var email *string
	if googleUser.Email != "" {
		email = &googleUser.Email
	}
	var avatar *string
	if googleUser.Picture != "" {
		avatar = &googleUser.Picture
	}

	// Use email as username for Google
	username := googleUser.Name
	if username == "" {
		username = googleUser.Email
	}

	user, err := database.FindOrCreateUserByOAuth(ctx, "google", googleUser.ID, username, email, avatar, rawData)
	if err != nil {
		redirectWithError(c, "Failed to create user: "+err.Error())
		return
	}

	emailStr := ""
	if user.Email != nil {
		emailStr = *user.Email
	}
	token, expiresAt, err := auth.GenerateToken(user.ID, user.Username, emailStr, user.Plan)
	if err != nil {
		redirectWithError(c, "Failed to generate token")
		return
	}

	redirectWithToken(c, token, expiresAt, "google", user.Username, stateData.RedirectURL)
}

// ExchangeToken exchanges OAuth user info for JWT token
// This is used when OAuth is handled by external proxy (like Cloudflare Worker)
func ExchangeToken(c *gin.Context) {
	var req struct {
		Provider string `json:"provider" binding:"required"`
		Username string `json:"username" binding:"required"`
		Email    string `json:"email"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	ctx := context.Background()

	var user *models.User
	var err error

	// For Google, oauth-proxy returns email as user, so try to find by email first
	if req.Provider == "google" && req.Email != "" {
		user, err = database.GetUserByEmail(ctx, req.Email)
	}

	// If not found by email, try by provider username
	if user == nil {
		user, err = database.FindUserByProviderUsername(ctx, req.Provider, req.Username)
	}

	// Also try finding by email in oauth request
	if user == nil && req.Email != "" {
		user, err = database.FindUserByProviderEmail(ctx, req.Provider, req.Email)
	}

	if err != nil || user == nil {
		// Try to find existing user by email
		if req.Email != "" {
			user, _ = database.GetUserByEmail(ctx, req.Email)
		}

		if user != nil {
			// User exists but no OAuth provider link - create one
			providerUserID := req.Username
			if req.Provider == "google" && req.Email != "" {
				providerUserID = req.Email
			}
			var email *string
			if req.Email != "" {
				email = &req.Email
			}
			op := &models.OAuthProvider{
				UserID:           user.ID,
				Provider:         req.Provider,
				ProviderUserID:   providerUserID,
				ProviderUsername: &req.Username,
				ProviderEmail:    email,
			}
			database.CreateOAuthProvider(ctx, op)
		} else {
			// Create new user
			var email *string
			if req.Email != "" {
				email = &req.Email
			}
			// Use email as provider_user_id for Google since that's what we get from proxy
			providerUserID := req.Username
			if req.Provider == "google" && req.Email != "" {
				providerUserID = req.Email
			}
			user, err = database.FindOrCreateUserByOAuth(ctx, req.Provider, providerUserID, req.Username, email, nil, nil)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user: " + err.Error()})
				return
			}
		}
	}

	// Update last login
	database.UpdateUserLastLogin(ctx, user.ID)

	// Generate JWT token
	emailStr := ""
	if user.Email != nil {
		emailStr = *user.Email
	}
	token, expiresAt, err := auth.GenerateToken(user.ID, user.Username, emailStr, user.Plan)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_at": expiresAt.Unix(),
		"user_id":    user.ID,
		"username":   user.Username,
		"plan":       user.Plan,
	})
}

// VerifyToken verifies the current token
func VerifyToken(c *gin.Context) {
	userID := middleware.GetUserID(c)
	username := middleware.GetUsername(c)

	ctx := context.Background()
	user, err := database.GetUserByID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"valid":    true,
		"user_id":  userID,
		"username": username,
		"plan":     user.Plan,
	})
}

// GetCurrentUser returns current user info
func GetCurrentUser(c *gin.Context) {
	userID := middleware.GetUserID(c)

	ctx := context.Background()
	user, err := database.GetUserByID(ctx, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	serverCount, _ := database.CountServersByUserID(ctx, userID)

	c.JSON(http.StatusOK, gin.H{
		"user":         user,
		"server_count": serverCount,
		"server_limit": user.ServerLimit,
	})
}

// Logout invalidates the current session
func Logout(c *gin.Context) {
	// With JWT, logout is handled client-side by removing the token
	// Optionally add token to blacklist in Redis
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}

// ============================================================================
// Helper Functions
// ============================================================================

func getOAuthCallbackURL(c *gin.Context, provider string) string {
	cfg := config.Get()
	return fmt.Sprintf("%s/api/auth/oauth/%s/callback", cfg.AppURL, provider)
}

func redirectWithToken(c *gin.Context, token string, expiresAt time.Time, provider, username, customRedirect string) {
	redirectURL := "/oauth-callback"
	if safeRedirect := sanitizeRedirectURL(customRedirect); safeRedirect != "" {
		redirectURL = safeRedirect
	}

	params := url.Values{}
	params.Set("token", token)
	params.Set("expires", fmt.Sprintf("%d", expiresAt.Unix()))
	params.Set("provider", provider)
	params.Set("user", username)

	separator := "?"
	if strings.Contains(redirectURL, "?") {
		separator = "&"
	}

	c.Redirect(http.StatusTemporaryRedirect, redirectURL+separator+params.Encode())
}

func redirectWithError(c *gin.Context, message string) {
	params := url.Values{}
	params.Set("error", message)
	c.Redirect(http.StatusTemporaryRedirect, "/oauth-callback?"+params.Encode())
}

func sanitizeRedirectURL(raw string) string {
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}

	if parsed.IsAbs() {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return ""
		}
		return parsed.String()
	}

	// Disallow protocol-relative redirects and other unsafe patterns
	if strings.HasPrefix(raw, "//") {
		return ""
	}

	if strings.HasPrefix(raw, "/") {
		return raw
	}

	return ""
}
