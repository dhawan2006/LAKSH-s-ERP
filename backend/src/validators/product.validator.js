'use strict';

const Joi = require('joi');

const addProductOptions = {
    body: Joi.object({
        name: Joi.string().required().trim(),
        barcode: Joi.string().allow('', null).optional(),
        cost_price: Joi.number().min(0).default(0),
        selling_price: Joi.number().positive().required(),
        stock_quantity: Joi.number().integer().min(0).default(0),
        gst_percentage: Joi.number().min(0).max(100).default(0),
        low_stock_threshold: Joi.number().integer().min(0).default(5),
        category_id: Joi.number().integer().allow(null).optional(),
        mrp: Joi.number().min(0).default(0),
        bulk_qty: Joi.number().integer().min(0).default(0),
        bulk_discount: Joi.number().min(0).default(0)
    })
};

const getProductsOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(200).default(50),
        offset: Joi.number().integer().min(0).default(0),
        search: Joi.string().allow('', null).optional()
    })
};

const updateProductOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        name: Joi.string().required().trim(),
        cost_price: Joi.number().min(0).default(0),
        selling_price: Joi.number().positive().required(),
        stock_quantity: Joi.number().integer().min(0).default(0),
        gst_percentage: Joi.number().min(0).max(100).default(0),
        low_stock_threshold: Joi.number().integer().min(0).default(5),
        category_id: Joi.number().integer().allow(null).optional(),
        mrp: Joi.number().min(0).default(0),
        bulk_qty: Joi.number().integer().min(0).default(0),
        bulk_discount: Joi.number().min(0).default(0)
    })
};

const deleteProductOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const productByBarcodeOptions = {
    params: Joi.object({
        code: Joi.string().required().trim()
    })
};

const getBarcodeOptions = {
    params: Joi.object({
        code: Joi.string().required().trim()
    })
};

module.exports = {
    addProductOptions,
    getProductsOptions,
    updateProductOptions,
    deleteProductOptions,
    productByBarcodeOptions,
    getBarcodeOptions
};
