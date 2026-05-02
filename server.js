// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs').promises; // Use promise-based fs
const path = require('path');
const chokidar = require('chokidar');
const { version } = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e6
});

app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data')); // Base directory for markdown files
const DATA_ROOT = path.resolve(DATA_DIR);

function isPathInside(base, target) {
    const relative = path.relative(base, target);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveDataPath(relativePath = '') {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
        const error = new Error('Invalid path');
        error.status = 400;
        throw error;
    }

    const resolvedPath = path.resolve(DATA_ROOT, relativePath);
    if (!isPathInside(DATA_ROOT, resolvedPath)) {
        const error = new Error('Invalid path');
        error.status = 400;
        throw error;
    }
    return resolvedPath;
}

function relativeDataPath(fullPath) {
    return path.relative(DATA_ROOT, fullPath).split(path.sep).join('/');
}

function isMarkdownPath(filePath) {
    return path.extname(filePath).toLowerCase() === '.md';
}

function isValidItemName(name) {
    return typeof name === 'string'
        && name.trim() === name
        && name.length > 0
        && name !== '.'
        && name !== '..'
        && !/[\0-\x1f\x7f/\\]/.test(name);
}

async function assertSafeExistingPath(resolvedPath, { allowDirectory = false, requireMarkdownFile = false } = {}) {
    const stats = await fs.lstat(resolvedPath);

    if (stats.isSymbolicLink()) {
        const error = new Error('Symbolic links are not allowed');
        error.status = 400;
        throw error;
    }

    if (stats.isDirectory()) {
        if (!allowDirectory) {
            const error = new Error('Expected a file');
            error.status = 400;
            throw error;
        }
        return stats;
    }

    if (!stats.isFile()) {
        const error = new Error('Unsupported item type');
        error.status = 400;
        throw error;
    }

    if (requireMarkdownFile && !isMarkdownPath(resolvedPath)) {
        const error = new Error('Invalid file path');
        error.status = 400;
        throw error;
    }

    return stats;
}

function sendError(res, error, fallbackMessage) {
    if (error.status) {
        return res.status(error.status).json({ error: error.message });
    }
    if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Item not found' });
    }
    if (error.code === 'EEXIST') {
        return res.status(409).json({ error: 'Item already exists' });
    }
    return res.status(500).json({ error: fallbackMessage });
}

// Ensure data directory exists
fs.mkdir(DATA_DIR, { recursive: true })
  .catch(err => console.error('Error creating data directory:', err));

// Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        "connect-src 'self' ws: wss:",
        "font-src 'self' data:",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'"
    ].join('; '));
    next();
});

app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const origin = req.get('origin');
    if (!origin) return next();

    try {
        const originUrl = new URL(origin);
        if (originUrl.host === req.get('host')) return next();
    } catch {
        // Fall through to the rejection below.
    }

    return res.status(403).json({ error: 'Cross-origin writes are not allowed' });
});

app.use(express.json({ limit: process.env.JSON_LIMIT || '10mb' })); // Middleware to parse JSON bodies
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }
    return next(error);
});
app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    if (!req.is('application/json')) {
        return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ error: 'JSON body must be an object' });
    }
    return next();
});
app.use('/easymde', express.static(path.join(__dirname, 'node_modules/easymde/dist')));
app.use('/font-awesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free/')));
app.use('/dompurify', express.static(path.join(__dirname, 'node_modules/dompurify/dist')));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static frontend files

// --- API Endpoints ---

app.get('/api/version', (req, res) => {
    res.json({ version });
});

// Get list of files and folders
app.get('/api/files', async (req, res) => {
    try {
        const resolvedPath = resolveDataPath(req.query.path || '');
        await assertSafeExistingPath(resolvedPath, { allowDirectory: true });
        const items = await fs.readdir(resolvedPath, { withFileTypes: true });
        const files = items
            .filter(item => item.isFile() && path.extname(item.name).toLowerCase() === '.md')
            .map(item => ({ name: item.name, type: 'file' }));
        const folders = items
            .filter(item => item.isDirectory())
            .map(item => ({ name: item.name, type: 'folder' }));

        res.json([...folders, ...files]); // Send folders first, then files
    } catch (error) {
        console.error('Error listing files:', error);
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Directory not found' });
        }
        sendError(res, error, 'Failed to list files');
    }
});

