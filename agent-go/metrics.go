package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

type MetricsCollector struct {
	mu                sync.RWMutex
	lastNetworkRx     uint64
	lastNetworkTx     uint64
	lastNetworkTime   time.Time
	pingResults       *PingMetrics
	pingResultsMu     sync.RWMutex
	customPingTargets []PingTargetConfig
	customTargetsMu   sync.RWMutex
	gatewayIP         string
	ipAddresses       []string
}

func NewMetricsCollector() *MetricsCollector {
	mc := &MetricsCollector{
		lastNetworkTime: time.Now(),
		pingResults:     &PingMetrics{Targets: []PingTarget{}},
	}

	// Get initial network totals
	netIO, _ := net.IOCounters(true)
	for _, io := range netIO {
		mc.lastNetworkRx += io.BytesRecv
		mc.lastNetworkTx += io.BytesSent
	}

	// Detect gateway
	mc.gatewayIP = detectGateway()

	// Collect IP addresses
	mc.ipAddresses = collectIPAddresses()

	// Start background ping thread
	go mc.pingLoop()

	return mc
}

func (mc *MetricsCollector) SetPingTargets(targets []PingTargetConfig) {
	mc.customTargetsMu.Lock()
	defer mc.customTargetsMu.Unlock()
	mc.customPingTargets = targets
}

func (mc *MetricsCollector) Collect() SystemMetrics {
	// CPU metrics
	cpuPercent, _ := cpu.Percent(200*time.Millisecond, true)
	cpuInfo, _ := cpu.Info()

	var cpuBrand string
	var cpuFreq uint64
	if len(cpuInfo) > 0 {
		cpuBrand = cpuInfo[0].ModelName
		cpuFreq = uint64(cpuInfo[0].Mhz)
	}

	var totalCPU float32
	perCore := make([]float32, len(cpuPercent))
	for i, p := range cpuPercent {
		perCore[i] = float32(p)
		totalCPU += float32(p)
	}
	if len(cpuPercent) > 0 {
		totalCPU /= float32(len(cpuPercent))
	}

	// Memory metrics
	memInfo, _ := mem.VirtualMemory()
	swapInfo, _ := mem.SwapMemory()
	memoryModules := collectMemoryModules()

	// Disk metrics - collect physical disks
	diskMetrics := collectPhysicalDisks()

	// Network metrics
	netIO, _ := net.IOCounters(true)
	var interfaces []NetworkInterface
	var totalRx, totalTx uint64

	for _, io := range netIO {
		// Filter out virtual interfaces
		name := strings.ToLower(io.Name)
		if isVirtualInterface(name) {
			continue
		}

		// Get interface details (MAC address and speed)
		mac, speed := getInterfaceDetails(io.Name)

		interfaces = append(interfaces, NetworkInterface{
			Name:      io.Name,
			MAC:       mac,
			Speed:     speed,
			RxBytes:   io.BytesRecv,
			TxBytes:   io.BytesSent,
			RxPackets: io.PacketsRecv,
			TxPackets: io.PacketsSent,
		})
		totalRx += io.BytesRecv
		totalTx += io.BytesSent
	}

	// Calculate network speed
	mc.mu.Lock()
	now := time.Now()
	elapsed := now.Sub(mc.lastNetworkTime).Seconds()
	var rxSpeed, txSpeed uint64
	if elapsed > 0.1 {
		rxDiff := totalRx - mc.lastNetworkRx
		txDiff := totalTx - mc.lastNetworkTx
		if totalRx >= mc.lastNetworkRx {
			rxSpeed = uint64(float64(rxDiff) / elapsed)
		}
		if totalTx >= mc.lastNetworkTx {
			txSpeed = uint64(float64(txDiff) / elapsed)
		}
		mc.lastNetworkRx = totalRx
		mc.lastNetworkTx = totalTx
		mc.lastNetworkTime = now
	}
	mc.mu.Unlock()

	// Load average
	loadAvg, _ := load.Avg()
	var la LoadAverage
	if loadAvg != nil {
		la = LoadAverage{
			One:     loadAvg.Load1,
			Five:    loadAvg.Load5,
			Fifteen: loadAvg.Load15,
		}
	}

	// Host info
	hostInfo, _ := host.Info()
	uptime, _ := host.Uptime()

	// Get cached ping results
	mc.pingResultsMu.RLock()
	ping := mc.pingResults
	mc.pingResultsMu.RUnlock()

	metrics := SystemMetrics{
		Timestamp: time.Now().UTC(),
		Hostname:  hostInfo.Hostname,
		OS: OsInfo{
			Name:    hostInfo.Platform,
			Version: hostInfo.PlatformVersion,
			Kernel:  hostInfo.KernelVersion,
			Arch:    runtime.GOARCH,
		},
		CPU: CpuMetrics{
			Brand:     cpuBrand,
			Cores:     len(cpuPercent),
			Usage:     totalCPU,
			Frequency: cpuFreq,
			PerCore:   perCore,
		},
		Memory: MemoryMetrics{
			Total:        memInfo.Total,
			Used:         memInfo.Used,
			Available:    memInfo.Available,
			SwapTotal:    swapInfo.Total,
			SwapUsed:     swapInfo.Used,
			UsagePercent: float32(memInfo.UsedPercent),
			Modules:      memoryModules,
		},
		Disks: diskMetrics,
		Network: NetworkMetrics{
			Interfaces: interfaces,
			TotalRx:    totalRx,
			TotalTx:    totalTx,
			RxSpeed:    rxSpeed,
			TxSpeed:    txSpeed,
		},
		Uptime:      uptime,
		LoadAverage: la,
		Ping:        ping,
		Version:     "0.1.0",
	}

	if len(mc.ipAddresses) > 0 {
		metrics.IPAddresses = mc.ipAddresses
	}

	return metrics
}

