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
		
		-- 15-minute aggregated ping metrics (keep for 7 days)
		CREATE TABLE IF NOT EXISTS ping_15min (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			bucket_start TEXT NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_avg REAL,
			latency_max REAL,
			packet_loss_avg REAL NOT NULL DEFAULT 0,
			ok_count INTEGER NOT NULL DEFAULT 0,
			fail_count INTEGER NOT NULL DEFAULT 0,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, target_name, bucket_start)
		);
		
		CREATE INDEX IF NOT EXISTS idx_ping_15min_server_time ON ping_15min(server_id, bucket_start);
		CREATE INDEX IF NOT EXISTS idx_ping_15min_target ON ping_15min(server_id, target_name, bucket_start);
		
		-- Hourly aggregated ping metrics (keep for 30 days)
		CREATE TABLE IF NOT EXISTS ping_hourly (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			hour_start TEXT NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_avg REAL,
			latency_max REAL,
			packet_loss_avg REAL NOT NULL DEFAULT 0,
			ok_count INTEGER NOT NULL DEFAULT 0,
			fail_count INTEGER NOT NULL DEFAULT 0,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, target_name, hour_start)
		);
		
		CREATE INDEX IF NOT EXISTS idx_ping_hourly_server_time ON ping_hourly(server_id, hour_start);
		CREATE INDEX IF NOT EXISTS idx_ping_hourly_target ON ping_hourly(server_id, target_name, hour_start);
		
		-- Daily aggregated ping metrics (keep forever)
		CREATE TABLE IF NOT EXISTS ping_daily (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			date TEXT NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_avg REAL,
			latency_max REAL,
			packet_loss_avg REAL NOT NULL DEFAULT 0,
			uptime_percent REAL NOT NULL DEFAULT 0,
			sample_count INTEGER NOT NULL,
			UNIQUE(server_id, target_name, date)
		);
		
		CREATE INDEX IF NOT EXISTS idx_ping_daily_server_time ON ping_daily(server_id, date);
		CREATE INDEX IF NOT EXISTS idx_ping_daily_target ON ping_daily(server_id, target_name, date);
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

	// Backfill bucket for existing data - only if there are NULL values (check first for fast startup)
	var needsBackfill5min int
	db.QueryRow("SELECT 1 FROM metrics_raw WHERE bucket_5min IS NULL OR bucket_5min > 100000000 LIMIT 1").Scan(&needsBackfill5min)
	if needsBackfill5min == 1 {
		fmt.Println("⏳ Backfilling bucket_5min for metrics_raw (one-time migration)...")
		db.Exec("UPDATE metrics_raw SET bucket_5min = CAST(strftime('%s', timestamp) AS INTEGER) / 120 WHERE bucket_5min IS NULL OR bucket_5min > 100000000")
	}
	db.QueryRow("SELECT 1 FROM ping_raw WHERE bucket_5min IS NULL OR bucket_5min > 100000000 LIMIT 1").Scan(&needsBackfill5min)
	if needsBackfill5min == 1 {
		fmt.Println("⏳ Backfilling bucket_5min for ping_raw (one-time migration)...")
		db.Exec("UPDATE ping_raw SET bucket_5min = CAST(strftime('%s', timestamp) AS INTEGER) / 120 WHERE bucket_5min IS NULL OR bucket_5min > 100000000")
	}

	// Migration: Add bucket_5sec column for efficient 1h sampling (5-sec buckets for 720 points over 1h)
	db.Exec("ALTER TABLE metrics_raw ADD COLUMN bucket_5sec INTEGER")
	db.Exec("ALTER TABLE ping_raw ADD COLUMN bucket_5sec INTEGER")

	// Create indexes for bucket_5sec (ignore error if already exists)
	db.Exec("CREATE INDEX IF NOT EXISTS idx_metrics_raw_server_bucket_5sec ON metrics_raw(server_id, bucket_5sec)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_ping_raw_server_bucket_5sec ON ping_raw(server_id, bucket_5sec)")

	// Backfill bucket_5sec for existing data - only if there are NULL values (check first for fast startup)
	var needsBackfill5sec int
	db.QueryRow("SELECT 1 FROM metrics_raw WHERE bucket_5sec IS NULL LIMIT 1").Scan(&needsBackfill5sec)
	if needsBackfill5sec == 1 {
		fmt.Println("⏳ Backfilling bucket_5sec for metrics_raw (one-time migration)...")
		db.Exec("UPDATE metrics_raw SET bucket_5sec = CAST(strftime('%s', timestamp) AS INTEGER) / 5 WHERE bucket_5sec IS NULL")
	}
	db.QueryRow("SELECT 1 FROM ping_raw WHERE bucket_5sec IS NULL LIMIT 1").Scan(&needsBackfill5sec)
	if needsBackfill5sec == 1 {
		fmt.Println("⏳ Backfilling bucket_5sec for ping_raw (one-time migration)...")
		db.Exec("UPDATE ping_raw SET bucket_5sec = CAST(strftime('%s', timestamp) AS INTEGER) / 5 WHERE bucket_5sec IS NULL")
	}

	// Create real-time aggregation tables for fast queries
	db.Exec(`
		-- 5-second aggregated metrics (for 1h queries, ~720 points per server)
		CREATE TABLE IF NOT EXISTS metrics_5sec (
			server_id TEXT NOT NULL,
			bucket INTEGER NOT NULL,
			cpu_sum REAL NOT NULL DEFAULT 0,
			cpu_max REAL NOT NULL DEFAULT 0,
			memory_sum REAL NOT NULL DEFAULT 0,
			memory_max REAL NOT NULL DEFAULT 0,
			disk_sum REAL NOT NULL DEFAULT 0,
			net_rx INTEGER NOT NULL DEFAULT 0,
			net_tx INTEGER NOT NULL DEFAULT 0,
			ping_sum REAL NOT NULL DEFAULT 0,
			ping_count INTEGER NOT NULL DEFAULT 0,
			sample_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (server_id, bucket)
		) WITHOUT ROWID
	`)

	db.Exec(`
		-- 2-minute aggregated metrics (for 24h queries, ~720 points per server)
		CREATE TABLE IF NOT EXISTS metrics_2min (
			server_id TEXT NOT NULL,
			bucket INTEGER NOT NULL,
			cpu_sum REAL NOT NULL DEFAULT 0,
			cpu_max REAL NOT NULL DEFAULT 0,
			memory_sum REAL NOT NULL DEFAULT 0,
			memory_max REAL NOT NULL DEFAULT 0,
			disk_sum REAL NOT NULL DEFAULT 0,
			net_rx INTEGER NOT NULL DEFAULT 0,
			net_tx INTEGER NOT NULL DEFAULT 0,
			ping_sum REAL NOT NULL DEFAULT 0,
			ping_count INTEGER NOT NULL DEFAULT 0,
			sample_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (server_id, bucket)
		) WITHOUT ROWID
	`)

	db.Exec(`
		-- 5-second aggregated ping metrics (for 1h queries)
		CREATE TABLE IF NOT EXISTS ping_5sec (
			server_id TEXT NOT NULL,
			bucket INTEGER NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_sum REAL NOT NULL DEFAULT 0,
			latency_max REAL NOT NULL DEFAULT 0,
			latency_count INTEGER NOT NULL DEFAULT 0,
			ok_count INTEGER NOT NULL DEFAULT 0,
			fail_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (server_id, target_name, bucket)
		) WITHOUT ROWID
	`)

	db.Exec(`
		-- 2-minute aggregated ping metrics (for 24h queries)
		CREATE TABLE IF NOT EXISTS ping_2min (
			server_id TEXT NOT NULL,
			bucket INTEGER NOT NULL,
			target_name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			latency_sum REAL NOT NULL DEFAULT 0,
			latency_max REAL NOT NULL DEFAULT 0,
			latency_count INTEGER NOT NULL DEFAULT 0,
			ok_count INTEGER NOT NULL DEFAULT 0,
			fail_count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (server_id, target_name, bucket)
		) WITHOUT ROWID
	`)

	// Run ANALYZE in background to avoid slow startup
	go func() {
		time.Sleep(10 * time.Second) // Wait for server to fully start
		db.Exec("ANALYZE")
	}()

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
	// Pre-compute 5-second bucket for efficient 1h sampling (720 points over 1h)
	bucket5sec := metrics.Timestamp.Unix() / 5

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

	// Insert raw data (for debugging and fallback)
	_, err := db.Exec(`
		INSERT INTO metrics_raw (server_id, timestamp, cpu_usage, memory_usage, disk_usage, net_rx, net_tx, load_1, load_5, load_15, ping_ms, bucket_5min, bucket_5sec)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
		bucket5sec,
	)
	if err != nil {
		return err
	}

	// UPSERT to 5-second aggregation table (for 1h queries)
	pingVal := float64(0)
	pingCnt := 0
	if pingMs != nil {
		pingVal = *pingMs
		pingCnt = 1
	}
	db.Exec(`
		INSERT INTO metrics_5sec (server_id, bucket, cpu_sum, cpu_max, memory_sum, memory_max, disk_sum, net_rx, net_tx, ping_sum, ping_count, sample_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(server_id, bucket) DO UPDATE SET
			cpu_sum = cpu_sum + excluded.cpu_sum,
			cpu_max = MAX(cpu_max, excluded.cpu_max),
			memory_sum = memory_sum + excluded.memory_sum,
			memory_max = MAX(memory_max, excluded.memory_max),
			disk_sum = disk_sum + excluded.disk_sum,
			net_rx = MAX(net_rx, excluded.net_rx),
			net_tx = MAX(net_tx, excluded.net_tx),
			ping_sum = ping_sum + excluded.ping_sum,
			ping_count = ping_count + excluded.ping_count,
			sample_count = sample_count + 1`,
		serverID, bucket5sec,
		float64(metrics.CPU.Usage), float64(metrics.CPU.Usage),
		float64(metrics.Memory.UsagePercent), float64(metrics.Memory.UsagePercent),
		float64(diskUsage),
		metrics.Network.TotalRx, metrics.Network.TotalTx,
		pingVal, pingCnt,
	)

	// UPSERT to 2-minute aggregation table (for 24h queries)
	db.Exec(`
		INSERT INTO metrics_2min (server_id, bucket, cpu_sum, cpu_max, memory_sum, memory_max, disk_sum, net_rx, net_tx, ping_sum, ping_count, sample_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(server_id, bucket) DO UPDATE SET
			cpu_sum = cpu_sum + excluded.cpu_sum,
			cpu_max = MAX(cpu_max, excluded.cpu_max),
			memory_sum = memory_sum + excluded.memory_sum,
			memory_max = MAX(memory_max, excluded.memory_max),
			disk_sum = disk_sum + excluded.disk_sum,
			net_rx = MAX(net_rx, excluded.net_rx),
			net_tx = MAX(net_tx, excluded.net_tx),
			ping_sum = ping_sum + excluded.ping_sum,
			ping_count = ping_count + excluded.ping_count,
			sample_count = sample_count + 1`,
		serverID, bucket5min,
		float64(metrics.CPU.Usage), float64(metrics.CPU.Usage),
		float64(metrics.Memory.UsagePercent), float64(metrics.Memory.UsagePercent),
		float64(diskUsage),
		metrics.Network.TotalRx, metrics.Network.TotalTx,
		pingVal, pingCnt,
	)

	// Store individual ping targets
	if metrics.Ping != nil {
		for _, target := range metrics.Ping.Targets {
			// Insert raw ping data
			db.Exec(`
				INSERT INTO ping_raw (server_id, timestamp, target_name, target_host, latency_ms, packet_loss, status, bucket_5min, bucket_5sec)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				serverID, timestamp, target.Name, target.Host,
				target.LatencyMs, target.PacketLoss, target.Status,
				bucket5min, bucket5sec,
			)

			// Prepare values for ping aggregation
			latencyVal := float64(0)
			latencyMax := float64(0)
			latencyCnt := 0
			if target.LatencyMs != nil {
				latencyVal = *target.LatencyMs
				latencyMax = *target.LatencyMs
				latencyCnt = 1
			}
			okCnt := 0
			failCnt := 0
			if target.Status == "ok" {
				okCnt = 1
			} else {
				failCnt = 1
			}

			// UPSERT to ping_5sec (for 1h queries)
			db.Exec(`
				INSERT INTO ping_5sec (server_id, bucket, target_name, target_host, latency_sum, latency_max, latency_count, ok_count, fail_count)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(server_id, target_name, bucket) DO UPDATE SET
					target_host = excluded.target_host,
					latency_sum = latency_sum + excluded.latency_sum,
					latency_max = MAX(latency_max, excluded.latency_max),
					latency_count = latency_count + excluded.latency_count,
					ok_count = ok_count + excluded.ok_count,
					fail_count = fail_count + excluded.fail_count`,
				serverID, bucket5sec, target.Name, target.Host,
				latencyVal, latencyMax, latencyCnt, okCnt, failCnt,
			)

			// UPSERT to ping_2min (for 24h queries)
			db.Exec(`
				INSERT INTO ping_2min (server_id, bucket, target_name, target_host, latency_sum, latency_max, latency_count, ok_count, fail_count)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(server_id, target_name, bucket) DO UPDATE SET
					target_host = excluded.target_host,
					latency_sum = latency_sum + excluded.latency_sum,
					latency_max = MAX(latency_max, excluded.latency_max),
					latency_count = latency_count + excluded.latency_count,
					ok_count = ok_count + excluded.ok_count,
					fail_count = fail_count + excluded.fail_count`,
				serverID, bucket5min, target.Name, target.Host,
				latencyVal, latencyMax, latencyCnt, okCnt, failCnt,
			)
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
	if err != nil {
		return err
	}

	// Aggregate ping data into 15-minute buckets
	_, err = db.Exec(`
		INSERT OR REPLACE INTO ping_15min (server_id, bucket_start, target_name, target_host, latency_avg, latency_max, packet_loss_avg, ok_count, fail_count, sample_count)
		SELECT 
			server_id,
			? as bucket_start,
			target_name,
			target_host,
			AVG(latency_ms),
			MAX(latency_ms),
			AVG(packet_loss),
			SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END),
			SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END),
			COUNT(*)
		FROM ping_raw
		WHERE timestamp >= ? AND timestamp < ?
		GROUP BY server_id, target_name, target_host`,
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
	if err != nil {
		return err
	}

	// Aggregate ping data into hourly buckets
	_, err = db.Exec(`
		INSERT OR REPLACE INTO ping_hourly (server_id, hour_start, target_name, target_host, latency_avg, latency_max, packet_loss_avg, ok_count, fail_count, sample_count)
		SELECT 
			server_id,
			strftime('%Y-%m-%dT%H:00:00Z', bucket_start) as hour,
			target_name,
			target_host,
			AVG(latency_avg),
			MAX(latency_max),
			AVG(packet_loss_avg),
			SUM(ok_count),
			SUM(fail_count),
			SUM(sample_count)
		FROM ping_15min
		WHERE bucket_start >= ? AND bucket_start < datetime(?, '+1 hour')
		GROUP BY server_id, target_name, target_host, hour`, hourStart, hourStart)
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
	if err != nil {
		return err
	}

	// Aggregate ping data into daily buckets
	_, err = db.Exec(`
		INSERT OR REPLACE INTO ping_daily (server_id, date, target_name, target_host, latency_avg, latency_max, packet_loss_avg, uptime_percent, sample_count)
		SELECT 
			server_id,
			date(hour_start) as day,
			target_name,
			target_host,
			AVG(latency_avg),
			MAX(latency_max),
			AVG(packet_loss_avg),
			(SUM(ok_count) * 100.0 / (SUM(ok_count) + SUM(fail_count))),
			SUM(sample_count)
		FROM ping_hourly
		WHERE date(hour_start) = ?
		GROUP BY server_id, target_name, target_host, day`, yesterday)
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

	// Delete 5-second aggregation data older than 1 hour
	cutoff5sec := time.Now().UTC().Add(-time.Hour).Unix() / 5
	db.Exec("DELETE FROM metrics_5sec WHERE bucket < ?", cutoff5sec)
	db.Exec("DELETE FROM ping_5sec WHERE bucket < ?", cutoff5sec)

	// Delete 2-minute aggregation data older than 24 hours
	cutoff2min := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
	db.Exec("DELETE FROM metrics_2min WHERE bucket < ?", cutoff2min)
	db.Exec("DELETE FROM ping_2min WHERE bucket < ?", cutoff2min)

	// Delete 15-min data older than 7 days
	cutoff15min := time.Now().UTC().Add(-7 * 24 * time.Hour).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_15min WHERE bucket_start < ?", cutoff15min); err != nil {
		return err
	}

	// Delete ping 15-min data older than 7 days
	if _, err := db.Exec("DELETE FROM ping_15min WHERE bucket_start < ?", cutoff15min); err != nil {
		return err
	}

	// Delete hourly data older than 30 days
	cutoffHourly := time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)
	if _, err := db.Exec("DELETE FROM metrics_hourly WHERE hour_start < ?", cutoffHourly); err != nil {
		return err
	}

	// Delete ping hourly data older than 30 days
	if _, err := db.Exec("DELETE FROM ping_hourly WHERE hour_start < ?", cutoffHourly); err != nil {
		return err
	}

	// Update query planner statistics after cleanup
	db.Exec("ANALYZE")

	return nil
}