// Get file content
app.get('/api/files/content', async (req, res) => {
    try {
        const resolvedPath = resolveDataPath(req.query.path || '');
        await assertSafeExistingPath(resolvedPath, { requireMarkdownFile: true });
        const content = await fs.readFile(resolvedPath, 'utf8');
        res.type('text/markdown').send(content);
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found' });
        }
        sendError(res, error, 'Failed to read file');
    }
});

// Save file content
app.post('/api/files/save', async (req, res) => {
    const content = req.body.content; // Note: Defaulting to undefined if missing
    const relativePath = req.body.path; // For logging

    // ---> Add logging <---
    console.log(`[Save Endpoint] Received request for path: "${relativePath}"`);
    if (typeof content === 'undefined') {
        console.error('[Save Endpoint] Error: req.body.content is undefined!');
    } else {
        console.log(`[Save Endpoint] Received content length: ${content.length}`);
    }
    // ---> End logging <---

    // Check if content is actually provided (even if empty string is valid)
    if (typeof content !== 'string') {
         console.error(`[Save Endpoint] Invalid content type received: ${typeof content}`);
         return res.status(400).json({ error: 'Invalid content data' });
     }


    try {
        const resolvedPath = resolveDataPath(relativePath);
        if (!isMarkdownPath(resolvedPath)) {
            return res.status(400).json({ error: 'Invalid file path' });
        }
        await assertSafeExistingPath(path.dirname(resolvedPath), { allowDirectory: true });
        try {
            await assertSafeExistingPath(resolvedPath, { requireMarkdownFile: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        console.log(`[Save Endpoint] Writing ${content.length} bytes to ${resolvedPath}`); // Log before write
        await fs.writeFile(resolvedPath, content, 'utf8');
        console.log(`[Save Endpoint] Successfully wrote file: ${resolvedPath}`); // Log after write
        res.json({ message: 'File saved successfully' });
        // We rely on chokidar for notifications
    } catch (error) {
        console.error(`[Save Endpoint] Error saving file "${relativePath}":`, error); // Log error details
        sendError(res, error, 'Failed to save file');
    }
});

// Create file or folder
app.post('/api/files/create', async (req, res) => {
    const type = req.body.type; // 'file' or 'folder'
    const name = req.body.name;
    const parentPath = req.body.parentPath || ''; // Relative path within DATA_DIR

    if (type !== 'file' && type !== 'folder') {
        return res.status(400).json({ error: 'Invalid type' });
    }

    if (!isValidItemName(name)) { // Basic name validation
        return res.status(400).json({ error: 'Invalid name' });
    }

    try {
        const fullParentPath = resolveDataPath(parentPath);
        await assertSafeExistingPath(fullParentPath, { allowDirectory: true });
        const newItemPath = resolveDataPath(path.join(relativeDataPath(fullParentPath), name + (type === 'file' ? '.md' : '')));
        if (type === 'file') {
            await fs.writeFile(newItemPath, '', { encoding: 'utf8', flag: 'wx' }); // Create empty file
        } else {
            await fs.mkdir(newItemPath);
        }
        res.status(201).json({ message: `${type} created successfully` });
    } catch (error) {
        console.error(`Error creating ${type}:`, error);
        sendError(res, error, `Failed to create ${type}`);
    }
});


// Rename file or folder
app.post('/api/files/rename', async (req, res) => {
    const oldPathRelative = req.body.oldPath;
    const newName = req.body.newName;
    if (!oldPathRelative || typeof oldPathRelative !== 'string') {
        return res.status(400).json({ error: 'Invalid path' });
    }

    if (!isValidItemName(newName)) {
        return res.status(400).json({ error: 'Invalid new name' });
    }

    try {
        const oldPathFull = resolveDataPath(oldPathRelative);
        const parentDir = path.dirname(oldPathFull);
        const stats = await assertSafeExistingPath(oldPathFull, { allowDirectory: true, requireMarkdownFile: true });

        // Ensure the new name has the correct extension if it's a file
        let finalNewName = newName;
        if (stats.isFile() && path.extname(newName).toLowerCase() !== '.md') {
            finalNewName += '.md';
        }

        const newPathFull = resolveDataPath(path.join(relativeDataPath(parentDir), finalNewName));
        if (oldPathFull === newPathFull) {
            return res.status(400).json({ error: 'New name cannot be the same as the old name' });
        }

        try {
            await fs.lstat(newPathFull);
            return res.status(409).json({ error: 'An item with the new name already exists' });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        await fs.rename(oldPathFull, newPathFull);
        res.json({ message: 'Item renamed successfully', newPath: relativeDataPath(newPathFull) });
    } catch (error) {
        console.error('Error renaming item:', error);
         if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Item not found' });
         }
        sendError(res, error, 'Failed to rename item');
    }
});

// Delete file or folder
app.post('/api/files/delete', async (req, res) => {
    const itemPathRelative = req.body.path;
    if (!itemPathRelative || typeof itemPathRelative !== 'string') {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        const itemPathFull = resolveDataPath(itemPathRelative);
        if (itemPathFull === DATA_ROOT) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        const stats = await assertSafeExistingPath(itemPathFull, { allowDirectory: true, requireMarkdownFile: true });
        if (stats.isDirectory()) {
            await fs.rm(itemPathFull, { recursive: true, force: true }); // Use rm for directories (recursive)
        } else {
            await fs.unlink(itemPathFull); // Use unlink for files
        }
        res.json({ message: 'Item deleted successfully' });
    } catch (error) {
        console.error('Error deleting item:', error);
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Item not found' });
         }
        sendError(res, error, 'Failed to delete item');
    }
});


// --- File Watching with Chokidar and Socket.IO ---

const watcher = chokidar.watch(DATA_DIR, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true, // Don't fire events for existing files on startup
    depth: undefined // Watch recursively
});

watcher
    .on('add', filePath => {
        console.log(`File ${filePath} has been added`);
        io.emit('file-changed', { event: 'add', path: relativeDataPath(filePath), type: 'file' });
    })
    .on('change', filePath => {
        console.log(`File ${filePath} has been changed`);
        io.emit('file-changed', { event: 'change', path: relativeDataPath(filePath), type: 'file' });
    })
    .on('unlink', filePath => {
        console.log(`File ${filePath} has been removed`);
        io.emit('file-changed', { event: 'unlink', path: relativeDataPath(filePath), type: 'file' });
    })
    .on('addDir', dirPath => {
        console.log(`Directory ${dirPath} has been added`);
        io.emit('file-changed', { event: 'addDir', path: relativeDataPath(dirPath), type: 'folder' });
    })
    .on('unlinkDir', dirPath => {
        console.log(`Directory ${dirPath} has been removed`);
        io.emit('file-changed', { event: 'unlinkDir', path: relativeDataPath(dirPath), type: 'folder' });
    })
    .on('error', error => console.error(`Watcher error: ${error}`));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
    // Optional: Could add specific events here if needed
});

