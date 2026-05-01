// public/main.js
import { STATUS_UPDATE_DEBOUNCE, SAVE_DEBOUNCE } from './modules/config.js';
import { state } from './modules/state.js';
import { elements } from './modules/elements.js';
import * as ui from './modules/ui.js';
import * as editor from './modules/editor.js';
import * as api from './modules/api.js';
import { initResizablePanes } from './modules/resize.js';
import { refreshState } from './modules/editor.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- State & Timers ---
    let saveTimeout = null;
    let statusBarUpdateTimeout = null;
    let outlineUpdateTimeout = null;

    // --- Editor Change Handler ---
    const onEditorChange = (content) => {
        clearTimeout(statusBarUpdateTimeout);
        clearTimeout(outlineUpdateTimeout);
        statusBarUpdateTimeout = setTimeout(() => ui.updateStatusBar(content), STATUS_UPDATE_DEBOUNCE);
        outlineUpdateTimeout = setTimeout(() => {
            ui.generateOutline(content, editor.handleTocClick);
        }, STATUS_UPDATE_DEBOUNCE);
        debouncedSave();
    };

    // --- Core App Functions ---
    function clearEditorState() {
        state.currentFilePath = null;
        state.currentContent = '';
        state.easymde.value('');
        state.easymde.codemirror.clearHistory();
        ui.clearEditorUI();
        refreshState();
    }

    async function loadFileList(folderPath = '') {
        try {
            const items = await api.fetchFileList(folderPath);
            state.currentFolder = folderPath;
            ui.updateFileList(items, loadFileList, loadFileContent);

            const fileItems = items.filter(item => item.type === 'file');
            if (folderPath === '' && !fileItems.length && !state.currentFilePath) {
                const newFilePath = await handleCreateItem('file', 'Untitled');
                if (newFilePath) {
                    await loadFileList('');
                    await loadFileContent(newFilePath);
                }
            } else if (fileItems.length > 0 && !state.currentFilePath) {
                const firstFilePath = folderPath ? `${folderPath}/${fileItems[0].name}` : fileItems[0].name;
                await loadFileContent(firstFilePath);
            }
        } catch (error) {
            elements.fileList.textContent = '';
            const li = document.createElement('li');
            li.textContent = 'Error loading files.';
            elements.fileList.appendChild(li);
        }
    }

    async function loadFileContent(filePath, isExternalReload = false, preloadedContent = null) {
        ui.setSyncStatus('loading');
        try {
            const content = preloadedContent ?? await api.fetchFileContent(filePath);
            if (isExternalReload && content === state.currentContent) {
                ui.setSyncStatus('');
                return false;
            }
            clearEditorState(); // Clear previous state before loading new
            state.easymde.value(content);
            state.easymde.codemirror.setCursor(0, 0);
            state.easymde.codemirror.clearHistory();

            state.currentFilePath = filePath;
            state.currentContent = content;
            elements.statusFile.textContent = filePath;
            elements.headerCurrentFile.textContent = filePath;
            ui.updateStatusBar(content);
            ui.generateOutline(content, editor.handleTocClick);
            ui.updateActionButtons();
            refreshState();
            
            // Highlight the active file in the list
            document.querySelectorAll('#file-list li.active').forEach(li => li.classList.remove('active'));
            const fileElement = Array.from(elements.fileList.children).find(li => li.dataset.path === filePath);
            if (fileElement) fileElement.classList.add('active');

            ui.setSyncStatus('');
            state.easymde.codemirror.focus();
            return true;
        } catch (error) {
            clearEditorState();
            ui.setSyncStatus('');
            return false;
        }
    }

    function debouncedSave() {
        if (!state.currentFilePath) return;
        clearTimeout(saveTimeout);
        ui.setSyncStatus('saving');
        saveTimeout = setTimeout(async () => {
            if (state.isSaving) {
                debouncedSave();
                return;
            }
            const content = state.easymde.value();
            if (content === state.currentContent) {
                ui.setSyncStatus('saved', 'No changes');
                return;
            }
            ui.setSyncStatus('saving');
            await api.saveFile(state.currentFilePath, content);
        }, SAVE_DEBOUNCE);
    }

    // --- Event Handlers ---
    async function handleCreateItem(type, predefinedName = null) {
        const name = predefinedName || prompt(type === 'folder' ? 'Enter folder name:' : 'Enter file name (without .md):');
        if (!name || !name.trim()) return null;
        if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
            if (!predefinedName) ui.showNotification('Invalid characters in name.', 'warning');
            return null;
        }
        const finalName = (type === 'file' && !predefinedName) ? name.replace(/\.md$/i, '') : name;
        try {
            ui.setSyncStatus('loading', `Creating ${type}...`);
            await api.createItem(finalName, type, state.currentFolder);
            if (!predefinedName) ui.showNotification(`${type} "${finalName}" created.`, 'success');
            ui.setSyncStatus('');
            return state.currentFolder ? `${state.currentFolder}/${finalName}.md` : `${finalName}.md`;
        } catch (error) {
            ui.setSyncStatus('');
            return null;
        }
    }

    async function handleRenameItem() {
        if (!state.currentFilePath) return;
        const currentName = state.currentFilePath.substring(state.currentFilePath.lastIndexOf('/') + 1);
        const newName = prompt(`Enter new name for "${currentName}":`, currentName.replace('.md', ''));
        if (!newName || !newName.trim() || newName === currentName.replace('.md', '')) return;
        if (!/^[a-zA-Z0-9_.-]+$/.test(newName)) {
            ui.showNotification('Invalid characters in name.', 'warning');
            return;
        }
        try {
            ui.setSyncStatus('loading', `Renaming...`);
            const result = await api.renameItem(state.currentFilePath, newName);
            ui.showNotification(`Renamed to "${result.newPath}"`, 'success');
            state.currentFilePath = result.newPath;
            state.currentContent = state.easymde.value();
            elements.statusFile.textContent = state.currentFilePath;
            elements.headerCurrentFile.textContent = state.currentFilePath;
            await loadFileList(state.currentFolder);
            ui.updateActionButtons();
            ui.setSyncStatus('');
        } catch (error) {
            ui.setSyncStatus('');
        }
    }

    async function handleDeleteItem() {
        if (!state.currentFilePath || !confirm(`Delete "${state.currentFilePath}"? This cannot be undone.`)) return;
        try {
            ui.setSyncStatus('loading', `Deleting...`);
            await api.deleteItem(state.currentFilePath);
            ui.showNotification(`"${state.currentFilePath}" deleted.`, 'success');
            clearEditorState();
            await loadFileList(state.currentFolder);
            ui.setSyncStatus('');
        } catch (error) {
            ui.setSyncStatus('');
        }
    }

    function handleExport(type) {
        if (!state.currentFilePath) {
            ui.showNotification('No file open to export.', 'warning');
            return;
        }
        const baseName = state.currentFilePath.substring(state.currentFilePath.lastIndexOf('/') + 1).replace('.md', '');
        const content = state.easymde.value();
        let downloadContent, mimeType, fileName;

        if (type === 'md') {
            downloadContent = content;
            mimeType = 'text/markdown;charset=utf-8';
            fileName = `${baseName}.md`;
        } else if (type === 'html') {
            const renderedHtml = editor.sanitizeRenderedHtml(state.easymde.options.previewRender(content));
            downloadContent = `<!DOCTYPE html>\n<html>\n<head><meta charset="UTF-8"><title>${escapeHtml(baseName)}</title></head>\n<body>\n${renderedHtml}\n</body>\n</html>`;
            mimeType = 'text/html;charset=utf-8';
            fileName = `${baseName}.html`;
        }
        
        const blob = new Blob([downloadContent], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        link.remove();
        ui.showNotification(`Exported ${fileName}`, 'success');
    }

    function handleImport() {
        elements.importFileInput.accept = '.md';
        elements.importFileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                state.easymde.value(re.target.result);
                ui.showNotification(`Imported ${file.name}. Save to keep changes.`, 'info');
                if (state.currentFilePath) debouncedSave();
            };
            reader.readAsText(file);
            elements.importFileInput.value = '';
        };
        elements.importFileInput.click();
    }


    // --- Socket.IO Setup ---
    const socket = io();
    socket.on('connect', () => ui.showNotification('Connected', 'success', 1500));
    socket.on('disconnect', () => ui.showNotification('Disconnected', 'error'));
    socket.on('file-changed', async (data) => {
        if (state.ignoreNextWatcherEvent) { state.ignoreNextWatcherEvent = false; return; }
        const changeParentDir = data.path.includes('/') ? data.path.substring(0, data.path.lastIndexOf('/')) : '';
        const changeName = data.path.substring(data.path.lastIndexOf('/') + 1);
        if (changeParentDir === state.currentFolder) {
            if (data.event.includes('add') || data.event.includes('unlink')) {
                ui.showNotification(`File list updated: ${changeName} ${data.event}`, 'info', 2000);
                loadFileList(state.currentFolder);
            } else if (data.event === 'change' && data.path === state.currentFilePath) {
                const reloaded = await loadFileContent(state.currentFilePath, true);
                if (reloaded) {
                    ui.showNotification(`"${changeName}" changed externally. Reloaded.`, 'warning', 3000);
                }
            } else if (data.event === 'unlink' && data.path === state.currentFilePath) {
                ui.showNotification(`"${changeName}" deleted externally. Clearing editor.`, 'warning', 3000);
                clearEditorState();
                loadFileList(state.currentFolder);
            }
        }
    });

    // --- Attach Event Listeners ---
    elements.createFolderButton.addEventListener('click', async () => {
        if (await handleCreateItem('folder')) loadFileList(state.currentFolder);
    });
    elements.createFileButton.addEventListener('click', async () => {
        const newPath = await handleCreateItem('file');
        if (newPath) {
            await loadFileList(state.currentFolder);
            await loadFileContent(newPath);
        }
    });
    elements.renameButton.addEventListener('click', handleRenameItem);
    elements.deleteButton.addEventListener('click', handleDeleteItem);
    elements.actionMenuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.actionMenuDropdown.classList.toggle('hidden');
    });
    document.body.addEventListener('click', () => elements.actionMenuDropdown.classList.add('hidden'));
    elements.actionMenuDropdown.addEventListener('click', (e) => e.stopPropagation());
    elements.importMdButton.addEventListener('click', (e) => {
        e.preventDefault(); handleImport();
        elements.actionMenuDropdown.classList.add('hidden');
    });
    elements.exportMdButton.addEventListener('click', (e) => {
        e.preventDefault(); handleExport('md');
        elements.actionMenuDropdown.classList.add('hidden');
    });
    elements.exportHtmlButton.addEventListener('click', (e) => {
        e.preventDefault(); handleExport('html');
        elements.actionMenuDropdown.classList.add('hidden');
    });
    elements.aboutButton.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('about-modal').classList.remove('hidden');
        elements.actionMenuDropdown.classList.add('hidden');
    });
    document.getElementById('about-modal-close').addEventListener('click', () => {
        document.getElementById('about-modal').classList.add('hidden');
    });
    document.getElementById('about-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });


    // --- Initial Load ---
    editor.initEditor(onEditorChange);
    window._editorInstance = state.easymde;
    ui.setToolbarHeightVar();
    initResizablePanes();
    loadFileList();
    ui.clearEditorUI();
});

function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = value;
    return span.innerHTML;
}
