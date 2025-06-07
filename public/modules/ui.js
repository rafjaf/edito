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
        li.innerHTML = `<span class="icon"><i class="fas fa-arrow-up"></i></span> ..`;
        li.dataset.path = parentPath;
        li.dataset.type = 'folder';
        li.addEventListener('click', () => onFolderClick(parentPath));
        elements.fileList.appendChild(li);
    }
    files.forEach(item => {
        const li = document.createElement('li');
        const iconClass = item.type === 'folder' ? 'fa-folder' : 'fa-file-alt';
        li.innerHTML = `<span class="icon"><i class="fas ${iconClass}"></i></span> ${item.name}`;
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
    let match;
    while ((match = headingRx.exec(content)) !== null) {
        const level = match[1].length;
        const title = match[2].trim();
        const lineNumber = (content.slice(0, match.index).match(/\n/g) || []).length;
        const a = document.createElement('a');
        a.textContent = title;
        a.href = 'javascript:void(0)';
        a.className = `h${level}`;
        a.dataset.line = lineNumber;
        a.dataset.lvl = level;
        a.dataset.txt = title;
        a.addEventListener('click', onTocClick);
        const li = document.createElement('li');
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