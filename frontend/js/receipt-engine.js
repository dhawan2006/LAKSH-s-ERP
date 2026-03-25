/**
 * Receipt Engine — Industry-Level Receipt Generation for Kirana ERP
 *
 * Provides:
 *   - getInvoiceSettings()              — fetch settings from API + localStorage cache
 *   - generateThermalReceipt(data, s)   — thermal receipt HTML (58mm / 80mm)
 *   - generateA4Invoice(data, s)        — formal A4 tax invoice HTML
 *   - generateReceipt(data, s)          — auto-selects template from settings
 *   - printReceipt(html, settings)      — thermal → popup window, A4 → hidden iframe
 *   - previewReceipt(html, el)          — inject into preview container
 *   - clearSettingsCache()              — bust the 30-sec localStorage cache
 */

'use strict';

const ReceiptEngine = (function () {

    const CACHE_KEY = 'kirana_invoice_settings';
    const CACHE_TTL = 0;

    /* ─── Settings ─────────────────────────────────────────────── */

    async function getInvoiceSettings(forceRefresh = false) {
        const defaults = _defaults();

        if (!forceRefresh) {
            try {
                const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
                if (cached && cached._ts && (Date.now() - cached._ts < CACHE_TTL)) return cached;
            } catch (_) { /* ignore */ }
        }

        try {
            const token = localStorage.getItem('token');
            // Add cache-busting timestamp to the fetch url itself
            const res = await fetch(`/api/v1/invoice-settings?_t=${Date.now()}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            const json = await res.json();
            console.log('[ReceiptEngine] API raw response:', JSON.stringify(json));
            if (json.data) {
                const settings = { ..._defaults(), ...json.data };
                settings._ts = Date.now();
                console.log('[ReceiptEngine] Merged settings:', JSON.stringify({ shop_name: settings.shop_name, printer_mode: settings.printer_mode }));
                localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
                return settings;
            }
        } catch (e) {
            console.warn('[ReceiptEngine] Failed to fetch invoice settings, using defaults:', e);
        }

        return defaults;
    }

    function clearSettingsCache() {
        localStorage.removeItem(CACHE_KEY);
    }

    function _defaults() {
        return {
            shop_name: 'Kirana Store',
            shop_address: '',
            shop_phone: '',
            gst_number: '',
            logo_path: '',
            printer_mode: 'thermal80',    // 'thermal58' | 'thermal80' | 'a4'
            invoice_type: 'thermal',       // kept for backward compat
            receipt_width: '80mm',         // kept for backward compat
            show_gst: true,
            show_phone: true,
            show_thank_you: true,
            show_payment_details: true,
            invoice_prefix: 'INV-',
            invoice_counter: 0,
            thank_you_message: 'Thank you for shopping!',
            terms: 'Goods once sold will not be taken back.',
        };
    }

    /* ─── Width Config ──────────────────────────────────────────── */

    function getWidthCSS(settings) {
        // Resolve mode: prefer explicit printer_mode, fall back to legacy fields
        const mode = settings.printer_mode ||
            (settings.invoice_type === 'a4' ? 'a4' :
             settings.receipt_width === '58mm' ? 'thermal58' : 'thermal80');

        if (mode === 'a4') {
            return {
                containerWidth: '210mm',
                viewportWidth: '794', // ~210mm at 96dpi
                fontSize: '13px',
                pageRule: '@page { size: A4; margin: 15mm 20mm; }',
                className: 'receipt-a4',
                isThermal: false,
            };
        }
        if (mode === 'thermal58') {
            return {
                containerWidth: '56mm',
                viewportWidth: '220', // ~58mm at 96dpi
                fontSize: '10.5px',
                pageRule: '@page { size: 58mm auto; margin: 0; }',
                className: 'receipt-thermal-58',
                isThermal: true,
            };
        }
        // Default: thermal80
        return {
            containerWidth: '78mm',
            viewportWidth: '308', // ~80mm at 96dpi
            fontSize: '11.5px',
            pageRule: '@page { size: 80mm auto; margin: 0; }',
            className: 'receipt-thermal-80',
            isThermal: true,
        };
    }

    /* ─── Helpers ───────────────────────────────────────────────── */

    function _esc(str) {
        if (!str && str !== 0) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _fmt(n) { return Number(n || 0).toFixed(2); }

    function _formatDate(d) {
        try {
            return new Date(d || Date.now()).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true,
            });
        } catch (_) { return new Date().toLocaleString('en-IN'); }
    }

    function _logoHtml(settings, maxWidth) {
        if (!settings.logo_path) return '';
        return `<div style="text-align:center;margin-bottom:6px;">
            <img src="${settings.logo_path}" alt="Logo"
                 style="max-width:${maxWidth};max-height:48px;object-fit:contain;">
        </div>`;
    }

    function _sep(dashed = true) {
        return dashed
            ? `<div style="border-bottom:1px dashed #aaa;margin:5px 0;"></div>`
            : `<div style="border-bottom:1px solid #888;margin:5px 0;"></div>`;
    }

    /** Compute per-item totals from cart item */
    function _itemTotals(item) {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.price) || 0;
        const disc = Number(item.discount) || 0;
        const gst = Number(item.gst) || 0;
        const raw = rate * qty;
        const discAmt = raw * (disc / 100);
        const net = raw - discAmt;
        const gstAmt = net * (gst / 100);
        return { qty, rate, disc, gst, raw, discAmt, net, gstAmt, total: net + gstAmt };
    }

    /** Compute CGST/SGST slab-wise breakdown for B2B invoices */
    function _computeGSTSlabs(items) {
        const slabs = {}; // { '18': { taxable: X, cgst: Y, sgst: Y } }
        items.forEach(item => {
            const t = _itemTotals(item);
            if (t.gst <= 0) return;
            const key = String(t.gst);
            if (!slabs[key]) slabs[key] = { rate: t.gst, taxable: 0, cgst: 0, sgst: 0 };
            slabs[key].taxable += t.net;
            slabs[key].cgst += t.gstAmt / 2;
            slabs[key].sgst += t.gstAmt / 2;
        });
        return Object.values(slabs).sort((a, b) => a.rate - b.rate);
    }

    /* ─── Wrap HTML ─────────────────────────────────────────────── */

    function _wrapHtml(body, w) {
        const font = w.isThermal
            ? `'Courier New', Courier, monospace`
            : `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
        return `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${w.viewportWidth || (w.isThermal ? '308' : '794')}, initial-scale=1">
<style>
    ${w.pageRule}
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    body {
        font-family: ${font};
        font-size: ${w.fontSize};
        color: #111;
        width: ${w.containerWidth};
        margin: 0 auto;
        padding: ${w.isThermal ? '6px 5px' : '0'};
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    table { width: 100%; border-collapse: collapse; }
    @media print {
        html, body {
            width: ${w.containerWidth} !important;
            max-width: ${w.containerWidth} !important;
            overflow: hidden !important;
            margin: 0 !important;
        }
        body {
            padding: ${w.isThermal ? '4px 3px' : '0'} !important;
        }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
</style>
<script>
  window.onbeforeprint = function() {
    document.body.style.zoom = '1';
    document.documentElement.style.zoom = '1';
  };
<\/script>
</head><body>${body}</body></html>`;
    }

    /* ─────────────────────────────────────────────────────────────
       THERMAL RECEIPT
    ────────────────────────────────────────────────────────────── */

    function generateThermalReceipt(data, s) {
        s = s || _defaults();
        const w = getWidthCSS(s);
        const items = data.items || [];
        // Derive is58 from printer_mode first, fall back to receipt_width
        const is58 = (s.printer_mode === 'thermal58') || 
                     (s.receipt_width === '58mm' && s.printer_mode !== 'thermal80');
        const fs = is58 ? '9px' : '10px';
        const fsH = is58 ? '13px' : '15px';

        /* ── Header ─────────────────────────────────────────────── */
        const header = [
            _logoHtml(s, is58 ? '34mm' : '44mm'),
            `<div style="text-align:center;font-weight:800;font-size:${fsH};letter-spacing:0.5px;">${_esc(s.shop_name || 'Kirana Store')}</div>`,
            s.shop_address
                ? `<div style="text-align:center;font-size:${fs};color:#555;">${_esc(s.shop_address)}</div>` : '',
            (s.show_phone && s.shop_phone)
                ? `<div style="text-align:center;font-size:${fs};color:#555;">Ph: ${_esc(s.shop_phone)}</div>` : '',
            (s.show_gst && s.gst_number)
                ? `<div style="text-align:center;font-size:${fs};color:#555;">GSTIN: ${_esc(s.gst_number)}</div>` : '',
        ].filter(Boolean).join('');

        /* ── Invoice Info ───────────────────────────────────────── */
        const info = `
            <div style="display:flex;justify-content:space-between;font-size:${fs};margin:2px 0;">
                <span><b>Bill:</b> ${_esc(data.invoice || '')}</span>
                <span>${_formatDate(data.date)}</span>
            </div>
            ${data.customer
                ? `<div style="font-size:${fs};"><b>Customer:</b> ${_esc(data.customer)}</div>`
                : ''}`;

        /* ── Items Table ────────────────────────────────────────── */
        /* Each row: Name | Qty×Rate (Disc%) | Total
           A second sub-row for GST if applicable */
        const rowFs = is58 ? '9px' : '10px';
        const itemRows = items.map(item => {
            const t = _itemTotals(item);
            const discNote = t.disc > 0 ? ` <span style="color:#888;">(${t.disc}%off)</span>` : '';
            const gstNote = t.gst > 0 ? ` <span style="color:#888;font-size:8.5px;">+${t.gst}%GST</span>` : '';
            return `<tr>
                <td style="padding:2px 0;font-size:${rowFs};vertical-align:top;">
                    ${_esc(item.name)}${discNote}${gstNote}
                </td>
                <td style="text-align:center;padding:2px 2px;font-size:${rowFs};vertical-align:top;white-space:nowrap;">
                    ${t.qty}&times;${_fmt(t.rate)}
                </td>
                <td style="text-align:right;padding:2px 0;font-size:${rowFs};font-weight:600;vertical-align:top;white-space:nowrap;">
                    &#8377;${_fmt(t.total)}
                </td>
            </tr>`;
        }).join('');

        const itemsTable = `
            <table>
                <thead>
                    <tr style="border-bottom:1px solid #888;font-size:${rowFs};font-weight:700;">
                        <td style="padding:2px 0;">Item</td>
                        <td style="text-align:center;padding:2px 2px;">Qty&times;Rate</td>
                        <td style="text-align:right;padding:2px 0;">Amt</td>
                    </tr>
                </thead>
                <tbody>${itemRows}</tbody>
            </table>`;

        /* ── Compute Totals ─────────────────────────────────────── */
        let subtotalNet = 0, totalGST = 0, totalDisc = 0;
        items.forEach(item => {
            const t = _itemTotals(item);
            subtotalNet += t.net;
            totalGST += t.gstAmt;
            totalDisc += t.discAmt;
        });
        let grandBeforeBillDisc = subtotalNet + totalGST;

        const billDisc = Number(data.bill_discount) || 0;
        const discType = data.discount_type || 'flat';
        const billDiscAmt = discType === 'percent'
            ? grandBeforeBillDisc * (billDisc / 100)
            : billDisc;
        const grandTotal = Math.max(0, grandBeforeBillDisc - billDiscAmt);

        /* ── Summary Block ──────────────────────────────────────── */
        const summaryLines = [];

        // GST breakdown
        if (totalGST > 0 && s.show_gst) {
            summaryLines.push(
                `<div style="display:flex;justify-content:space-between;font-size:${fs};">
                    <span>Subtotal (excl. GST)</span><span>&#8377;${_fmt(subtotalNet)}</span>
                </div>`
            );
            // B2B mode: show CGST + SGST slab breakdown
            if (s.invoice_mode === 'b2b') {
                const slabs = _computeGSTSlabs(items);
                slabs.forEach(slab => {
                    const halfRate = _fmt(slab.rate / 2);
                    summaryLines.push(
                        `<div style="display:flex;justify-content:space-between;font-size:${fs};">
                            <span>CGST @${halfRate}%</span><span>&#8377;${_fmt(slab.cgst)}</span>
                        </div>`,
                        `<div style="display:flex;justify-content:space-between;font-size:${fs};">
                            <span>SGST @${halfRate}%</span><span>&#8377;${_fmt(slab.sgst)}</span>
                        </div>`
                    );
                });
            } else {
                summaryLines.push(
                    `<div style="display:flex;justify-content:space-between;font-size:${fs};">
                        <span>GST</span><span>&#8377;${_fmt(totalGST)}</span>
                    </div>`
                );
            }
        }
        if (totalDisc > 0) {
            summaryLines.push(
                `<div style="display:flex;justify-content:space-between;font-size:${fs};color:#c00;">
                    <span>Item Discounts</span><span>-&#8377;${_fmt(totalDisc)}</span>
                </div>`
            );
        }
        if (billDiscAmt > 0) {
            const label = discType === 'percent'
                ? `Bill Discount (${billDisc}%)`
                : `Bill Discount`;
            summaryLines.push(
                `<div style="display:flex;justify-content:space-between;font-size:${fs};color:#c00;">
                    <span>${label}</span><span>-&#8377;${_fmt(billDiscAmt)}</span>
                </div>`
            );
        }

        const grandLine = `
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:${fsH};margin:4px 0;">
                <span>TOTAL</span><span>&#8377;${_fmt(grandTotal)}</span>
            </div>`;

        /* ── Payment Details ────────────────────────────────────── */
        const payLines = [];
        if (s.show_payment_details) {
            if (data.cash_paid !== undefined)
                payLines.push(`<div style="display:flex;justify-content:space-between;font-size:${fs};">
                    <span>Cash Paid</span><span>&#8377;${_fmt(data.cash_paid)}</span>
                </div>`);
            if (Number(data.upi_paid) > 0)
                payLines.push(`<div style="display:flex;justify-content:space-between;font-size:${fs};">
                    <span>UPI / Card</span><span>&#8377;${_fmt(data.upi_paid)}</span>
                </div>`);
            if (Number(data.credit) > 0)
                payLines.push(`<div style="display:flex;justify-content:space-between;font-size:${fs};color:#c00;font-weight:700;">
                    <span>⚠ Credit Due</span><span>&#8377;${_fmt(data.credit)}</span>
                </div>`);
            if (Number(data.change) > 0)
                payLines.push(`<div style="display:flex;justify-content:space-between;font-size:${fs};">
                    <span>Change Returned</span><span>&#8377;${_fmt(data.change)}</span>
                </div>`);
        }

        /* ── Footer ─────────────────────────────────────────────── */
        const thankYou = (s.show_thank_you && s.thank_you_message)
            ? `<div style="text-align:center;font-size:${is58 ? '8px' : '9px'};color:#888;margin-top:4px;">${_esc(s.thank_you_message)}</div>`
            : '';
        const terms = s.terms
            ? `<div style="text-align:center;font-size:8px;color:#bbb;margin-top:2px;">${_esc(s.terms)}</div>`
            : '';
        const powered = `<div style="text-align:center;font-size:7px;color:#ccc;margin-top:4px;">Powered by Kirana ERP</div>`;

        /* ── Loyalty Points Earned ──────────────────────────────── */
        const loyaltyLine = (data.points_earned && data.points_earned > 0)
            ? `<div style="text-align:center;font-size:${fs};color:#228B22;margin-top:3px;">⭐ Points Earned: ${data.points_earned}</div>`
            : '';

        const body = [
            header,
            _sep(),
            info,
            _sep(),
            itemsTable,
            _sep(false),
            ...summaryLines,
            grandLine,
            _sep(),
            ...payLines,
            loyaltyLine,
            _sep(),
            thankYou,
            terms,
            powered,
        ].join('\n');

        return _wrapHtml(body, w);
    }

    /* ─────────────────────────────────────────────────────────────
       A4 TAX INVOICE
    ────────────────────────────────────────────────────────────── */

    function generateA4Invoice(data, s) {
        s = s || _defaults();
        const w = getWidthCSS(s);
        const items = data.items || [];

        /* ── Header ─────────────────────────────────────────────── */
        const header = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;
                    margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e0e0e0;">
            <div>
                ${_logoHtml(s, '60mm')}
                <div style="font-size:22px;font-weight:800;color:#111;">${_esc(s.shop_name || 'Kirana Store')}</div>
                ${s.shop_address
                ? `<div style="font-size:12px;color:#666;margin-top:2px;">${_esc(s.shop_address)}</div>` : ''}
                ${(s.show_phone && s.shop_phone)
                ? `<div style="font-size:12px;color:#666;">Ph: ${_esc(s.shop_phone)}</div>` : ''}
                ${(s.show_gst && s.gst_number)
                ? `<div style="font-size:12px;color:#666;margin-top:2px;"><b>GSTIN:</b> ${_esc(s.gst_number)}</div>` : ''}
            </div>
            <div style="text-align:right;">
                <div style="font-size:22px;font-weight:800;color:#333;letter-spacing:1px;">TAX INVOICE</div>
                <div style="margin-top:8px;font-size:13px;color:#555;line-height:1.7;">
                    <div><b>Invoice:</b> ${_esc(data.invoice || '')}</div>
                    <div><b>Date:</b> ${_formatDate(data.date)}</div>
                </div>
            </div>
        </div>`;

        const customerBlock = data.customer ? `
        <div style="margin-bottom:18px;padding:12px 16px;background:#f8f9fb;
                    border-radius:8px;border:1px solid #eee;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:4px;">Bill To</div>
            <div style="font-size:14px;font-weight:600;color:#222;">${_esc(data.customer)}</div>
        </div>` : '';

        /* ── Items Table ────────────────────────────────────────── */
        let subtotalNet = 0, totalGST = 0, totalDisc = 0;
        const tableRows = items.map((item, idx) => {
            const t = _itemTotals(item);
            subtotalNet += t.net;
            totalGST += t.gstAmt;
            totalDisc += t.discAmt;
            const bg = idx % 2 === 0 ? '#fff' : '#fafafa';
            return `<tr style="background:${bg};border-bottom:1px solid #eee;">
                <td style="padding:9px 12px;color:#222;font-weight:500;">${_esc(item.name)}</td>
                <td style="padding:9px 12px;text-align:center;">${t.qty}</td>
                <td style="padding:9px 12px;text-align:right;">&#8377;${_fmt(t.rate)}</td>
                <td style="padding:9px 12px;text-align:right;color:#c53030;">${t.disc > 0 ? t.disc + '%' : '—'}</td>
                <td style="padding:9px 12px;text-align:right;">${t.gst > 0 ? t.gst + '%' : '—'}</td>
                <td style="padding:9px 12px;text-align:right;font-weight:700;">&#8377;${_fmt(t.total)}</td>
            </tr>`;
        }).join('');

        const table = `
        <table style="margin-bottom:20px;">
            <thead>
                <tr style="background:#1a1a2e;color:#fff;">
                    <th style="padding:10px 12px;text-align:left;font-weight:600;font-size:12px;">Product</th>
                    <th style="padding:10px 12px;text-align:center;font-weight:600;font-size:12px;">Qty</th>
                    <th style="padding:10px 12px;text-align:right;font-weight:600;font-size:12px;">Rate</th>
                    <th style="padding:10px 12px;text-align:right;font-weight:600;font-size:12px;">Disc</th>
                    <th style="padding:10px 12px;text-align:right;font-weight:600;font-size:12px;">GST</th>
                    <th style="padding:10px 12px;text-align:right;font-weight:600;font-size:12px;">Total</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>`;

        /* ── Totals ─────────────────────────────────────────────── */
        let grandBeforeBillDisc = subtotalNet + totalGST;
        const billDisc = Number(data.bill_discount) || 0;
        const discType = data.discount_type || 'flat';
        const billDiscAmt = discType === 'percent'
            ? grandBeforeBillDisc * (billDisc / 100)
            : billDisc;
        const grandTotal = Math.max(0, grandBeforeBillDisc - billDiscAmt);

        const summaryRow = (label, value, color = '#555', large = false) =>
            `<div style="display:flex;justify-content:space-between;padding:4px 0;
                         font-size:${large ? '14px' : '13px'};color:${color};${large ? 'font-weight:700;' : ''}">
                <span>${label}</span><span>&#8377;${_fmt(value)}</span>
            </div>`;

        const totalsBlock = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
            <div style="min-width:280px;">
                ${subtotalNet > 0 && totalGST > 0 ? summaryRow('Subtotal (excl. GST)', subtotalNet) : ''}
                ${totalGST > 0 && s.invoice_mode === 'b2b' ? _computeGSTSlabs(items).map(slab => {
                    const hr = (slab.rate / 2).toFixed(2);
                    return summaryRow(`CGST @${hr}%`, slab.cgst) + summaryRow(`SGST @${hr}%`, slab.sgst);
                }).join('') : (totalGST > 0 ? summaryRow('Total GST', totalGST) : '')}
                ${totalDisc > 0 ? summaryRow('Item Discounts', totalDisc, '#c53030') : ''}
                ${billDiscAmt > 0 ? summaryRow(
            discType === 'percent' ? `Bill Discount (${billDisc}%)` : 'Bill Discount',
            billDiscAmt, '#c53030') : ''}
                <div style="border-top:2px solid #111;margin:8px 0;"></div>
                <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:800;color:#111;">
                    <span>Grand Total</span><span>&#8377;${_fmt(grandTotal)}</span>
                </div>
                ${data.points_earned && data.points_earned > 0 ? `<div style="text-align:right;font-size:12px;color:#228B22;margin-top:4px;">⭐ Loyalty Points Earned: ${data.points_earned}</div>` : ''}
            </div>
        </div>`;

        /* ── Payment Details ────────────────────────────────────── */
        let paymentBlock = '';
        if (s.show_payment_details) {
            const rows = [];
            if (data.cash_paid !== undefined)
                rows.push(summaryRow('Cash Paid', data.cash_paid));
            if (Number(data.upi_paid) > 0)
                rows.push(summaryRow('UPI / Card', data.upi_paid));
            if (Number(data.credit) > 0)
                rows.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;
                                       font-size:13px;color:#dc2626;font-weight:700;">
                    <span>⚠ Credit Due</span><span>&#8377;${_fmt(data.credit)}</span>
                </div>`);
            if (Number(data.change) > 0)
                rows.push(summaryRow('Change Returned', data.change));

            if (rows.length) {
                paymentBlock = `
                <div style="padding:12px 16px;background:#f8f9fb;border-radius:8px;
                             border:1px solid #eee;margin-bottom:20px;">
                    <div style="font-size:11px;color:#888;text-transform:uppercase;
                                letter-spacing:0.5px;margin-bottom:6px;">Payment Details</div>
                    ${rows.join('')}
                </div>`;
            }
        }

        /* ── Terms & Signature ──────────────────────────────────── */
        const termsBlock = s.terms ? `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
            <div style="font-size:11px;color:#888;text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:4px;">Terms &amp; Conditions</div>
            <div style="font-size:12px;color:#666;line-height:1.6;">${_esc(s.terms)}</div>
        </div>` : '';

        const signatureBlock = `
        <div style="display:flex;justify-content:space-between;margin-top:40px;padding-top:20px;
                    border-top:1px solid #eee;">
            <div style="text-align:center;">
                <div style="border-top:1px solid #bbb;width:130px;margin-bottom:6px;"></div>
                <div style="font-size:11px;color:#888;">Customer Signature</div>
            </div>
            <div style="text-align:center;">
                <div style="border-top:1px solid #bbb;width:130px;margin-bottom:6px;"></div>
                <div style="font-size:11px;color:#888;">Authorised Signature</div>
            </div>
        </div>`;

        const thankYou = (s.show_thank_you && s.thank_you_message)
            ? `<div style="text-align:center;margin-top:20px;color:#aaa;font-size:11px;letter-spacing:0.5px;">${_esc(s.thank_you_message)}</div>`
            : '';
        const powered = `<div style="text-align:center;margin-top:6px;color:#ccc;font-size:10px;">Powered by Kirana ERP</div>`;

        const body = [header, customerBlock, table, paymentBlock, totalsBlock, termsBlock, signatureBlock, thankYou, powered].join('\n');
        return _wrapHtml(body, w);
    }

    /* ─── Auto-Select Template ──────────────────────────────────── */

    function generateReceipt(data, settings) {
        const s = settings || _defaults();
        // Resolve mode from printer_mode first, then fall back to legacy invoice_type
        const mode = s.printer_mode ||
            (s.invoice_type === 'a4' ? 'a4' : 'thermal80');
        console.log('[ReceiptEngine] generateReceipt → mode:', mode, '| shop_name:', s.shop_name, '| printer_mode:', s.printer_mode, '| invoice_type:', s.invoice_type);
        if (mode === 'a4') return generateA4Invoice(data, s);
        return generateThermalReceipt(data, s);
    }

    /* ─────────────────────────────────────────────────────────────
       PRINT HELPERS
    ────────────────────────────────────────────────────────────── */

    /**
     * Detect printer mode from generated HTML content.
     * Used as fallback when settings are not passed to printReceipt().
     */
    function _detectModeFromHtml(html) {
        if (html.includes('210mm') || html.includes('size: A4')) return 'a4';
        if (html.includes('56mm') || html.includes('58mm auto')) return 'thermal58';
        return 'thermal80';
    }

    /**
     * Thermal print via a narrow popup window.
     * The popup width matches the paper width so the OS print dialog
     * infers the correct page size from @page CSS.
     */
    function _printThermalPopup(htmlContent, mode) {
        // px widths at 96 dpi: 58mm ≈ 226px, 80mm ≈ 308px
        const widthPx = mode === 'thermal58' ? 226 : 308;
        const win = window.open(
            '',
            '_blank',
            `width=${widthPx + 40},height=700,left=100,top=100,` +
            `toolbar=0,menubar=0,location=0,status=0,scrollbars=1`
        );

        if (!win) {
            if (typeof kiranaAlert === 'function') {
                kiranaAlert(
                    'Popup blocked!',
                    'Please allow popups for this site to enable thermal printing.\nIn Chrome: click the popup-blocked icon in the address bar → Always allow.'
                );
            } else {
                alert('Popup blocked!\n\nPlease allow popups for this site to enable thermal printing.');
            }
            return;
        }

        win.document.open();
        win.document.write(htmlContent);
        win.document.close();

        // Use onload; fallback via setTimeout
        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            try {
                win.focus();
                win.print();
                setTimeout(() => { try { win.close(); } catch (_) {} }, 2500);
            } catch (e) {
                console.error('[ReceiptEngine] Thermal print error:', e);
            }
        };

        win.onload = () => setTimeout(doPrint, 200);
        setTimeout(doPrint, 1000); // hard fallback if onload already fired
    }

    /**
     * A4 / laser print via a hidden iframe (silent, no popup).
     * This approach works perfectly for A4 since the OS ignores @page size
     * only for non-standard paper — A4 is the default so it is honoured.
     */
    function _printViaIframe(htmlContent) {
        const FRAME_ID = 'receiptPrintFrame';
        let frame = document.getElementById(FRAME_ID);
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = FRAME_ID;
            frame.style.cssText =
                'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;visibility:hidden;';
            document.body.appendChild(frame);
        }

        let printed = false;
        frame.onload = () => {
            if (printed) return;
            printed = true;
            try { frame.contentWindow.focus(); frame.contentWindow.print(); }
            catch (e) { console.error('[ReceiptEngine] A4 print error:', e); }
        };

        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open();
        doc.write(htmlContent);
        doc.close();

        // Hard fallback
        setTimeout(() => {
            if (!printed) {
                printed = true;
                try { frame.contentWindow.focus(); frame.contentWindow.print(); }
                catch (e) { console.error('[ReceiptEngine] A4 print fallback:', e); }
            }
        }, 1200);
    }

    /* ─────────────────────────────────────────────────────────────
       PRINT — public entry point
       - Thermal (58mm / 80mm): opens a narrow popup window so the OS
         print dialog picks up the exact paper size from @page CSS.
       - A4 / laser: uses the existing hidden iframe (works fine for A4).
    ────────────────────────────────────────────────────────────── */

    function printReceipt(htmlContent, settings) {
        console.log("PRINT SETTINGS:", settings);
        // Resolve printer mode from settings, or detect from HTML as fallback
        const mode = (settings && settings.printer_mode) ||
            (settings && settings.invoice_type === 'a4' ? 'a4' : null) ||
            _detectModeFromHtml(htmlContent);

        if (mode === 'a4') {
            _printViaIframe(htmlContent);
        } else {
            _printThermalPopup(htmlContent, mode);
        }
    }

    /* ─────────────────────────────────────────────────────────────
       PREVIEW — sandboxed iframe inside modal container
    ────────────────────────────────────────────────────────────── */

    function previewReceipt(htmlContent, containerEl, settings) {
        if (typeof containerEl === 'string') containerEl = document.getElementById(containerEl);
        if (!containerEl) return;

        let iframe = containerEl.querySelector('.receipt-preview-frame');
        const isLive = containerEl.dataset.preview === 'live';

        if (!iframe) {
            iframe = document.createElement('iframe');
            iframe.className = 'receipt-preview-frame';

            const extraStyles = isLive
                ? 'box-shadow: 0 4px 28px rgba(0,0,0,0.18); margin: 0 auto;'
                : 'min-height: 340px; margin: 0 auto;';

            iframe.style.cssText =
                'border:none;background:#fff;border-radius:8px;' +
                'display:block;transition:height 0.25s ease;' + extraStyles;
            containerEl.innerHTML = '';
            containerEl.appendChild(iframe);
        }

        const iDoc = iframe.contentDocument || iframe.contentWindow.document;
        iDoc.open();
        iDoc.write(htmlContent);
        iDoc.close();

        // Detect paper mode and set iframe width to mirror print width exactly
        let detectedMode;
        if (settings && settings.printer_mode) {
            detectedMode = settings.printer_mode;
        } else if (settings && settings.invoice_type === 'a4') {
            detectedMode = 'a4';
        } else {
            detectedMode = _detectModeFromHtml(htmlContent); // fallback only
        }
        const widthMap = { a4: '210mm', thermal58: '58mm', thermal80: '80mm' };
        let targetWidth = widthMap[detectedMode] || '80mm';

        iframe.style.width = targetWidth;

        // Allow live preview to push container horizontal scrollbars instead of squishing
        if (isLive) {
            iframe.style.maxWidth = 'none';
        } else {
            iframe.style.maxWidth = '100%';
        }

        const resize = () => {
            try {
                const h = iDoc.documentElement.scrollHeight || iDoc.body.scrollHeight;
                if (h > 50) iframe.style.height = (h + 32) + 'px';

                if (isLive) {
                    const cWidth = containerEl.clientWidth;
                    const iWidth = iframe.offsetWidth;
                    if (cWidth > 0 && iWidth > 0 && iWidth > (cWidth - 48)) {
                        const scale = (cWidth - 48) / iWidth;
                        iframe.style.transform = `scale(${scale})`;
                        iframe.style.transformOrigin = 'top center';
                        // Reduce the physical height of the container to match the scaled height
                        iframe.style.marginBottom = `-${(1 - scale) * (h + 32)}px`;
                    } else {
                        iframe.style.transform = 'none';
                        iframe.style.marginBottom = '0';
                    }
                }
            } catch (_) { }
        };
        
        window.addEventListener('resize', resize);
        iframe.onload = resize;
        setTimeout(resize, 100);
        setTimeout(resize, 300);
        setTimeout(resize, 800);
    }

    /* ─── WhatsApp Receipt ──────────────────────────────────────────
       Generates plain-text receipt formatted for WhatsApp messaging.
       No API key needed — uses official wa.me Click-to-Chat URL.
       Phone must be a 10-digit Indian mobile number (without country code).
    ──────────────────────────────────────────────────────────────── */

    function generateWhatsAppText(data, s) {
        s = s || _defaults();
        const items = data.items || [];
        const lines = [];
        const sep = '─────────────────────';

        // ── Header
        lines.push(`🛒 *${s.shop_name || 'Kirana Store'}*`);
        if (s.shop_address) lines.push(s.shop_address);
        if (s.show_phone && s.shop_phone) lines.push(`📞 ${s.shop_phone}`);
        if (s.show_gst && s.gst_number) lines.push(`GSTIN: ${s.gst_number}`);
        lines.push(sep);

        // ── Invoice info
        lines.push(`🧾 *Bill: ${data.invoice || ''}*`);
        lines.push(`📅 ${_formatDate(data.date)}`);
        if (data.customer) lines.push(`👤 ${data.customer}`);
        lines.push(sep);

        // ── Items
        items.forEach(item => {
            const t = _itemTotals(item);
            let row = `• ${item.name}  ${t.qty}×₹${_fmt(t.rate)}`;
            if (t.disc > 0) row += ` (-${t.disc}%)`;
            row += `  = *₹${_fmt(t.total)}*`;
            lines.push(row);
        });
        lines.push(sep);

        // ── Totals
        let subtotalNet = 0, totalGST = 0, totalDisc = 0;
        items.forEach(item => {
            const t = _itemTotals(item);
            subtotalNet += t.net; totalGST += t.gstAmt; totalDisc += t.discAmt;
        });
        const grandBeforeBillDisc = subtotalNet + totalGST;
        const billDisc = Number(data.bill_discount) || 0;
        const discType = data.discount_type || 'flat';
        const billDiscAmt = discType === 'percent'
            ? grandBeforeBillDisc * (billDisc / 100) : billDisc;
        const grandTotal = Math.max(0, grandBeforeBillDisc - billDiscAmt);

        if (totalDisc > 0) lines.push(`💰 Item Savings: ₹${_fmt(totalDisc)}`);
        if (billDiscAmt > 0) lines.push(`🎁 Bill Discount: -₹${_fmt(billDiscAmt)}`);
        if (totalGST > 0 && s.show_gst) lines.push(`📊 GST: ₹${_fmt(totalGST)}`);
        lines.push(`*💵 TOTAL: ₹${_fmt(grandTotal)}*`);
        lines.push(sep);

        // ── Payment
        if (s.show_payment_details) {
            if (data.cash_paid !== undefined) lines.push(`💵 Cash: ₹${_fmt(data.cash_paid)}`);
            if (Number(data.upi_paid) > 0) lines.push(`📱 UPI: ₹${_fmt(data.upi_paid)}`);
            if (Number(data.credit) > 0) lines.push(`⚠️ *Credit Due: ₹${_fmt(data.credit)}*`);
            if (Number(data.change) > 0) lines.push(`↩️ Change: ₹${_fmt(data.change)}`);
        }

        // ── Loyalty
        if (data.points_earned && data.points_earned > 0) {
            lines.push(`⭐ Points Earned: ${data.points_earned}`);
        }

        // ── Footer
        if (s.show_thank_you && s.thank_you_message) {
            lines.push('');
            lines.push(s.thank_you_message);
        }
        const footer = (s.receipt_footer ?? 'Sent from Kirana ERP').trim();
        if (footer) lines.push(`_${footer}_`);

        return lines.join('\n');
    }

    /**
     * Returns the WhatsApp Click-to-Chat URL for a 10-digit Indian mobile number.
     * @param {string} phone  - 10-digit number (e.g. "9876543210") OR "91XXXXXXXXXX"
     * @param {string} text   - Plain text receipt from generateWhatsAppText()
     * @returns {string|null} URL or null if phone invalid
     */
    function getWhatsAppUrl(phone, text) {
        // Normalise: strip spaces, dashes, brackets, leading +91 or 91
        let digits = String(phone).replace(/\D/g, '');
        if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
        if (digits.length !== 10) return null; // invalid — caller should hide button

        const MAX_URL_CHARS = 1800; // safe buffer below WhatsApp's ~2000 limit
        let safeText = text;

        if (encodeURIComponent(safeText).length > MAX_URL_CHARS) {
            // Trim item lines, keep header + totals + footer intact
            const lines = safeText.split('\n');
            const itemStart = lines.findIndex(l => l.startsWith('•'));
            const itemEnd   = lines.findLastIndex(l => l.startsWith('•'));

            if (itemStart !== -1 && itemEnd !== -1) {
                const before     = lines.slice(0, itemStart);
                const itemLines  = lines.slice(itemStart, itemEnd + 1);
                const after      = lines.slice(itemEnd + 1);

                // Binary-search: find how many items fit within the URL budget
                let lo = 1, hi = itemLines.length, kept = [];
                while (lo <= hi) {
                    const mid = Math.floor((lo + hi) / 2);
                    const trimmed = [
                        ...before,
                        ...itemLines.slice(0, mid),
                        `  _...and ${itemLines.length - mid} more item(s)_`,
                        ...after
                    ].join('\n');
                    if (encodeURIComponent(trimmed).length <= MAX_URL_CHARS) {
                        kept = itemLines.slice(0, mid);
                        lo = mid + 1;
                    } else {
                        hi = mid - 1;
                    }
                }
                safeText = [
                    ...before,
                    ...kept,
                    `  _...and ${itemLines.length - kept.length} more item(s)_`,
                    ...after
                ].join('\n');
            }
        }

        return `https://wa.me/91${digits}?text=${encodeURIComponent(safeText)}`;
    }

    /* ─── Public API ────────────────────────────────────────────── */

    return {
        getInvoiceSettings,
        clearSettingsCache,
        getWidthCSS,
        generateThermalReceipt,
        generateA4Invoice,
        generateReceipt,
        printReceipt,
        previewReceipt,
        generateWhatsAppText,
        getWhatsAppUrl,
    };

})();
