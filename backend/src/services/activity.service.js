'use strict';

/**
 * Activity Logger Service
 * Silently logs user actions to the activity_logs table.
 * Failures are intentionally swallowed so they never break the main request.
 */

const db = require('../config/database');

/**
 * @param {number|null} userId   - req.user.id (null for anonymous/system)
 * @param {string}      action   - Short action label e.g. "invoice_created"
 * @param {string}      details  - Human-readable detail string
 */
function logActivity(userId, action, details) {
    db.run(
        `INSERT INTO activity_logs (user_id, action, details) VALUES (?, ?, ?)`,
        [userId || null, action, details || ''],
        (err) => {
            if (err) console.warn('[ActivityLog] Failed to write log:', err.message);
        }
    );
}

module.exports = { logActivity };
