package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"
)

// serverCmd represents the server command
var serverCmd = &cobra.Command{
	Use:     "server",
	Aliases: []string{"servers", "srv"},
	Short:   "Manage servers",
	Long: `Manage your vStats Cloud servers.

Examples:
  vstats server list              # List all servers
  vstats server create web-01     # Create a new server
  vstats server show <id>         # Show server details
  vstats server delete <id>       # Delete a server
  vstats server metrics <id>      # View server metrics
  vstats server history <id>      # View metrics history
  vstats server install <id>      # Get agent installation command`,
}

// serverListCmd lists all servers
var serverListCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List all servers",
	Long:    `List all servers associated with your account.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		client := NewClient()
		servers, err := client.ListServers()
		if err != nil {
			return fmt.Errorf("failed to list servers: %w", err)
		}

		switch outputFmt {
		case "json":
			return OutputJSON(servers)
		case "yaml":
			return OutputYAML(servers)
		default:
			if len(servers) == 0 {
				fmt.Println("No servers found.")
				fmt.Println("Use 'vstats server create <name>' to add a server.")
				return nil
			}

			table := NewTable("NAME", "STATUS", "CPU", "MEM", "IP", "LAST SEEN")
			for _, s := range servers {
				cpu := "-"
				mem := "-"
				if s.Metrics != nil {
					if s.Metrics.CPUUsage != nil {
						cpu = formatPercent(*s.Metrics.CPUUsage)
					}
					if s.Metrics.MemoryTotal != nil && s.Metrics.MemoryUsed != nil && *s.Metrics.MemoryTotal > 0 {
						memPercent := float64(*s.Metrics.MemoryUsed) / float64(*s.Metrics.MemoryTotal) * 100
						mem = formatPercent(memPercent)
					}
				}

				table.AddRow(
					s.Name,
					formatStatus(s.Status),
					cpu,
					mem,
					ptrString(s.IPAddress),
					formatTimeAgo(s.LastSeenAt),
				)
			}
			table.Render()
		}
		return nil
	},
}

// serverCreateCmd creates a new server
var serverCreateCmd = &cobra.Command{
	Use:   "create <name>",
	Short: "Create a new server",
	Long: `Create a new server in your account.

