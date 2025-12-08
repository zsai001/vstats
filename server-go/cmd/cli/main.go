package main

import (
	"fmt"
	"os"

	"vstats/cmd/cli/commands"
)

var Version = "dev"

func main() {
	commands.SetVersion(Version)

	if err := commands.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
