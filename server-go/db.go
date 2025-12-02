package main

import (
	"database/sql"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

func InitDatabase() (*sql.DB, error) {
	db, err := sql.Open("sqlite", GetDBPath())
	if err != nil {
		return nil, err
	}

	// Create tables
	_, err = db.Exec(`
		-- Raw metrics (keep for 24 hours)
		CREATE TABLE IF NOT EXISTS metrics_raw (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			cpu_usage REAL NOT NULL,
			memory_usage REAL NOT NULL,
			disk_usage REAL NOT NULL,
			net_rx INTEGER NOT NULL,
			net_tx INTEGER NOT NULL,
			load_1 REAL NOT NULL,
			load_5 REAL NOT NULL,
			load_15 REAL NOT NULL,
			ping_ms REAL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		);
		
		-- Hourly aggregated metrics (keep for 30 days)
		CREATE TABLE IF NOT EXISTS metrics_hourly (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			hour_start TEXT NOT NULL,
			cpu_avg REAL NOT NULL,
			cpu_max REAL NOT NULL,
			memory_avg REAL NOT NULL,
			memory_max REAL NOT NULL,
			disk_avg REAL NOT NULL,
			net_rx_total INTEGER NOT NULL,
			net_tx_total INTEGER NOT NULL,
			ping_avg REAL,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, hour_start)
		);
		
		-- Daily aggregated metrics (keep forever)
		CREATE TABLE IF NOT EXISTS metrics_daily (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			date TEXT NOT NULL,
			cpu_avg REAL NOT NULL,
			cpu_max REAL NOT NULL,
			memory_avg REAL NOT NULL,
			memory_max REAL NOT NULL,
			disk_avg REAL NOT NULL,
			net_rx_total INTEGER NOT NULL,
			net_tx_total INTEGER NOT NULL,
			uptime_percent REAL NOT NULL,
			ping_avg REAL,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, date)
		);
		
		-- Create indexes
		CREATE INDEX IF NOT EXISTS idx_metrics_raw_server_time ON metrics_raw(server_id, timestamp);
		CREATE INDEX IF NOT EXISTS idx_metrics_hourly_server_time ON metrics_hourly(server_id, hour_start);
		CREATE INDEX IF NOT EXISTS idx_metrics_daily_server_time ON metrics_daily(server_id, date);
		
		-- Ping metrics per target (keep for 24 hours)
		CREATE TABLE IF NOT EXISTS ping_raw (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			timestamp TEXT NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_ms REAL,
			packet_loss REAL NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'ok'
		);
		
		CREATE INDEX IF NOT EXISTS idx_ping_raw_server_time ON ping_raw(server_id, timestamp);
		CREATE INDEX IF NOT EXISTS idx_ping_raw_target ON ping_raw(server_id, target_name, timestamp);
	`)
	if err != nil {
		return nil, err
	}

	// Migration: Add ping_ms column if it doesn't exist
	db.Exec("ALTER TABLE metrics_raw ADD COLUMN ping_ms REAL")
	db.Exec("ALTER TABLE metrics_hourly ADD COLUMN ping_avg REAL")
	db.Exec("ALTER TABLE metrics_daily ADD COLUMN ping_avg REAL")

	return db, nil
}

func StoreMetrics(db *sql.DB, serverID string, metrics *SystemMetrics) error {
	var diskUsage float32 = 0
	if len(metrics.Disks) > 0 {
		diskUsage = metrics.Disks[0].UsagePercent
	}

	timestamp := metrics.Timestamp.Format(time.RFC3339)

	// Get average ping latency from all targets
	var pingMs *float64
	if metrics.Ping != nil && len(metrics.Ping.Targets) > 0 {
		var sum float64
		var count int
		for _, t := range metrics.Ping.Targets {
			if t.LatencyMs != nil {
				sum += *t.LatencyMs
				count++
			}
		}
		if count > 0 {
			avg := sum / float64(count)
			pingMs = &avg
		}
	}

	_, err := db.Exec(`
		INSERT INTO metrics_raw (server_id, timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, load_1, load_5, load_15, ping_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		serverID,
		timestamp,
		metrics.CPU.Usage,
		metrics.Memory.UsagePercent,
		diskUsage,
		metrics.Network.TotalRx,
		metrics.Network.TotalTx,
		metrics.LoadAverage.One,
		metrics.LoadAverage.Five,
		metrics.LoadAverage.Fifteen,
		pingMs,
	)
	if err != nil {
		return err
	}

	// Store individual ping targets
	if metrics.Ping != nil {
		for _, target := range metrics.Ping.Targets {
			_, err := db.Exec(`
				INSERT INTO ping_raw (server_id, timestamp, target_name, target_host, latency_ms, packet_loss, status)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
				serverID,
				timestamp,
				target.Name,
				target.Host,
				target.LatencyMs,
				target.PacketLoss,
				target.Status,
			)
			if err != nil {
				fmt.Printf("Failed to store ping target: %v\n", err)
			}
		}
	}

	return nil
}

