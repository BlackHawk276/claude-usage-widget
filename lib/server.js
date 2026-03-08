'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { getUsageData } = require('./fetch');

/**
 * Start a local HTTP server that serves the widget HTML
 * and exposes /api/usage for live data.
 */
function startWidgetServer(callback) {
  const server = http.createServer(async (req, res) => {
    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    if (req.url === '/api/usage') {
      res.setHeader('Content-Type', 'application/json');
      try {
        const data = await getUsageData();
        res.writeHead(200);
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(200);
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Serve the HTML widget
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, 'widget.html');
      let html = fs.readFileSync(htmlPath, 'utf8');
      // Inject the actual port
      html = html.replace('{{PORT}}', String(server.address().port));
      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Listen on random available port
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    callback(port);
  });

  return server;
}

module.exports = { startWidgetServer };
