package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/host"
)

// AgentVersion will be set at build time via -ldflags
var AgentVersion = "dev"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "--version", "-v":
			fmt.Printf("vstats-agent version %s\n", AgentVersion)
			os.Exit(0)
		case "register":
			if len(os.Args) < 5 {
				fmt.Println("Usage: vstats-agent register --server <server_url> --token <admin_token> [--name <server_name>]")
				os.Exit(1)
			}
			handleRegister()
			return
		case "install":
			handleInstall()
			return
		case "uninstall":
			handleUninstall()
			return
		case "show-config":
			handleShowConfig()
			return
		}
	}

	// Default: run agent
	runAgent()
}

func runAgent() {
	configPath := DefaultConfigPath()
	if len(os.Args) > 2 && os.Args[1] == "run" {
		// Allow custom config path
		for i, arg := range os.Args {
			if arg == "--config" && i+1 < len(os.Args) {
				configPath = os.Args[i+1]
				break
			}
		}
	}

	log.Printf("Loading config from %s", configPath)

	config, err := LoadConfig(configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Println("Starting vStats agent")
	log.Printf("  Server ID: %s", config.ServerID)
	log.Printf("  Dashboard: %s", config.DashboardURL)
	log.Printf("  Interval: %ds", config.IntervalSecs)

	client := NewWebSocketClient(config)
	client.Run()
}

func handleRegister() {
	var serverURL, token, name string

	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--server":
			if i+1 < len(os.Args) {
				serverURL = os.Args[i+1]
				i++
			}
		case "--token":
			if i+1 < len(os.Args) {
				token = os.Args[i+1]
				i++
			}
		case "--name":
			if i+1 < len(os.Args) {
				name = os.Args[i+1]
				i++
			}
		}
	}

	if serverURL == "" || token == "" {
		fmt.Println("Error: --server and --token are required")
		os.Exit(1)
	}

	if name == "" {
		hostInfo, _ := host.Info()
		if hostInfo != nil {
			name = hostInfo.Hostname
		}
		if name == "" {
			name = "Unknown"
		}
	}

	log.Printf("Registering with dashboard at %s", serverURL)
	log.Printf("  Name: %s", name)

	// Register with server
	reqBody := map[string]string{
		"name":     name,
		"location": "",
		"provider": "",
	}

	reqData, _ := json.Marshal(reqBody)
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/agent/register", serverURL), bytes.NewBuffer(reqData))
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Fatalf("Failed to send registration request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Fatalf("Registration failed (%d): %s", resp.StatusCode, string(body))
	}

	var registerResp RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&registerResp); err != nil {
		log.Fatalf("Failed to parse registration response: %v", err)
	}

	log.Println("Registration successful!")
	log.Printf("  Server ID: %s", registerResp.ID)

	// Create config
	config := &AgentConfig{
		DashboardURL: serverURL,
		ServerID:     registerResp.ID,
		AgentToken:   registerResp.Token,
		ServerName:   name,
		Location:     "",
		Provider:     "",
		IntervalSecs: 5,
	}

	configPath := DefaultConfigPath()
	if err := SaveConfig(config, configPath); err != nil {
		log.Fatalf("Failed to save config: %v", err)
	}

	log.Printf("Configuration saved to %s", configPath)
	fmt.Println()
	fmt.Println("✅ Agent registered successfully!")
	fmt.Println()
	fmt.Println("To start the agent, run:")
	fmt.Println("  vstats-agent run")
	fmt.Println()
	fmt.Println("Or install as a service:")
	fmt.Println("  sudo vstats-agent install")
}

func handleInstall() {
	configPath := DefaultConfigPath()

	// Check for --config flag
	for i, arg := range os.Args {
		if arg == "--config" && i+1 < len(os.Args) {
			configPath = os.Args[i+1]
			break
		}
	}

	// Verify config file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		log.Fatalf("Config file not found: %s", configPath)
	}

	exe, _ := os.Executable()

	if runtime.GOOS == "linux" {
		installSystemd(exe, configPath)
	} else if runtime.GOOS == "darwin" {
		installLaunchd(exe, configPath)
	} else if runtime.GOOS == "windows" {
		installWindowsService(exe, configPath)
	} else if runtime.GOOS == "freebsd" {
		installFreeBSDService(exe, configPath)
	} else {
		log.Fatalf("Service installation is only supported on Linux, macOS, Windows, and FreeBSD")
	}
}

