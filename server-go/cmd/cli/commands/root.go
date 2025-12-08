package commands

import (
	"fmt"

	"github.com/spf13/cobra"
)

var (
	version   = "dev"
	cfgFile   string
	outputFmt string
	cloudURL  string
	noColor   bool
)

// rootCmd represents the base command when called without any subcommands
var rootCmd = &cobra.Command{
	Use:   "vstats",
	Short: "vStats CLI - Server monitoring management tool",
	Long: `vStats CLI is a command-line interface for managing your vStats Cloud servers.

It allows you to:
  - Login and authenticate with vStats Cloud
  - List, create, and manage servers
  - View real-time metrics and history
  - Generate agent installation commands
  - Export data in various formats (table, json, yaml)

Examples:
  vstats login                    # Login to vStats Cloud
  vstats server list              # List all servers
  vstats server create web-01     # Create a new server
  vstats server metrics web-01    # View server metrics`,
	SilenceUsage: true,
}

// Execute adds all child commands to the root command and sets flags appropriately.
func Execute() error {
	return rootCmd.Execute()
}

// SetVersion sets the version string
func SetVersion(v string) {
	version = v
}

func init() {
	cobra.OnInitialize(initConfig)

	// Global flags
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.vstats/config.yaml)")
	rootCmd.PersistentFlags().StringVarP(&outputFmt, "output", "o", "table", "output format (table, json, yaml)")
	rootCmd.PersistentFlags().StringVar(&cloudURL, "cloud-url", "", "vStats Cloud URL (default from config)")
	rootCmd.PersistentFlags().BoolVar(&noColor, "no-color", false, "disable colored output")

	// Add subcommands
	rootCmd.AddCommand(versionCmd)
	rootCmd.AddCommand(loginCmd)
	rootCmd.AddCommand(logoutCmd)
	rootCmd.AddCommand(serverCmd)
	rootCmd.AddCommand(configCmd)
	rootCmd.AddCommand(whoamiCmd)
}

func initConfig() {
	// Load configuration
	if err := LoadConfig(cfgFile); err != nil {
		// Config file not found is OK for some commands
		if cfgFile != "" {
			fmt.Printf("Warning: Could not load config file: %v\n", err)
		}
	}

	// Override cloud URL from flag
	if cloudURL != "" {
		cfg.CloudURL = cloudURL
	}
}

// versionCmd shows version info
var versionCmd = &cobra.Command{
	Use:   "version",
	Short: "Print the version number",
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Printf("vstats version %s\n", version)
	},
}
