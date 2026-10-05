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

  const kitabsJsonPath = path.join(uploadsDir, 'kitabs_registry.json');
  const notesJsonPath = path.join(uploadsDir, 'notes_registry.json');

  // Ensure registry files exist
  if (!fs.existsSync(kitabsJsonPath)) {
    fs.writeFileSync(kitabsJsonPath, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(notesJsonPath)) {
    fs.writeFileSync(notesJsonPath, JSON.stringify([], null, 2));
  }

  app.use(express.json({ limit: '50mb' }));

  // Kitabs Registry API with automatic folder scanning
  app.get('/api/kitabs', (req, res) => {
    try {
      const data = fs.readFileSync(kitabsJsonPath, 'utf8');
      let kitabs: any[] = JSON.parse(data || '[]');

      // Auto-scan uploads directory for any unindexed PDF files
      if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(uploadsDir);
        let updated = false;

        files.forEach((fileName) => {
          if (fileName.toLowerCase().endsWith('.pdf')) {
            const rawId = fileName.replace(/\.pdf$/i, '');
            // Check if this PDF is already registered by ID or pdfUrl
            const exists = kitabs.some(
              (k: any) =>
                k.id === rawId ||
                k.pdfUrl === `/api/pdf/${rawId}` ||
                k.pdfUrl?.includes(fileName)
            );

            if (!exists) {
              const cleanTitle = rawId.replace(/^kitab[-_]/i, '').replace(/[-_]+/g, ' ').trim();
              const formattedTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1) || 'Kitab Server';

              const newServerKitab = {
                id: rawId,
                catalogNumber: `TK-SRV.${Math.floor(100 + Math.random() * 899)}`,
                title: formattedTitle,
                subtitle: `Diunggah langsung ke server (${fileName})`,
                author: 'Koleksi Maktabah Server',
                category: 'Maktabah Server',
                language: 'Dokumen PDF · PocketBook',
                totalPages: 100,
                lastReadPage: 1,
                bookmarks: [1],
                addedAt: new Date().toLocaleDateString('id-ID', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
                isUploadedPdf: true,
                pdfUrl: `/api/pdf/${rawId}`,
                fileSizeLabel: 'PDF Server',
                coverTone: 'bronze',
                chapters: [
                  {
                    id: 'ch-srv-1',
                    number: '01',
                    title: 'مقدمة الكتاب',
                    startPage: 1,
                  },
                ],
                pages: Array.from({ length: 100 }, (_, i) => ({
                  pageNumber: i + 1,
                  chapterTitle: 'مقدمة الكتاب',
                  paragraphs: [`[Halaman ${i + 1} · Dokumen PDF Asli Server]`],
                  footnote: `Dokumen PDF Server "${fileName}" · Lembar ${i + 1}`,
                })),
              };

              kitabs.unshift(newServerKitab);
              updated = true;
              console.log(`[Server Auto-Scan] Automatically indexed PDF file: ${fileName}`);
            }
          }
        });

        if (updated) {
          fs.writeFileSync(kitabsJsonPath, JSON.stringify(kitabs, null, 2));
        }
      }

      res.json(kitabs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/kitabs', (req, res) => {
    try {
      const kitab = req.body;
      if (!kitab || !kitab.id) {
        return res.status(400).json({ error: 'Invalid kitab object' });
      }
      const raw = fs.readFileSync(kitabsJsonPath, 'utf8');
      let kitabs: any[] = [];
      try { kitabs = JSON.parse(raw || '[]'); } catch {}

      const index = kitabs.findIndex((k: any) => k.id === kitab.id);
      if (index >= 0) {
        kitabs[index] = { ...kitabs[index], ...kitab };
      } else {
        kitabs.unshift(kitab);
      }

      fs.writeFileSync(kitabsJsonPath, JSON.stringify(kitabs, null, 2));
      console.log(`[Server] Saved kitab "${kitab.title}" to disk registry.`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/kitabs/:id', (req, res) => {
    try {
      const kitabId = req.params.id;
      const raw = fs.readFileSync(kitabsJsonPath, 'utf8');
      let kitabs: any[] = [];
      try { kitabs = JSON.parse(raw || '[]'); } catch {}

      kitabs = kitabs.filter((k: any) => k.id !== kitabId);
      fs.writeFileSync(kitabsJsonPath, JSON.stringify(kitabs, null, 2));
      
      // Also delete PDF file if exists
      const pdfPath = path.join(uploadsDir, `${kitabId}.pdf`);
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Notes Registry API
  app.get('/api/notes', (req, res) => {
    try {
      const data = fs.readFileSync(notesJsonPath, 'utf8');
      res.json(JSON.parse(data || '[]'));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/notes', (req, res) => {
    try {
      const note = req.body;
      if (!note || !note.id) {
        return res.status(400).json({ error: 'Invalid note object' });
      }
      const raw = fs.readFileSync(notesJsonPath, 'utf8');
      let notes: any[] = [];
      try { notes = JSON.parse(raw || '[]'); } catch {}

      const index = notes.findIndex((n: any) => n.id === note.id);
      if (index >= 0) {
        notes[index] = { ...notes[index], ...note };
      } else {
        notes.unshift(note);
      }

      fs.writeFileSync(notesJsonPath, JSON.stringify(notes, null, 2));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/notes/:id', (req, res) => {
    try {
      const noteId = req.params.id;
      const raw = fs.readFileSync(notesJsonPath, 'utf8');
      let notes: any[] = [];
      try { notes = JSON.parse(raw || '[]'); } catch {}

      notes = notes.filter((n: any) => n.id !== noteId);
      fs.writeFileSync(notesJsonPath, JSON.stringify(notes, null, 2));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

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