func (mc *MetricsCollector) pingLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		mc.customTargetsMu.RLock()
		customTargets := mc.customPingTargets
		mc.customTargetsMu.RUnlock()

		results := collectPingMetrics(mc.gatewayIP, customTargets)

		mc.pingResultsMu.Lock()
		mc.pingResults = results
		mc.pingResultsMu.Unlock()
	}
}

func collectPingMetrics(gatewayIP string, customTargets []PingTargetConfig) *PingMetrics {
	var targets []PingTarget

	// Default targets
	defaultTargets := []struct {
		name string
		host string
	}{
		{"Google DNS", "8.8.8.8"},
		{"Cloudflare", "1.1.1.1"},
		{"Local Gateway", gatewayIP},
	}

	pingedHosts := make(map[string]bool)

	// Ping default targets
	for _, dt := range defaultTargets {
		if dt.host == "" {
			continue
		}
		if pingedHosts[dt.host] {
			continue
		}

		latency, packetLoss, status := pingHost(dt.host)
		targets = append(targets, PingTarget{
			Name:       dt.name,
			Host:       dt.host,
			LatencyMs:  latency,
			PacketLoss: packetLoss,
			Status:     status,
		})
		pingedHosts[dt.host] = true
	}

	// Ping custom targets
	for _, ct := range customTargets {
		if ct.Host == "" || pingedHosts[ct.Host] {
			continue
		}

		latency, packetLoss, status := pingHost(ct.Host)
		targets = append(targets, PingTarget{
			Name:       ct.Name,
			Host:       ct.Host,
			LatencyMs:  latency,
			PacketLoss: packetLoss,
			Status:     status,
		})
		pingedHosts[ct.Host] = true
	}

	return &PingMetrics{Targets: targets}
}

