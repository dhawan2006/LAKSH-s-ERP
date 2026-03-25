'use strict';

const Joi = require('joi');

const addCustomerOptions = {
    body: Joi.object({
        name: Joi.string().required().trim(),
        phone: Joi.string().allow('', null).optional().trim(),
        address: Joi.string().allow('', null).optional().trim()
    })
};

const getCustomersOptions = {
    query: Joi.object({
        limit: Joi.number().integer().min(1).max(200).default(50),
        offset: Joi.number().integer().min(0).default(0)
    })
};

const updateCustomerOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        name: Joi.string().required().trim(),
        phone: Joi.string().allow('', null).optional().trim(),
        address: Joi.string().allow('', null).optional().trim()
    })
};

const addPaymentOptions = {
    body: Joi.object({
        customer_id: Joi.number().integer().required(),
        amount: Joi.number().positive().required()
    })
};

module.exports = {
    addCustomerOptions,
    getCustomersOptions,
    updateCustomerOptions,
    addPaymentOptions
};
