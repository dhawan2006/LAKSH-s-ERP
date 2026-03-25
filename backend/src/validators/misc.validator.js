'use strict';

const Joi = require('joi');

const profitLossOptions = {
    query: Joi.object({
        from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
        period: Joi.string().valid('today', 'week', 'month').optional()
    })
};

const productBulkDiscountOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        bulk_qty: Joi.number().integer().min(0).default(0),
        bulk_discount: Joi.number().min(0).default(0)
    })
};

module.exports = {
    profitLossOptions,
    productBulkDiscountOptions
};
