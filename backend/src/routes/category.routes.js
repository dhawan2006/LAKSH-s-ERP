/**
 * Category Routes
 * POST   /add-category        — Create a new category
 * GET    /categories          — List all categories
 * PUT    /update-category/:id — Update a category
 * DELETE /delete-category/:id — Delete a category
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../config/database');
const validate = require('../middlewares/validate');
const apiResponse = require('../utils/apiResponse');
const { addCategoryOptions, updateCategoryOptions, deleteCategoryOptions } = require('../validators/category.validator');

/* ─── Create Category ─────────────────────────────────────────── */
router.post('/add-category', validate(addCategoryOptions), (req, res) => {
    const { name, description } = req.body;

    db.run(`INSERT INTO categories (name, description) VALUES (?, ?)`,
        [name, description],
        function (err) {
            if (err) {
                const isDup = err.message.includes('UNIQUE');
                return apiResponse.error(res, isDup ? `Category "${name}" already exists` : 'Failed to add category', err, 400);
            }
            return apiResponse.success(res, 'Category added', { id: this.lastID }, 201);
        }
    );
});

/* ─── List All Categories ─────────────────────────────────────── */
router.get('/categories', (req, res) => {
    db.all(
        `SELECT c.*, COUNT(p.id) AS product_count
         FROM categories c LEFT JOIN products p ON p.category_id = c.id
         GROUP BY c.id ORDER BY c.name ASC`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch categories', err, 500);
            return apiResponse.success(res, 'Categories fetched successfully', rows);
        }
    );
});

/* ─── Update Category ─────────────────────────────────────────── */
router.put('/update-category/:id', validate(updateCategoryOptions), (req, res) => {
    const { name, description } = req.body;

    db.run(`UPDATE categories SET name = ?, description = ? WHERE id = ?`,
        [name, description, req.params.id],
        function (err) {
            if (err) return apiResponse.error(res, 'Failed to update category', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'Category not found', null, 404);
            return apiResponse.success(res, 'Category updated');
        }
    );
});

/* ─── Delete Category ─────────────────────────────────────────── */
router.delete('/delete-category/:id', validate(deleteCategoryOptions), (req, res) => {
    // Unlink products first
    db.run(`UPDATE products SET category_id = NULL WHERE category_id = ?`, [req.params.id], () => {
        db.run(`DELETE FROM categories WHERE id = ?`, [req.params.id], function (err) {
            if (err) return apiResponse.error(res, 'Failed to delete category', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'Category not found', null, 404);
            return apiResponse.success(res, 'Category deleted');
        });
    });
});

module.exports = router;
