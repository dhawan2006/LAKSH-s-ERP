'use strict';

const Joi = require('joi');

const createSaleOptions = {
    body: Joi.object({
        customer_id: Joi.number().integer().allow(null).optional(),
        bill_discount: Joi.number().min(0).default(0),
        discount_type: Joi.string().valid('flat', 'percent').default('flat'),
        cash_paid: Joi.number().min(0).default(0),
        upi_paid: Joi.number().min(0).default(0),
        manager_override_token: Joi.string().allow(null, '').optional(),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                quantity: Joi.number().integer().positive().required(),
                price: Joi.number().min(0).required(),
                discount: Joi.number().min(0).default(0),
                price_overridden: Joi.boolean().optional(),
                cost_price: Joi.number().min(0).optional(),
                gst: Joi.number().min(0).optional(),
                name: Joi.string().optional(),
                mrp: Joi.number().min(0).optional(),
                bulk_qty: Joi.number().min(0).optional(),
                bulk_discount: Joi.number().min(0).optional()
            })
        ).min(1).required()
    })
};

const getSalesOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(500).default(50),
        offset: Joi.number().integer().min(0).default(0)
    })
};

const getSaleOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const getSaleByInvoiceOptions = {
    params: Joi.object({
        invoiceNumber: Joi.string().max(20).pattern(/^[a-zA-Z0-9\-]+$/).required()
    })
};

module.exports = {
    createSaleOptions,
    getSalesOptions,
    getSaleOptions,
    getSaleByInvoiceOptions
};
