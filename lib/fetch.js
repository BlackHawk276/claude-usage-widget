'use strict';

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Read the Claude Code OAuth token from macOS Keychain.
 */
function readKeychainToken() {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return raw;
  } catch (err) {
    throw new Error(
      'Could not read Claude Code credentials from macOS Keychain.\n' +
      'Make sure Claude Code is installed and you are logged in.'
    );
  }
}

/**
 * Parse the keychain credential blob.
 * The structure may be:
 *   - A single object with claudeAiOauth (current format)
 *   - An array of credential entries
 *   - A single object with oauthAccount (legacy format)
 */
function parseKeychainData(raw) {
  try {
    const data = JSON.parse(raw);

    // Helper: extract from a single credential entry
    function extract(entry) {
      // Current format: claudeAiOauth
      const oauth = entry.claudeAiOauth || entry.oauthAccount;
      if (oauth && oauth.accessToken) {
        return {
          accessToken: oauth.accessToken,
          displayName: oauth.displayName || entry.displayName || null,
          subscriptionType: oauth.subscriptionType || entry.subscriptionType || 'Unknown',
          rateLimitTier: oauth.rateLimitTier || entry.rateLimitTier || 'Unknown',
        };
      }
      return null;
    }

    // data is an array of credential objects
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (!entry) continue;
        const result = extract(entry);
        if (result) return result;
      }
    } else if (data && typeof data === 'object') {
      const result = extract(data);
      if (result) return result;
    }

    throw new Error('No valid OAuth credentials found in keychain data');
  } catch (err) {
    if (err.message.includes('No valid OAuth')) throw err;
    throw new Error('Failed to parse keychain credential data: ' + err.message);
  }
}

/**
 * Read ~/.claude.json for supplementary account info.
 */
function readClaudeConfig() {
  try {
    const configPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.claude.json'
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Make a minimal API call to get rate limit headers.
 * Returns { headers, body, statusCode }.
 */
function fetchRateLimits(accessToken) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });

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
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
        });
      });
    });

    req.on('error', (err) => {
      reject(new Error('API request failed: ' + err.message));
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('API request timed out after 15 seconds'));
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

  return {
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
}

/**
 * High-level: fetch everything needed for the display.
 */
async function getUsageData() {
  // 1. Read keychain
  const raw = readKeychainToken();
  const creds = parseKeychainData(raw);

  // 2. Read config
  const config = readClaudeConfig();

  // 3. Fetch rate limits
  const response = await fetchRateLimits(creds.accessToken);

  // 4. Parse headers
  const limits = parseRateLimitHeaders(response.headers);

  // Try to resolve display name from config or keychain
  let displayName = creds.displayName;
  if (!displayName && config) {
    displayName = config.oauthAccount?.displayName
      || config.displayName
      || config.accountName
      || null;
  }
  if (!displayName) {
    displayName = creds.subscriptionType || 'Claude User';
  }

  return {
    account: {
      displayName: displayName,
      subscriptionType: creds.subscriptionType,
      rateLimitTier: creds.rateLimitTier,
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
  readKeychainToken,
  parseKeychainData,
  readClaudeConfig,
  fetchRateLimits,
  parseRateLimitHeaders,
  getUsageData,
};
