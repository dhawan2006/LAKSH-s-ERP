/**
 * Kirana ERP — WhatsApp Routes
 * Handles tracking of WhatsApp receipt sends.
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const apiResponse = require('../utils/apiResponse');

// Log a WhatsApp receipt send
router.post('/whatsapp/log', (req, res) => {
    const { sale_id, invoice_number, customer_phone, customer_name, amount } = req.body;

    if (!sale_id || !invoice_number) {
        return apiResponse.error(res, 'sale_id and invoice_number are required', null, 400);
    }

    const sql = `
        INSERT INTO whatsapp_send_log 
        (sale_id, invoice_number, customer_phone, customer_name, amount) 
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [sale_id, invoice_number, customer_phone, customer_name, amount], function(err) {
        if (err) {
            console.error('[WhatsApp Log] Error inserting log:', err);
            return apiResponse.error(res, 'Failed to log WhatsApp send', err, 500);
        }
        return apiResponse.success(res, 'WhatsApp send logged', { id: this.lastID }, 201);
    });
});

module.exports = router;