func pingHost(host string) (*float64, float64, string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", "3", "-w", "2000", host)
	} else {
		cmd = exec.CommandContext(ctx, "ping", "-c", "3", "-W", "2", host)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, 100.0, "error"
	}

	outputStr := string(output)
	status := "ok"
	packetLoss := 0.0
	var latency *float64

	// Parse packet loss
	if strings.Contains(outputStr, "100%") || strings.Contains(outputStr, "timeout") {
		status = "timeout"
		packetLoss = 100.0
	} else {
		// Extract packet loss percentage
		packetLossRegex := regexp.MustCompile(`(\d+(?:\.\d+)?)%\s*(?:packet\s+)?loss`)
		if matches := packetLossRegex.FindStringSubmatch(outputStr); len(matches) > 1 {
			if loss, err := strconv.ParseFloat(matches[1], 64); err == nil {
				packetLoss = loss
			}
		}
	}

	// Parse average latency
	if runtime.GOOS == "windows" {
		// Windows format: "Average = 12ms"
		avgRegex := regexp.MustCompile(`Average\s*=\s*(\d+)\s*ms`)
		if matches := avgRegex.FindStringSubmatch(outputStr); len(matches) > 1 {
			if lat, err := strconv.ParseFloat(matches[1], 64); err == nil {
				latency = &lat
			}
		}
	} else {
		// Linux/macOS format: "min/avg/max/mdev = 1.234/2.345/3.456/0.567 ms"
		avgRegex := regexp.MustCompile(`(?:min/avg/max|round-trip)\s*[=:]\s*[\d.]+/([\d.]+)/[\d.]+`)
		if matches := avgRegex.FindStringSubmatch(outputStr); len(matches) > 1 {
			if lat, err := strconv.ParseFloat(matches[1], 64); err == nil {
				latency = &lat
			}
		}
		// Fallback: try to find any number followed by "ms"
		if latency == nil {
			msRegex := regexp.MustCompile(`(\d+(?:\.\d+)?)\s*ms`)
			matches := msRegex.FindAllStringSubmatch(outputStr, -1)
			if len(matches) > 0 {
				// Take the last match (usually the average)
				if lat, err := strconv.ParseFloat(matches[len(matches)-1][1], 64); err == nil {
					latency = &lat
				}
			}
		}
	}

	if packetLoss >= 100.0 {
		status = "timeout"
	} else if latency == nil && packetLoss > 0 {
		status = "error"
	}

	return latency, packetLoss, status
}

func detectGateway() string {
	switch runtime.GOOS {
	case "linux":
		// Use 'ip route show default'
		cmd := exec.Command("ip", "route", "show", "default")
		output, err := cmd.Output()
		if err == nil {
			outputStr := string(output)
			// Parse: default via 192.168.1.1 dev eth0
			fields := strings.Fields(outputStr)
			for i, field := range fields {
				if field == "via" && i+1 < len(fields) {
					gateway := fields[i+1]
					if strings.Contains(gateway, ".") && !strings.Contains(gateway, "/") {
						return gateway
					}
				}
			}
		}
	case "darwin":
		// Use 'route -n get default'
		cmd := exec.Command("route", "-n", "get", "default")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "gateway:") {
					parts := strings.Fields(line)
					if len(parts) > 1 {
						return parts[1]
					}
				}
			}
		}
	case "windows":
		// Use PowerShell to get default gateway
		cmd := exec.Command("powershell", "-Command", "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1).NextHop")
		output, err := cmd.Output()
		if err == nil {
			gateway := strings.TrimSpace(string(output))
			if gateway != "" && strings.Contains(gateway, ".") {
				return gateway
			}
		}
		// Fallback: use 'route print'
		cmd = exec.Command("cmd", "/C", "route", "print", "0.0.0.0")
		output, err = cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			for scanner.Scan() {
				line := scanner.Text()
				fields := strings.Fields(line)
				if len(fields) >= 3 && fields[0] == "0.0.0.0" {
					gateway := fields[2]
					if strings.Contains(gateway, ".") && gateway != "0.0.0.0" {
						return gateway
					}
				}
			}
		}
	}
	return ""
}

func collectIPAddresses() []string {
	var ips []string

	switch runtime.GOOS {
	case "linux":
		// Try 'hostname -I' first
		cmd := exec.Command("hostname", "-I")
		output, err := cmd.Output()
		if err == nil {
			fields := strings.Fields(string(output))
			for _, ip := range fields {
				if strings.Contains(ip, ".") && !strings.HasPrefix(ip, "127.") {
					ips = append(ips, ip)
				}
			}
		}
		// Fallback: use 'ip addr show'
		if len(ips) == 0 {
			cmd = exec.Command("ip", "addr", "show")
			output, err := cmd.Output()
			if err == nil {
				scanner := bufio.NewScanner(strings.NewReader(string(output)))
				for scanner.Scan() {
					line := scanner.Text()
					if strings.Contains(line, "inet ") && !strings.Contains(line, "127.0.0.1") {
						fields := strings.Fields(line)
						if len(fields) >= 2 {
							ip := strings.Split(fields[1], "/")[0]
							if strings.Contains(ip, ".") && !strings.HasPrefix(ip, "127.") {
								ips = append(ips, ip)
							}
						}
					}
				}
			}
		}
	case "darwin":
		// Use 'ifconfig'
		cmd := exec.Command("ifconfig")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "inet ") && !strings.Contains(line, "127.0.0.1") {
					fields := strings.Fields(line)
					if len(fields) >= 2 {
						ip := fields[1]
						if strings.Contains(ip, ".") && !strings.HasPrefix(ip, "127.") {
							ips = append(ips, ip)
						}
					}
				}
			}
		}
	case "windows":
		// Use PowerShell
		cmd := exec.Command("powershell", "-Command", "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			for scanner.Scan() {
				ip := strings.TrimSpace(scanner.Text())
				if ip != "" && strings.Contains(ip, ".") && !strings.HasPrefix(ip, "127.") {
					ips = append(ips, ip)
				}
			}
		}
		// Fallback: use 'ipconfig'
		if len(ips) == 0 {
			cmd = exec.Command("ipconfig")
			output, err := cmd.Output()
			if err == nil {
				scanner := bufio.NewScanner(strings.NewReader(string(output)))
				for scanner.Scan() {
					line := scanner.Text()
					if strings.Contains(line, "IPv4") || strings.Contains(line, "IP Address") {
						parts := strings.Split(line, ":")
						if len(parts) >= 2 {
							ip := strings.TrimSpace(parts[1])
							if strings.Contains(ip, ".") && !strings.HasPrefix(ip, "127.") {
								ips = append(ips, ip)
							}
						}
					}
				}
			}
		}
	}

	return ips
}

