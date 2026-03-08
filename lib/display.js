'use strict';

const chalk = require('chalk');

// ── Color palette ────────────────────────────────────────────────
const gold      = chalk.hex('#c9a84c');
const goldBright= chalk.hex('#d4a843');
const primary   = chalk.hex('#e0e0e0');
const body      = chalk.hex('#cccccc');
const dim       = chalk.hex('#888888');
const green     = chalk.hex('#22c55e');
const yellow    = chalk.hex('#eab308');
const orange    = chalk.hex('#f97316');
const red       = chalk.hex('#ef4444');

// ── Box-drawing characters ───────────────────────────────────────
const BOX = {
  tl: '\u256D', tr: '\u256E',
  bl: '\u2570', br: '\u256F',
  h:  '\u2500', v:  '\u2502',
};

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Strip ANSI escape codes for visible-length calculations.
 */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Pick a color function based on utilization (0.0 - 1.0).
 */
function utilizationColor(value) {
  if (value === null || value === undefined) return dim;
  const pct = value * 100;
  if (pct >= 90) return red;
  if (pct >= 75) return orange;
  if (pct >= 50) return yellow;
  return green;
}

/**
 * Format a utilization value as a percentage string.
 */
function fmtPercent(value) {
  if (value === null || value === undefined) return ' N/A';
  return (value * 100).toFixed(1) + '%';
}

/**
 * Build a progress bar string.
 *   width: total character width of the bar (inside brackets)
 */
function progressBar(value, width) {
  if (value === null || value === undefined) {
    return dim('[' + '\u2591'.repeat(width) + ']');
  }
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const colorFn = utilizationColor(value);
  return (
    dim('[') +
    colorFn('\u2588'.repeat(filled)) +
    dim('\u2591'.repeat(empty)) +
    dim(']')
  );
}

/**
 * Format a unix epoch reset time as a relative duration from now.
 */
function fmtReset(epoch) {
  if (epoch === null || epoch === undefined) return '';
  const now = Math.floor(Date.now() / 1000);
  let diff = epoch - now;
  if (diff <= 0) return dim('resetting now');

  const days = Math.floor(diff / 86400);
  diff %= 86400;
  const hours = Math.floor(diff / 3600);
  diff %= 3600;
  const minutes = Math.floor(diff / 60);

  const parts = [];
  if (days > 0) parts.push(days + 'd');
  if (hours > 0) parts.push(hours + 'h');
  if (minutes > 0) parts.push(minutes + 'm');

  return dim('resets in ') + body(parts.join(' ') || '<1m');
}

/**
 * Format a status string with color.
 */
function fmtStatus(status) {
  if (!status) return dim('unknown');
  if (status === 'allowed') return green(status);
  if (status === 'limited') return red(status);
  return yellow(status);
}

// ── Main render ──────────────────────────────────────────────────

/**
 * Render the usage data to a string for printing.
 */
