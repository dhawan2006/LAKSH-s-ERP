'use strict';

/**
 * Standardized API Response Utility
 */

const apiResponse = {
    success: (res, message, data = null, statusCode = 200) => {
        const responseLogs = {
            success: true,
            message,
        };
        if (data !== null) {
            responseLogs.data = data;
        }
        return res.status(statusCode).json(responseLogs);
    },

    error: (res, message, errors = null, statusCode = 400) => {
        const responseLogs = {
            success: false,
            message,
        };
        if (errors !== null) {
            responseLogs.errors = errors;
        }
        return res.status(statusCode).json(responseLogs);
    },
};

module.exports = apiResponse;