func isVirtualInterface(name string) bool {
	return name == "lo" || name == "lo0" ||
		strings.HasPrefix(name, "veth") ||
		strings.HasPrefix(name, "docker") ||
		strings.HasPrefix(name, "br-") ||
		strings.HasPrefix(name, "virbr") ||
		strings.HasPrefix(name, "utun") ||
		strings.HasPrefix(name, "awdl") ||
		strings.HasPrefix(name, "llw")
}

func floatPtr(f float64) *float64 {
	return &f
}

// collectMemoryModules collects detailed memory module information
func collectMemoryModules() []MemoryModule {
	var modules []MemoryModule

	switch runtime.GOOS {
	case "linux":
		// Use dmidecode (requires root)
		cmd := exec.Command("dmidecode", "-t", "memory")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			var currentModule *MemoryModule
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "Memory Device") {
					if currentModule != nil && currentModule.Size > 0 {
						modules = append(modules, *currentModule)
					}
					currentModule = &MemoryModule{}
				} else if currentModule != nil {
					if strings.HasPrefix(line, "Size:") {
						val := strings.TrimSpace(strings.TrimPrefix(line, "Size:"))
						if val != "No Module Installed" {
							parts := strings.Fields(val)
							if len(parts) >= 2 {
								if size, err := strconv.ParseUint(parts[0], 10, 64); err == nil {
									switch strings.ToUpper(parts[1]) {
									case "GB":
										currentModule.Size = size * 1024 * 1024 * 1024
									case "MB":
										currentModule.Size = size * 1024 * 1024
									case "KB":
										currentModule.Size = size * 1024
									default:
										currentModule.Size = size
									}
								}
							}
						}
					} else if strings.HasPrefix(line, "Type:") {
						val := strings.TrimSpace(strings.TrimPrefix(line, "Type:"))
						if val != "Unknown" && val != "" {
							currentModule.MemType = val
						}
					} else if strings.HasPrefix(line, "Speed:") {
						val := strings.TrimSpace(strings.TrimPrefix(line, "Speed:"))
						parts := strings.Fields(val)
						if len(parts) > 0 {
							if speed, err := strconv.ParseUint(parts[0], 10, 32); err == nil {
								currentModule.Speed = uint32(speed)
							}
						}
					} else if strings.HasPrefix(line, "Locator:") {
						val := strings.TrimSpace(strings.TrimPrefix(line, "Locator:"))
						if val != "" {
							currentModule.Slot = val
						}
					} else if strings.HasPrefix(line, "Manufacturer:") {
						val := strings.TrimSpace(strings.TrimPrefix(line, "Manufacturer:"))
						if val != "Unknown" && val != "" && val != "Not Specified" {
							currentModule.Manufacturer = val
						}
					}
				}
			}
			if currentModule != nil && currentModule.Size > 0 {
				modules = append(modules, *currentModule)
			}
		}
	case "darwin":
		// Use system_profiler
		cmd := exec.Command("system_profiler", "SPMemoryDataType", "-json")
		output, err := cmd.Output()
		if err == nil {
			var data map[string]interface{}
			if json.Unmarshal(output, &data) == nil {
				if memoryData, ok := data["SPMemoryDataType"].([]interface{}); ok {
					for _, item := range memoryData {
						if itemMap, ok := item.(map[string]interface{}); ok {
							if items, ok := itemMap["_items"].([]interface{}); ok {
								for _, moduleItem := range items {
									if module, ok := moduleItem.(map[string]interface{}); ok {
										sizeStr, _ := module["dimm_size"].(string)
										var size uint64
										if strings.Contains(sizeStr, "GB") {
											sizeStr = strings.ReplaceAll(sizeStr, " GB", "")
											sizeStr = strings.TrimSpace(sizeStr)
											if s, err := strconv.ParseUint(sizeStr, 10, 64); err == nil {
												size = s * 1024 * 1024 * 1024
											}
										}
										if size > 0 {
											memModule := MemoryModule{
												Size: size,
											}
											if name, ok := module["_name"].(string); ok {
												memModule.Slot = name
											}
											if dimmType, ok := module["dimm_type"].(string); ok {
												memModule.MemType = dimmType
											}
											if dimmSpeed, ok := module["dimm_speed"].(string); ok {
												parts := strings.Fields(dimmSpeed)
												if len(parts) > 0 {
													if s, err := strconv.ParseUint(parts[0], 10, 32); err == nil {
														memModule.Speed = uint32(s)
													}
												}
											}
											if manufacturer, ok := module["dimm_manufacturer"].(string); ok {
												memModule.Manufacturer = manufacturer
											}
											modules = append(modules, memModule)
										}
									}
								}
							}
						}
					}
				}
			}
		}
	case "windows":
		// Use WMIC
		cmd := exec.Command("wmic", "memorychip", "get", "Capacity,Speed,MemoryType,Manufacturer,DeviceLocator", "/format:csv")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			firstLine := true
			for scanner.Scan() {
				if firstLine {
					firstLine = false
					continue
				}
				line := scanner.Text()
				parts := strings.Split(line, ",")
				if len(parts) >= 5 {
					if size, err := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64); err == nil && size > 0 {
						memModule := MemoryModule{
							Size: size,
						}
						if slot := strings.TrimSpace(parts[2]); slot != "" {
							memModule.Slot = slot
						}
						if memTypeCode, err := strconv.ParseUint(strings.TrimSpace(parts[3]), 10, 32); err == nil {
							switch memTypeCode {
							case 20:
								memModule.MemType = "DDR"
							case 21:
								memModule.MemType = "DDR2"
							case 24:
								memModule.MemType = "DDR3"
							case 26:
								memModule.MemType = "DDR4"
							case 34:
								memModule.MemType = "DDR5"
							}
						}
						if speed, err := strconv.ParseUint(strings.TrimSpace(parts[4]), 10, 32); err == nil {
							memModule.Speed = uint32(speed)
						}
						if manufacturer := strings.TrimSpace(parts[5]); manufacturer != "" {
							memModule.Manufacturer = manufacturer
						}
						modules = append(modules, memModule)
					}
				}
			}
		}
	}

	return modules
}

