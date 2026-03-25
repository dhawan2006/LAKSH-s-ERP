'use strict';

require('dotenv').config();

if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET is not set in environment variables. Create a .env file with a strong secret.');
    process.exit(1);
}

module.exports = {
    PORT: process.env.PORT || 8000,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',
    NODE_ENV: process.env.NODE_ENV || 'development',
};
