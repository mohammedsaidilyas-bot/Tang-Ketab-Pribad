import express from 'express';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Server-side PDF proxy to completely bypass browser CORS issues with Firebase Storage
  app.get('/api/proxy-pdf', async (req, res) => {
    const pdfUrl = req.query.url as string;
    if (!pdfUrl) {
      return res.status(400).send('Missing url parameter');
    }
    try {
      console.log(`[Proxy] Fetching PDF from cloud storage: ${pdfUrl}`);
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        console.warn(`[Proxy] Failed to fetch PDF: ${response.status} ${response.statusText}`);
        return res.status(response.status).send(`Failed to fetch PDF from cloud: ${response.statusText}`);
      }
      
      const contentType = response.headers.get('content-type') || 'application/pdf';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

      const arrayBuffer = await response.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
      console.log(`[Proxy] Successfully proxied PDF (${arrayBuffer.byteLength} bytes)`);
    } catch (err: any) {
      console.error('[Proxy] PDF Proxy error:', err);
      res.status(500).send(`Proxy error: ${err.message}`);
    }
  });

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
