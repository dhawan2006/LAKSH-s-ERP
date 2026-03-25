/**
 * Kirana ERP — Express Server
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const env = require('./config/env');
const db = require('./config/database');
const initDB = require('./config/init');
const errorHandler = require('./middlewares/errorHandler');
const authMiddleware = require('./middlewares/authMiddleware');

const productRoutes = require('./routes/product.routes');
const customerRoutes = require('./routes/customer.routes');
const saleRoutes = require('./routes/sale.routes');
const reportRoutes = require('./routes/report.routes');
const categoryRoutes = require('./routes/category.routes');
const purchaseRoutes = require('./routes/purchase.routes');
const saleOrderRoutes = require('./routes/saleorder.routes');
const registerRoutes = require('./routes/register.routes');
const miscRoutes = require('./routes/misc.routes');
const authRoutes = require('./routes/auth.routes');
const settingsRoutes = require('./routes/settings.routes');
const pinRoutes = require('./routes/pin.routes');
const heldBillsRoutes = require('./routes/heldbills.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');

const app = express();

// 1. Compression should be first to compress all HTTP responses
app.use(compression());

// 2. Security Hardening with explicit CSP
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://laksh-s-erp.vercel.app';

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", FRONTEND_URL],
        },
    },
}));

// 3. General Rate Limiter
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { error: 'Too many requests' } });
app.use(limiter);

// 4. CORS — allow Vercel frontend
const allowedOrigins = [
    FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:8000',
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(null, true); // relaxed for now; tighten later
    },
    credentials: true,
}));

// 5. Body Parse with Strict Limits
app.use(express.json({ limit: '2mb' }));

/* ── Health Check (no auth required) ─────────────────────────── */
app.get('/api/health', (req, res) => {
    db.get('SELECT 1 AS ok', [], (err) => {
        if (err) return res.status(503).json({ status: 'unhealthy', db: 'error' });
        res.json({
            status: 'ok',
            db: 'connected',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '4.2',
        });
    });
});

// Create v1 router
const apiRouter = express.Router();

// Public Auth APIs (login) — mounted BEFORE global auth middleware
apiRouter.use('/', authRoutes);

// Public health check (no auth) — used by offline queue system
apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Protect all remaining routes globally
apiRouter.use(authMiddleware);

apiRouter.use('/', productRoutes);
apiRouter.use('/', customerRoutes);
apiRouter.use('/', saleRoutes);
apiRouter.use('/', reportRoutes);
apiRouter.use('/', categoryRoutes);
apiRouter.use('/', purchaseRoutes);
apiRouter.use('/', saleOrderRoutes);
apiRouter.use('/', registerRoutes);
apiRouter.use('/', miscRoutes);
apiRouter.use('/', pinRoutes);
apiRouter.use('/', heldBillsRoutes);
apiRouter.use('/', settingsRoutes);
apiRouter.use('/', whatsappRoutes);

// Mount API router
app.use('/api/v1', apiRouter);

// 404 Handler
app.use((req, res, next) => {
    const err = new Error('Route not found');
    err.statusCode = 404;
    next(err);
});

// Global Error Handler
app.use(errorHandler);

// Initialize DB then start listening
if (process.env.NODE_ENV === 'test') {
    // DB is already initialised by Jest globalSetup — nothing to do here.
} else {
    initDB()
        .then(() => {
            const PORT = env.PORT || 8000;
            app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Kirana ERP Server running on port ${PORT}`));
        })
        .catch(err => {
            console.error('Failed to initialize database:', err);
            process.exit(1);
        });
}

module.exports = app;
