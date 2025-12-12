package main

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// DBWriter serializes all database write operations through a channel
type DBWriter struct {
	db       *sql.DB
	writeCh  chan writeJob
	done     chan struct{}
	wg       sync.WaitGroup
}

type writeJob struct {
	fn     func(*sql.DB) error
	result chan error // nil for fire-and-forget
}

// Global DBWriter instance
var dbWriter *DBWriter

// NewDBWriter creates a new database writer with a buffered channel
func NewDBWriter(db *sql.DB, bufferSize int) *DBWriter {
	w := &DBWriter{
		db:      db,
		writeCh: make(chan writeJob, bufferSize),
		done:    make(chan struct{}),
	}
	w.wg.Add(1)
	go w.processWrites()
	return w
}

// processWrites handles all write operations sequentially
func (w *DBWriter) processWrites() {
	defer w.wg.Done()
	for {
		select {
		case job := <-w.writeCh:
			err := job.fn(w.db)
			if job.result != nil {
				job.result <- err
			} else if err != nil {
				fmt.Printf("Database write error: %v\n", err)
			}
		case <-w.done:
			// Drain remaining jobs before exiting
			for {
				select {
				case job := <-w.writeCh:
					err := job.fn(w.db)
					if job.result != nil {
						job.result <- err
					}
				default:
					return
				}
			}
		}
	}
}

// WriteAsync queues a write operation (fire-and-forget)
func (w *DBWriter) WriteAsync(fn func(*sql.DB) error) {
	select {
	case w.writeCh <- writeJob{fn: fn, result: nil}:
	default:
		fmt.Println("Warning: write queue full, dropping write")
	}
}

// WriteSync queues a write operation and waits for result
func (w *DBWriter) WriteSync(fn func(*sql.DB) error) error {
	result := make(chan error, 1)
	w.writeCh <- writeJob{fn: fn, result: result}
	return <-result
}

// Close stops the writer and waits for pending writes
func (w *DBWriter) Close() {
	close(w.done)
	w.wg.Wait()
}

// GetDB returns the underlying database for read operations
func (w *DBWriter) GetDB() *sql.DB {
	return w.db
}

func InitDatabase() (*sql.DB, error) {
	// Open database with busy_timeout as fallback
	db, err := sql.Open("sqlite", GetDBPath()+"?_busy_timeout=5000")
	if err != nil {
		return nil, err
	}

	// Enable WAL mode for better concurrent read access
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		fmt.Printf("Warning: Failed to enable WAL mode: %v\n", err)
	}

	// Set synchronous to NORMAL for better performance while still being safe
	if _, err := db.Exec("PRAGMA synchronous=NORMAL"); err != nil {
		fmt.Printf("Warning: Failed to set synchronous mode: %v\n", err)
	}

	// Create tables
	_, err = db.Exec(`
		-- Raw metrics (keep for 24 hours)
		-- Note: bucket_5min column added via migration for existing databases
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
		
		-- 15-minute aggregated metrics (keep for 7 days, for 7d range with 720 points)
		CREATE TABLE IF NOT EXISTS metrics_15min (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			bucket_start TEXT NOT NULL,
			cpu_avg REAL NOT NULL,
			cpu_max REAL NOT NULL,
			memory_avg REAL NOT NULL,
			memory_max REAL NOT NULL,
			disk_avg REAL NOT NULL,
			net_rx_total INTEGER NOT NULL,
			net_tx_total INTEGER NOT NULL,
			ping_avg REAL,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, bucket_start)
		);
		
		CREATE INDEX IF NOT EXISTS idx_metrics_15min_server_time ON metrics_15min(server_id, bucket_start);
		
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
		
		-- Create indexes (bucket_5min index created after migration)
		CREATE INDEX IF NOT EXISTS idx_metrics_raw_server_time ON metrics_raw(server_id, timestamp);
		CREATE INDEX IF NOT EXISTS idx_metrics_hourly_server_time ON metrics_hourly(server_id, hour_start);
		CREATE INDEX IF NOT EXISTS idx_metrics_daily_server_time ON metrics_daily(server_id, date);
		
		-- Ping metrics per target (keep for 24 hours)
		-- Note: bucket_5min column added via migration for existing databases
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

	// Migration: Add bucket_5min column for efficient 24h sampling (actually stores 2-min buckets for 720 points)
	db.Exec("ALTER TABLE metrics_raw ADD COLUMN bucket_5min INTEGER")
	db.Exec("ALTER TABLE ping_raw ADD COLUMN bucket_5min INTEGER")

	// Create indexes for bucket_5min (ignore error if already exists)
	db.Exec("CREATE INDEX IF NOT EXISTS idx_metrics_raw_server_bucket ON metrics_raw(server_id, bucket_5min)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ping_raw_server_bucket ON ping_raw(server_id, bucket_5min)")

	// Backfill bucket for existing data - use 120 seconds (2 min) for 720 points over 24h
	db.Exec("UPDATE metrics_raw SET bucket_5min = CAST(strftime('%s', timestamp) AS INTEGER) / 120 WHERE bucket_5min IS NULL OR bucket_5min > 100000000")
	db.Exec("UPDATE ping_raw SET bucket_5min = CAST(strftime('%s', timestamp) AS INTEGER) / 120 WHERE bucket_5min IS NULL OR bucket_5min > 100000000")

	return db, nil
}

// StoreMetricsAsync queues metrics storage (fire-and-forget)
func StoreMetricsAsync(serverID string, metrics *SystemMetrics) {
	if dbWriter == nil {
		return
	}
	// Copy data to avoid race conditions
	m := *metrics
	sid := serverID
	dbWriter.WriteAsync(func(db *sql.DB) error {
		return storeMetricsInternal(db, sid, &m)
	})
}

// StoreMetrics stores metrics synchronously (legacy, for compatibility)
func StoreMetrics(db *sql.DB, serverID string, metrics *SystemMetrics) error {
	if dbWriter != nil {
		m := *metrics
		sid := serverID
		return dbWriter.WriteSync(func(db *sql.DB) error {
			return storeMetricsInternal(db, sid, &m)
		})
	}
	return storeMetricsInternal(db, serverID, metrics)
}

func storeMetricsInternal(db *sql.DB, serverID string, metrics *SystemMetrics) error {
	var diskUsage float32 = 0
	if len(metrics.Disks) > 0 {
		diskUsage = metrics.Disks[0].UsagePercent
	}

	timestamp := metrics.Timestamp.Format(time.RFC3339)
	// Pre-compute 2-minute bucket for efficient 24h sampling (720 points over 24h)
	bucket5min := metrics.Timestamp.Unix() / 120

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
		INSERT INTO metrics_raw (server_id, timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, load_1, load_5, load_15, ping_ms, bucket_5min)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
		bucket5min,
	)
	if err != nil {
		return err
	}

	// Store individual ping targets
	if metrics.Ping != nil {
		for _, target := range metrics.Ping.Targets {
			_, err := db.Exec(`
				INSERT INTO ping_raw (server_id, timestamp, target_name, target_host, latency_ms, packet_loss, status, bucket_5min)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				serverID,
				timestamp,
				target.Name,
				target.Host,
				target.LatencyMs,
				target.PacketLoss,
				target.Status,
				bucket5min,
			)
			if err != nil {
				fmt.Printf("Failed to store ping target: %v\n", err)
			}
		}
	}

	return nil
}

