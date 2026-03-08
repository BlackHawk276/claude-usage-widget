#!/usr/bin/env node
'use strict';

const path = require('path');
const { getUsageData, setDebug } = require(path.join(__dirname, '..', 'lib', 'fetch'));
const { render, renderError } = require(path.join(__dirname, '..', 'lib', 'display'));

// ── Argument parsing ─────────────────────────────────────────────
const args = process.argv.slice(2);
const flagHelp   = args.includes('--help') || args.includes('-h');
const flagWatch  = args.includes('--watch') || args.includes('-w');
const flagJson   = args.includes('--json');
const flagWidget = args.includes('--widget');
const flagDebug  = args.includes('--debug');

if (flagDebug) setDebug(true);

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
  console.log('    ' + chalk.white('--debug') + dim('       Show diagnostic info for troubleshooting'));
  console.log('    ' + chalk.white('--help, -h') + dim('    Show this help message'));
  console.log('');
  console.log(body('  Prerequisites:'));
  console.log(dim('    - macOS with Claude Code installed and logged in'));
  console.log(dim('    - Run "claude" at least once and log in with your Anthropic account'));
  console.log('');
  process.exit(0);
}

// ── Widget mode ─────────────────────────────────────────────────

if (flagWidget) {
  const { spawn, exec, execSync } = require('child_process');
  const fs = require('fs');
  const chalk = require('chalk');
  const gold = chalk.hex('#c9a84c');
  const dim  = chalk.hex('#888888');
  const warn = chalk.hex('#eab308');

  const pyWidgetPath = path.join(__dirname, '..', 'claude_usage_widget.py');

  console.log('');
  console.log(gold.bold('  Starting Claude Usage Widget...'));

  // On macOS, try the native floating widget first
  if (process.platform === 'darwin') {
    let hasPython = false;
    let hasTkinter = false;

    // Check python3
    try {
      execSync('python3 --version', { stdio: 'pipe' });
      hasPython = true;
    } catch (_) {}

    // Check tkinter
    if (hasPython) {
      try {
        execSync('python3 -c "import tkinter"', { stdio: 'pipe' });
        hasTkinter = true;
      } catch (_) {}
    }

    if (hasPython && hasTkinter && fs.existsSync(pyWidgetPath)) {
      console.log(gold('  Launching floating desktop widget...'));

      // Launch with stderr piped so we can detect crashes
      const child = spawn('python3', [pyWidgetPath], {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      // Give it 3 seconds to start — if it crashes, fall back to browser
      const timeout = setTimeout(() => {
        // Still alive after 3s — it's working
        child.stderr.destroy();
        child.unref();
        console.log(dim('  Widget is running on your screen.'));
        console.log(dim('  Drag it anywhere. Click X to close.'));
        console.log(dim(`  To stop: kill ${child.pid}`));
        console.log('');
        process.exit(0);
      }, 3000);

      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          console.log(warn('  Desktop widget failed to start.'));
          if (stderr.trim()) {
            console.log(dim('  Error: ' + stderr.trim().split('\n').pop()));
          }
          console.log(dim('  Falling back to browser widget...\n'));
          launchBrowserWidget();
        }
      });

      return; // don't fall through
    } else {
      if (!hasPython) console.log(dim('  python3 not found.'));
      else if (!hasTkinter) console.log(dim('  python3 tkinter not available.'));
      console.log(dim('  Opening browser widget instead...\n'));
    }
  }

  // Fallback: browser widget
  launchBrowserWidget();

  function launchBrowserWidget() {
    const { startWidgetServer } = require(path.join(__dirname, '..', 'lib', 'server'));

    startWidgetServer((port) => {
      const url = `http://localhost:${port}`;
      console.log(gold(`  Widget live at: ${url}`));
      console.log('');
      console.log(dim('  Auto-refreshes every 5 minutes.'));
      console.log(dim('  Keep this terminal open. Press Ctrl+C to stop.'));
      console.log('');

      if (process.platform === 'darwin') {
        // Try Chrome/Chromium --app mode first (minimal popup, no browser chrome)
        const browsers = [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        ];

        let launched = false;
        for (const browser of browsers) {
          if (fs.existsSync(browser)) {
            console.log(gold('  Opening as floating widget window...'));
            const child = spawn(browser, [
              `--app=${url}`,
              '--window-size=440,520',
              '--window-position=1000,80',
              '--disable-extensions',
              '--no-first-run',
            ], { detached: true, stdio: 'ignore' });
            child.unref();
            launched = true;
            break;
          }
        }

        if (!launched) {
          // Fallback: use AppleScript to open Safari as a small popup
          console.log(gold('  Opening widget in Safari...'));
          const script = `
            tell application "Safari"
              activate
              set theDoc to make new document with properties {URL:"${url}"}
              delay 1
              tell window 1
                set bounds to {960, 60, 1400, 560}
              end tell
            end tell
          `;
          exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, (err) => {
            if (err) {
              exec(`open "${url}"`, () => {});
            }
          });
        }
      } else if (process.platform === 'win32') {
        exec(`start "" "${url}"`, () => {});
      } else {
        exec(`xdg-open "${url}"`, () => {});
      }
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