func GetHistory(db *sql.DB, serverID, rangeStr string) ([]HistoryPoint, error) {
	return GetHistorySince(db, serverID, rangeStr, 0)
}

// GetHistorySince returns history data since a specific bucket (for incremental queries)
func GetHistorySince(db *sql.DB, serverID, rangeStr string, sinceBucket int64) ([]HistoryPoint, error) {
	var data []HistoryPoint
	var rows *sql.Rows
	var err error

	switch rangeStr {
	case "1h":
		// Read directly from pre-aggregated 5-second table (no GROUP BY needed!)
		cutoffBucket := time.Now().UTC().Add(-time.Hour).Unix() / 5
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				datetime(bucket * 5, 'unixepoch') as timestamp,
				CASE WHEN sample_count > 0 THEN cpu_sum / sample_count ELSE 0 END as cpu_usage,
				CASE WHEN sample_count > 0 THEN memory_sum / sample_count ELSE 0 END as memory_usage,
				CASE WHEN sample_count > 0 THEN disk_sum / sample_count ELSE 0 END as disk_usage,
				net_rx,
				net_tx,
				CASE WHEN ping_count > 0 THEN ping_sum / ping_count ELSE NULL END as ping_ms,
				bucket
			FROM metrics_5sec 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY bucket ASC
			LIMIT 720`, serverID, cutoffBucket)

	case "24h":
		// Read directly from pre-aggregated 2-minute table (no GROUP BY needed!)
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				datetime(bucket * 120, 'unixepoch') as timestamp,
				CASE WHEN sample_count > 0 THEN cpu_sum / sample_count ELSE 0 END as cpu_usage,
				CASE WHEN sample_count > 0 THEN memory_sum / sample_count ELSE 0 END as memory_usage,
				CASE WHEN sample_count > 0 THEN disk_sum / sample_count ELSE 0 END as disk_usage,
				net_rx,
				net_tx,
				CASE WHEN ping_count > 0 THEN ping_sum / ping_count ELSE NULL END as ping_ms,
				bucket
			FROM metrics_2min 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY bucket ASC
			LIMIT 720`, serverID, cutoffBucket)

	case "7d":
		// 7d with 15-min buckets (672 points max)
		cutoff := time.Now().UTC().Add(-7 * 24 * time.Hour).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM metrics_15min WHERE server_id = ? AND bucket_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use pre-aggregated 15-min data
			rows, err = db.Query(`
				SELECT bucket_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
				FROM metrics_15min 
				WHERE server_id = ? AND bucket_start >= ?
				ORDER BY bucket_start ASC
				LIMIT 720`, serverID, cutoff)
		} else {
			// Fall back to real-time aggregation from raw data (15-min buckets = 900 seconds)
			rows, err = db.Query(`
				SELECT 
					datetime((strftime('%s', timestamp) / 900) * 900, 'unixepoch') as bucket_start,
					AVG(cpu_usage) as cpu_avg,
					AVG(memory_usage) as memory_avg,
					AVG(disk_usage) as disk_avg,
					MAX(net_rx) - MIN(net_rx) as net_rx_total,
					MAX(net_tx) - MIN(net_tx) as net_tx_total,
					AVG(ping_ms) as ping_avg
				FROM metrics_raw 
				WHERE server_id = ? AND timestamp >= ?
				GROUP BY strftime('%s', timestamp) / 900
				ORDER BY bucket_start ASC
				LIMIT 720`, serverID, cutoff)
		}

	case "30d":
		// 30d with hourly buckets (720 points max)
		cutoff := time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM metrics_hourly WHERE server_id = ? AND hour_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use pre-aggregated hourly data
			rows, err = db.Query(`
				SELECT hour_start, cpu_avg, memory_avg, disk_avg, net_rx_total, net_tx_total, ping_avg
				FROM metrics_hourly WHERE server_id = ? AND hour_start >= ?
				ORDER BY hour_start ASC
				LIMIT 720`, serverID, cutoff)
		} else {
			// Try 15-min table first
			var count15 int
			db.QueryRow(`SELECT COUNT(*) FROM metrics_15min WHERE server_id = ? AND bucket_start >= ?`,
				serverID, cutoff).Scan(&count15)

			if count15 > 0 {
				// Aggregate from 15-min data to hourly
				rows, err = db.Query(`
					SELECT 
						strftime('%Y-%m-%dT%H:00:00Z', bucket_start) as hour_start,
						AVG(cpu_avg) as cpu_avg,
						AVG(memory_avg) as memory_avg,
						AVG(disk_avg) as disk_avg,
						SUM(net_rx_total) as net_rx_total,
						SUM(net_tx_total) as net_tx_total,
						AVG(ping_avg) as ping_avg
					FROM metrics_15min 
					WHERE server_id = ? AND bucket_start >= ?
					GROUP BY strftime('%Y-%m-%dT%H:00:00Z', bucket_start)
					ORDER BY hour_start ASC
					LIMIT 720`, serverID, cutoff)
			} else {
				// Fall back to raw data with hourly aggregation
				rows, err = db.Query(`
					SELECT 
						strftime('%Y-%m-%dT%H:00:00Z', timestamp) as hour_start,
						AVG(cpu_usage) as cpu_avg,
						AVG(memory_usage) as memory_avg,
						AVG(disk_usage) as disk_avg,
						MAX(net_rx) - MIN(net_rx) as net_rx_total,
						MAX(net_tx) - MIN(net_tx) as net_tx_total,
						AVG(ping_ms) as ping_avg
					FROM metrics_raw 
					WHERE server_id = ? AND timestamp >= ?
					GROUP BY strftime('%Y-%m-%dT%H:00:00Z', timestamp)
					ORDER BY hour_start ASC
					LIMIT 720`, serverID, cutoff)
			}
		}

	case "1y":
		// 1y with 12-hour buckets (730 points max)
		cutoff := time.Now().UTC().AddDate(0, 0, -365).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM metrics_hourly WHERE server_id = ? AND hour_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use hourly data with 12-hour grouping
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
				LIMIT 730`, serverID, cutoff)
		} else {
			// Fall back to raw data with 12-hour aggregation
			rows, err = db.Query(`
				SELECT 
					MIN(timestamp) as timestamp,
					AVG(cpu_usage) as cpu_avg,
					AVG(memory_usage) as memory_avg,
					AVG(disk_usage) as disk_avg,
					MAX(net_rx) - MIN(net_rx) as net_rx_total,
					MAX(net_tx) - MIN(net_tx) as net_tx_total,
					AVG(ping_ms) as ping_avg
				FROM metrics_raw 
				WHERE server_id = ? AND timestamp >= ?
				GROUP BY date(timestamp), (CAST(strftime('%H', timestamp) AS INTEGER) / 12)
				ORDER BY MIN(timestamp) ASC
				LIMIT 730`, serverID, cutoff)
		}

	default:
		// Default to 24h - read from pre-aggregated table
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				datetime(bucket * 120, 'unixepoch') as timestamp,
				CASE WHEN sample_count > 0 THEN cpu_sum / sample_count ELSE 0 END as cpu_usage,
				CASE WHEN sample_count > 0 THEN memory_sum / sample_count ELSE 0 END as memory_usage,
				CASE WHEN sample_count > 0 THEN disk_sum / sample_count ELSE 0 END as disk_usage,
				net_rx,
				net_tx,
				CASE WHEN ping_count > 0 THEN ping_sum / ping_count ELSE NULL END as ping_ms,
				bucket
			FROM metrics_2min 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY bucket ASC
			LIMIT 720`, serverID, cutoffBucket)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	// Check if we're reading from aggregated tables (1h or 24h) which have bucket column
	useAggregated := rangeStr == "1h" || rangeStr == "24h" || rangeStr == ""

	for rows.Next() {
		var point HistoryPoint
		var bucket int64
		var scanErr error
		if useAggregated {
			scanErr = rows.Scan(&point.Timestamp, &point.CPU, &point.Memory, &point.Disk, &point.NetRx, &point.NetTx, &point.PingMs, &bucket)
		} else {
			scanErr = rows.Scan(&point.Timestamp, &point.CPU, &point.Memory, &point.Disk, &point.NetRx, &point.NetTx, &point.PingMs)
		}
		if scanErr != nil {
			continue
		}
		data = append(data, point)
	}

	return data, nil
}