function render(data) {
  const W = 68; // inner content width (visible characters between borders)

  // Wrap content in box borders, right-padding to fill the row
  const line = (content) => {
    const vis = stripAnsi(content).length;
    const pad = W - vis;
    return gold(BOX.v) + ' ' + content + (pad > 0 ? ' '.repeat(pad) : '') + ' ' + gold(BOX.v);
  };

  const emptyLine = () => gold(BOX.v) + ' '.repeat(W + 2) + gold(BOX.v);

  const divider = () => gold(BOX.v) + ' ' + dim(BOX.h.repeat(W)) + ' ' + gold(BOX.v);

  const topBorder = gold(BOX.tl + BOX.h.repeat(W + 2) + BOX.tr);
  const bottomBorder = gold(BOX.bl + BOX.h.repeat(W + 2) + BOX.br);

  const BAR_W = 20;

  // Build a limit row: "Label:  XX.X% [████████░░░░]  resets in Xd Xh Xm"
  function limitRow(label, util, reset) {
    const pct = fmtPercent(util);
    const colorFn = utilizationColor(util);

    // Fixed-width label area (14 chars: "Sonnet Limit: ")
    const labelStr = body(label + ':');
    // Right-align percentage in a 6-char field
    const pctPad = 6 - pct.length;
    const pctStr = (pctPad > 0 ? ' '.repeat(pctPad) : '') + colorFn(pct);
    const bar = progressBar(util, BAR_W);
    const resetStr = fmtReset(reset);

    const content = labelStr + ' ' + pctStr + ' ' + bar + '  ' + resetStr;
    return line(content);
  }

  const lines = [];

  // Top border
  lines.push(topBorder);

  // Title (centered)
  const title = 'Claude Usage Monitor';
  const titlePadL = Math.floor((W - title.length) / 2);
  const titlePadR = W - title.length - titlePadL;
  lines.push(
    gold(BOX.v) +
    ' '.repeat(titlePadL + 1) +
    goldBright.bold(title) +
    ' '.repeat(titlePadR + 1) +
    gold(BOX.v)
  );

  lines.push(divider());

  // Account info
  const acct = data.account || {};
  const nameStr = primary(acct.displayName || 'Unknown');
  const subStr = dim(' | ') + body(acct.subscriptionType || 'Unknown');
  const tierStr = dim(' | Tier: ') + body(acct.rateLimitTier || 'Unknown');
  lines.push(line(nameStr + subStr + tierStr));

  lines.push(emptyLine());

  // Rate limit bars
  const lim = data.limits || {};
  const fh = lim.fiveHour || {};
  const wk = lim.weekly || {};
  const sn = lim.sonnet || {};

  lines.push(limitRow('5-Hour Limit', fh.utilization, fh.reset));
  lines.push(limitRow('Weekly Limit', wk.utilization, wk.reset));
  lines.push(limitRow('Sonnet Limit', sn.utilization, sn.reset));

  lines.push(emptyLine());
  lines.push(divider());

  // Status + timestamp row
  const overallStatus = (lim.overall && lim.overall.status) || 'unknown';
  const statusStr = dim('Status: ') + fmtStatus(overallStatus);
  const ts = dim(new Date(data.timestamp).toLocaleTimeString());
  const statusVis = stripAnsi(statusStr).length;
  const tsVis = stripAnsi(ts).length;
  const gap = W - statusVis - tsVis;
  const finalContent = statusStr + (gap > 0 ? ' '.repeat(gap) : '  ') + ts;
  lines.push(line(finalContent));

  // Bottom border
  lines.push(bottomBorder);

  return lines.join('\n');
}

/**
 * Render an error box.
 */
function renderError(err) {
  const W = 58;
  const hLine = BOX.h.repeat(W + 2);

  const lines = [];
  lines.push(red(BOX.tl + hLine + BOX.tr));

  const title = 'Error';
  const padL = Math.floor((W - title.length) / 2);
  const padR = W - title.length - padL;
  lines.push(red(BOX.v) + ' '.repeat(padL + 1) + red.bold(title) + ' '.repeat(padR + 1) + red(BOX.v));
  lines.push(red(BOX.v) + ' '.repeat(W + 2) + red(BOX.v));

  // Word-wrap error message
  const msg = err.message || String(err);
  const maxLine = W - 2;
  for (let i = 0; i < msg.length; i += maxLine) {
    const chunk = msg.slice(i, i + maxLine);
    lines.push(red(BOX.v) + '  ' + body(chunk) + ' '.repeat(Math.max(0, W - chunk.length)) + red(BOX.v));
  }

  lines.push(red(BOX.v) + ' '.repeat(W + 2) + red(BOX.v));
  lines.push(red(BOX.bl + hLine + BOX.br));

  return lines.join('\n');
}

module.exports = {
  render,
  renderError,
  utilizationColor,
  progressBar,
  fmtPercent,
  fmtReset,
  fmtStatus,
};
