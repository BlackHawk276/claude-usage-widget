# Claude Usage Widget

Monitor your Claude Code API rate limits from the terminal. Displays a beautiful dashboard showing your 5-hour, weekly, and Sonnet usage limits with color-coded progress bars.

![Screenshot placeholder](screenshot.png)

## Quick Start

Run directly without installing:

```bash
npx claude-usage-widget
```

Or install globally:

```bash
npm install -g claude-usage-widget
claude-usage
```

## Prerequisites

- **macOS** (uses macOS Keychain to read credentials)
- **Claude Code** must be installed and you must be logged in
- OAuth credentials are automatically stored in your macOS Keychain by Claude Code

## Features

- Color-coded progress bars for 5-hour, weekly, and Sonnet rate limits
- Green/yellow/orange/red coloring based on utilization level
- Relative reset times (e.g., "resets in 2h 15m")
- Account info display (name, subscription type, tier)
- Overall rate limit status indicator
- Watch mode for continuous monitoring
- JSON output for scripting and integrations

## Options

| Flag | Description |
|------|-------------|
| `--watch`, `-w` | Auto-refresh the display every 5 minutes |
| `--json` | Output raw JSON data instead of the formatted display |
| `--help`, `-h` | Show help message |

## How It Works

1. **Reads credentials** from the macOS Keychain (`Claude Code-credentials`)
2. **Makes a minimal API call** to `https://api.anthropic.com/v1/messages` using your OAuth token. The call sends a single-character message with `max_tokens: 1` to minimize usage.
3. **Parses rate limit headers** from the API response, including:
   - `anthropic-ratelimit-unified-5h-utilization` (5-hour rolling window)
   - `anthropic-ratelimit-unified-7d-utilization` (weekly limit)
   - `anthropic-ratelimit-unified-7d_sonnet-utilization` (Sonnet weekly limit)
   - Reset times and status for each limit
4. **Displays** the data in a formatted terminal dashboard

## Python Floating Widget

This package also includes a Python-based floating desktop widget (`claude_usage_widget.py`) that provides an always-on-top transparent overlay. See the Python script and its associated shell scripts (`start_widget.sh`, `stop_widget.sh`, `install_autostart.sh`) for the desktop widget alternative.

## License

MIT
