package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"vstats/internal/cloud/config"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

var (
	ErrInvalidToken  = errors.New("invalid token")
	ErrExpiredToken  = errors.New("token expired")
	ErrInvalidClaims = errors.New("invalid token claims")
)

// Claims represents JWT claims
type Claims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email,omitempty"`
	Plan     string `json:"plan"`
	jwt.RegisteredClaims
}

// GenerateToken generates a JWT token
func GenerateToken(userID, username, email, plan string) (string, time.Time, error) {
	cfg := config.Get()
	expiresAt := time.Now().Add(cfg.JWTExpiry)

	claims := &Claims{
		UserID:   userID,
		Username: username,
		Email:    email,
		Plan:     plan,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
			Issuer:    "vstats-cloud",
			Subject:   userID,
			ID:        uuid.New().String(),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(cfg.JWTSecret))
	if err != nil {
		return "", time.Time{}, err
	}

	return tokenString, expiresAt, nil
}

// ValidateToken validates a JWT token and returns claims
func ValidateToken(tokenString string) (*Claims, error) {
	cfg := config.Get()

	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(cfg.JWTSecret), nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidClaims
	}

	return claims, nil
}

// HashToken creates SHA256 hash of a token (for session storage)
func HashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

// GenerateSessionToken generates a random session token
func GenerateSessionToken() string {
	return uuid.New().String() + "-" + uuid.New().String()
}

// GenerateAPIKey generates a new API key
func GenerateAPIKey() (key string, prefix string, hash string) {
	key = "vst_" + uuid.New().String() + uuid.New().String()
	prefix = key[:12]
	hash = HashToken(key)
	return
}
