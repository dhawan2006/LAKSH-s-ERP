'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get } = require('../utils/db-promise');

/* ─── In-memory rate limiter (per IP, 5 attempts/min) ────────── */
const _pinAttempts = {};  // { ip: { count, resetAt } }

function checkPinRateLimit(ip) {
    const now = Date.now();
    const entry = _pinAttempts[ip];

    if (!entry || now > entry.resetAt) {
        _pinAttempts[ip] = { count: 1, resetAt: now + 60000 };
        return true;
    }

    if (entry.count >= 5) {
        return false;
    }

    entry.count++;
    return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const ip of Object.keys(_pinAttempts)) {
        if (now > _pinAttempts[ip].resetAt) {
            delete _pinAttempts[ip];
        }
    }
}, 5 * 60 * 1000);

/* ─── POST /verify-manager-pin ───────────────────────────────── */
router.post('/verify-manager-pin', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    if (!checkPinRateLimit(ip)) {
        return res.status(429).json({
            success: false,
            message: 'Too many PIN attempts. Try again in 1 minute.'
        });
    }

    const { pin } = req.body;

    if (!pin || typeof pin !== 'string') {
        return res.status(400).json({
            success: false,
            message: 'PIN is required'
        });
    }

    try {
        const settings = await get(
            'SELECT manager_pin_hash FROM invoice_settings WHERE id = 1'
        );

        if (!settings || !settings.manager_pin_hash) {
            return res.status(500).json({
                success: false,
                message: 'Manager PIN not configured'
            });
        }

        const match = await bcrypt.compare(pin, settings.manager_pin_hash);

        if (!match) {
            return res.status(401).json({
                success: false,
                message: 'Incorrect PIN'
            });
        }

        // Generate a short-lived JWT for manager override
        const secret = process.env.JWT_SECRET;
        const token = jwt.sign(
            { managerOverride: true },
            secret,
            { expiresIn: '5m' }
        );

        return res.json({ success: true, token });

    } catch (err) {
        console.error('[verify-manager-pin] Error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal error verifying PIN'
        });
    }
});

module.exports = router;
