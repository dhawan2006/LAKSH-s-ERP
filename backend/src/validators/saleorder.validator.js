'use strict';

const Joi = require('joi');

const addSaleOrderOptions = {
    body: Joi.object({
        customer_id: Joi.number().integer().allow(null).optional(),
        notes: Joi.string().allow('', null).optional().trim(),
        valid_till: Joi.string().allow('', null).optional().trim(),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                quantity: Joi.number().integer().positive().required(),
                price: Joi.number().min(0).default(0),
                discount: Joi.number().min(0).default(0)
            })
        ).min(1).required()
    })
};

const getSaleOrderItemsOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const convertSaleOrderOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        cash_paid: Joi.number().min(0).default(0),
        upi_paid: Joi.number().min(0).default(0),
        bill_discount: Joi.number().min(0).default(0),
        discount_type: Joi.string().valid('flat', 'percent').default('flat')
    })
};

const saleReturnOptions = {
    body: Joi.object({
        sale_id: Joi.number().integer().allow(null).optional(),
        reason: Joi.string().trim().min(3).max(500).required(),
        refund_cash: Joi.number().min(0).max(999999).default(0),
        refund_upi: Joi.number().min(0).max(999999).default(0),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                sale_item_id: Joi.number().integer().allow(null).optional(),
                quantity: Joi.number().integer().min(1).required(),
                price: Joi.number().min(0).max(999999).required(),
                discount: Joi.number().min(0).max(100).default(0),
                return_condition: Joi.string()
                    .valid('resellable', 'damaged', 'expired')
                    .default('resellable')
            })
        ).min(1).required()
    })
};

const getSaleReturnDetailOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

module.exports = {
    addSaleOrderOptions,
    getSaleOrderItemsOptions,
    convertSaleOrderOptions,
    saleReturnOptions,
    getSaleReturnDetailOptions
};
