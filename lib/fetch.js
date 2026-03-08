'use strict';

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Debug flag (set by CLI)
let DEBUG = false;
function setDebug(val) { DEBUG = val; }
function debug(msg) { if (DEBUG) console.error('[DEBUG] ' + msg); }

/**
 * Read the Claude Code OAuth token from macOS Keychain.
 */
function readKeychainToken() {
  if (process.platform !== 'darwin') {
    throw new Error(
      'This tool only works on macOS.\n' +
      'It reads Claude Code credentials from the macOS Keychain.'
    );
  }

  try {
    debug('Reading keychain entry "Claude Code-credentials"...');
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    debug('Keychain read OK, length=' + raw.length);
    return raw;
  } catch (err) {
    debug('Keychain read FAILED: ' + err.message);
    throw new Error(
      'Could not read Claude Code credentials from macOS Keychain.\n\n' +
      'Troubleshooting:\n' +
      '  1. Make sure Claude Code is installed (npm install -g @anthropic-ai/claude-code)\n' +
      '  2. Run "claude" and log in with your Anthropic account\n' +
      '  3. Try again after logging in\n\n' +
      'The credentials are stored when you first log in to Claude Code.'
    );
  }
}

/**
 * Parse the keychain credential blob.
 */
function parseKeychainData(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    debug('JSON parse failed: ' + err.message);
    debug('Raw data (first 100 chars): ' + raw.substring(0, 100));
    throw new Error('Failed to parse keychain data. The stored credentials may be corrupted.\nTry logging out and back in to Claude Code.');
  }

  debug('Parsed keychain data, keys: ' + JSON.stringify(Object.keys(data)));

  // Current format: { claudeAiOauth: { accessToken, ... } }
  const oauth = data.claudeAiOauth || data.oauthAccount;

  if (oauth && oauth.accessToken) {
    // Check token expiry
    if (oauth.expiresAt) {
      const expiresIn = oauth.expiresAt - Date.now();
      debug('Token expires in ' + Math.round(expiresIn / 1000) + 's');
      if (expiresIn < 0) {
        throw new Error(
          'Your Claude Code OAuth token has expired.\n\n' +
          'Fix: Open Claude Code in your terminal ("claude") — it will\n' +
          'automatically refresh the token. Then try this tool again.'
        );
      }
    }

    return {
      accessToken: oauth.accessToken,
      subscriptionType: oauth.subscriptionType || null,
      rateLimitTier: oauth.rateLimitTier || null,
    };
  }

  // Try legacy or alternative structures
  if (data.accessToken) {
    debug('Found accessToken at root level');
    return {
      accessToken: data.accessToken,
      subscriptionType: data.subscriptionType || null,
      rateLimitTier: data.rateLimitTier || null,
    };
  }

  // Array format
  if (Array.isArray(data)) {
    debug('Data is array with ' + data.length + ' entries');
    for (const entry of data) {
      if (!entry) continue;
      const inner = entry.claudeAiOauth || entry.oauthAccount || entry;
      if (inner && inner.accessToken) {
        return {
          accessToken: inner.accessToken,
          subscriptionType: inner.subscriptionType || null,
          rateLimitTier: inner.rateLimitTier || null,
        };
      }
    }
  }

  debug('Could not find accessToken in data structure');
  throw new Error(
    'No valid OAuth credentials found in keychain.\n' +
    'The credential format may have changed. Try logging out and back in to Claude Code.'
  );
}

/**
 * Read ~/.claude.json for supplementary account info.
 */
function readClaudeConfig() {
  try {
    const configPath = path.join(os.homedir(), '.claude.json');
    debug('Reading config from ' + configPath);
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    debug('Config read OK, has oauthAccount=' + !!config.oauthAccount);
    return config;
  } catch (err) {
    debug('Config read failed (this is OK): ' + err.message);
    return null;
  }
}

/**
 * Make a minimal API call to get rate limit headers.
 */
