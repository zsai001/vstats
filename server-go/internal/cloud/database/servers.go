package database

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"time"

	"vstats/internal/cloud/models"

	"github.com/google/uuid"
)

// ============================================================================
// Server Operations
// ============================================================================

// GenerateAgentKey generates a unique agent key
func GenerateAgentKey() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// CreateServer creates a new server
func CreateServer(ctx context.Context, server *models.Server) error {
	server.ID = uuid.New().String()
	server.AgentKey = GenerateAgentKey()
	server.Status = "offline"
	server.CreatedAt = time.Now()
	server.UpdatedAt = time.Now()

	_, err := pool.Exec(ctx, `
		INSERT INTO servers (id, user_id, name, hostname, ip_address, agent_key, agent_version, os_type, os_version, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, server.ID, server.UserID, server.Name, server.Hostname, server.IPAddress,
		server.AgentKey, server.AgentVersion, server.OSType, server.OSVersion,
		server.Status, server.Metadata, server.CreatedAt, server.UpdatedAt)

	return err
}

// GetServerByID retrieves a server by ID
func GetServerByID(ctx context.Context, id string) (*models.Server, error) {
	var server models.Server
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, name, hostname, ip_address, agent_key, agent_version, os_type, os_version, status, last_seen_at, metadata, created_at, updated_at
		FROM servers WHERE id = $1 AND deleted_at IS NULL
	`, id).Scan(
		&server.ID, &server.UserID, &server.Name, &server.Hostname, &server.IPAddress,
		&server.AgentKey, &server.AgentVersion, &server.OSType, &server.OSVersion,
		&server.Status, &server.LastSeenAt, &server.Metadata, &server.CreatedAt, &server.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &server, nil
}

// GetServerByAgentKey retrieves a server by agent key
func GetServerByAgentKey(ctx context.Context, agentKey string) (*models.Server, error) {
	var server models.Server
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, name, hostname, ip_address, agent_key, agent_version, os_type, os_version, status, last_seen_at, metadata, created_at, updated_at
		FROM servers WHERE agent_key = $1 AND deleted_at IS NULL
	`, agentKey).Scan(
		&server.ID, &server.UserID, &server.Name, &server.Hostname, &server.IPAddress,
		&server.AgentKey, &server.AgentVersion, &server.OSType, &server.OSVersion,
		&server.Status, &server.LastSeenAt, &server.Metadata, &server.CreatedAt, &server.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &server, nil
}

// GetServersByUserID retrieves all servers for a user
func GetServersByUserID(ctx context.Context, userID string) ([]models.Server, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, user_id, name, hostname, ip_address, agent_key, agent_version, os_type, os_version, status, last_seen_at, metadata, created_at, updated_at
		FROM servers WHERE user_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var servers []models.Server
	for rows.Next() {
		var server models.Server
		if err := rows.Scan(
			&server.ID, &server.UserID, &server.Name, &server.Hostname, &server.IPAddress,
			&server.AgentKey, &server.AgentVersion, &server.OSType, &server.OSVersion,
			&server.Status, &server.LastSeenAt, &server.Metadata, &server.CreatedAt, &server.UpdatedAt,
		); err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}

	return servers, nil
}

// UpdateServer updates a server
func UpdateServer(ctx context.Context, server *models.Server) error {
	server.UpdatedAt = time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE servers 
		SET name = $1, hostname = $2, ip_address = $3, agent_version = $4, os_type = $5, os_version = $6, status = $7, metadata = $8, updated_at = $9
		WHERE id = $10
	`, server.Name, server.Hostname, server.IPAddress, server.AgentVersion,
		server.OSType, server.OSVersion, server.Status, server.Metadata, server.UpdatedAt, server.ID)
	return err
}

// UpdateServerStatus updates server status and last_seen_at
func UpdateServerStatus(ctx context.Context, serverID, status string) error {
	now := time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE servers SET status = $1, last_seen_at = $2, updated_at = $2 WHERE id = $3
	`, status, now, serverID)
	return err
}

// DeleteServer soft deletes a server
func DeleteServer(ctx context.Context, serverID string) error {
	now := time.Now()
	_, err := pool.Exec(ctx, `
		UPDATE servers SET deleted_at = $1, updated_at = $1 WHERE id = $2
	`, now, serverID)
	return err
}

// CountServersByUserID counts servers for a user
func CountServersByUserID(ctx context.Context, userID string) (int, error) {
	var count int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM servers WHERE user_id = $1 AND deleted_at IS NULL
	`, userID).Scan(&count)
	return count, err
}

// ============================================================================
// Server Metrics Operations
// ============================================================================

