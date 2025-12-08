# vStats CLI

A command-line interface for managing vStats Cloud servers.

## Installation

### From Source

```bash
cd server-go
go build -o vstats ./cmd/cli

# Move to PATH
sudo mv vstats /usr/local/bin/
```

### Download Binary

```bash
# Linux/macOS
curl -fsSL https://vstats.zsoft.cc/cli/install.sh | bash

# Windows (PowerShell)
iwr -useb https://vstats.zsoft.cc/cli/install.ps1 | iex
```

## Quick Start

```bash
# Login to vStats Cloud
vstats login

# List servers
vstats server list

# Create a new server
vstats server create my-server

# Get agent installation command
vstats server install my-server

# View server metrics
vstats server metrics my-server
```

## Commands

### Authentication

```bash
# Login with interactive prompt
vstats login

# Login with token directly
vstats login --token <your-token>

# Show current user
vstats whoami

# Logout
vstats logout
```

### Server Management

```bash
# List all servers
vstats server list
vstats server ls

# Create a new server
vstats server create <name>

# Show server details
vstats server show <name-or-id>

# Update server name
vstats server update <name-or-id> --name <new-name>

# Delete a server
vstats server delete <name-or-id>
vstats server delete <name-or-id> --force
```

### Metrics

```bash
# View current metrics
vstats server metrics <name-or-id>

# View metrics history
vstats server history <name-or-id>
vstats server history <name-or-id> --range 24h
vstats server history <name-or-id> --range 7d
vstats server history <name-or-id> --range 30d
```

### Agent Management

```bash
# Get agent installation command
vstats server install <name-or-id>

# Show agent key
vstats server key <name-or-id>

# Regenerate agent key
vstats server key <name-or-id> --regenerate
```

### Configuration

```bash
# Show current configuration
vstats config show

# Set configuration value
vstats config set cloud_url https://api.vstats.example.com

# Show config file path
vstats config path
```

## Output Formats

The CLI supports multiple output formats:

```bash
# Table format (default)
vstats server list

# JSON format
vstats server list -o json

# YAML format
vstats server list -o yaml
```

## Global Flags

| Flag | Description |
|------|-------------|
| `--config` | Config file path (default: `~/.vstats/config.yaml`) |
| `-o, --output` | Output format: `table`, `json`, `yaml` |
| `--cloud-url` | Override vStats Cloud URL |
| `--no-color` | Disable colored output |

## Configuration File

The CLI stores configuration in `~/.vstats/config.yaml`:

```yaml
cloud_url: https://api.vstats.zsoft.cc
token: <your-jwt-token>
username: your-username
expires_at: 1234567890
```

## Examples

### Create and monitor a server

```bash
# Create a new server
vstats server create web-prod-01

# Get the installation command
vstats server install web-prod-01
# Copy and run the command on your server

# Check server status
vstats server list

# View detailed metrics
vstats server metrics web-prod-01
```

### Export server list to JSON

```bash
vstats server list -o json > servers.json
```

### Automation with shell scripts

```bash
#!/bin/bash

# Get all offline servers
vstats server list -o json | jq '.[] | select(.status == "offline") | .name'

# Check CPU usage for all servers
for server in $(vstats server list -o json | jq -r '.[].name'); do
    echo "Server: $server"
    vstats server metrics $server -o json | jq '.cpu_usage'
done
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VSTATS_CLOUD_URL` | Override default cloud URL |
| `VSTATS_TOKEN` | Authentication token |
| `NO_COLOR` | Disable colored output |

## License

MIT License - see the main repository for details.
