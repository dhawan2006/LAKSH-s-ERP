'use strict';

const Joi = require('joi');

const updateInvoiceSettingsOptions = {
    body: Joi.object({
        shop_name: Joi.string().allow('', null).optional().trim(),
        shop_address: Joi.string().allow('', null).optional().trim(),
        shop_phone: Joi.string().allow('', null).optional().trim(),
        gst_number: Joi.string().allow('', null).optional().trim(),
        printer_mode: Joi.string().valid('thermal58', 'thermal80', 'a4').allow(null).optional(),
        invoice_type: Joi.string().allow('', null).optional().trim(),
        receipt_width: Joi.string().allow('', null).optional().trim(),
        show_gst: Joi.boolean().optional(),
        show_phone: Joi.boolean().optional(),
        show_thank_you: Joi.boolean().optional(),
        show_payment_details: Joi.boolean().optional(),
        invoice_prefix: Joi.string().allow('', null).optional().trim(),
        thank_you_message: Joi.string().allow('', null).optional().trim(),
        terms: Joi.string().allow('', null).optional().trim(),
        return_window_days: Joi.number().integer().min(0).max(365).optional(),
        // B2B invoice settings
        invoice_mode: Joi.string().valid('b2c', 'b2b').allow('', null).optional(),
        state_code: Joi.string().allow('', null).optional().trim(),
        // Loyalty settings
        loyalty_enabled: Joi.boolean().optional(),
        loyalty_earn_rate: Joi.number().min(0).max(100).optional(),
        loyalty_redeem_rate: Joi.number().min(0).max(1000).optional(),
        loyalty_min_redeem: Joi.number().integer().min(1).max(10000).optional(),
        // WhatsApp Receipt
        whatsapp_receipt_enabled: Joi.boolean().optional(),
        receipt_footer: Joi.string().max(120).allow('').optional()
    })
};

module.exports = {
    updateInvoiceSettingsOptions
};
