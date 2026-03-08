#!/bin/bash
# Start the Claude Usage Widget
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WIDGET="$SCRIPT_DIR/claude_usage_widget.py"
PID_FILE="$SCRIPT_DIR/.widget.pid"

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Widget is already running (PID $OLD_PID)"
        echo "Run ./stop_widget.sh to stop it first."
        exit 0
    fi
fi

echo "Starting Claude Usage Widget..."
python3 "$WIDGET" &
PID=$!
echo $PID > "$PID_FILE"
echo "Widget started (PID $PID)"
echo "A floating widget should appear in the top-right of your screen."
echo "You can drag it anywhere. Click X to close, or run ./stop_widget.sh"
