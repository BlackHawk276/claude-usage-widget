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
  const { exec } = require('child_process');
  const chalk = require('chalk');
  const gold = chalk.hex('#c9a84c');
  const dim  = chalk.hex('#888888');

  console.log('');
  console.log(gold.bold('  Starting Claude Usage Widget...'));

  // Always use the browser widget — it works everywhere, no Python needed
  const { startWidgetServer } = require(path.join(__dirname, '..', 'lib', 'server'));

  startWidgetServer((port) => {
    const url = `http://localhost:${port}`;
    console.log(gold(`  Widget live at: ${url}`));
    console.log('');
    console.log(dim('  Auto-refreshes every 5 minutes.'));
    console.log(dim('  Keep this terminal open. Press Ctrl+C to stop.'));
    console.log('');

    // Open browser (cross-platform)
    let cmd;
    if (process.platform === 'darwin') cmd = `open "${url}"`;
    else if (process.platform === 'win32') cmd = `start "" "${url}"`;
    else cmd = `xdg-open "${url}"`;

    exec(cmd, (err) => {
      if (err) {
        console.log(chalk.hex('#eab308')('  Could not open browser automatically.'));
        console.log(chalk.white(`  Open this URL manually: ${url}`));
      }
    });
  });

  process.on('SIGINT', () => {
    console.log('');
    console.log(dim('  Widget stopped.'));
    process.exit(0);
  });

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
