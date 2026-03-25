'use strict';

/**
 * Global Frontend Auth Guard + Account Switcher
 * 1. Public pages: account-select.html, unlock.html, login.html — no redirect
 * 2. Checks localStorage for token; redirects to account-select.html if missing
 * 3. Overrides window.fetch to attach Authorization headers
 * 4. Enforces RBAC visibility (hides admin nav links for workers)
 * 5. Injects account-switcher dropdown into .topbar-right
 */

(function () {
    const publicPages = ['login.html', 'account-select.html', 'unlock.html'];
    const currentFile = window.location.pathname.split('/').pop() || 'index.html';

    if (publicPages.includes(currentFile)) return;

    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const name = localStorage.getItem('name') || localStorage.getItem('user') || 'User';

    // 1. Check Auth
    if (!token) {
        window.location.href = 'account-select.html';
        return;
    }

    if (localStorage.getItem('must_change_password') === '1' && currentFile !== 'change-password.html') {
        window.location.href = 'change-password.html';
        return;
    }

    // 2. Enforce Role Isolation (UI level)
    const adminOnlyPages = [
        'index.html', 'reports.html', 'profit-loss.html', 'register.html',
        'backup.html', 'employees.html', 'products.html', 'categories.html',
        'purchase-orders.html', 'purchases.html', 'purchase-returns.html'
    ];

    if (role !== 'admin' && adminOnlyPages.includes(currentFile)) {
        window.location.href = 'billing.html';
        return;
    }

    // 3. Capture original fetch BEFORE any override
    var rawFetch = window.fetch.bind(window);

    // 4. Override window.fetch to inject JWT automatically
    window.fetch = async function (resource, config) {
        if (typeof resource === 'string' && resource.startsWith('/')) {
            config = config || {};
            config.headers = config.headers || {};
            config.headers['Authorization'] = `Bearer ${token}`;
        }

        try {
            const response = await rawFetch(resource, config);
            if (response.status === 401 && !resource.includes('/api/v1/auth/login')) {
                localStorage.clear();
                window.location.href = 'account-select.html';
            }
            return response;
        } catch (err) {
            throw err;
        }
    };

    // 5. Update sidebar + inject account switcher when DOM is ready
    document.addEventListener('DOMContentLoaded', () => {

        /* ── Sidebar user info ───────────────────────────────────── */
        const storeInfo = document.querySelector('.store-info h4');
        const roleSpan = document.querySelector('.store-info span');
        const avatar = document.querySelector('.store-avatar');

        if (storeInfo) storeInfo.textContent = name;
        if (roleSpan) roleSpan.textContent = role === 'admin' ? 'Super Admin' : 'Worker';
        if (avatar && name) avatar.textContent = name.charAt(0).toUpperCase();

        /* ── Sidebar logout button ───────────────────────────────── */
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (sidebarFooter && !document.getElementById('logoutBtn')) {
            const logoutBtn = document.createElement('button');
            logoutBtn.id = 'logoutBtn';
            logoutBtn.className = 'btn btn-outline btn-sm';
            logoutBtn.style.cssText = 'width:100%;margin-top:12px;color:#ef4444;border-color:#ef4444;';
            logoutBtn.innerHTML = '<b>🚪 Logout</b>';
            logoutBtn.onclick = () => {
                localStorage.clear();
                window.location.href = 'account-select.html';
            };
            sidebarFooter.appendChild(logoutBtn);
        }

        /* ── Hide admin links for workers ────────────────────────── */
        if (role !== 'admin') {
            const allowedForWorker = ['billing.html', 'customers.html', 'sales.html', 'sale-orders.html', 'sale-returns.html'];
            document.querySelectorAll('.sidebar nav a').forEach(link => {
                const href = link.getAttribute('href') || '';
                if (!allowedForWorker.includes(href) && !allowedForWorker.some(a => href.includes(a))) {
                    link.style.display = 'none';
                }
            });
            document.querySelectorAll('.sidebar-section-label').forEach(l => {
                const text = l.textContent.toLowerCase();
                if (text.includes('purchase') || text.includes('finance')) {
                    l.style.display = 'none';
                }
            });
        }

        /* ── Account Switcher Dropdown ───────────────────────────── */
        const topbarRight = document.querySelector('.topbar-right');
        if (!topbarRight || document.getElementById('acctSwitcher')) return;

        // Inject styles
        const styleEl = document.createElement('style');
        styleEl.textContent = `
            #acctSwitcher {
                position: relative;
                display: inline-flex;
                align-items: center;
            }
            #acctSwitcherBtn {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                background: #141c2e;
                border: 1px solid #1e2d45;
                border-radius: 10px;
                padding: 6px 12px;
                color: #f0f4fc;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;
                transition: border-color 0.2s, background 0.2s;
                white-space: nowrap;
            }
            #acctSwitcherBtn:hover { border-color: #10d9a0; background: #0f1521; }
            #acctSwitcherBtn .asb-avatar {
                width: 26px; height: 26px; border-radius: 50%;
                font-size: 12px; font-weight: 800; color: #fff;
                display: flex; align-items: center; justify-content: center;
            }
            .asb-avatar.role-admin  { background: linear-gradient(135deg, #10d9a0, #0891b2); }
            .asb-avatar.role-worker { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
            #acctSwitcherBtn .asb-caret { font-size: 10px; color: #4a5c80; transition: transform 0.2s; }
            #acctSwitcher.dd-open #acctSwitcherBtn .asb-caret { transform: rotate(180deg); }

            #acctDropdown {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                min-width: 210px;
                background: #0f1521;
                border: 1px solid #1e2d45;
                border-radius: 14px;
                box-shadow: 0 16px 40px rgba(0,0,0,0.55);
                padding: 8px;
                z-index: 9999;
                display: none;
            }
            #acctSwitcher.dd-open #acctDropdown { display: block; animation: ddIn 0.18s ease; }
            @keyframes ddIn {
                from { opacity: 0; transform: translateY(-6px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .dd-label {
                font-size: 10px; font-weight: 700; color: #2a3a5c;
                text-transform: uppercase; letter-spacing: 0.08em;
                padding: 4px 10px 6px;
            }
            .dd-user-item {
                display: flex; align-items: center; gap: 10px;
                padding: 8px 10px; border-radius: 9px;
                cursor: pointer; transition: background 0.15s;
                font-size: 13px; color: #c0cfe8;
            }
            .dd-user-item:hover { background: #141c2e; }
            .dd-av {
                width: 28px; height: 28px; border-radius: 50%;
                font-size: 11px; font-weight: 800; color: #fff;
                display: flex; align-items: center; justify-content: center;
                flex-shrink: 0;
            }
            .dd-av.role-admin  { background: linear-gradient(135deg, #10d9a0, #0891b2); }
            .dd-av.role-worker { background: linear-gradient(135deg, #6366f1, #8b5cf6); }
            .dd-user-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
            .dd-uname { font-weight: 600; color: #e2e8f0; font-size: 13px; }
            .dd-urole { font-size: 10.5px; color: #4a5c80; }
            .dd-user-item.active-user .dd-uname { color: #10d9a0; }
            .dd-check { color: #10d9a0; font-size: 13px; flex-shrink: 0; }
            .dd-divider { border: none; border-top: 1px solid #1e2d45; margin: 6px 0; }
            .dd-action {
                display: flex; align-items: center; gap: 10px;
                padding: 8px 10px; border-radius: 9px;
                cursor: pointer; font-size: 13px; font-weight: 500;
                transition: background 0.15s;
            }
            .dd-action:hover { background: #141c2e; }
            .dd-action.dd-add { color: #818cf8; }
            .dd-action.dd-out { color: #ef4444; }
        `;
        document.head.appendChild(styleEl);

        // Build switcher element
        const switcher = document.createElement('div');
        switcher.id = 'acctSwitcher';

        const avatarInitials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        const avatarRoleClass = role === 'admin' ? 'role-admin' : 'role-worker';

        switcher.innerHTML = `
            <button id="acctSwitcherBtn" type="button">
                <span class="asb-avatar ${avatarRoleClass}">${avatarInitials}</span>
                <span>${name}</span>
                <span class="asb-caret">▼</span>
            </button>
            <div id="acctDropdown">
                <div class="dd-label">Switch Account</div>
                <div id="ddUserList">
                    <div class="dd-user-item" style="color:#4a5c80;font-size:12px;justify-content:center;">Loading…</div>
                </div>
                <hr class="dd-divider">
                ${role === 'admin' ? `<div class="dd-action dd-add" id="ddAddBtn">＋&nbsp; Add Worker</div>` : ''}
                <div class="dd-action dd-out" id="ddLogoutBtn">🚪&nbsp; Logout</div>
            </div>
        `;

        // Insert before "+ New Sale" btn if present
        const newSaleBtn = topbarRight.querySelector('a[href="billing.html"]');
        if (newSaleBtn) {
            topbarRight.insertBefore(switcher, newSaleBtn);
        } else {
            topbarRight.appendChild(switcher);
        }

        // Wire button
        document.getElementById('acctSwitcherBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const sw = document.getElementById('acctSwitcher');
            sw.classList.toggle('dd-open');
            if (sw.classList.contains('dd-open')) _loadSwitcherUsers();
        });

        document.getElementById('ddLogoutBtn').addEventListener('click', () => {
            localStorage.clear();
            window.location.href = 'account-select.html';
        });

        const addBtn = document.getElementById('ddAddBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                document.getElementById('acctSwitcher').classList.remove('dd-open');
                window.location.href = 'account-select.html';
            });
        }

        // Close on outside click
        document.addEventListener('click', () => {
            const sw = document.getElementById('acctSwitcher');
            if (sw) sw.classList.remove('dd-open');
        });

        // Pre-load users
        _loadSwitcherUsers();
    });

    /* ── Switcher user loading ──────────────────────────────────────── */
    function _loadSwitcherUsers() {
        const container = document.getElementById('ddUserList');
        if (!container) return;

        rawFetch('/api/v1/users/list')
            .then(r => r.json())
            .then(data => _renderSwitcherUsers(data.data || []))
            .catch(() => {
                if (container) container.innerHTML =
                    '<div class="dd-user-item" style="color:#ef4444;font-size:12px;justify-content:center;">⚠️ Failed to load</div>';
            });
    }

    function _renderSwitcherUsers(users) {
        const container = document.getElementById('ddUserList');
        if (!container) return;

        const currentName = localStorage.getItem('name') || '';

        container.innerHTML = users.map(u => {
            const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            const roleClass = u.role === 'admin' ? 'role-admin' : 'role-worker';
            const roleLabel = u.role === 'admin' ? 'Admin' : 'Worker';
            const isActive = u.name === currentName;

            return `<div class="dd-user-item ${isActive ? 'active-user' : ''}"
                        data-username="${u.username}" data-name="${u.name}" data-role="${u.role}">
                <div class="dd-av ${roleClass}">${initials}</div>
                <div class="dd-user-info">
                    <span class="dd-uname">${u.name}</span>
                    <span class="dd-urole">${roleLabel}</span>
                </div>
                ${isActive ? '<span class="dd-check">✓</span>' : ''}
            </div>`;
        }).join('');

        // Wire click events
        container.querySelectorAll('.dd-user-item').forEach(item => {
            item.addEventListener('click', () => {
                const uname = item.dataset.username;
                const uname2 = item.dataset.name;
                const urole = item.dataset.role;
                const current = localStorage.getItem('name') || '';
                document.getElementById('acctSwitcher').classList.remove('dd-open');
                if (uname2 === current) return;
                sessionStorage.setItem('selectedUsername', uname);
                sessionStorage.setItem('selectedName', uname2);
                sessionStorage.setItem('selectedRole', urole);
                window.location.href = 'unlock.html';
            });
        });
    }

})();
