'use strict';

const Joi = require('joi');

const addPurchaseOrderOptions = {
    body: Joi.object({
        supplier_name: Joi.string().allow('', null).optional().trim(),
        supplier_phone: Joi.string().allow('', null).optional().trim(),
        notes: Joi.string().allow('', null).optional().trim(),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                quantity: Joi.number().integer().positive().required(),
                purchase_price: Joi.number().min(0).default(0)
            })
        ).min(1).required()
    })
};

const getPurchaseOrdersOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(200).default(50),
        offset: Joi.number().integer().min(0).default(0)
    })
};

const getPurchaseOrderItemsOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const receivePurchaseOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        cash_paid: Joi.number().min(0).default(0),
        credit_amount: Joi.number().min(0).default(0),
        notes: Joi.string().allow('', null).optional().trim()
    })
};

const addPurchaseOptions = {
    body: Joi.object({
        supplier_name: Joi.string().allow('', null).optional().trim(),
        supplier_phone: Joi.string().allow('', null).optional().trim(),
        cash_paid: Joi.number().min(0).default(0),
        credit_amount: Joi.number().min(0).default(0),
        notes: Joi.string().allow('', null).optional().trim(),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                quantity: Joi.number().integer().positive().required(),
                purchase_price: Joi.number().min(0).default(0)
            })
        ).min(1).required()
    })
};

const getPurchasesOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(200).default(50),
        offset: Joi.number().integer().min(0).default(0)
    })
};

const getPurchaseItemsOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const purchaseReturnOptions = {
    body: Joi.object({
        purchase_id: Joi.number().integer().allow(null).optional(),
        reason: Joi.string().allow('', null).optional().trim(),
        items: Joi.array().items(
            Joi.object({
                product_id: Joi.number().integer().required(),
                quantity: Joi.number().integer().positive().required(),
                purchase_price: Joi.number().min(0).default(0)
            })
        ).min(1).required()
    })
};

const getPurchaseReturnsOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(200).default(50),
        offset: Joi.number().integer().min(0).default(0)
    })
};

module.exports = {
    addPurchaseOrderOptions,
    getPurchaseOrdersOptions,
    getPurchaseOrderItemsOptions,
    receivePurchaseOptions,
    addPurchaseOptions,
    getPurchasesOptions,
    getPurchaseItemsOptions,
    purchaseReturnOptions,
    getPurchaseReturnsOptions
};
