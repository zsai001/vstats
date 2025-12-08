package commands

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"
	"gopkg.in/yaml.v3"
)

// loginCmd represents the login command
var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login to vStats Cloud",
	Long: `Login to vStats Cloud using a token.

You can get your token from the vStats Cloud dashboard.

Examples:
  vstats login                    # Interactive login
  vstats login --token <token>    # Login with token directly`,
	RunE: runLogin,
}

var loginToken string

func init() {
	loginCmd.Flags().StringVarP(&loginToken, "token", "t", "", "authentication token")
}

func runLogin(cmd *cobra.Command, args []string) error {
	token := loginToken

	// If no token provided, prompt for it
	if token == "" {
		fmt.Println("Login to vStats Cloud")
		fmt.Println("=====================")
		fmt.Println()
		fmt.Println("You can get your token from: " + cfg.CloudURL)
		fmt.Println()
		fmt.Print("Enter your token: ")

		// Try to read securely
		if term.IsTerminal(int(syscall.Stdin)) {
			byteToken, err := term.ReadPassword(int(syscall.Stdin))
			fmt.Println()
			if err != nil {
				return fmt.Errorf("failed to read token: %w", err)
			}
			token = string(byteToken)
		} else {
			reader := bufio.NewReader(os.Stdin)
			input, err := reader.ReadString('\n')
			if err != nil {
				return fmt.Errorf("failed to read token: %w", err)
			}
			token = strings.TrimSpace(input)
		}
	}

	if token == "" {
		return fmt.Errorf("token is required")
	}

	// Verify the token
	fmt.Println("Verifying token...")
	client := &Client{
		BaseURL:    cfg.CloudURL,
		Token:      token,
		HTTPClient: NewClient().HTTPClient,
	}

	resp, err := client.VerifyToken()
	if err != nil {
		return fmt.Errorf("authentication failed: %w", err)
	}

	if !resp.Valid {
		return fmt.Errorf("invalid token")
	}

	// Save the token
	cfg.Token = token
	cfg.Username = resp.Username
	cfg.ExpiresAt = time.Now().Add(7 * 24 * time.Hour).Unix() // JWT typically expires in 7 days

	if err := SaveConfig(); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Println()
	fmt.Printf("✓ Logged in as %s\n", resp.Username)
	fmt.Printf("  Plan: %s\n", resp.Plan)
	return nil
}

// logoutCmd represents the logout command
var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout from vStats Cloud",
	Long:  `Logout from vStats Cloud and remove stored credentials.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if !IsLoggedIn() {
			fmt.Println("Not logged in")
			return nil
		}

		username := cfg.Username
		cfg.Token = ""
		cfg.Username = ""
		cfg.ExpiresAt = 0

		if err := SaveConfig(); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}

		fmt.Printf("✓ Logged out from %s\n", username)
		return nil
	},
}

// whoamiCmd represents the whoami command
var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user information",
	Long:  `Display information about the currently logged in user.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if !IsLoggedIn() {
			return fmt.Errorf("not logged in. Run 'vstats login' first")
		}

		client := NewClient()
		resp, err := client.GetCurrentUser()
		if err != nil {
			return fmt.Errorf("failed to get user info: %w", err)
		}

		switch outputFmt {
		case "json":
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
		case "yaml":
			data, _ := yaml.Marshal(resp)
			fmt.Print(string(data))
		default:
			user := resp.User
			fmt.Println("Current User")
			fmt.Println("============")
			fmt.Printf("Username:     %s\n", user.Username)
			if user.Email != nil {
				fmt.Printf("Email:        %s\n", *user.Email)
			}
			fmt.Printf("Plan:         %s\n", user.Plan)
			fmt.Printf("Servers:      %d / %d\n", resp.ServerCount, resp.ServerLimit)
			fmt.Printf("Status:       %s\n", user.Status)
		}
		return nil
	},
}

// requireLogin checks if the user is logged in and returns an error if not
func requireLogin() error {
	if !IsLoggedIn() {
		return fmt.Errorf("not logged in. Run 'vstats login' first")
	}
	return nil
}
