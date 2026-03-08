#!/usr/bin/env node
'use strict';

const path = require('path');
const { getUsageData } = require(path.join(__dirname, '..', 'lib', 'fetch'));
const { render, renderError } = require(path.join(__dirname, '..', 'lib', 'display'));

// ── Argument parsing ─────────────────────────────────────────────
const args = process.argv.slice(2);
const flagHelp  = args.includes('--help') || args.includes('-h');
const flagWatch = args.includes('--watch') || args.includes('-w');
const flagJson  = args.includes('--json');

// ── Help ─────────────────────────────────────────────────────────
if (flagHelp) {
  const chalk = require('chalk');
  const gold = chalk.hex('#c9a84c');
  const dim  = chalk.hex('#888888');
  const body = chalk.hex('#cccccc');

  console.log('');
  console.log(gold.bold('  Claude Usage Monitor'));
  console.log(dim('  Monitor your Claude Code API rate limits from the terminal'));
  console.log('');
  console.log(body('  Usage:'));
  console.log('    ' + chalk.white('claude-usage') + dim('            Show current usage'));
  console.log('    ' + chalk.white('claude-usage --watch') + dim('    Auto-refresh every 5 minutes'));
  console.log('    ' + chalk.white('claude-usage --json') + dim('     Output raw JSON data'));
  console.log('');
  console.log(body('  Options:'));
  console.log('    ' + chalk.white('--watch, -w') + dim('   Refresh every 5 minutes'));
  console.log('    ' + chalk.white('--json') + dim('        Output JSON instead of formatted display'));
  console.log('    ' + chalk.white('--help, -h') + dim('    Show this help message'));
  console.log('');
  console.log(body('  Prerequisites:'));
  console.log(dim('    - macOS with Claude Code installed and logged in'));
  console.log(dim('    - OAuth credentials stored in macOS Keychain'));
  console.log('');
  process.exit(0);
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
