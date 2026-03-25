'use strict';

const { logError } = require('../utils/loggers');

/**
 * Global Error Handler middleware for Express
 */
module.exports = (err, req, res, next) => {
    const statusCode = err.statusCode || (err.error ? 400 : 500);
    const message = err.error || err.message || 'Internal server error';

    // Only log real server errors — 404s are expected and not useful to log
    if (statusCode >= 500) {
        console.error('Server error:', err);
        logError(err);
    }

    res.status(statusCode).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};