func GetPingHistory(db *sql.DB, serverID, rangeStr string) ([]PingHistoryTarget, error) {
	return GetPingHistorySince(db, serverID, rangeStr, 0)
}

// GetPingHistorySince returns ping history data since a specific bucket (for incremental queries)
func GetPingHistorySince(db *sql.DB, serverID, rangeStr string, sinceBucket int64) ([]PingHistoryTarget, error) {
	var rows *sql.Rows
	var err error

	switch rangeStr {
	case "1h":
		// Read directly from pre-aggregated 5-second table (no GROUP BY needed!)
		cutoffBucket := time.Now().UTC().Add(-time.Hour).Unix() / 5
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				target_name,
				target_host,
				datetime(bucket * 5, 'unixepoch') as timestamp,
				CASE WHEN latency_count > 0 THEN latency_sum / latency_count ELSE NULL END as latency_ms,
				CASE WHEN fail_count > 0 THEN 'error' ELSE 'ok' END as status
			FROM ping_5sec 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY target_name, bucket ASC`, serverID, cutoffBucket)

	case "24h":
		// Read directly from pre-aggregated 2-minute table (no GROUP BY needed!)
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				target_name,
				target_host,
				datetime(bucket * 120, 'unixepoch') as timestamp,
				CASE WHEN latency_count > 0 THEN latency_sum / latency_count ELSE NULL END as latency_ms,
				CASE WHEN fail_count > 0 THEN 'error' ELSE 'ok' END as status
			FROM ping_2min 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY target_name, bucket ASC`, serverID, cutoffBucket)

	case "7d":
		// 7d with 15-min buckets (672 points max)
		cutoff := time.Now().UTC().Add(-7 * 24 * time.Hour).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM ping_15min WHERE server_id = ? AND bucket_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use pre-aggregated 15-min data
			rows, err = db.Query(`
				SELECT 
					target_name,
					target_host,
					bucket_start,
					latency_avg as latency_ms,
					CASE WHEN fail_count > 0 THEN 'error' ELSE 'ok' END as status
				FROM ping_15min 
				WHERE server_id = ? AND bucket_start >= ?
				ORDER BY target_name, bucket_start ASC`, serverID, cutoff)
		} else {
			// Fall back to real-time aggregation from raw data
			rows, err = db.Query(`
				SELECT 
					target_name,
					target_host,
					datetime((strftime('%s', timestamp) / 900) * 900, 'unixepoch') as bucket_start,
					AVG(latency_ms) as latency_ms,
					MIN(status) as status
				FROM ping_raw 
				WHERE server_id = ? AND timestamp >= ?
				GROUP BY target_name, target_host, strftime('%s', timestamp) / 900
				ORDER BY target_name, bucket_start ASC`, serverID, cutoff)
		}

	case "30d":
		// 30d with hourly buckets (720 points max)
		cutoff := time.Now().UTC().AddDate(0, 0, -30).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM ping_hourly WHERE server_id = ? AND hour_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use pre-aggregated hourly data
			rows, err = db.Query(`
				SELECT 
					target_name,
					target_host,
					hour_start,
					latency_avg as latency_ms,
					CASE WHEN fail_count > 0 THEN 'error' ELSE 'ok' END as status
				FROM ping_hourly 
				WHERE server_id = ? AND hour_start >= ?
				ORDER BY target_name, hour_start ASC`, serverID, cutoff)
		} else {
			// Try 15-min table first
			var count15 int
			db.QueryRow(`SELECT COUNT(*) FROM ping_15min WHERE server_id = ? AND bucket_start >= ?`,
				serverID, cutoff).Scan(&count15)

			if count15 > 0 {
				// Aggregate from 15-min data to hourly
				rows, err = db.Query(`
					SELECT 
						target_name,
						target_host,
						strftime('%Y-%m-%dT%H:00:00Z', bucket_start) as hour_start,
						AVG(latency_avg) as latency_ms,
						CASE WHEN SUM(fail_count) > 0 THEN 'error' ELSE 'ok' END as status
					FROM ping_15min 
					WHERE server_id = ? AND bucket_start >= ?
					GROUP BY target_name, target_host, strftime('%Y-%m-%dT%H:00:00Z', bucket_start)
					ORDER BY target_name, hour_start ASC`, serverID, cutoff)
			} else {
				// Fall back to raw data with hourly aggregation
				rows, err = db.Query(`
					SELECT 
						target_name,
						target_host,
						strftime('%Y-%m-%dT%H:00:00Z', timestamp) as hour_start,
						AVG(latency_ms) as latency_ms,
						MIN(status) as status
					FROM ping_raw 
					WHERE server_id = ? AND timestamp >= ?
					GROUP BY target_name, target_host, strftime('%Y-%m-%dT%H:00:00Z', timestamp)
					ORDER BY target_name, hour_start ASC`, serverID, cutoff)
			}
		}

	case "1y":
		// 1y with 12-hour buckets (730 points max)
		cutoff := time.Now().UTC().AddDate(0, 0, -365).Format(time.RFC3339)
		var count int
		db.QueryRow(`SELECT COUNT(*) FROM ping_hourly WHERE server_id = ? AND hour_start >= ?`,
			serverID, cutoff).Scan(&count)

		if count > 0 {
			// Use hourly data with 12-hour grouping
			rows, err = db.Query(`
				SELECT 
					target_name,
					target_host,
					MIN(hour_start) as timestamp,
					AVG(latency_avg) as latency_ms,
					CASE WHEN SUM(fail_count) > 0 THEN 'error' ELSE 'ok' END as status
				FROM ping_hourly 
				WHERE server_id = ? AND hour_start >= ?
				GROUP BY target_name, target_host, date(hour_start), (CAST(strftime('%H', hour_start) AS INTEGER) / 12)
				ORDER BY target_name, MIN(hour_start) ASC`, serverID, cutoff)
		} else {
			// Fall back to raw data with 12-hour aggregation
			rows, err = db.Query(`
				SELECT 
					target_name,
					target_host,
					MIN(timestamp) as timestamp,
					AVG(latency_ms) as latency_ms,
					MIN(status) as status
				FROM ping_raw 
				WHERE server_id = ? AND timestamp >= ?
				GROUP BY target_name, target_host, date(timestamp), (CAST(strftime('%H', timestamp) AS INTEGER) / 12)
				ORDER BY target_name, MIN(timestamp) ASC`, serverID, cutoff)
		}

	default:
		// Default to 24h - read from pre-aggregated table
		cutoffBucket := time.Now().UTC().Add(-24*time.Hour).Unix() / 120
		if sinceBucket > cutoffBucket {
			cutoffBucket = sinceBucket
		}
		rows, err = db.Query(`
			SELECT 
				target_name,
				target_host,
				datetime(bucket * 120, 'unixepoch') as timestamp,
				CASE WHEN latency_count > 0 THEN latency_sum / latency_count ELSE NULL END as latency_ms,
				CASE WHEN fail_count > 0 THEN 'error' ELSE 'ok' END as status
			FROM ping_2min 
			WHERE server_id = ? AND bucket >= ?
			ORDER BY target_name, bucket ASC`, serverID, cutoffBucket)
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