// collectPhysicalDisks collects physical disk information
func collectPhysicalDisks() []DiskMetrics {
	var disks []DiskMetrics

	switch runtime.GOOS {
	case "linux":
		// Read from /sys/block to get physical disks
		entries, err := os.ReadDir("/sys/block")
		if err == nil {
			physicalDisks := make(map[string]*DiskMetrics)
			for _, entry := range entries {
				name := entry.Name()
				// Skip virtual devices
				if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") ||
					strings.HasPrefix(name, "dm-") || strings.HasPrefix(name, "sr") ||
					strings.HasPrefix(name, "fd") {
					continue
				}

				// Get disk size
				sizePath := filepath.Join("/sys/block", name, "size")
				sizeData, err := os.ReadFile(sizePath)
				if err != nil {
					continue
				}
				sectors, err := strconv.ParseUint(strings.TrimSpace(string(sizeData)), 10, 64)
				if err != nil || sectors == 0 {
					continue
				}
				total := sectors * 512 // Convert sectors to bytes

				// Get disk type
				diskType := detectDiskType(name)

				// Get model
				modelPath := filepath.Join("/sys/block", name, "device", "model")
				var model string
				if modelData, err := os.ReadFile(modelPath); err == nil {
					model = strings.TrimSpace(string(modelData))
				}

				// Get serial
				serialPath := filepath.Join("/sys/block", name, "device", "serial")
				var serial string
				if serialData, err := os.ReadFile(serialPath); err == nil {
					serial = strings.TrimSpace(string(serialData))
				}

				physicalDisks[name] = &DiskMetrics{
					Name:        name,
					Model:       model,
					Serial:      serial,
					Total:       total,
					DiskType:    diskType,
					MountPoints: []string{},
					Used:        0,
				}
			}

			// Map partitions to physical disks
			partitions, _ := disk.Partitions(false)
			for _, p := range partitions {
				partName := p.Device
				mountPoint := p.Mountpoint

				// Skip special mounts
				if strings.HasPrefix(mountPoint, "/snap") || strings.HasPrefix(mountPoint, "/boot/efi") {
					continue
				}

				// Find base device name
				baseName := strings.TrimPrefix(partName, "/dev/")
				if strings.Contains(baseName, "nvme") {
					// NVMe: nvme0n1p1 -> nvme0n1
					baseName = strings.Split(baseName, "p")[0]
				} else {
					// SATA/SCSI: sda1 -> sda
					baseName = regexp.MustCompile(`^([^0-9]+)`).FindString(baseName)
				}

				if diskMetrics, ok := physicalDisks[baseName]; ok {
					if mountPoint != "" && mountPoint != "none" {
						diskMetrics.MountPoints = append(diskMetrics.MountPoints, mountPoint)
					}
					// Update usage from partition
					if usage, err := disk.Usage(p.Mountpoint); err == nil {
						partUsed := usage.Total - usage.Free
						diskMetrics.Used += partUsed
					}
				}
			}

			// Calculate usage percent and convert to slice
			for _, d := range physicalDisks {
				if d.Total > 0 {
					d.UsagePercent = float32(float64(d.Used) / float64(d.Total) * 100)
				}
				disks = append(disks, *d)
			}
		}
	case "darwin":
		// Use diskutil or fallback to partitions
		partitions, _ := disk.Partitions(false)
		physicalDisks := make(map[string]*DiskMetrics)
		for _, p := range partitions {
			name := p.Device
			mount := p.Mountpoint

			// Skip system volumes
			if strings.HasPrefix(mount, "/System") || strings.Contains(name, "synthesized") {
				continue
			}

			usage, err := disk.Usage(mount)
			if err != nil {
				continue
			}

			diskName := strings.TrimPrefix(name, "/dev/")
			if _, exists := physicalDisks[diskName]; !exists {
				physicalDisks[diskName] = &DiskMetrics{
					Name:         diskName,
					Total:        usage.Total,
					Used:         usage.Used,
					UsagePercent: float32(usage.UsedPercent),
					DiskType:     "SSD", // Most Macs use SSD
					MountPoints:  []string{mount},
				}
			}
		}
		for _, d := range physicalDisks {
			disks = append(disks, *d)
		}
	case "windows":
		// Use WMIC to get physical disks
		cmd := exec.Command("wmic", "diskdrive", "get", "DeviceID,Model,SerialNumber,Size,MediaType", "/format:csv")
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			firstLine := true
			physicalDisks := make(map[string]*DiskMetrics)
			for scanner.Scan() {
				if firstLine {
					firstLine = false
					continue
				}
				line := scanner.Text()
				parts := strings.Split(line, ",")
				if len(parts) >= 5 {
					deviceID := strings.TrimSpace(parts[1])
					model := strings.TrimSpace(parts[2])
					serial := strings.TrimSpace(parts[4])
					size, _ := strconv.ParseUint(strings.TrimSpace(parts[5]), 10, 64)
					mediaType := strings.TrimSpace(parts[3])

					if size > 0 {
						var diskType string
						if strings.Contains(mediaType, "SSD") || strings.Contains(mediaType, "Solid") {
							diskType = "SSD"
						} else if strings.Contains(mediaType, "HDD") || strings.Contains(mediaType, "Fixed") {
							diskType = "HDD"
						}

						name := strings.ReplaceAll(deviceID, "\\\\.\\", "")
						physicalDisks[name] = &DiskMetrics{
							Name:        name,
							Model:       model,
							Serial:      serial,
							Total:       size,
							DiskType:    diskType,
							MountPoints: []string{},
							Used:        0,
						}
					}
				}
			}

			// Get usage from partitions
			partitions, _ := disk.Partitions(false)
			for _, p := range partitions {
				mount := p.Mountpoint
				if mount != "" {
					if usage, err := disk.Usage(mount); err == nil {
						// On Windows, report partition usage directly if no physical disks found
						if len(physicalDisks) == 0 {
							disks = append(disks, DiskMetrics{
								Name:         mount,
								Total:        usage.Total,
								Used:         usage.Used,
								UsagePercent: float32(usage.UsedPercent),
								DiskType:     "SSD",
								MountPoints:  []string{mount},
							})
						}
					}
				}
			}

			// Calculate usage percent for physical disks
			for _, d := range physicalDisks {
				if d.Total > 0 {
					d.UsagePercent = float32(float64(d.Used) / float64(d.Total) * 100)
				}
				disks = append(disks, *d)
			}
		}
	}

	return disks
}