// InsertServerMetrics inserts server metrics
func InsertServerMetrics(ctx context.Context, metrics *models.ServerMetrics) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO server_metrics (
			server_id, collected_at,
			cpu_usage, cpu_cores, load_avg_1, load_avg_5, load_avg_15,
			memory_total, memory_used, memory_free, memory_cached, memory_buffers, swap_total, swap_used,
			disk_total, disk_used, disk_free,
			network_rx_bytes, network_tx_bytes, network_rx_packets, network_tx_packets,
			process_count, raw_data
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
	`, metrics.ServerID, metrics.CollectedAt,
		metrics.CPUUsage, metrics.CPUCores, metrics.LoadAvg1, metrics.LoadAvg5, metrics.LoadAvg15,
		metrics.MemoryTotal, metrics.MemoryUsed, metrics.MemoryFree, metrics.MemoryCached, metrics.MemoryBuffers, metrics.SwapTotal, metrics.SwapUsed,
		metrics.DiskTotal, metrics.DiskUsed, metrics.DiskFree,
		metrics.NetworkRxBytes, metrics.NetworkTxBytes, metrics.NetworkRxPackets, metrics.NetworkTxPackets,
		metrics.ProcessCount, metrics.RawData)
	return err
}

// GetLatestMetrics retrieves the latest metrics for a server
func GetLatestMetrics(ctx context.Context, serverID string) (*models.ServerMetrics, error) {
	var m models.ServerMetrics
	err := pool.QueryRow(ctx, `
		SELECT id, server_id, collected_at,
			cpu_usage, cpu_cores, load_avg_1, load_avg_5, load_avg_15,
			memory_total, memory_used, memory_free, memory_cached, memory_buffers, swap_total, swap_used,
			disk_total, disk_used, disk_free,
			network_rx_bytes, network_tx_bytes, network_rx_packets, network_tx_packets,
			process_count, raw_data
		FROM server_metrics WHERE server_id = $1
		ORDER BY collected_at DESC LIMIT 1
	`, serverID).Scan(
		&m.ID, &m.ServerID, &m.CollectedAt,
		&m.CPUUsage, &m.CPUCores, &m.LoadAvg1, &m.LoadAvg5, &m.LoadAvg15,
		&m.MemoryTotal, &m.MemoryUsed, &m.MemoryFree, &m.MemoryCached, &m.MemoryBuffers, &m.SwapTotal, &m.SwapUsed,
		&m.DiskTotal, &m.DiskUsed, &m.DiskFree,
		&m.NetworkRxBytes, &m.NetworkTxBytes, &m.NetworkRxPackets, &m.NetworkTxPackets,
		&m.ProcessCount, &m.RawData)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// GetMetricsHistory retrieves metrics history for a server
func GetMetricsHistory(ctx context.Context, serverID string, since time.Time, limit int) ([]models.ServerMetrics, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, server_id, collected_at,
			cpu_usage, cpu_cores, load_avg_1, load_avg_5, load_avg_15,
			memory_total, memory_used, memory_free, memory_cached, memory_buffers, swap_total, swap_used,
			disk_total, disk_used, disk_free,
			network_rx_bytes, network_tx_bytes, network_rx_packets, network_tx_packets,
			process_count, raw_data
		FROM server_metrics 
		WHERE server_id = $1 AND collected_at >= $2
		ORDER BY collected_at DESC
		LIMIT $3
	`, serverID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var metrics []models.ServerMetrics
	for rows.Next() {
		var m models.ServerMetrics
		if err := rows.Scan(
			&m.ID, &m.ServerID, &m.CollectedAt,
			&m.CPUUsage, &m.CPUCores, &m.LoadAvg1, &m.LoadAvg5, &m.LoadAvg15,
			&m.MemoryTotal, &m.MemoryUsed, &m.MemoryFree, &m.MemoryCached, &m.MemoryBuffers, &m.SwapTotal, &m.SwapUsed,
			&m.DiskTotal, &m.DiskUsed, &m.DiskFree,
			&m.NetworkRxBytes, &m.NetworkTxBytes, &m.NetworkRxPackets, &m.NetworkTxPackets,
			&m.ProcessCount, &m.RawData,
		); err != nil {
			return nil, err
		}
		metrics = append(metrics, m)
	}

	return metrics, nil
}

// CleanupOldMetrics deletes metrics older than specified days
func CleanupOldMetrics(ctx context.Context, retentionDays int) (int64, error) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	result, err := pool.Exec(ctx, `
		DELETE FROM server_metrics WHERE collected_at < $1
	`, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
