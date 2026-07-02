import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import syncRouter from './routes/sync';
import usersRouter from './routes/users';
import driveRouter from './routes/drive';
import configRouter from './routes/config';
import reportsRouter from './routes/reports';
import newsRouter from './routes/news';
import pushRouter from './routes/push';
import tasksRouter from './routes/tasks';
import campaignsRouter from './routes/campaigns';
import budgetRouter from './routes/budget';
import eventsRouter from './routes/events';
import plannerItemsRouter from './routes/planner/items';
import plannerConfigRouter from './routes/planner/config';
import plannerCronRouter from './routes/planner/cron';

dotenv.config();

// ── Startup env validation ──────────────────────────────────────────────────
const REQUIRED_ENV = ['MEDIA_TOKEN_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable ${key} is not set. Exiting.`);
    process.exit(1);
  }
}
if (!process.env.CRON_SECRET) {
  console.warn('WARNING: CRON_SECRET is not set — scheduled Drive sync endpoint is disabled.');
}
if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn('WARNING: VAPID keys are not set — Web Push notifications are disabled.');
}
// requireAuth (middleware/auth.ts) only rejects requests missing an App Check
// token when NODE_ENV === 'production'. Any other value (unset, a typo, a
// staging label) silently disables that check with no signal at request time.
// Surface it loudly at boot instead, since this is easy to miss in a Cloud Run
// deploy that forgets --update-env-vars NODE_ENV=production.
if (process.env.NODE_ENV !== 'production') {
  console.warn(
    `WARNING: NODE_ENV is "${process.env.NODE_ENV || '(unset)'}", not "production" — ` +
    'Firebase App Check enforcement is DISABLED for clients that omit the X-Firebase-AppCheck ' +
    'header. This is expected in local dev; if you see this in a deployed environment, App Check ' +
    'is not being enforced.'
  );
}

// ── App setup ───────────────────────────────────────────────────────────────
const app = express();
const port = process.env.PORT || 5000;

// Cloud Run terminates TLS at a single front-end proxy that sets X-Forwarded-For.
// Trust exactly one hop so express-rate-limit reads the real client IP instead of
// throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR. Do NOT use `true` (trust all) — that
// would let clients spoof their IP and bypass the rate limiter.
app.set('trust proxy', 1);

// CORS — must come before helmet() so preflight OPTIONS responses are sent correctly
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  // Sensible defaults: both Firebase hosting domains + custom domain + local dev
  allowedOrigins.push(
    'https://sosunmarketingplanner.online',
    'https://sosun-fihaara.web.app',
    'https://sosun-fihaara.firebaseapp.com',
    'http://localhost:5173',
  );
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server / curl (no origin header) in non-prod only
      if (!origin) {
        return callback(null, process.env.NODE_ENV !== 'production');
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Return false (not an Error) so Express does NOT 500 — browser gets a
      // clean CORS rejection with no ACAO header, which is the correct behaviour.
      console.warn(`CORS: blocked origin "${origin}"`);
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Cron-Secret', 'X-Firebase-AppCheck'],
    credentials: true,
  })
);

// Security headers (after CORS so preflight isn't blocked)
app.use(helmet());

app.use(express.json());

// ── Rate limiting ───────────────────────────────────────────────────────────
// Global: 100 requests per 15 minutes per IP
const MEDIA_STREAM_PATH = /^\/api\/drive\/files\/[^/]+\/(content|thumbnail)(\/|$)|^\/api\/drive\/files\/[^/]+\/revisions\/[^/]+\/content$/;
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  // Media streaming (range requests, thumbnails) can issue many GETs for a single
  // view; counting them would lock out a normal user. They're already guarded by
  // the media-token check and the workspace boundary, so exempt them here.
  skip: (req) => req.method === 'GET' && MEDIA_STREAM_PATH.test(req.path),
  message: { success: false, error: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Stricter limit on auth-sensitive user management routes
const userRouteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests on this endpoint.' },
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/sync', syncRouter);
app.use('/api/users', userRouteLimiter, usersRouter);
app.use('/api/drive', driveRouter);
app.use('/api/config', configRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/news', newsRouter);
app.use('/api/push', pushRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/events', eventsRouter);
app.use('/api/planner/items', plannerItemsRouter);
app.use('/api/planner/config', plannerConfigRouter);
app.use('/api/planner/cron', plannerCronRouter);

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Global Error Handler Middleware
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled backend error:', err);
  // Honor an explicit status set by deeper handlers (e.g. assertWithinRoot → 403,
  // verifyToken → 401). Anything without a 4xx/5xx status is treated as a 500.
  const status = Number(err?.status);
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  // Don't leak internal error text on 5xx in production — only surface
  // deliberate client-facing (4xx) messages.
  const isProd = process.env.NODE_ENV === 'production';
  const message =
    httpStatus < 500
      ? err.message || 'Request error'
      : isProd
        ? 'Internal server error'
        : err.message || 'Internal server error';
  res.status(httpStatus).json({ success: false, error: message });
});

app.listen(port, () => {
  console.log(`Backend server is running on port ${port}`);
});
