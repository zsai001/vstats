package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

const (
	DefaultCloudURL = "https://api.vstats.zsoft.cc"
)

// Config represents the CLI configuration
type Config struct {
	CloudURL  string `yaml:"cloud_url" json:"cloud_url"`
	Token     string `yaml:"token,omitempty" json:"token,omitempty"`
	Username  string `yaml:"username,omitempty" json:"username,omitempty"`
	ExpiresAt int64  `yaml:"expires_at,omitempty" json:"expires_at,omitempty"`
}

var cfg = &Config{
	CloudURL: DefaultCloudURL,
}

// GetConfigDir returns the configuration directory
func GetConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".vstats"), nil
}

// GetConfigPath returns the configuration file path
func GetConfigPath() (string, error) {
	dir, err := GetConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// LoadConfig loads the configuration from file
func LoadConfig(path string) error {
	if path == "" {
		var err error
		path, err = GetConfigPath()
		if err != nil {
			return err
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No config file is OK
		}
		return err
	}

	return yaml.Unmarshal(data, cfg)
}

// SaveConfig saves the configuration to file
func SaveConfig() error {
	path, err := GetConfigPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// GetConfig returns the current configuration
func GetConfig() *Config {
	return cfg
}

// IsLoggedIn checks if user is logged in
func IsLoggedIn() bool {
	return cfg.Token != ""
}

// configCmd represents the config command
var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage CLI configuration",
	Long:  `View and manage vStats CLI configuration.`,
}

var configShowCmd = &cobra.Command{
	Use:   "show",
	Short: "Show current configuration",
	RunE: func(cmd *cobra.Command, args []string) error {
		// Create a copy without sensitive data for display
		display := struct {
			CloudURL  string `yaml:"cloud_url" json:"cloud_url"`
			Username  string `yaml:"username,omitempty" json:"username,omitempty"`
			LoggedIn  bool   `yaml:"logged_in" json:"logged_in"`
			ExpiresAt int64  `yaml:"expires_at,omitempty" json:"expires_at,omitempty"`
		}{
			CloudURL:  cfg.CloudURL,
			Username:  cfg.Username,
			LoggedIn:  IsLoggedIn(),
			ExpiresAt: cfg.ExpiresAt,
		}

		switch outputFmt {
		case "json":
			data, _ := json.MarshalIndent(display, "", "  ")
			fmt.Println(string(data))
		case "yaml":
			data, _ := yaml.Marshal(display)
			fmt.Print(string(data))
		default:
			fmt.Println("vStats CLI Configuration")
			fmt.Println("========================")
			fmt.Printf("Cloud URL:  %s\n", display.CloudURL)
			fmt.Printf("Username:   %s\n", display.Username)
			fmt.Printf("Logged In:  %v\n", display.LoggedIn)
		}
		return nil
	},
}

var configSetCmd = &cobra.Command{
	Use:   "set <key> <value>",
	Short: "Set a configuration value",
	Long: `Set a configuration value.

Available keys:
  cloud_url   The vStats Cloud API URL`,
	Args: cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key, value := args[0], args[1]

		switch key {
		case "cloud_url":
			cfg.CloudURL = value
		default:
			return fmt.Errorf("unknown configuration key: %s", key)
		}

		if err := SaveConfig(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}

		fmt.Printf("✓ Configuration updated: %s = %s\n", key, value)
		return nil
	},
}

var configPathCmd = &cobra.Command{
	Use:   "path",
	Short: "Show configuration file path",
	RunE: func(cmd *cobra.Command, args []string) error {
		path, err := GetConfigPath()
		if err != nil {
			return err
		}
		fmt.Println(path)
		return nil
	},
}

func init() {
	configCmd.AddCommand(configShowCmd)
	configCmd.AddCommand(configSetCmd)
	configCmd.AddCommand(configPathCmd)
}