After creating the server, you'll receive an agent key that can be used
to connect an agent to this server.`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		name := args[0]
		client := NewClient()

		server, err := client.CreateServer(name)
		if err != nil {
			return fmt.Errorf("failed to create server: %w", err)
		}

		switch outputFmt {
		case "json":
			return OutputJSON(server)
		case "yaml":
			return OutputYAML(server)
		default:
			fmt.Printf("✓ Server '%s' created successfully!\n\n", server.Name)
			fmt.Printf("  ID:        %s\n", server.ID)
			fmt.Printf("  Agent Key: %s\n", server.AgentKey)
			fmt.Println()
			fmt.Println("To install the agent, run:")
			fmt.Printf("  vstats server install %s\n", server.ID)
		}
		return nil
	},
}

// serverShowCmd shows server details
var serverShowCmd = &cobra.Command{
	Use:     "show <id>",
	Aliases: []string{"get", "info"},
	Short:   "Show server details",
	Long:    `Show detailed information about a specific server.`,
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		client := NewClient()

		// Try to find server by name first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		switch outputFmt {
		case "json":
			return OutputJSON(server)
		case "yaml":
			return OutputYAML(server)
		default:
			fmt.Println("Server Details")
			fmt.Println("==============")
			fmt.Printf("ID:            %s\n", server.ID)
			fmt.Printf("Name:          %s\n", server.Name)
			fmt.Printf("Status:        %s\n", formatStatus(server.Status))
			fmt.Printf("Hostname:      %s\n", ptrString(server.Hostname))
			fmt.Printf("IP Address:    %s\n", ptrString(server.IPAddress))
			fmt.Printf("OS:            %s %s\n", ptrString(server.OSType), ptrString(server.OSVersion))
			fmt.Printf("Agent Version: %s\n", ptrString(server.AgentVersion))
			fmt.Printf("Last Seen:     %s\n", formatTime(server.LastSeenAt))
			fmt.Printf("Created:       %s\n", formatTime(&server.CreatedAt))

			if server.Metrics != nil {
				fmt.Println()
				fmt.Println("Current Metrics")
				fmt.Println("---------------")
				fmt.Printf("CPU Usage:     %s\n", ptrFloat(server.Metrics.CPUUsage))
				fmt.Printf("Load Average:  %s / %s / %s\n",
					ptrFloatRaw(server.Metrics.LoadAvg1),
					ptrFloatRaw(server.Metrics.LoadAvg5),
					ptrFloatRaw(server.Metrics.LoadAvg15))
				fmt.Printf("Memory:        %s / %s\n",
					ptrBytes(server.Metrics.MemoryUsed),
					ptrBytes(server.Metrics.MemoryTotal))
				fmt.Printf("Disk:          %s / %s\n",
					ptrBytes(server.Metrics.DiskUsed),
					ptrBytes(server.Metrics.DiskTotal))
				fmt.Printf("Processes:     %s\n", ptrInt(server.Metrics.ProcessCount))
			}
		}
		return nil
	},
}

// serverDeleteCmd deletes a server
var serverDeleteCmd = &cobra.Command{
	Use:     "delete <id>",
	Aliases: []string{"rm", "remove"},
	Short:   "Delete a server",
	Long:    `Delete a server from your account.`,
	Args:    cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		// Confirm deletion
		force, _ := cmd.Flags().GetBool("force")
		if !force {
			fmt.Printf("Are you sure you want to delete server '%s'? [y/N] ", server.Name)
			var confirm string
			fmt.Scanln(&confirm)
			if strings.ToLower(confirm) != "y" && strings.ToLower(confirm) != "yes" {
				fmt.Println("Cancelled.")
				return nil
			}
		}

		if err := client.DeleteServer(server.ID); err != nil {
			return fmt.Errorf("failed to delete server: %w", err)
		}

		fmt.Printf("✓ Server '%s' deleted\n", server.Name)
		return nil
	},
}

// serverUpdateCmd updates a server
var serverUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update server settings",
	Long:  `Update server name or settings.`,
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		name, _ := cmd.Flags().GetString("name")

		if name == "" {
			return fmt.Errorf("no changes specified. Use --name to update the server name")
		}

		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		updated, err := client.UpdateServer(server.ID, name)
		if err != nil {
			return fmt.Errorf("failed to update server: %w", err)
		}

		switch outputFmt {
		case "json":
			return OutputJSON(updated)
		case "yaml":
			return OutputYAML(updated)
		default:
			fmt.Printf("✓ Server updated: %s\n", updated.Name)
		}
		return nil
	},
}

// serverMetricsCmd shows server metrics
var serverMetricsCmd = &cobra.Command{
	Use:   "metrics <id>",
	Short: "View server metrics",
	Long:  `View the latest metrics for a server.`,
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		resp, err := client.GetServerMetrics(server.ID)
		if err != nil {
			return fmt.Errorf("failed to get metrics: %w", err)
		}

		if resp.Metrics == nil {
			fmt.Println("No metrics available for this server.")
			return nil
		}

		switch outputFmt {
		case "json":
			return OutputJSON(resp.Metrics)
		case "yaml":
			return OutputYAML(resp.Metrics)
		default:
			m := resp.Metrics
			fmt.Printf("Metrics for %s\n", server.Name)
			fmt.Println(strings.Repeat("=", 40))
			fmt.Println()

			fmt.Println("CPU")
			fmt.Printf("  Usage:        %s\n", ptrFloat(m.CPUUsage))
			fmt.Printf("  Cores:        %s\n", ptrInt(m.CPUCores))
			fmt.Printf("  Load Avg:     %s / %s / %s\n",
				ptrFloatRaw(m.LoadAvg1),
				ptrFloatRaw(m.LoadAvg5),
				ptrFloatRaw(m.LoadAvg15))

			fmt.Println()
			fmt.Println("Memory")
			fmt.Printf("  Total:        %s\n", ptrBytes(m.MemoryTotal))
			fmt.Printf("  Used:         %s\n", ptrBytes(m.MemoryUsed))
			fmt.Printf("  Free:         %s\n", ptrBytes(m.MemoryFree))

			fmt.Println()
			fmt.Println("Disk")
			fmt.Printf("  Total:        %s\n", ptrBytes(m.DiskTotal))
			fmt.Printf("  Used:         %s\n", ptrBytes(m.DiskUsed))
			fmt.Printf("  Free:         %s\n", ptrBytes(m.DiskFree))

			fmt.Println()
			fmt.Println("Processes")
			fmt.Printf("  Count:        %s\n", ptrInt(m.ProcessCount))
		}
		return nil
	},
}

// serverHistoryCmd shows server metrics history
var serverHistoryCmd = &cobra.Command{
	Use:   "history <id>",
	Short: "View metrics history",
	Long: `View historical metrics for a server.

