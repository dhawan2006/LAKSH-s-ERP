/**
 * Custom Modal Dialog System for Kirana ERP
 * Replaces native alert() and confirm() with modern, promise-based modals.
 */

window.kiranaConfirm = function(title, message, confirmText = 'OK', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        const box = document.createElement('div');
        box.className = 'dialog-box';

        const titleEl = document.createElement('h3');
        titleEl.className = 'dialog-title';
        titleEl.textContent = title;

        const msgEl = document.createElement('p');
        msgEl.className = 'dialog-message';
        // Handle basic newlines
        msgEl.innerHTML = String(message).replace(/\n/g, '<br>');

        const actions = document.createElement('div');
        actions.className = 'dialog-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-outline';
        cancelBtn.textContent = cancelText;
        cancelBtn.onclick = () => {
            _closeKiranaDialog(overlay);
            resolve(false);
        };

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.textContent = confirmText;
        confirmBtn.onclick = () => {
            _closeKiranaDialog(overlay);
            resolve(true);
        };

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        box.appendChild(titleEl);
        box.appendChild(msgEl);
        box.appendChild(actions);
        overlay.appendChild(box);

        document.body.appendChild(overlay);
    });
};

window.kiranaAlert = function(title, message, okText = 'OK') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        const box = document.createElement('div');
        box.className = 'dialog-box';

        const titleEl = document.createElement('h3');
        titleEl.className = 'dialog-title';
        titleEl.textContent = title;

        const msgEl = document.createElement('p');
        msgEl.className = 'dialog-message';
        msgEl.innerHTML = String(message).replace(/\n/g, '<br>');

        const actions = document.createElement('div');
        actions.className = 'dialog-actions';
        actions.style.justifyContent = 'flex-end';

        const okBtn = document.createElement('button');
        okBtn.className = 'btn btn-primary';
        okBtn.textContent = okText;
        okBtn.onclick = () => {
            _closeKiranaDialog(overlay);
            resolve(true);
        };

        actions.appendChild(okBtn);

        box.appendChild(titleEl);
        box.appendChild(msgEl);
        box.appendChild(actions);
        overlay.appendChild(box);

        document.body.appendChild(overlay);
    });
};

function _closeKiranaDialog(overlay) {
    overlay.style.animation = 'dialogFadeOut 0.2s ease forwards';
    const box = overlay.querySelector('.dialog-box');
    if (box) box.style.animation = 'dialogPopOut 0.2s ease forwards';
    
    setTimeout(() => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    }, 200);
}
