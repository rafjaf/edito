// public/modules/api.js
import { state } from './state.js';
import { showNotification } from './ui.js';

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({
                error: `HTTP error! status: ${response.status}`
            }));
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }
        const contentType = response.headers.get("content-type");
        return contentType?.includes("application/json") ? response.json() : response.text();
    } catch (error) {
        showNotification(`Error: ${error.message}`, 'error');
        throw error;
    }
}

export async function fetchFileList(folderPath = '') {
    return await apiRequest(`/api/files?path=${encodeURIComponent(folderPath)}`);
}

export async function fetchFileContent(filePath) {
    return await apiRequest(`/api/files/content?path=${encodeURIComponent(filePath)}`);
}

export async function fetchVersion() {
    return await apiRequest('/api/version');
}

export async function saveFile(filePath, content) {
    state.isSaving = true;
    state.ignoreNextWatcherEvent = true;
    try {
        await apiRequest('/api/files/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: content })
        });
    } catch (error) {
        state.ignoreNextWatcherEvent = false;
        throw error;
    } finally {
        state.isSaving = false;
    }
}

export async function createItem(name, type, parentPath) {
    state.ignoreNextWatcherEvent = true;
    return await apiRequest('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, parentPath })
    });
}

export async function renameItem(oldPath, newName) {
    state.ignoreNextWatcherEvent = true;
    return await apiRequest('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newName })
    });
}

export async function deleteItem(path) {
    state.ignoreNextWatcherEvent = true;
    return await apiRequest('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });
}