Available ranges:
  1h   - Last hour (default)
  24h  - Last 24 hours
  7d   - Last 7 days
  30d  - Last 30 days`,
	Args: cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		rangeStr, _ := cmd.Flags().GetString("range")
		if rangeStr == "" {
			rangeStr = "1h"
		}

		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		history, err := client.GetServerHistory(server.ID, rangeStr)
		if err != nil {
			return fmt.Errorf("failed to get history: %w", err)
		}

		switch outputFmt {
		case "json":
			return OutputJSON(history)
		case "yaml":
			return OutputYAML(history)
		default:
			fmt.Printf("Metrics History for %s (range: %s)\n", server.Name, history.Range)
			fmt.Println(strings.Repeat("=", 50))

			if len(history.Data) == 0 {
				fmt.Println("No historical data available.")
				return nil
			}

			table := NewTable("TIME", "CPU", "MEM USED", "DISK USED")
			for _, d := range history.Data {
				table.AddRow(
					d.CollectedAt.Local().Format("01-02 15:04"),
					ptrFloat(d.CPUUsage),
					ptrBytes(d.MemoryUsed),
					ptrBytes(d.DiskUsed),
				)
			}
			table.Render()
		}
		return nil
	},
}

// serverInstallCmd shows installation command
var serverInstallCmd = &cobra.Command{
	Use:   "install <id>",
	Short: "Get agent installation command",
	Long:  `Get the command to install the vStats agent on a server.`,
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		resp, err := client.GetInstallCommand(server.ID)
		if err != nil {
			return fmt.Errorf("failed to get install command: %w", err)
		}

		switch outputFmt {
		case "json":
			return OutputJSON(resp)
		case "yaml":
			return OutputYAML(resp)
		default:
			fmt.Printf("Agent Installation for '%s'\n", server.Name)
			fmt.Println(strings.Repeat("=", 50))
			fmt.Println()
			fmt.Println("Run this command on your server:")
			fmt.Println()
			fmt.Printf("  %s\n", resp.Command)
			fmt.Println()
			fmt.Printf("Agent Key: %s\n", resp.AgentKey)
		}
		return nil
	},
}

// serverKeyCmd shows or regenerates the agent key
var serverKeyCmd = &cobra.Command{
	Use:   "key <id>",
	Short: "Show or regenerate agent key",
	Long:  `Show the agent key for a server, or regenerate it with --regenerate.`,
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := requireLogin(); err != nil {
			return err
		}

		serverID := args[0]
		regenerate, _ := cmd.Flags().GetBool("regenerate")
		client := NewClient()

		// Find server first
		server, err := findServerByNameOrID(client, serverID)
		if err != nil {
			return err
		}

		if regenerate {
			resp, err := client.RegenerateAgentKey(server.ID)
			if err != nil {
				return fmt.Errorf("failed to regenerate key: %w", err)
			}

			switch outputFmt {
			case "json":
				return OutputJSON(resp)
			case "yaml":
				return OutputYAML(resp)
			default:
				fmt.Printf("✓ New agent key for '%s':\n", server.Name)
				fmt.Printf("  %s\n", resp.AgentKey)
				fmt.Println()
				fmt.Println("Note: The old key is now invalid. Update your agent configuration.")
			}
		} else {
			switch outputFmt {
			case "json":
				return OutputJSON(map[string]string{"agent_key": server.AgentKey})
			case "yaml":
				return OutputYAML(map[string]string{"agent_key": server.AgentKey})
			default:
				fmt.Printf("Agent key for '%s':\n", server.Name)
				fmt.Printf("  %s\n", server.AgentKey)
			}
		}
		return nil
	},
}

// findServerByNameOrID finds a server by name or ID
func findServerByNameOrID(client *Client, nameOrID string) (*Server, error) {
	// First try to get by ID
	server, err := client.GetServer(nameOrID)
	if err == nil {
		return server, nil
	}

	// Try to find by name
	servers, err := client.ListServers()
	if err != nil {
		return nil, fmt.Errorf("server not found: %s", nameOrID)
	}

	for _, s := range servers {
		if s.Name == nameOrID {
			return &s, nil
		}
	}

	return nil, fmt.Errorf("server not found: %s", nameOrID)
}

// ptrFloatRaw returns a float without formatting
func ptrFloatRaw(f *float64) string {
	if f == nil {
		return "-"
	}
	return fmt.Sprintf("%.2f", *f)
}

func init() {
	// Add subcommands
	serverCmd.AddCommand(serverListCmd)
	serverCmd.AddCommand(serverCreateCmd)
	serverCmd.AddCommand(serverShowCmd)
	serverCmd.AddCommand(serverDeleteCmd)
	serverCmd.AddCommand(serverUpdateCmd)
	serverCmd.AddCommand(serverMetricsCmd)
	serverCmd.AddCommand(serverHistoryCmd)
	serverCmd.AddCommand(serverInstallCmd)
	serverCmd.AddCommand(serverKeyCmd)

	// Flags
	serverDeleteCmd.Flags().BoolP("force", "f", false, "force deletion without confirmation")
	serverUpdateCmd.Flags().StringP("name", "n", "", "new server name")
	serverHistoryCmd.Flags().StringP("range", "r", "1h", "time range (1h, 24h, 7d, 30d)")
	serverKeyCmd.Flags().Bool("regenerate", false, "regenerate the agent key")
}