func AggregateHourly(db *sql.DB) error {
	hourAgo := time.Now().UTC().Add(-time.Hour)
	hourStart := hourAgo.Format("2006-01-02T15:00:00Z")

	_, err := db.Exec(`
		INSERT OR REPLACE INTO metrics_hourly (server_id, hour_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, net_rx_total, net_tx_total, sample_count)
		SELECT 
			server_id,
			strftime('%Y-%m-%dT%H:00:00Z', timestamp) as hour,
			AVG(cpu_usage),
			MAX(cpu_usage),
			AVG(memory_usage),
			MAX(memory_usage),
			AVG(disk_usage),
			MAX(net_rx) - MIN(net_rx),
			MAX(net_tx) - MIN(net_tx),
			COUNT(*)
		FROM metrics_raw
		WHERE timestamp >= ? AND timestamp < datetime(?, '+1 hour')
		GROUP BY server_id, hour`, hourStart, hourStart)
	return err
}

func AggregateDaily(db *sql.DB) error {
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")

	_, err := db.Exec(`
		INSERT OR REPLACE INTO metrics_daily (server_id, date, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, net_rx_total, net_tx_total, uptime_percent, sample_count)
		SELECT 
			server_id,
			date(hour_start) as day,
			AVG(cpu_avg),
			MAX(cpu_max),
			AVG(memory_avg),
			MAX(memory_max),
			AVG(disk_avg),
			SUM(net_rx_total),
			SUM(net_tx_total),
			(COUNT(*) * 100.0 / 24.0),
			SUM(sample_count)
		FROM metrics_hourly
		WHERE date(hour_start) = ?
		GROUP BY server_id, day`, yesterday)
	return err
}

func CleanupOldData(db *sql.DB) error {
	// Delete raw data older than 24 hours
	cutoffRaw := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_raw WHERE timestamp < ?", cutoffRaw); err != nil {
		return err
	}

	// Delete ping raw data older than 24 hours
	if _, err := db.Exec("DELETE FROM ping_raw WHERE timestamp < ?", cutoffRaw); err != nil {
		return err
	}

	// Delete hourly data older than 30 days
	cutoffHourly := time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_hourly WHERE hour_start < ?", cutoffHourly); err != nil {
		return err
	}

	return nil
}

func GetHistory(db *sql.DB, serverID, rangeStr string) ([]HistoryPoint, error) {
	var data []HistoryPoint
	var rows *sql.Rows
	var err error

	switch rangeStr {
	case "1h":
		cutoff := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, ping_ms
			FROM metrics_raw WHERE server_id = ? AND timestamp >= ?
			ORDER BY timestamp ASC`, serverID, cutoff)

	case "24h":
		cutoff := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, ping_ms
			FROM metrics_raw WHERE server_id = ? AND timestamp >= ?
			AND (CAST(strftime('%s', timestamp) AS INTEGER) % 300) < 60
			ORDER BY timestamp ASC`, serverID, cutoff)

	case "7d":
		cutoff := time.Now().UTC().AddDate(0, 0, -7).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT hour_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
			FROM metrics_hourly WHERE server_id = ? AND hour_start >= ?
			ORDER BY hour_start ASC`, serverID, cutoff)

	case "30d", "1y":
		var days int
		if rangeStr == "30d" {
			days = -30
		} else {
			days = -365
		}
		cutoff := time.Now().UTC().AddDate(0, 0, days).Format("2006-01-02")
		rows, err = db.Query(`
			SELECT date, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
			FROM metrics_daily WHERE server_id = ? AND date >= ?
			ORDER BY date ASC`, serverID, cutoff)

	default:
		cutoff := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, ping_ms
			FROM metrics_raw WHERE server_id = ? AND timestamp >= ?
			ORDER BY timestamp ASC`, serverID, cutoff)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var point HistoryPoint
		err := rows.Scan(&point.Timestamp, &point.CPU, &point.Memory, &point.Disk, &point.NetRx, &point.NetTx, &point.PingMs)
		if err != nil {
			continue
		}
		data = append(data, point)
	}

	return data, nil
}

func GetPingHistory(db *sql.DB, serverID, rangeStr string) ([]PingHistoryTarget, error) {
	var cutoff string
	if rangeStr == "1h" {
		cutoff = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	} else {
		cutoff = time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	}

	query := `
		SELECT target_name, target_host, timestamp, latency_ms, status
		FROM ping_raw 
		WHERE server_id = ? AND timestamp >= ?
		ORDER BY target_name, timestamp ASC`

	if rangeStr == "24h" {
		query = `
			SELECT target_name, target_host, timestamp, latency_ms, status
			FROM ping_raw 
			WHERE server_id = ? AND timestamp >= ?
			AND (CAST(strftime('%s', timestamp) AS INTEGER) % 300) < 60
			ORDER BY target_name, timestamp ASC`
	}

	rows, err := db.Query(query, serverID, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	targetsMap := make(map[string]*PingHistoryTarget)
	for rows.Next() {
		var name, host, timestamp, status string
		var latencyMs *float64

		if err := rows.Scan(&name, &host, &timestamp, &latencyMs, &status); err != nil {
			continue
		}

		if _, exists := targetsMap[name]; !exists {
			targetsMap[name] = &PingHistoryTarget{
				Name: name,
				Host: host,
				Data: []PingHistoryPoint{},
			}
		}

		targetsMap[name].Data = append(targetsMap[name].Data, PingHistoryPoint{
			Timestamp: timestamp,
			LatencyMs: latencyMs,
			Status:    status,
		})
	}

	var targets []PingHistoryTarget
	for _, t := range targetsMap {
		targets = append(targets, *t)
	}

	return targets, nil
}

