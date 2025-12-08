package main

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

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
