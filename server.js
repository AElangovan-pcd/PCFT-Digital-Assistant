import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY environment variable is not set. The proxy will forward requests without a key, which will fail.');
}

// Set up the proxy to Google's Generative AI endpoint
const googleProxy = createProxyMiddleware({
  target: 'https://generativelanguage.googleapis.com',
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  pathRewrite: (path, req) => {
    // Append the API key to the query string for all proxied requests
    if (API_KEY) {
      const separator = path.includes('?') ? '&' : '?';
      return path + separator + 'key=' + API_KEY;
    }
    return path;
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Optional: Add logging or other header manipulation here
      // console.log(`[PROXY] HTTP Request: ${req.method} ${req.url}`);
    },
    proxyReqWs: (proxyReq, req, socket, options, head) => {
      // console.log(`[PROXY] WebSocket Request: ${req.url}`);
    },
    error: (err, req, res) => {
      console.error('[PROXY ERROR]', err);
    }
  }
});

// Proxy routes matching the Google API paths
app.use('/v1alpha', googleProxy);
app.use('/v1beta', googleProxy);
app.use('/v1', googleProxy);
app.use('/ws', googleProxy);

// Serve the static frontend files
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // Catch-all to serve index.html for React Router / SPA navigation
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get(/.*/, (req, res) => {
    res.send('The "dist" folder was not found. Please run "npm run build" to build the frontend.');
  });
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Proxying API requests to Google Generative Language API`);
});