// --- Default Route ---
// Serve index.html for any route not handled by API or static files
/*
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
*/

// --- Start Server ---
server.listen(PORT, HOST, () => {
    console.log(`Edito server running on http://${HOST}:${PORT}`);
    console.log(`Markdown files will be stored in: ${DATA_DIR}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing server...');

    // 1. Close watcher
    console.log('Closing file watcher...');
    watcher.close().then(() => console.log('File watcher closed.')); // Chokidar returns a promise

    // 2. Close Socket.IO server (this helps close connections)
    console.log('Closing Socket.IO server...');
    io.close((err) => {
         if (err) {
             console.error('Error closing Socket.IO:', err);
         } else {
             console.log('Socket.IO server closed.');
         }

        // 3. Close HTTP server (inside IO close callback)
        console.log('Closing HTTP server...');
        server.close((err) => {
            if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
                console.error('Error closing HTTP server:', err);
                process.exit(1); // Exit with error code if server close failed
            } else {
                console.log('HTTP server closed.');
                process.exit(0); // Exit successfully
            }
        });
    });

     // Set a timeout to force exit if graceful shutdown takes too long
     setTimeout(() => {
         console.error('Graceful shutdown timed out. Forcing exit.');
         process.exit(1);
     }, 5000); // Force exit after 5 seconds
});
