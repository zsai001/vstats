package database

import (
	"context"
	"time"

	"vstats/internal/cloud/models"

	"github.com/google/uuid"
)

// ============================================================================
// User Operations
// ============================================================================

// CreateUser creates a new user
func CreateUser(ctx context.Context, user *models.User) error {
	user.ID = uuid.New().String()
	user.CreatedAt = time.Now()
	user.UpdatedAt = time.Now()

	_, err := pool.Exec(ctx, `
		INSERT INTO users (id, username, email, email_verified, avatar_url, plan, server_limit, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, user.ID, user.Username, user.Email, user.EmailVerified, user.AvatarURL,
		user.Plan, user.ServerLimit, user.Status, user.Metadata, user.CreatedAt, user.UpdatedAt)

	return err
}

// GetUserByID retrieves a user by ID
func GetUserByID(ctx context.Context, id string) (*models.User, error) {
	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, username, email, email_verified, avatar_url, plan, server_limit, status, metadata, created_at, updated_at, last_login_at
		FROM users WHERE id = $1 AND status != 'deleted'
	`, id).Scan(
		&user.ID, &user.Username, &user.Email, &user.EmailVerified, &user.AvatarURL,
		&user.Plan, &user.ServerLimit, &user.Status, &user.Metadata, &user.CreatedAt, &user.UpdatedAt, &user.LastLoginAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// GetUserByEmail retrieves a user by email
func GetUserByEmail(ctx context.Context, email string) (*models.User, error) {
	var user models.User
	err := pool.QueryRow(ctx, `
		SELECT id, username, email, email_verified, avatar_url, plan, server_limit, status, metadata, created_at, updated_at, last_login_at
		FROM users WHERE email = $1 AND status != 'deleted'
	`, email).Scan(
		&user.ID, &user.Username, &user.Email, &user.EmailVerified, &user.AvatarURL,
		&user.Plan, &user.ServerLimit, &user.Status, &user.Metadata, &user.CreatedAt, &user.UpdatedAt, &user.LastLoginAt,
	)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// UpdateUserLastLogin updates the last login time
func UpdateUserLastLogin(ctx context.Context, userID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2
	`, time.Now(), userID)
	return err
}

// ============================================================================
// OAuth Provider Operations
// ============================================================================

// GetOAuthProvider retrieves OAuth provider by provider and provider_user_id
func GetOAuthProvider(ctx context.Context, provider, providerUserID string) (*models.OAuthProvider, error) {
	var op models.OAuthProvider
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, provider, provider_user_id, provider_username, provider_email, provider_avatar_url, raw_data, created_at, updated_at
		FROM oauth_providers WHERE provider = $1 AND provider_user_id = $2
	`, provider, providerUserID).Scan(
		&op.ID, &op.UserID, &op.Provider, &op.ProviderUserID, &op.ProviderUsername,
		&op.ProviderEmail, &op.ProviderAvatar, &op.RawData, &op.CreatedAt, &op.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &op, nil
}

// CreateOAuthProvider creates a new OAuth provider link
func CreateOAuthProvider(ctx context.Context, op *models.OAuthProvider) error {
	op.ID = uuid.New().String()
	op.CreatedAt = time.Now()
	op.UpdatedAt = time.Now()

	_, err := pool.Exec(ctx, `
		INSERT INTO oauth_providers (id, user_id, provider, provider_user_id, provider_username, provider_email, provider_avatar_url, raw_data, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, op.ID, op.UserID, op.Provider, op.ProviderUserID, op.ProviderUsername,
		op.ProviderEmail, op.ProviderAvatar, op.RawData, op.CreatedAt, op.UpdatedAt)

	return err
}

// UpdateOAuthProvider updates OAuth provider info
func UpdateOAuthProvider(ctx context.Context, op *models.OAuthProvider) error {
	op.UpdatedAt = time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE oauth_providers 
		SET provider_username = $1, provider_email = $2, provider_avatar_url = $3, raw_data = $4, updated_at = $5
		WHERE id = $6
	`, op.ProviderUsername, op.ProviderEmail, op.ProviderAvatar, op.RawData, op.UpdatedAt, op.ID)
	return err
}

// FindOrCreateUserByOAuth finds or creates a user based on OAuth info
func FindOrCreateUserByOAuth(ctx context.Context, provider, providerUserID, username string, email, avatarURL *string, rawData []byte) (*models.User, error) {
	// Check if OAuth provider exists
	op, err := GetOAuthProvider(ctx, provider, providerUserID)
	if err == nil {
		// Provider exists, update info and return user
		op.ProviderUsername = &username
		op.ProviderEmail = email
		op.ProviderAvatar = avatarURL
		op.RawData = rawData
		UpdateOAuthProvider(ctx, op)

		user, err := GetUserByID(ctx, op.UserID)
		if err != nil {
			return nil, err
		}
		UpdateUserLastLogin(ctx, user.ID)
		return user, nil
	}

	// Create new user
	user := &models.User{
		Username:      username,
		Email:         email,
		EmailVerified: email != nil,
		AvatarURL:     avatarURL,
		Plan:          "free",
		ServerLimit:   models.GetServerLimit("free"),
		Status:        "active",
		Metadata:      []byte("{}"),
	}

	if err := CreateUser(ctx, user); err != nil {
		return nil, err
	}

	// Create OAuth provider link
	op = &models.OAuthProvider{
		UserID:           user.ID,
		Provider:         provider,
		ProviderUserID:   providerUserID,
		ProviderUsername: &username,
		ProviderEmail:    email,
		ProviderAvatar:   avatarURL,
		RawData:          rawData,
	}

	if err := CreateOAuthProvider(ctx, op); err != nil {
		return nil, err
	}

	return user, nil
}
