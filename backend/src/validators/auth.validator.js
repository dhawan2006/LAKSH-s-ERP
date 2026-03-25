'use strict';

const Joi = require('joi');

const loginOptions = {
    body: Joi.object({
        username: Joi.string().required().trim().lowercase(),
        password: Joi.string().required()
    })
};

const changePasswordOptions = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        newPassword: Joi.string().min(6).required(),
    })
};

const changeMyPasswordOptions = {
    body: Joi.object({
        oldPassword: Joi.string().required(),
        newPassword: Joi.string().min(6).required(),
    })
};

const createUserOptions = {
    body: Joi.object({
        name: Joi.string().min(2).max(100).required().trim(),
        username: Joi.string().alphanum().min(3).max(30).required().lowercase().trim(),
        password: Joi.string().min(6).required(),
        role: Joi.string().valid('admin', 'worker').required()
    })
};

module.exports = {
    loginOptions,
    changePasswordOptions,
    changeMyPasswordOptions,
    createUserOptions
};
