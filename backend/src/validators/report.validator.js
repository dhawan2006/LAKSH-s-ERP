'use strict';

const Joi = require('joi');

const rangeReportOptions = {
    query: Joi.object({
        from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required()
    })
};

const salesTrendOptions = {
    query: Joi.object({
        range: Joi.string().valid('today', 'week', 'month').default('month')
    })
};

const getSaleItemsOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

const getCustomerLedgerOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

module.exports = {
    rangeReportOptions,
    salesTrendOptions,
    getSaleItemsOptions,
    getCustomerLedgerOptions
};
