/**
 * Sale Service
 * Handles all business logic for creating sales transactions.
 *
 * BUG FIX: Previously, generateInvoiceNumber() started its own
 * BEGIN IMMEDIATE TRANSACTION while createSale() had already begun
 * a BEGIN TRANSACTION — SQLite does not support nested transactions,
 * causing a "cannot start a transaction within a transaction" error.
 *
 * Fix: Invoice number generation is now inlined into the single
 * outer transaction used by createSale(), removing the nesting.
 */

'use strict';

const { run, get } = require('../utils/db-promise');

/* ─── Main Export ─────────────────────────────────────────────── */

/**
 * Creates a complete sale in a single atomic transaction.
 *
 * @param {Object} data
 * @param {Array}  data.items           - Cart items [{product_id, quantity, discount}]
 * @param {number} [data.cash_paid=0]
 * @param {number} [data.upi_paid=0]
 * @param {number|null} [data.customer_id=null]
 * @param {number} [data.bill_discount=0]
 * @param {string} [data.discount_type='flat'] - 'flat' | 'percent'
 * @param {Object} [opts={}]
 * @param {boolean} [opts.managerOverride=false]
 *
 * @returns {{ invoice: string, total: number, credit: number }}
 */
async function createSale(data, opts = {}) {
    const {
        items,
        cash_paid = 0,
        upi_paid = 0,
        customer_id = null,
        bill_discount = 0,
        discount_type = 'flat',
    } = data;

    if (!Array.isArray(items) || items.length === 0) {
        throw { error: 'Cart is empty' };
    }

    const managerOverride = opts.managerOverride === true;

    // Use IMMEDIATE to prevent SQLITE_BUSY on concurrent writes.
    await run('BEGIN IMMEDIATE TRANSACTION');

    try {
        /* ── 1. Generate invoice number from invoice_settings ──── */
        const settingsRow = await get('SELECT invoice_prefix, invoice_counter FROM invoice_settings WHERE id = 1');
        const prefix = settingsRow?.invoice_prefix || 'INV-';
        const newCounter = (settingsRow?.invoice_counter ?? 0) + 1;
        await run('UPDATE invoice_settings SET invoice_counter = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [newCounter]);
        const invoiceNumber = `${prefix}${String(newCounter).padStart(5, '0')}`;

        /* ── 2. Validate items & compute per-item nets ─────────── */
        const productCache = {};
        let netSubtotal = 0;

        for (const item of items) {
            const { product_id, quantity, discount = 0, price } = item;

            if (!product_id || !Number.isInteger(quantity) || quantity <= 0) {
                throw { error: `Invalid item data for product_id: ${product_id}` };
            }

            const product = await get('SELECT * FROM products WHERE id = ?', [product_id]);

            if (!product) {
                throw { error: `Product #${product_id} not found` };
            }
            if (product.stock_quantity < quantity) {
                throw { error: `Insufficient stock for "${product.name}" (available: ${product.stock_quantity})` };
            }

            productCache[product_id] = product;

            // Use the price from the frontend payload to support inline overrides
            const effectivePrice = price !== undefined ? Number(price) : product.selling_price;

            // MRP ceiling — hard legal limit, no override
            if (product.mrp > 0 && effectivePrice > product.mrp + 0.01) {
                // Allow 0.01 tolerance for floating point
                throw { error: `"${product.name}": Selling price ₹${effectivePrice.toFixed(2)} exceeds MRP ₹${product.mrp.toFixed(2)}. Selling above MRP is illegal.` };
            }

            // Cost floor — enforced unless manager override token present
            if (!managerOverride && product.cost_price > 0 && effectivePrice < product.cost_price - 0.01) {
                throw { error: `"${product.name}": Price ₹${effectivePrice.toFixed(2)} is below cost ₹${product.cost_price.toFixed(2)}. Manager authorisation token required.` };
            }

            const raw = effectivePrice * quantity;
            const discountAmt = raw * (discount / 100);
            const itemNet = raw - discountAmt;
            netSubtotal += itemNet;
        }

        /* ── 3. Apply bill discount to net subtotal (before GST) ── */
        let billDiscAmt = 0;
        if (discount_type === 'percent') {
            billDiscAmt = netSubtotal * (Math.min(100, bill_discount) / 100);
        } else {
            billDiscAmt = Math.min(bill_discount, netSubtotal);
        }
        billDiscAmt = Math.max(0, billDiscAmt);

        const taxableSubtotal = netSubtotal - billDiscAmt;
        const billDiscRatio = netSubtotal > 0 ? (billDiscAmt / netSubtotal) : 0;

        /* ── 4. Compute GST on discounted taxable value per item ── */
        let totalGST = 0;
        for (const item of items) {
            const product = productCache[item.product_id];
            const effectivePrice = item.price !== undefined ? Number(item.price) : product.selling_price;
            const raw = effectivePrice * item.quantity;
            const discountAmt = raw * ((item.discount || 0) / 100);
            const net = raw - discountAmt;
            const netAfterBillDisc = net * (1 - billDiscRatio);
            totalGST += netAfterBillDisc * (product.gst_percentage / 100);
        }

        totalGST = Math.round(totalGST * 100) / 100;
        const grandTotal = Math.max(0, Math.round((taxableSubtotal + totalGST) * 100) / 100);

        /* ── 5. Compute credit ──────────────────────────────────── */
        const paidAmount = Number(cash_paid) + Number(upi_paid);
        const creditAmount = Math.max(0, grandTotal - paidAmount);

        /* ── 6. Insert sale record ──────────────────────────────── */
        const saleResult = await run(`
            INSERT INTO sales
                (invoice_number, customer_id, total_amount, gst_amount,
                 bill_discount, discount_type, final_amount,
                 cash_paid, upi_paid, credit_amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceNumber,
                customer_id || null,
                taxableSubtotal,
                totalGST,
                bill_discount,
                discount_type,
                grandTotal,
                Number(cash_paid),
                Number(upi_paid),
                creditAmount,
            ]
        );

        const saleId = saleResult.lastID;

        /* ── 7. Insert sale items & deduct stock ────────────────── */
        for (const item of items) {
            const { product_id, quantity, discount = 0 } = item;
            const product = productCache[product_id];

            // Re-validate stock inside the lock — guards against concurrent terminals
            const freshStock = await get(
                'SELECT stock_quantity FROM products WHERE id = ?',
                [product_id]
            );
            if (!freshStock || freshStock.stock_quantity < quantity) {
                throw {
                    error: `Stock changed during checkout for "${product.name}". ` +
                           `Available: ${freshStock?.stock_quantity ?? 0}, requested: ${quantity}`
                };
            }

            await run(`
                INSERT INTO sale_items
                    (sale_id, product_id, quantity, price, cost_price, discount)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [saleId, product_id, quantity, item.price !== undefined ? Number(item.price) : product.selling_price, product.cost_price, discount]
            );

            await run(
                'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
                [quantity, product_id]
            );
        }

        /* ── 8. Update customer credit balance ────────────────────── */
        if (customer_id) {
            // Add new credit if sale is partly on credit
            if (creditAmount > 0) {
                await run(
                    'UPDATE customers SET credit_balance = credit_balance + ? WHERE id = ?',
                    [creditAmount, customer_id]
                );
            }
        }

        /* ── 9. Loyalty points — earn on every named customer sale ── */
        let pointsEarned = 0;
        if (customer_id) {
            try {
                const loyaltySettings = await get(
                    'SELECT loyalty_enabled, loyalty_earn_rate FROM invoice_settings WHERE id = 1'
                );
                if (loyaltySettings?.loyalty_enabled === 1) {
                    const rate = loyaltySettings.loyalty_earn_rate || 1;
                    pointsEarned = Math.floor(grandTotal / 100 * rate);
                    if (pointsEarned > 0) {
                        await run(
                            'UPDATE customers SET loyalty_points = loyalty_points + ? WHERE id = ?',
                            [pointsEarned, customer_id]
                        );
                        await run(
                            `INSERT INTO loyalty_transactions (customer_id, sale_id, type, points, note)
                             VALUES (?, ?, 'earn', ?, ?)`,
                            [customer_id, saleId, pointsEarned, `Earned on invoice ${invoiceNumber}`]
                        );
                    }
                }
            } catch (loyaltyErr) {
                // loyalty_transactions table may not exist yet — don't block the sale
                console.warn('[createSale] Loyalty points error (non-fatal):', loyaltyErr.message);
            }
        }

        await run('COMMIT');

        return {
            id: saleId,
            invoice: invoiceNumber,
            total: parseFloat(grandTotal.toFixed(2)),
            credit: parseFloat(creditAmount.toFixed(2)),
            points_earned: pointsEarned,
        };

    } catch (error) {
        await run('ROLLBACK').catch(() => { }); // swallow rollback errors
        throw error;
    }
}

module.exports = { createSale };
