'use strict';

const Joi = require('joi');

const openRegisterOptions = {
    body: Joi.object({
        opening_cash: Joi.number().min(0).required(),
        operator_name: Joi.string().allow('', null).optional().trim()
    })
};

const closeRegisterOptions = {
    body: Joi.object({
        closing_cash: Joi.number().min(0).required(),
        notes: Joi.string().allow('', null).optional().trim()
    })
};

module.exports = {
    openRegisterOptions,
    closeRegisterOptions
};