function fetchRateLimits(accessToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });

    debug('Making API call to api.anthropic.com/v1/messages...');

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        debug('API response: status=' + res.statusCode);

        // Log all rate limit headers in debug mode
        if (DEBUG) {
          const rlHeaders = Object.entries(res.headers)
            .filter(([k]) => k.includes('ratelimit'))
            .map(([k, v]) => `  ${k}: ${v}`);
          if (rlHeaders.length > 0) {
            debug('Rate limit headers:\n' + rlHeaders.join('\n'));
          } else {
            debug('WARNING: No rate limit headers found in response!');
            debug('All response headers:\n' +
              Object.entries(res.headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')
            );
          }
        }

        // Check for API errors
        if (res.statusCode === 401) {
          reject(new Error(
            'Authentication failed (401).\n\n' +
            'Your token may be expired. Open Claude Code ("claude") to\n' +
            'refresh it, then try again.'
          ));
          return;
        }

        if (res.statusCode === 403) {
          let msg = 'Access forbidden (403).';
          try {
            const parsed = JSON.parse(body);
            if (parsed.error && parsed.error.message) {
              msg = parsed.error.message;
            }
          } catch (_) {}
          reject(new Error(msg));
          return;
        }

        // 429 is OK — we still get rate limit headers
        if (res.statusCode === 429) {
          debug('Got 429 but still parsing headers for rate limit info');
        }

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
        });
      });
    });

    req.on('error', (err) => {
      debug('API request error: ' + err.message);
      reject(new Error(
        'API request failed: ' + err.message + '\n\n' +
        'Check your internet connection and try again.'
      ));
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('API request timed out after 15 seconds.\nCheck your internet connection.'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Parse the unified rate limit headers from the API response.
 */
function parseRateLimitHeaders(headers) {
  const prefix = 'anthropic-ratelimit-unified-';

  const get = (key) => {
    const val = headers[prefix + key];
    return val !== undefined ? val : null;
  };

  const parseFloat_ = (val) => {
    if (val === null || val === undefined) return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  const parseInt_ = (val) => {
    if (val === null || val === undefined) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  };

  const result = {
    overall: {
      status: get('status'),
    },
    fiveHour: {
      utilization: parseFloat_(get('5h-utilization')),
      reset: parseInt_(get('5h-reset')),
      status: get('5h-status'),
    },
    weekly: {
      utilization: parseFloat_(get('7d-utilization')),
      reset: parseInt_(get('7d-reset')),
      status: get('7d-status'),
    },
    sonnet: {
      utilization: parseFloat_(get('7d_sonnet-utilization')),
      reset: parseInt_(get('7d_sonnet-reset')),
      status: get('7d_sonnet-status'),
    },
  };

  debug('Parsed limits: 5h=' + result.fiveHour.utilization +
    ', 7d=' + result.weekly.utilization +
    ', sonnet=' + result.sonnet.utilization +
    ', overall=' + result.overall.status);

  return result;
}

/**
 * High-level: fetch everything needed for the display.
 */
async function getUsageData() {
  // 1. Read keychain
  const raw = readKeychainToken();
  const creds = parseKeychainData(raw);

  // 2. Read config for display name
  const config = readClaudeConfig();
  let displayName = null;
  if (config && config.oauthAccount) {
    displayName = config.oauthAccount.displayName || null;
  }
  if (!displayName) {
    displayName = 'Claude User';
  }

  // 3. Fetch rate limits
  const response = await fetchRateLimits(creds.accessToken);

  // 4. Parse headers
  const limits = parseRateLimitHeaders(response.headers);

  return {
    account: {
      displayName: displayName,
      subscriptionType: creds.subscriptionType || 'Unknown',
      rateLimitTier: creds.rateLimitTier || 'Unknown',
    },
    limits: limits,
    apiStatus: response.statusCode,
    timestamp: new Date().toISOString(),
    rawHeaders: Object.fromEntries(
      Object.entries(response.headers).filter(([k]) =>
        k.startsWith('anthropic-ratelimit')
      )
    ),
  };
}

module.exports = {
  setDebug,
  readKeychainToken,
  parseKeychainData,
  readClaudeConfig,
  fetchRateLimits,
  parseRateLimitHeaders,
  getUsageData,
};
