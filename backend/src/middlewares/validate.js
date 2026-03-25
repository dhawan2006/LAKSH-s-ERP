'use strict';

const apiResponse = require('../utils/apiResponse');

/**
 * Validation Middleware using Joi
 *
 * Express 5 makes req.query and req.params immutable getters.
 * This middleware validates the input, then uses Object.defineProperty
 * to override the getters with the Joi-validated (and coerced) values.
 *
 * @param {Object} schema - Joi schema (e.g. { body: Joi.object(...), query: Joi.object(...) })
 */
const validate = (schema) => {
    return (req, res, next) => {
        const errors = [];

        // Validate req.body (Express 5 allows body mutation)
        if (schema.body) {
            const { error, value } = schema.body.validate(req.body, { abortEarly: false, stripUnknown: true });
            if (error) {
                errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'body' })));
            } else {
                req.body = value;
            }
        }

        // Validate req.query — use Object.defineProperty to override the immutable getter
        if (schema.query) {
            const { error, value } = schema.query.validate(req.query, { abortEarly: false, stripUnknown: true });
            if (error) {
                errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'query' })));
            } else {
                Object.defineProperty(req, 'query', {
                    value: value,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            }
        }

        // Validate req.params — use Object.defineProperty to override the immutable getter
        if (schema.params) {
            const { error, value } = schema.params.validate(req.params, { abortEarly: false, stripUnknown: true });
            if (error) {
                errors.push(...error.details.map(d => ({ field: d.path.join('.'), message: d.message, location: 'params' })));
            } else {
                Object.defineProperty(req, 'params', {
                    value: value,
                    writable: true,
                    configurable: true,
                    enumerable: true,
                });
            }
        }

        if (errors.length > 0) {
            return apiResponse.error(res, 'Validation failed', errors, 422);
        }

        next();
    };
};

module.exports = validate;