func Aggregate15Min(db *sql.DB) error {
	if dbWriter != nil {
		return dbWriter.WriteSync(aggregate15MinInternal)
	}
	return aggregate15MinInternal(db)
}

func aggregate15MinInternal(db *sql.DB) error {
	// Aggregate raw data from the last hour into 15-minute buckets
	// This runs every 15 minutes, processing data from 15-30 minutes ago
	now := time.Now().UTC()
	// Round down to the previous 15-minute boundary
	minuteOffset := now.Minute() % 15
	bucketEnd := now.Add(-time.Duration(minuteOffset) * time.Minute).Truncate(time.Minute)
	bucketStart := bucketEnd.Add(-15 * time.Minute)

	_, err := db.Exec(`
		INSERT OR REPLACE INTO metrics_15min (server_id, bucket_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, net_rx_total, net_tx_total, ping_avg, sample_count)
		SELECT 
			server_id,
			? as bucket_start,
			AVG(cpu_usage),
			MAX(cpu_usage),
			AVG(memory_usage),
			MAX(memory_usage),
			AVG(disk_usage),
			MAX(net_rx) - MIN(net_rx),
			MAX(net_tx) - MIN(net_tx),
			AVG(ping_ms),
			COUNT(*)
		FROM metrics_raw
		WHERE timestamp >= ? AND timestamp < ?
		GROUP BY server_id`,
		bucketStart.Format(time.RFC3339),
		bucketStart.Format(time.RFC3339),
		bucketEnd.Format(time.RFC3339))
	return err
}

func AggregateHourly(db *sql.DB) error {
	if dbWriter != nil {
		return dbWriter.WriteSync(aggregateHourlyInternal)
	}
	return aggregateHourlyInternal(db)
}

func aggregateHourlyInternal(db *sql.DB) error {
	hourAgo := time.Now().UTC().Add(-time.Hour)
	hourStart := hourAgo.Format("2006-01-02T15:00:00Z")

	_, err := db.Exec(`
		INSERT OR REPLACE INTO metrics_hourly (server_id, hour_start, cpu_avg, cpu_max, memory_avg, memory_max, disk_avg, net_rx_total, net_tx_total, ping_avg, sample_count)
		SELECT 
			server_id,
			strftime('%Y-%m-%dT%H:00:00Z', bucket_start) as hour,
			AVG(cpu_avg),
			MAX(cpu_max),
			AVG(memory_avg),
			MAX(memory_max),
			AVG(disk_avg),
			SUM(net_rx_total),
			SUM(net_tx_total),
			AVG(ping_avg),
			SUM(sample_count)
		FROM metrics_15min
		WHERE bucket_start >= ? AND bucket_start < datetime(?, '+1 hour')
		GROUP BY server_id, hour`, hourStart, hourStart)
	return err
}