func handleUninstall() {
	if runtime.GOOS == "linux" {
		uninstallSystemd()
	} else if runtime.GOOS == "darwin" {
		uninstallLaunchd()
	} else if runtime.GOOS == "windows" {
		uninstallWindowsService()
	} else if runtime.GOOS == "freebsd" {
		uninstallFreeBSDService()
	} else {
		log.Fatalf("Service uninstallation is only supported on Linux, macOS, Windows, and FreeBSD")
	}
}

func handleShowConfig() {
	configPath := DefaultConfigPath()
	config, err := LoadConfig(configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	fmt.Printf("Configuration file: %s\n", configPath)
	fmt.Println()
	fmt.Printf("  Dashboard URL:  %s\n", config.DashboardURL)
	fmt.Printf("  WebSocket URL:  %s\n", config.WSUrl())
	fmt.Printf("  Server ID:      %s\n", config.ServerID)
	fmt.Printf("  Server Name:    %s\n", config.ServerName)
	fmt.Printf("  Location:       %s\n", config.Location)
	fmt.Printf("  Provider:       %s\n", config.Provider)
	fmt.Printf("  Interval:       %ds\n", config.IntervalSecs)
}

func installSystemd(exe, configPath string) {
	serviceContent := fmt.Sprintf(`[Unit]
Description=vStats Monitoring Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=%s run --config %s
Restart=always
RestartSec=10
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
`, exe, configPath)

	servicePath := "/etc/systemd/system/vstats-agent.service"
	if err := os.WriteFile(servicePath, []byte(serviceContent), 0644); err != nil {
		log.Fatalf("Failed to write service file: %v. Try running with sudo.", err)
	}

	log.Printf("Service file created at %s", servicePath)

	// Reload systemd
	if err := exec.Command("systemctl", "daemon-reload").Run(); err != nil {
		log.Fatalf("Failed to reload systemd: %v", err)
	}

	// Enable service
	if err := exec.Command("systemctl", "enable", "vstats-agent").Run(); err != nil {
		log.Fatalf("Failed to enable service: %v", err)
	}

	// Start service
	if err := exec.Command("systemctl", "start", "vstats-agent").Run(); err != nil {
		log.Fatalf("Failed to start service: %v", err)
	}

	// Verify service is running
	time.Sleep(1 * time.Second)
	if err := exec.Command("systemctl", "is-active", "--quiet", "vstats-agent").Run(); err != nil {
		log.Printf("Warning: Service may not be running. Check status with: systemctl status vstats-agent")
		log.Printf("Check logs with: journalctl -u vstats-agent -n 50")
		os.Exit(1)
	}

	fmt.Println()
	fmt.Println("✅ Service installed and started!")
	fmt.Println()
	fmt.Println("Useful commands:")
	fmt.Println("  systemctl status vstats-agent   # Check status")
	fmt.Println("  systemctl restart vstats-agent  # Restart")
	fmt.Println("  systemctl stop vstats-agent     # Stop")
	fmt.Println("  journalctl -u vstats-agent -f   # View logs")
}

func uninstallSystemd() {
	exec.Command("systemctl", "stop", "vstats-agent").Run()
	exec.Command("systemctl", "disable", "vstats-agent").Run()
	os.Remove("/etc/systemd/system/vstats-agent.service")
	exec.Command("systemctl", "daemon-reload").Run()
	fmt.Println("✅ Service uninstalled successfully!")
}

func installLaunchd(exe, configPath string) {
	plistContent := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>cc.zsoft.vstats-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
        <string>run</string>
        <string>--config</string>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/vstats-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/vstats-agent.error.log</string>
</dict>
</plist>
`, exe, configPath)

	plistPath := "/Library/LaunchDaemons/cc.zsoft.vstats-agent.plist"
	if err := os.WriteFile(plistPath, []byte(plistContent), 0644); err != nil {
		log.Fatalf("Failed to write plist file: %v. Try running with sudo.", err)
	}

	log.Printf("LaunchDaemon plist created at %s", plistPath)
	exec.Command("launchctl", "load", plistPath).Run()

	fmt.Println()
	fmt.Println("✅ Service installed and started!")
	fmt.Println()
	fmt.Println("Useful commands:")
	fmt.Println("  sudo launchctl list | grep vstats    # Check if running")
	fmt.Printf("  sudo launchctl unload %s   # Stop\n", plistPath)
	fmt.Println("  tail -f /tmp/vstats-agent.log        # View logs")
}

func uninstallLaunchd() {
	plistPath := "/Library/LaunchDaemons/cc.zsoft.vstats-agent.plist"
	exec.Command("launchctl", "unload", plistPath).Run()
	os.Remove(plistPath)
	fmt.Println("✅ Service uninstalled successfully!")
}

func installWindowsService(exe, configPath string) {
	binPath := fmt.Sprintf(`"%s" run --config "%s"`, exe, configPath)
	log.Printf("Creating Windows service with command: %s", binPath)

	exec.Command("sc", "create", "vstats-agent",
		"binPath=", binPath,
		"DisplayName=", "vStats Monitoring Agent",
		"start=", "auto",
		"obj=", "LocalSystem").Run()

	exec.Command("sc", "description", "vstats-agent",
		"vStats Monitoring Agent - Push system metrics to dashboard").Run()

	exec.Command("sc", "failure", "vstats-agent",
		"reset=", "86400",
		"actions=", "restart/10000/restart/10000/restart/10000").Run()

	exec.Command("sc", "start", "vstats-agent").Run()

	fmt.Println()
	fmt.Println("✅ Service installed and started!")
	fmt.Println()
	fmt.Println("Useful commands (run as Administrator):")
	fmt.Println("  sc query vstats-agent           # Check status")
	fmt.Println("  sc stop vstats-agent            # Stop service")
	fmt.Println("  sc start vstats-agent           # Start service")
	fmt.Println("  sc delete vstats-agent          # Remove service")
}

func uninstallWindowsService() {
	exec.Command("sc", "stop", "vstats-agent").Run()
	time.Sleep(2 * time.Second)
	exec.Command("sc", "delete", "vstats-agent").Run()
	fmt.Println("✅ Service uninstalled successfully!")
}

func installFreeBSDService(exe, configPath string) {
	rcScript := fmt.Sprintf(`#!/bin/sh
#
# PROVIDE: vstats_agent
# REQUIRE: NETWORKING
# KEYWORD: shutdown

. /etc/rc.subr

name="vstats_agent"
rcvar="vstats_agent_enable"
command="%s"
command_args="run --config %s"
pidfile="/var/run/vstats-agent.pid"

load_rc_config $name
run_rc_command "$1"
`, exe, configPath)

	rcScriptPath := "/usr/local/etc/rc.d/vstats-agent"
	if err := os.WriteFile(rcScriptPath, []byte(rcScript), 0755); err != nil {
		log.Fatalf("Failed to write rc script: %v. Try running with sudo.", err)
	}

	log.Printf("RC script created at %s", rcScriptPath)

	// Enable service
	exec.Command("sysrc", "vstats_agent_enable=YES").Run()
	exec.Command("service", "vstats-agent", "start").Run()

	fmt.Println()
	fmt.Println("✅ Service installed and started!")
	fmt.Println()
	fmt.Println("Useful commands:")
	fmt.Println("  service vstats-agent status   # Check status")
	fmt.Println("  service vstats-agent restart  # Restart")
	fmt.Println("  service vstats-agent stop     # Stop")
	fmt.Println("  tail -f /var/log/vstats-agent.log  # View logs")
}

func uninstallFreeBSDService() {
	exec.Command("service", "vstats-agent", "stop").Run()
	exec.Command("sysrc", "-x", "vstats_agent_enable").Run()
	os.Remove("/usr/local/etc/rc.d/vstats-agent")
	fmt.Println("✅ Service uninstalled successfully!")
}
