package commands

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"gopkg.in/yaml.v3"
)

// Colors for terminal output
const (
	ColorReset  = "\033[0m"
	ColorRed    = "\033[31m"
	ColorGreen  = "\033[32m"
	ColorYellow = "\033[33m"
	ColorBlue   = "\033[34m"
	ColorCyan   = "\033[36m"
	ColorGray   = "\033[90m"
)

// color returns colored text if color is enabled
func color(c, text string) string {
	if noColor {
		return text
	}
	return c + text + ColorReset
}

// statusColor returns the appropriate color for a status
func statusColor(status string) string {
	switch strings.ToLower(status) {
	case "online", "active", "healthy":
		return ColorGreen
	case "offline", "inactive", "unhealthy":
		return ColorRed
	case "pending", "connecting":
		return ColorYellow
	default:
		return ColorGray
	}
}

// statusIcon returns an icon for a status
func statusIcon(status string) string {
	switch strings.ToLower(status) {
	case "online", "active", "healthy":
		return "●"
	case "offline", "inactive", "unhealthy":
		return "○"
	case "pending", "connecting":
		return "◐"
	default:
		return "?"
	}
}

// formatStatus formats a status with color and icon
func formatStatus(status string) string {
	icon := statusIcon(status)
	c := statusColor(status)
	return color(c, icon+" "+status)
}

// formatBytes formats bytes to human readable format
func formatBytes(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)

	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.1f TB", float64(bytes)/TB)
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/GB)
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/MB)
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/KB)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

// formatPercent formats a percentage
func formatPercent(value float64) string {
	return fmt.Sprintf("%.1f%%", value)
}

// formatDuration formats a duration in human readable format
func formatDuration(d time.Duration) string {
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh %dm", int(d.Hours()), int(d.Minutes())%60)
	}
	days := int(d.Hours() / 24)
	hours := int(d.Hours()) % 24
	return fmt.Sprintf("%dd %dh", days, hours)
}

// formatTime formats a time
func formatTime(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.Local().Format("2006-01-02 15:04:05")
}

// formatTimeAgo formats a time as relative time
func formatTimeAgo(t *time.Time) string {
	if t == nil {
		return "-"
	}
	d := time.Since(*t)
	if d < time.Minute {
		return "just now"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	days := int(d.Hours() / 24)
	return fmt.Sprintf("%dd ago", days)
}

// Table represents a table for output
type Table struct {
	Headers []string
	Rows    [][]string
	Writer  io.Writer
}

// NewTable creates a new table
func NewTable(headers ...string) *Table {
	return &Table{
		Headers: headers,
		Rows:    make([][]string, 0),
		Writer:  os.Stdout,
	}
}

// AddRow adds a row to the table
func (t *Table) AddRow(cells ...string) {
	t.Rows = append(t.Rows, cells)
}

// Render renders the table
func (t *Table) Render() {
	w := tabwriter.NewWriter(t.Writer, 0, 0, 2, ' ', 0)

	// Print headers
	headerLine := strings.Join(t.Headers, "\t")
	fmt.Fprintln(w, color(ColorCyan, headerLine))

	// Print rows
	for _, row := range t.Rows {
		fmt.Fprintln(w, strings.Join(row, "\t"))
	}

	w.Flush()
}

// OutputJSON outputs data as JSON
func OutputJSON(data interface{}) error {
	output, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}

// OutputYAML outputs data as YAML
func OutputYAML(data interface{}) error {
	output, err := yaml.Marshal(data)
	if err != nil {
		return err
	}
	fmt.Print(string(output))
	return nil
}

// ptrString safely dereferences a string pointer
func ptrString(s *string) string {
	if s == nil {
		return "-"
	}
	return *s
}

// ptrFloat safely dereferences a float64 pointer
func ptrFloat(f *float64) string {
	if f == nil {
		return "-"
	}
	return formatPercent(*f)
}

// ptrInt safely dereferences an int pointer
func ptrInt(i *int) string {
	if i == nil {
		return "-"
	}
	return fmt.Sprintf("%d", *i)
}

// ptrBytes safely formats a byte pointer
func ptrBytes(b *int64) string {
	if b == nil {
		return "-"
	}
	return formatBytes(*b)
}
