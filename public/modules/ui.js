// public/modules/ui.js
import { elements } from './elements.js';
import { state } from './state.js';

export function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    elements.notificationsContainer.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
        notification.classList.remove('show');
        notification.addEventListener('transitionend', () => notification.remove());
    }, duration);
}

export function updateFileList(files, onFolderClick, onFileClick) {
    elements.fileList.innerHTML = '';
    if (state.currentFolder) {
        const parentPath = state.currentFolder.includes('/') ? state.currentFolder.substring(0, state.currentFolder.lastIndexOf('/')) : '';
        const li = document.createElement('li');
        li.append(createIcon('fa-arrow-up'), document.createTextNode(' ..'));
        li.dataset.path = parentPath;
        li.dataset.type = 'folder';
        li.addEventListener('click', () => onFolderClick(parentPath));
        elements.fileList.appendChild(li);
    }
    files.forEach(item => {
        const li = document.createElement('li');
        const iconClass = item.type === 'folder' ? 'fa-folder' : 'fa-file-alt';
        li.append(createIcon(iconClass), document.createTextNode(` ${item.name}`));
        const itemPath = state.currentFolder ? `${state.currentFolder}/${item.name}` : item.name;
        li.dataset.path = itemPath;
        li.dataset.type = item.type;
        if (item.type === 'file') {
            if (itemPath === state.currentFilePath) li.classList.add('active');
            li.addEventListener('click', () => {
                if (itemPath !== state.currentFilePath) onFileClick(itemPath);
            });
        } else {
            li.addEventListener('click', () => onFolderClick(itemPath));
        }
        elements.fileList.appendChild(li);
    });
    updateActionButtons();
    elements.currentFolderPath.textContent = `/${state.currentFolder}`;
}

export function generateOutline(content, onTocClick) {
    elements.outlineList.innerHTML = '';
    const headingRx = /^(#{1,6})\s+(.*)$/gm;
    const counters = [0, 0, 0, 0, 0, 0];
    let match;
    while ((match = headingRx.exec(content)) !== null) {
        const level = match[1].length;
        counters[level - 1]++;
        for (let i = level; i < counters.length; i++) counters[i] = 0;
        const rawTitle = match[2].trim();
        // Strip bold markers (**...**  or __...__), keep the inner text
        const strippedBold = rawTitle.replace(/(\*\*|__)(.+?)\1/g, '$2');
        // Keep plain text for dataset (for scroll-to)
        const plainTitle = strippedBold.replace(/\*(.+?)\*/g, '$1');
        const lineNumber = (content.slice(0, match.index).match(/\n/g) || []).length;
        const a = document.createElement('a');
        appendInlineItalic(a, strippedBold);
        a.href = '#';
        a.className = `h${level}`;
        a.style.setProperty('--outline-number', JSON.stringify(`${counters.slice(0, level).join('.')}. `));
        a.dataset.line = lineNumber;
        a.dataset.lvl = level;
        a.dataset.txt = plainTitle;
        a.addEventListener('click', onTocClick);
        const li = document.createElement('li');
        li.dataset.level = level;
        li.appendChild(a);
        elements.outlineList.appendChild(li);
    }
}

export function updateStatusBar(content = '') {
    const lines = content.split('\n').length;
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const size = new Blob([content]).size;
    elements.statusLines.textContent = `Lines: ${lines}`;
    elements.statusWords.textContent = `Words: ${words}`;
    elements.statusChars.textContent = `Chars: ${content.length}`;
    elements.statusSize.textContent = `Size: ${formatBytes(size)}`;
}

export function setSyncStatus(status, message = '') {
    elements.statusSync.className = 'sync-status';
    elements.statusSync.textContent = '';
    const statusMap = { loading: 'sync-loading', saving: 'sync-saving', saved: 'sync-saved', error: 'sync-error' };
    const textMap = { loading: 'Loading...', saving: 'Saving...', saved: 'Saved', error: 'Save Error' };
    if (status in statusMap) {
        elements.statusSync.classList.add(statusMap[status]);
        elements.statusSync.textContent = message || textMap[status];
        if (status === 'saved') {
            setTimeout(() => {
                if (elements.statusSync.classList.contains('sync-saved')) setSyncStatus('');
            }, 2000);
        }
    }
}

export function updateActionButtons() {
    const canOperate = !!state.currentFilePath;
    elements.renameButton.disabled = !canOperate;
    elements.deleteButton.disabled = !canOperate;
    elements.exportMdButton.disabled = !canOperate;
    elements.exportHtmlButton.disabled = !canOperate;
}

export function clearEditorUI() {
    elements.statusFile.textContent = 'No file selected';
    elements.headerCurrentFile.textContent = 'No file selected';
    updateStatusBar('');
    generateOutline('', () => {});
    updateActionButtons();
    document.querySelectorAll('#file-list li.active').forEach(li => li.classList.remove('active'));
}

export function setToolbarHeightVar() {
    const bar = document.querySelector('.editor-toolbar');
    if (!bar) return;
    const root = document.documentElement;
    requestAnimationFrame(() => {
        const h = bar.offsetHeight;
        root.style.setProperty('--toolbar-h', h + 'px');
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function createIcon(iconClass) {
    const span = document.createElement('span');
    span.className = 'icon';
    const icon = document.createElement('i');
    icon.className = `fas ${iconClass}`;
    span.appendChild(icon);
    return span;
}

function appendInlineItalic(parent, text) {
    const italicRx = /\*(.+?)\*/g;
    let lastIndex = 0;
    let match;

    while ((match = italicRx.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        const em = document.createElement('em');
        em.textContent = match[1];
        parent.appendChild(em);
        lastIndex = italicRx.lastIndex;
    }

    if (lastIndex < text.length) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}
