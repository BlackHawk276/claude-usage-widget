#!/bin/bash
# Install a LaunchAgent to auto-start the widget on login

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.claude.usage-widget"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
PYTHON3=$(which python3)
WIDGET="$SCRIPT_DIR/claude_usage_widget.py"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_NAME}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${PYTHON3}</string>
        <string>${WIDGET}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardErrorPath</key>
    <string>/tmp/claude-usage-widget.err</string>
</dict>
</plist>
EOF

echo "LaunchAgent installed at: $PLIST_PATH"
echo ""
echo "The widget will auto-start on login."
echo "To start now:    launchctl load $PLIST_PATH"
echo "To stop:         launchctl unload $PLIST_PATH"
echo "To uninstall:    rm $PLIST_PATH"
