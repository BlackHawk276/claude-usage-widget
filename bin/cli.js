#!/usr/bin/env node
'use strict';

const path = require('path');
const { getUsageData } = require(path.join(__dirname, '..', 'lib', 'fetch'));
const { render, renderError } = require(path.join(__dirname, '..', 'lib', 'display'));

// ── Argument parsing ─────────────────────────────────────────────
const args = process.argv.slice(2);
const flagHelp   = args.includes('--help') || args.includes('-h');
const flagWatch  = args.includes('--watch') || args.includes('-w');
const flagJson   = args.includes('--json');
const flagWidget = args.includes('--widget');

// ── Help ─────────────────────────────────────────────────────────
if (flagHelp) {
  const chalk = require('chalk');
  const gold = chalk.hex('#c9a84c');
  const dim  = chalk.hex('#888888');
  const body = chalk.hex('#cccccc');

  console.log('');
  console.log(gold.bold('  Claude Usage Monitor'));
  console.log(dim('  Monitor your Claude Code API rate limits'));
  console.log('');
  console.log(body('  Usage:'));
  console.log('    ' + chalk.white('claude-usage') + dim('              Show current usage in terminal'));
  console.log('    ' + chalk.white('claude-usage --watch') + dim('      Auto-refresh every 5 minutes'));
  console.log('    ' + chalk.white('claude-usage --widget') + dim('     Open live widget in browser'));
  console.log('    ' + chalk.white('claude-usage --json') + dim('       Output raw JSON data'));
  console.log('');
  console.log(body('  Options:'));
  console.log('    ' + chalk.white('--widget') + dim('      Open a live dashboard widget in your browser'));
  console.log('    ' + chalk.white('--watch, -w') + dim('   Refresh terminal display every 5 minutes'));
  console.log('    ' + chalk.white('--json') + dim('        Output JSON instead of formatted display'));
  console.log('    ' + chalk.white('--help, -h') + dim('    Show this help message'));
  console.log('');
  console.log(body('  Prerequisites:'));
  console.log(dim('    - macOS with Claude Code installed and logged in'));
  console.log(dim('    - OAuth credentials stored in macOS Keychain'));
  console.log('');
  process.exit(0);
}

// ── Widget mode ─────────────────────────────────────────────────

if (flagWidget) {
  const { spawn, exec } = require('child_process');
  const chalk = require('chalk');
  const gold = chalk.hex('#c9a84c');
  const dim  = chalk.hex('#888888');
  const warn = chalk.hex('#eab308');

  const pyWidgetPath = path.join(__dirname, '..', 'claude_usage_widget.py');

  console.log('');
  console.log(gold.bold('  Starting Claude Usage Widget...'));

  // Try launching the native floating widget (macOS + Python/tkinter)
  if (process.platform === 'darwin') {
    // Check if python3 + tkinter are available
    const checkCmd = 'python3 -c "import tkinter" 2>/dev/null';
    exec(checkCmd, (err) => {
      if (!err) {
        // Launch the floating desktop widget
        console.log(gold('  Launching floating desktop widget...'));
        console.log(dim('  A widget will appear in the top-right of your screen.'));
        console.log(dim('  You can drag it anywhere. Click X to close.'));
        console.log('');

        const child = spawn('python3', [pyWidgetPath], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        console.log(dim(`  Widget running (PID: ${child.pid})`));
        console.log(dim(`  To stop: kill ${child.pid}`));
        console.log('');
        process.exit(0);
      } else {
        // No tkinter — fall back to browser widget
        console.log(warn('  Python/tkinter not available. Falling back to browser widget...'));
        launchBrowserWidget();
      }
    });
  } else {
    // Non-macOS — use browser widget
    console.log(dim('  Desktop widget is macOS-only. Opening browser widget...'));
    launchBrowserWidget();
  }

  function launchBrowserWidget() {
    const { startWidgetServer } = require(path.join(__dirname, '..', 'lib', 'server'));

    startWidgetServer((port) => {
      const url = `http://localhost:${port}`;
      console.log(dim(`  Server running at ${url}`));
      console.log(gold(`  Opening widget in browser...`));
      console.log('');
      console.log(dim('  Keep this terminal open. Press Ctrl+C to stop.'));
      console.log('');

      const platform = process.platform;
      let cmd;
      if (platform === 'darwin') cmd = `open "${url}"`;
      else if (platform === 'win32') cmd = `start "" "${url}"`;
      else cmd = `xdg-open "${url}"`;

      exec(cmd, (err) => {
        if (err) {
          console.log(warn('  Could not open browser automatically.'));
          console.log(chalk.white(`  Open this URL manually: ${url}`));
        }
      });
    });

    process.on('SIGINT', () => {
      console.log('');
      console.log(dim('  Widget stopped.'));
      process.exit(0);
    });
  }

  return; // don't fall through to run()
}

// ── Main logic ───────────────────────────────────────────────────

async function run() {
  try {
    const data = await getUsageData();

    if (flagJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log('');
      console.log(render(data));
      console.log('');
    }
  } catch (err) {
    if (flagJson) {
      console.error(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.log('');
      console.log(renderError(err));
      console.log('');
    }
    if (!flagWatch) process.exit(1);
  }
}

async function watchLoop() {
  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Initial run
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
  await run();

  const chalk = require('chalk');
  const dim = chalk.hex('#888888');
  console.log(dim('  Watching... refreshes every 5 minutes. Press Ctrl+C to exit.'));

  setInterval(async () => {
    process.stdout.write('\x1b[2J\x1b[H'); // clear screen
    await run();
    console.log(dim('  Watching... refreshes every 5 minutes. Press Ctrl+C to exit.'));
  }, INTERVAL_MS);
}

// ── Entry point ──────────────────────────────────────────────────

if (flagWatch) {
  watchLoop();
} else {
  run();
}
