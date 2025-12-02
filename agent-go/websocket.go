package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	InitialReconnectDelay = 5 * time.Second
	MaxReconnectDelay     = 60 * time.Second
	AuthTimeout           = 10 * time.Second
	PingInterval          = 30 * time.Second
)

type WebSocketClient struct {
	config    *AgentConfig
	collector *MetricsCollector
}

func NewWebSocketClient(config *AgentConfig) *WebSocketClient {
	return &WebSocketClient{
		config:    config,
		collector: NewMetricsCollector(),
	}
}

func (wsc *WebSocketClient) Run() {
	reconnectDelay := InitialReconnectDelay

	for {
		log.Printf("Connecting to %s...", wsc.config.WSUrl())

		if err := wsc.connectAndRun(); err != nil {
			log.Printf("Connection error: %v", err)
		} else {
			log.Println("Connection closed normally")
			reconnectDelay = InitialReconnectDelay
		}

		log.Printf("Reconnecting in %v...", reconnectDelay)
		time.Sleep(reconnectDelay)

		// Exponential backoff
		reconnectDelay *= 2
		if reconnectDelay > MaxReconnectDelay {
			reconnectDelay = MaxReconnectDelay
		}
	}
}

func (wsc *WebSocketClient) connectAndRun() error {
	wsURL := wsc.config.WSUrl()

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	defer conn.Close()

	log.Println("Connected to WebSocket server")

	// Send authentication message
	authMsg := AuthMessage{
		Type:     "auth",
		ServerID: wsc.config.ServerID,
		Token:    wsc.config.AgentToken,
		Version:  AgentVersion,
	}

	authData, err := json.Marshal(authMsg)
	if err != nil {
		return fmt.Errorf("failed to serialize auth message: %w", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, authData); err != nil {
		return fmt.Errorf("failed to send auth message: %w", err)
	}

	log.Println("Sent authentication message")

	// Wait for auth response
	conn.SetReadDeadline(time.Now().Add(AuthTimeout))
	_, message, err := conn.ReadMessage()
	if err != nil {
		return fmt.Errorf("failed to receive auth response: %w", err)
	}

	var response ServerResponse
	if err := json.Unmarshal(message, &response); err != nil {
		return fmt.Errorf("failed to parse auth response: %w", err)
	}

	if response.Status != "ok" {
		return fmt.Errorf("authentication failed: %s", response.Message)
	}

	// Update ping targets from server config if provided
	if len(response.PingTargets) > 0 {
		log.Printf("Received %d ping targets from server", len(response.PingTargets))
		wsc.collector.SetPingTargets(response.PingTargets)
	}

	log.Println("Authentication successful!")

	// Reset read deadline
	conn.SetReadDeadline(time.Time{})

	// Start metrics sending loop
	metricsTicker := time.NewTicker(time.Duration(wsc.config.IntervalSecs) * time.Second)
	defer metricsTicker.Stop()

	pingTicker := time.NewTicker(PingInterval)
	defer pingTicker.Stop()

	// Handle incoming messages
	done := make(chan error, 1)

	go func() {
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				done <- err
				return
			}

			var response ServerResponse
			if err := json.Unmarshal(message, &response); err != nil {
				continue
			}

			switch response.Type {
			case "error":
				log.Printf("Server error: %s", response.Message)
			case "command":
				if response.Command == "update" {
					log.Println("Received update command from server")
					wsc.handleUpdateCommand(response.DownloadURL)
				}
			}
		}
	}()

	for {
		select {
		case <-metricsTicker.C:
			metrics := wsc.collector.Collect()
			msg := MetricsMessage{
				Type:    "metrics",
				Metrics: metrics,
			}

			data, err := json.Marshal(msg)
			if err != nil {
				log.Printf("Failed to serialize metrics: %v", err)
				continue
			}

			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return fmt.Errorf("failed to send metrics: %w", err)
			}

		case <-pingTicker.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return fmt.Errorf("failed to send ping: %w", err)
			}

		case err := <-done:
			return err
		}
	}
}

func (wsc *WebSocketClient) handleUpdateCommand(downloadURL string) {
	log.Println("Starting self-update process...")

	// Get the current executable path
	currentExe, err := os.Executable()
	if err != nil {
		log.Printf("Failed to get current executable path: %v", err)
		return
	}

	// Determine download URL
	url := downloadURL
	if url == "" {
		// Default to the server's agent binary endpoint
		url = fmt.Sprintf("%s/releases/vstats-agent", strings.TrimSuffix(wsc.config.DashboardURL, "/"))
	}

	log.Printf("Downloading update from: %s", url)

	// Download to a temporary file
	tempPath := currentExe + ".new"

	if err := downloadFile(url, tempPath); err != nil {
		log.Printf("Failed to download update: %v", err)
		return
	}

	log.Println("Download complete, applying update...")

	// On Unix, set execute permissions
	if runtime.GOOS != "windows" {
		if err := os.Chmod(tempPath, 0755); err != nil {
			log.Printf("Failed to set permissions: %v", err)
			os.Remove(tempPath)
			return
		}
	}

	// Backup current executable
	backupPath := currentExe + ".backup"
	if err := os.Rename(currentExe, backupPath); err != nil {
		log.Printf("Failed to backup current executable: %v", err)
		os.Remove(tempPath)
		return
	}

	// Move new executable to current path
	if err := os.Rename(tempPath, currentExe); err != nil {
		log.Printf("Failed to install new executable: %v", err)
		// Try to restore backup
		os.Rename(backupPath, currentExe)
		return
	}

	// Remove backup
	os.Remove(backupPath)

	log.Println("Update installed successfully! Restarting...")

	// Restart the agent
	if runtime.GOOS == "linux" {
		// Use systemctl if available
		exec.Command("systemctl", "restart", "vstats-agent").Start()
	}

	// Exit to allow restart
	os.Exit(0)
}

// downloadFile downloads a file from URL to path
func downloadFile(url, path string) error {
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	out, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		os.Remove(path)
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}
