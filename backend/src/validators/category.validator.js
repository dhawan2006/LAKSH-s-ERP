'use strict';

const Joi = require('joi');

const addCategoryOptions = {
    body: Joi.object({
        name: Joi.string().required().trim(),
        description: Joi.string().allow('', null).optional()
    })
};

const updateCategoryOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    }),
    body: Joi.object({
        name: Joi.string().required().trim(),
        description: Joi.string().allow('', null).optional()
    })
};

const deleteCategoryOptions = {
    params: Joi.object({
        id: Joi.number().integer().required()
    })
};

module.exports = {
    addCategoryOptions,
    updateCategoryOptions,
    deleteCategoryOptions
};
