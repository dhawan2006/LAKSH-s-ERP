/**
 * Application Logger
 * Appends timestamped error messages to error.log.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../error.log');

/**
 * Appends an error entry to the log file.
 * @param {Error|string} error
 */
function logError(error) {
    const message = error instanceof Error
        ? `[${new Date().toISOString()}] ${error.message}\n${error.stack}\n`
        : `[${new Date().toISOString()}] ${error}\n`;

    fs.appendFile(LOG_FILE, message, (err) => {
        if (err) console.error('Logger: Failed to write to log file:', err.message);
    });
}

/**
 * Logs informational messages (stdout only).
 * @param {string} message
 */
function logInfo(message) {
    console.log(`[${new Date().toISOString()}] INFO: ${message}`);
}

module.exports = { logError, logInfo };
