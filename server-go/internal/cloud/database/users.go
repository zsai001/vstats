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
// Admin User Management Operations
// ============================================================================

// UserWithStats represents a user with additional statistics
type UserWithStats struct {
	models.User
	ServerCount   int    `json:"server_count"`
	OAuthProvider string `json:"oauth_provider,omitempty"`
}

// ListAllUsers retrieves all users with pagination (admin only)
func ListAllUsers(ctx context.Context, limit, offset int, search string) ([]UserWithStats, int, error) {
	// Count total users
	var total int
	countQuery := `SELECT COUNT(*) FROM users WHERE status != 'deleted'`
	var countArgs []interface{}

	if search != "" {
		countQuery += ` AND (username ILIKE $1 OR email ILIKE $1)`
		countArgs = append(countArgs, "%"+search+"%")
	}

	err := pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	// Get users with server count
	var query string
	var args []interface{}

	if search != "" {
		query = `
			SELECT 
				u.id, u.username, u.email, u.email_verified, u.avatar_url, 
				u.plan, u.server_limit, u.status, u.metadata, 
				u.created_at, u.updated_at, u.last_login_at,
				COALESCE((SELECT COUNT(*) FROM servers s WHERE s.user_id = u.id AND s.deleted_at IS NULL), 0) as server_count,
				COALESCE((SELECT provider FROM oauth_providers op WHERE op.user_id = u.id LIMIT 1), '') as oauth_provider
			FROM users u
			WHERE u.status != 'deleted' AND (u.username ILIKE $1 OR u.email ILIKE $1)
			ORDER BY u.created_at DESC LIMIT $2 OFFSET $3
		`
		args = []interface{}{"%" + search + "%", limit, offset}
	} else {
		query = `
			SELECT 
				u.id, u.username, u.email, u.email_verified, u.avatar_url, 
				u.plan, u.server_limit, u.status, u.metadata, 
				u.created_at, u.updated_at, u.last_login_at,
				COALESCE((SELECT COUNT(*) FROM servers s WHERE s.user_id = u.id AND s.deleted_at IS NULL), 0) as server_count,
				COALESCE((SELECT provider FROM oauth_providers op WHERE op.user_id = u.id LIMIT 1), '') as oauth_provider
			FROM users u
			WHERE u.status != 'deleted'
			ORDER BY u.created_at DESC LIMIT $1 OFFSET $2
		`
		args = []interface{}{limit, offset}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []UserWithStats
	for rows.Next() {
		var u UserWithStats
		err := rows.Scan(
			&u.ID, &u.Username, &u.Email, &u.EmailVerified, &u.AvatarURL,
			&u.Plan, &u.ServerLimit, &u.Status, &u.Metadata,
			&u.CreatedAt, &u.UpdatedAt, &u.LastLoginAt,
			&u.ServerCount, &u.OAuthProvider,
		)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, u)
	}

	return users, total, nil
}

// UpdateUserPlan updates a user's plan (admin only)
func UpdateUserPlan(ctx context.Context, userID, plan string) error {
	serverLimit := models.GetServerLimit(plan)
	_, err := pool.Exec(ctx, `
		UPDATE users SET plan = $1, server_limit = $2, updated_at = $3 WHERE id = $4
	`, plan, serverLimit, time.Now(), userID)
	return err
}

// UpdateUserStatus updates a user's status (admin only)
func UpdateUserStatus(ctx context.Context, userID, status string) error {
	_, err := pool.Exec(ctx, `
		UPDATE users SET status = $1, updated_at = $2 WHERE id = $3
	`, status, time.Now(), userID)
	return err
}

// DeleteUser soft-deletes a user (admin only)
func DeleteUser(ctx context.Context, userID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE users SET status = 'deleted', updated_at = $1 WHERE id = $2
	`, time.Now(), userID)
	return err
}

// GetUserStats returns overall user statistics (admin only)
func GetUserStats(ctx context.Context) (map[string]interface{}, error) {
	stats := make(map[string]interface{})

	// Total users
	var totalUsers, activeUsers, suspendedUsers int
	err := pool.QueryRow(ctx, `
		SELECT 
			COUNT(*) FILTER (WHERE status != 'deleted'),
			COUNT(*) FILTER (WHERE status = 'active'),
			COUNT(*) FILTER (WHERE status = 'suspended')
		FROM users
	`).Scan(&totalUsers, &activeUsers, &suspendedUsers)
	if err != nil {
		return nil, err
	}

	stats["total_users"] = totalUsers
	stats["active_users"] = activeUsers
	stats["suspended_users"] = suspendedUsers

	// Users by plan
	var freeUsers, proUsers, enterpriseUsers int
	err = pool.QueryRow(ctx, `
		SELECT 
			COUNT(*) FILTER (WHERE plan = 'free' AND status = 'active'),
			COUNT(*) FILTER (WHERE plan = 'pro' AND status = 'active'),
			COUNT(*) FILTER (WHERE plan = 'enterprise' AND status = 'active')
		FROM users
	`).Scan(&freeUsers, &proUsers, &enterpriseUsers)
	if err != nil {
		return nil, err
	}

	stats["free_users"] = freeUsers
	stats["pro_users"] = proUsers
	stats["enterprise_users"] = enterpriseUsers

	// New users today
	var newToday int
	err = pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM users 
		WHERE created_at::DATE = CURRENT_DATE AND status != 'deleted'
	`).Scan(&newToday)
	if err != nil {
		return nil, err
	}
	stats["new_today"] = newToday

	// Total servers
	var totalServers, onlineServers int
	err = pool.QueryRow(ctx, `
		SELECT 
			COUNT(*) FILTER (WHERE deleted_at IS NULL),
			COUNT(*) FILTER (WHERE status = 'online' AND deleted_at IS NULL)
		FROM servers
	`).Scan(&totalServers, &onlineServers)
	if err != nil {
		return nil, err
	}

	stats["total_servers"] = totalServers
	stats["online_servers"] = onlineServers

	return stats, nil
}

// ============================================================================
// OAuth Provider Operations
// ============================================================================

// FindUserByProviderUsername finds user by OAuth provider and username
func FindUserByProviderUsername(ctx context.Context, provider, username string) (*models.User, error) {
	var userID string
	err := pool.QueryRow(ctx, `
		SELECT user_id FROM oauth_providers 
		WHERE provider = $1 AND provider_username = $2
	`, provider, username).Scan(&userID)
	if err != nil {
		return nil, err
	}
	return GetUserByID(ctx, userID)
}

// FindUserByProviderEmail finds user by OAuth provider and email
func FindUserByProviderEmail(ctx context.Context, provider, email string) (*models.User, error) {
	var userID string
	err := pool.QueryRow(ctx, `
		SELECT user_id FROM oauth_providers 
		WHERE provider = $1 AND provider_email = $2
	`, provider, email).Scan(&userID)
	if err != nil {
		return nil, err
	}
	return GetUserByID(ctx, userID)
}

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
