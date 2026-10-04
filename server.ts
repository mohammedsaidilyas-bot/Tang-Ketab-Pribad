import express from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Middleware for handling raw PDF uploads (up to 200MB)
  app.post('/api/upload-pdf', express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
    const kitabId = req.query.kitabId as string;
    if (!kitabId) {
      return res.status(400).json({ error: 'Missing kitabId parameter' });
    }
    try {
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'Empty file payload' });
      }

      const filePath = path.join(uploadsDir, `${kitabId}.pdf`);
      await fs.promises.writeFile(filePath, buffer);
      console.log(`[Server] Saved PDF to disk: ${filePath} (${buffer.length} bytes)`);

      const pdfUrl = `/api/pdf/${kitabId}`;
      res.json({ success: true, url: pdfUrl, size: buffer.length });
    } catch (err: any) {
      console.error('[Server] Failed to save uploaded PDF to disk:', err);
      res.status(500).json({ error: err.message || 'Failed to save PDF' });
    }
  });

  // Direct endpoint to serve stored PDF documents across all devices
  app.get('/api/pdf/:kitabId', (req, res) => {
    const kitabId = req.params.kitabId;
    const filePath = path.join(uploadsDir, `${kitabId}.pdf`);
    
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(filePath);
    }
    
    res.status(404).send('PDF not found on server disk');
  });

  // Check if a PDF exists on the server disk
  app.get('/api/has-pdf/:kitabId', (req, res) => {
    const kitabId = req.params.kitabId;
    const filePath = path.join(uploadsDir, `${kitabId}.pdf`);
    res.json({ exists: fs.existsSync(filePath) });
  });

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
