'use strict';

/**
 * OfflineQueue — IndexedDB-based offline sale queue for Kirana ERP.
 * When the server is unreachable, sales are queued here and synced
 * automatically when the server comes back online.
 */
const OfflineQueue = (function () {
    const DB_NAME = 'kirana_offline';
    const DB_VERSION = 1;
    const STORE = 'pending_sales';
    let _db = null;

    async function _open() {
        if (_db) return _db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('queued_at', 'queued_at', { unique: false });
                }
            };
            req.onsuccess = e => { _db = e.target.result; resolve(_db); };
            req.onerror = e => reject(e.target.error);
        });
    }

    async function enqueue(salePayload) {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const record = {
                payload: salePayload,
                queued_at: new Date().toISOString(),
                attempts: 0,
            };
            const req = store.add(record);
            req.onsuccess = () => resolve(req.result);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function getAll() {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = e => reject(e.target.error);
        });
    }

    async function remove(id) {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = e => reject(e.target.error);
        });
    }

    async function count() {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(0);
        });
    }

    return { enqueue, getAll, remove, count };
})();
