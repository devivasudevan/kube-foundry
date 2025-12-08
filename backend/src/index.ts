import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health';
import modelsRouter from './routes/models';
import deploymentsRouter from './routes/deployments';
import settingsRouter from './routes/settings';
import installationRouter from './routes/installation';
import { errorHandler } from './middleware/errorHandler';
import { isCompiled, loadStaticFiles, getStaticFile, getIndexHtml, hasStaticFiles } from './static';

const app = express();
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Load static files at startup (embedded in binary or from filesystem)
await loadStaticFiles();

const compiled = isCompiled();
console.log(`🔧 Running in ${compiled ? 'compiled binary' : 'development'} mode`);

// Middleware
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/models', modelsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/installation', installationRouter);

app.use((req, res, next) => {
  console.log(`[Middleware] Checking /api/deployments for ${req.url}`);
  next();
});

app.use('/api/deployments', deploymentsRouter);
app.use('/api/cluster', healthRouter);

// Serve static frontend files (from memory)
if (hasStaticFiles()) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    
    const file = getStaticFile(req.path);
    if (file) {
      res.setHeader('Content-Type', file.contentType);
      return res.send(file.content);
    }
    next();
  });
}

// SPA fallback - serve index.html for non-API routes
app.use((req, res, next) => {
  // If it's an API route that wasn't matched, return 404
  if (req.path.startsWith('/api/')) {
    console.log(`[404] No route matched: ${req.method} ${req.url}`);
    return res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.url}`, statusCode: 404 } });
  }
  
  // Serve index.html for SPA routing
  if (hasStaticFiles()) {
    const indexHtml = getIndexHtml();
    if (indexHtml) {
      res.setHeader('Content-Type', indexHtml.contentType);
      return res.send(indexHtml.content);
    }
  }
  
  return res.status(404).send('Frontend not available. Run with frontend build or in development mode.');
});

// Error handling
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 KubeFoundry backend running on http://localhost:${PORT}`);
});

export default app;
