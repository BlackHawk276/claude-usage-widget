#!/bin/bash
# Stop the Claude Usage Widget
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/.widget.pid"

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "Widget stopped (PID $PID)"
    else
        echo "Widget was not running"
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found. Trying to find process..."
    pkill -f "claude_usage_widget.py" && echo "Widget stopped" || echo "Widget not running"
fi
