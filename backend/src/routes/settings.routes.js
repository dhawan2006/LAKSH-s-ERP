'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { updateInvoiceSettingsOptions } = require('../validators/settings.validator');

/* ─── Logo Upload Config ──────────────────────────────────────── */
const logoDir = path.join(__dirname, '../../public/assets/logo');
if (!fs.existsSync(logoDir)) fs.mkdirSync(logoDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, logoDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `shop-logo${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Only image files (PNG, JPG, SVG, WebP) are allowed.'));
    }
});

/* ─── Helpers ─────────────────────────────────────────────────── */
function getSettings() {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM invoice_settings WHERE id = 1', (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
        });
    });
}

/* ─── GET /invoice-settings ──────────────────────────────── */
router.get('/invoice-settings', async (req, res) => {
    try {
        const settings = await getSettings();
        // Convert SQLite integers to booleans for frontend
        return apiResponse.success(res, 'Settings fetched successfully', {
            ...settings,
            show_gst: !!settings.show_gst,
            show_phone: !!settings.show_phone,
            show_thank_you: !!settings.show_thank_you,
            show_payment_details: !!settings.show_payment_details,
            loyalty_enabled: !!settings.loyalty_enabled,
            whatsapp_receipt_enabled: settings.whatsapp_receipt_enabled !== 0,
            receipt_footer: settings.receipt_footer ?? 'Sent from Kirana ERP',
        });
    } catch (err) {
        return apiResponse.error(res, 'Failed to fetch settings', err, 500);
    }
});

/* ─── PUT /invoice-settings ──────────────────────────────── */
router.put('/invoice-settings', requireAdmin, validate(updateInvoiceSettingsOptions), async (req, res) => {
    const {
        shop_name, shop_address, shop_phone, gst_number,
        printer_mode, invoice_type, receipt_width,
        show_gst, show_phone, show_thank_you, show_payment_details,
        invoice_prefix, thank_you_message, terms, return_window_days,
        // B2B fields
        invoice_mode, state_code,
        // Loyalty fields
        loyalty_enabled, loyalty_earn_rate, loyalty_redeem_rate, loyalty_min_redeem,
        // WhatsApp Receipt
        whatsapp_receipt_enabled, receipt_footer
    } = req.body;

    const sql = `UPDATE invoice_settings SET
        shop_name = COALESCE(?, shop_name),
        shop_address = COALESCE(?, shop_address),
        shop_phone = COALESCE(?, shop_phone),
        gst_number = COALESCE(?, gst_number),
        printer_mode = COALESCE(?, printer_mode),
        invoice_type = COALESCE(?, invoice_type),
        receipt_width = COALESCE(?, receipt_width),
        show_gst = COALESCE(?, show_gst),
        show_phone = COALESCE(?, show_phone),
        show_thank_you = COALESCE(?, show_thank_you),
        show_payment_details = COALESCE(?, show_payment_details),
        invoice_prefix = COALESCE(?, invoice_prefix),
        thank_you_message = COALESCE(?, thank_you_message),
        terms = COALESCE(?, terms),
        return_window_days = COALESCE(?, return_window_days),
        invoice_mode = COALESCE(?, invoice_mode),
        state_code = COALESCE(?, state_code),
        loyalty_enabled = COALESCE(?, loyalty_enabled),
        loyalty_earn_rate = COALESCE(?, loyalty_earn_rate),
        loyalty_redeem_rate = COALESCE(?, loyalty_redeem_rate),
        loyalty_min_redeem = COALESCE(?, loyalty_min_redeem),
        whatsapp_receipt_enabled = COALESCE(?, whatsapp_receipt_enabled),
        receipt_footer = COALESCE(?, receipt_footer),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1`;

    const params = [
        shop_name ?? null, shop_address ?? null, shop_phone ?? null, gst_number ?? null,
        printer_mode ?? null,
        invoice_type ?? null, receipt_width ?? null,
        show_gst !== undefined ? (show_gst ? 1 : 0) : null,
        show_phone !== undefined ? (show_phone ? 1 : 0) : null,
        show_thank_you !== undefined ? (show_thank_you ? 1 : 0) : null,
        show_payment_details !== undefined ? (show_payment_details ? 1 : 0) : null,
        invoice_prefix ?? null, thank_you_message ?? null, terms ?? null,
        return_window_days ?? null,
        // B2B
        invoice_mode ?? null, state_code ?? null,
        // Loyalty
        loyalty_enabled !== undefined ? (loyalty_enabled ? 1 : 0) : null,
        loyalty_earn_rate ?? null, loyalty_redeem_rate ?? null,
        loyalty_min_redeem ?? null,
        // WhatsApp Receipt
        whatsapp_receipt_enabled !== undefined ? (whatsapp_receipt_enabled ? 1 : 0) : null,
        receipt_footer ?? null,
    ];

    db.run(sql, params, function (err) {
        if (err) return apiResponse.error(res, 'Failed to save settings', err, 500);
        if (this.changes === 0) {
            // Row with id=1 doesn't exist — insert it
            const insertSql = `INSERT INTO invoice_settings (id, shop_name, shop_address, shop_phone, gst_number, printer_mode, invoice_type, receipt_width, show_gst, show_phone, show_thank_you, show_payment_details, invoice_prefix, thank_you_message, terms) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            db.run(insertSql, params.slice(0, 14), function (err2) {
                if (err2) return apiResponse.error(res, 'Failed to create settings', err2, 500);
                return apiResponse.success(res, 'Settings saved successfully');
            });
        } else {
            return apiResponse.success(res, 'Settings saved successfully');
        }
    });
});

/* ─── POST /invoice-settings/logo — Upload logo ──────────── */
// Multer errors (e.g., file validation) will be caught globally if next(err) is called implicitly, but we can also handle it
router.post('/invoice-settings/logo', requireAdmin, (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
        if (err) return apiResponse.error(res, err.message, err, 400);
        next();
    });
}, async (req, res) => {
    if (!req.file) return apiResponse.error(res, 'No file uploaded', null, 400);

    const logoPath = `/assets/logo/${req.file.filename}`;
    db.run('UPDATE invoice_settings SET logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
        [logoPath], function (err) {
            if (err) return apiResponse.error(res, 'Failed to save logo path', err, 500);
            return apiResponse.success(res, 'Logo uploaded', { logo_path: logoPath });
        });
});

/* ─── DELETE /invoice-settings/logo — Remove logo ────────── */
router.delete('/invoice-settings/logo', requireAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        if (settings.logo_path) {
            const filePath = path.join(__dirname, '../../public', settings.logo_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.run("UPDATE invoice_settings SET logo_path = '', updated_at = CURRENT_TIMESTAMP WHERE id = 1",
            function (err) {
                if (err) return apiResponse.error(res, 'Failed to remove logo', err, 500);
                return apiResponse.success(res, 'Logo removed');
            });
    } catch (err) {
        return apiResponse.error(res, 'Failed to remove logo', err, 500);
    }
});

module.exports = router;