func AggregateDaily(db *sql.DB) error {
	if dbWriter != nil {
		return dbWriter.WriteSync(aggregateDailyInternal)
	}
	return aggregateDailyInternal(db)
}

func aggregateDailyInternal(db *sql.DB) error {
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
	if dbWriter != nil {
		return dbWriter.WriteSync(cleanupOldDataInternal)
	}
	return cleanupOldDataInternal(db)
}

func cleanupOldDataInternal(db *sql.DB) error {
	// Delete raw data older than 24 hours
	cutoffRaw := time.Now().UTC().Add(-24 * time.Hour).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_raw WHERE timestamp < ?", cutoffRaw); err != nil {
		return err
	}

	// Delete ping raw data older than 24 hours
	if _, err := db.Exec("DELETE FROM ping_raw WHERE timestamp < ?", cutoffRaw); err != nil {
		return err
	}

	// Delete 15-min data older than 7 days
	cutoff15min := time.Now().UTC().Add(-7 * 24 * time.Hour).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_15min WHERE bucket_start < ?", cutoff15min); err != nil {
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
		// Use 2-min buckets for 720 data points over 24h (24*60/2 = 720)
		// bucket_5min now stores epoch/120 (2-min buckets)
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		rows, err = db.Query(`
			SELECT 
				MIN(timestamp) as timestamp,
				AVG(cpu_usage) as cpu_usage,
				AVG(memory_usage) as memory_usage,
				AVG(disk_usage) as disk_usage,
				MAX(net_rx) as net_rx,
				MAX(net_tx) as net_tx,
				AVG(ping_ms) as ping_ms
			FROM metrics_raw 
			WHERE server_id = ? AND bucket_5min >= ?
			GROUP BY bucket_5min
			ORDER BY bucket_5min ASC
			LIMIT 720`, serverID, cutoffBucket)

	case "7d":
		// 7d with 720 points = ~14 min intervals
		// Use 15-min aggregated data (672 points max, close to 720)
		cutoff := time.Now().UTC().Add(-7 * 24 * time.Hour).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT bucket_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
			FROM metrics_15min 
			WHERE server_id = ? AND bucket_start >= ?
			ORDER BY bucket_start ASC
			LIMIT 720`, serverID, cutoff)

	case "30d":
		// 30d = 720 hours, for 720 points we need 1 hour intervals (use hourly data directly)
		cutoff := time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT hour_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
			FROM metrics_hourly WHERE server_id = ? AND hour_start >= ?
			ORDER BY hour_start ASC
			LIMIT 720`, serverID, cutoff)

	case "1y":
		// 1y = 365 days, for 720 points we need ~12 hour intervals
		// Use daily data and duplicate each point, or use hourly with sampling
		cutoff := time.Now().UTC().AddDate(0, 0, -365).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT 
				MIN(hour_start) as timestamp,
				AVG(cpu_avg) as cpu_avg,
				AVG(memory_avg) as memory_avg,
				AVG(disk_avg) as disk_avg,
				SUM(net_rx_total) as net_rx_total,
				SUM(net_tx_total) as net_tx_total,
				AVG(ping_avg) as ping_avg
			FROM metrics_hourly 
			WHERE server_id = ? AND hour_start >= ?
			GROUP BY date(hour_start), (CAST(strftime('%H', hour_start) AS INTEGER) / 12)
			ORDER BY MIN(hour_start) ASC
			LIMIT 720`, serverID, cutoff)

	default:
		// Default to 24h with 720 points
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		rows, err = db.Query(`
			SELECT 
				MIN(timestamp) as timestamp,
				AVG(cpu_usage) as cpu_usage,
				AVG(memory_usage) as memory_usage,
				AVG(disk_usage) as disk_usage,
				MAX(net_rx) as net_rx,
				MAX(net_tx) as net_tx,
				AVG(ping_ms) as ping_ms
			FROM metrics_raw 
			WHERE server_id = ? AND bucket_5min >= ?
			GROUP BY bucket_5min
			ORDER BY bucket_5min ASC
			LIMIT 720`, serverID, cutoffBucket)
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
	var rows *sql.Rows
	var err error

	if rangeStr == "1h" {
		cutoff := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
		rows, err = db.Query(`
			SELECT target_name, target_host, timestamp, latency_ms, status
			FROM ping_raw 
			WHERE server_id = ? AND timestamp >= ?
			ORDER BY target_name, timestamp ASC`, serverID, cutoff)
	} else {
		// Use 2-min buckets for efficient 24h sampling (720 points)
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		rows, err = db.Query(`
			SELECT 
				target_name,
				target_host,
				MIN(timestamp) as timestamp,
				AVG(latency_ms) as latency_ms,
				-- Pick the most common status (simplified: use the first one)
				MIN(status) as status
			FROM ping_raw 
			WHERE server_id = ? AND bucket_5min >= ?
			GROUP BY target_name, target_host, bucket_5min
			ORDER BY target_name, bucket_5min ASC`, serverID, cutoffBucket)
	}

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