// detectDiskType detects if a disk is SSD, HDD, or NVMe
func detectDiskType(diskName string) string {
	// NVMe detection by name
	if strings.HasPrefix(diskName, "nvme") {
		return "NVMe"
	}

	switch runtime.GOOS {
	case "linux":
		// Check rotational flag: 0 = SSD, 1 = HDD
		rotationalPath := filepath.Join("/sys/block", diskName, "queue", "rotational")
		if data, err := os.ReadFile(rotationalPath); err == nil {
			rotational := strings.TrimSpace(string(data))
			if rotational == "0" {
				return "SSD"
			} else if rotational == "1" {
				return "HDD"
			}
		}
		// Fallback: check if it's a virtual device
		if strings.HasPrefix(diskName, "vd") || strings.HasPrefix(diskName, "xvd") {
			return "SSD" // Virtual disks are usually backed by SSDs
		}
	}

	return ""
}

// getInterfaceDetails gets MAC address and link speed for a network interface
func getInterfaceDetails(name string) (string, uint32) {
	var mac string
	var speed uint32

	switch runtime.GOOS {
	case "linux":
		// Read MAC address
		macPath := filepath.Join("/sys/class/net", name, "address")
		if data, err := os.ReadFile(macPath); err == nil {
			addr := strings.TrimSpace(string(data))
			if addr != "00:00:00:00:00:00" {
				mac = strings.ToUpper(addr)
			}
		}
		// Read link speed (in Mbps)
		speedPath := filepath.Join("/sys/class/net", name, "speed")
		if data, err := os.ReadFile(speedPath); err == nil {
			if s, err := strconv.ParseUint(strings.TrimSpace(string(data)), 10, 32); err == nil && s > 0 {
				speed = uint32(s)
			}
		}
	case "darwin":
		// Use ifconfig to get MAC
		cmd := exec.Command("ifconfig", name)
		output, err := cmd.Output()
		if err == nil {
			scanner := bufio.NewScanner(strings.NewReader(string(output)))
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "ether ") {
					parts := strings.Fields(line)
					if len(parts) > 1 {
						mac = strings.ToUpper(parts[1])
					}
				}
			}
		}
		// Use networksetup for speed
		cmd = exec.Command("networksetup", "-getMedia", name)
		output, err = cmd.Output()
		if err == nil {
			outputStr := strings.ToLower(string(output))
			if strings.Contains(outputStr, "1000") {
				speed = 1000
			} else if strings.Contains(outputStr, "100") {
				speed = 100
			} else if strings.Contains(outputStr, "10") {
				speed = 10
			}
		}
	case "windows":
		// Use PowerShell
		cmd := exec.Command("powershell", "-Command", fmt.Sprintf("Get-NetAdapter -Name '%s' | Select-Object -Property MacAddress,LinkSpeed | ConvertTo-Json", name))
		output, err := cmd.Output()
		if err == nil {
			var data map[string]interface{}
			if json.Unmarshal(output, &data) == nil {
				if macAddr, ok := data["MacAddress"].(string); ok {
					mac = strings.ToUpper(macAddr)
				}
				if linkSpeed, ok := data["LinkSpeed"].(string); ok {
					// Parse "1 Gbps" or "100 Mbps"
					parts := strings.Fields(linkSpeed)
					if len(parts) >= 2 {
						if num, err := strconv.ParseUint(parts[0], 10, 32); err == nil {
							if strings.HasPrefix(parts[1], "G") {
								speed = uint32(num * 1000)
							} else {
								speed = uint32(num)
							}
						}
					}
				}
			}
		}
	}

	return mac, speed
}

