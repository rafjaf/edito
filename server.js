// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs').promises; // Use promise-based fs
const path = require('path');
const chokidar = require('chokidar');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data'); // Base directory for markdown files

// Ensure data directory exists
fs.mkdir(DATA_DIR, { recursive: true })
  .catch(err => console.error('Error creating data directory:', err));

// Middleware
app.use(cors()); // Allow CORS - adjust in production if needed
app.use(express.json({ limit: '10mb' })); // Middleware to parse JSON bodies, increase limit for larger files
app.use('/easymde', express.static(path.join(__dirname, 'node_modules/easymde/dist')));
app.use('/font-awesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free/')));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static frontend files

// --- API Endpoints ---

// Get list of files and folders
app.get('/api/files', async (req, res) => {
    const dirPath = path.join(DATA_DIR, req.query.path || ''); // Get path relative to DATA_DIR

    // Security Check: Ensure the path stays within DATA_DIR
    const resolvedPath = path.resolve(dirPath);
    if (!resolvedPath.startsWith(path.resolve(DATA_DIR))) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
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
        res.status(500).json({ error: 'Failed to list files' });
    }
});

// Get file content
app.get('/api/files/content', async (req, res) => {
    const filePath = path.join(DATA_DIR, req.query.path || '');

    // Security Check
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(DATA_DIR)) || path.extname(resolvedPath).toLowerCase() !== '.md') {
        return res.status(400).json({ error: 'Invalid file path' });
    }

    try {
        const content = await fs.readFile(resolvedPath, 'utf8');
        res.type('text/markdown').send(content);
    } catch (error) {
        console.error('Error reading file:', error);
        if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'File not found' });
        }
        res.status(500).json({ error: 'Failed to read file' });
    }
});

// Save file content
// Find this endpoint (~line 85)
app.post('/api/files/save', async (req, res) => {
    const filePath = path.join(DATA_DIR, req.body.path || '');
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

    // Security Check (ensure it still works)
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(DATA_DIR)) || (relativePath && path.extname(resolvedPath).toLowerCase() !== '.md')) {
         console.error(`[Save Endpoint] Invalid path attempt: "${relativePath}" resolved to "${resolvedPath}"`);
        return res.status(400).json({ error: 'Invalid file path' });
    }

    // Check if content is actually provided (even if empty string is valid)
    if (typeof content !== 'string') {
         console.error(`[Save Endpoint] Invalid content type received: ${typeof content}`);
         return res.status(400).json({ error: 'Invalid content data' });
     }


    try {
        console.log(`[Save Endpoint] Writing ${content.length} bytes to ${resolvedPath}`); // Log before write
        await fs.writeFile(resolvedPath, content, 'utf8');
        console.log(`[Save Endpoint] Successfully wrote file: ${resolvedPath}`); // Log after write
        res.json({ message: 'File saved successfully' });
        // We rely on chokidar for notifications
    } catch (error) {
        console.error(`[Save Endpoint] Error saving file ${resolvedPath}:`, error); // Log error details
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// Create file or folder
app.post('/api/files/create', async (req, res) => {
    const type = req.body.type; // 'file' or 'folder'
    const name = req.body.name;
    const parentPath = req.body.parentPath || ''; // Relative path within DATA_DIR
    const fullParentPath = path.join(DATA_DIR, parentPath);

    if (!name || !/^[a-zA-Z0-9_.-]+$/.test(name)) { // Basic name validation
        return res.status(400).json({ error: 'Invalid name' });
    }

    const newItemPath = path.join(fullParentPath, name + (type === 'file' ? '.md' : ''));

    // Security Check
    const resolvedPath = path.resolve(newItemPath);
     if (!resolvedPath.startsWith(path.resolve(DATA_DIR))) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        if (type === 'file') {
            await fs.writeFile(newItemPath, '', 'utf8'); // Create empty file
        } else if (type === 'folder') {
            await fs.mkdir(newItemPath);
        } else {
            return res.status(400).json({ error: 'Invalid type' });
        }
        res.status(201).json({ message: `${type} created successfully` });
    } catch (error) {
        console.error(`Error creating ${type}:`, error);
         if (error.code === 'EEXIST') {
             return res.status(409).json({ error: 'Item already exists' });
         }
        res.status(500).json({ error: `Failed to create ${type}` });
    }
});


// Rename file or folder
app.post('/api/files/rename', async (req, res) => {
    const oldPathRelative = req.body.oldPath;
    const newName = req.body.newName;
    const oldPathFull = path.join(DATA_DIR, oldPathRelative);
    const parentDir = path.dirname(oldPathFull);

    if (!newName || !/^[a-zA-Z0-9_.-]+$/.test(newName)) {
        return res.status(400).json({ error: 'Invalid new name' });
    }

     // Ensure the new name has the correct extension if it's a file
    let finalNewName = newName;
    try {
        const stats = await fs.stat(oldPathFull);
        if (stats.isFile() && path.extname(newName).toLowerCase() !== '.md') {
            finalNewName += '.md';
        }
    } catch (error) {
         console.error('Error stating file for rename:', error);
         return res.status(404).json({ error: 'Original item not found' });
    }


    const newPathFull = path.join(parentDir, finalNewName);


    // Security Checks
    const resolvedOldPath = path.resolve(oldPathFull);
    const resolvedNewPath = path.resolve(newPathFull);
    if (!resolvedOldPath.startsWith(path.resolve(DATA_DIR)) || !resolvedNewPath.startsWith(path.resolve(DATA_DIR))) {
        return res.status(400).json({ error: 'Invalid path' });
    }
     if (resolvedOldPath === resolvedNewPath) {
         return res.status(400).json({ error: 'New name cannot be the same as the old name' });
     }

    try {
        await fs.rename(oldPathFull, newPathFull);
        res.json({ message: 'Item renamed successfully', newPath: path.relative(DATA_DIR, newPathFull) });
    } catch (error) {
        console.error('Error renaming item:', error);
         if (error.code === 'ENOENT') {
            return res.status(404).json({ error: 'Item not found' });
         } else if (error.code === 'EEXIST') {
             return res.status(409).json({ error: 'An item with the new name already exists' });
         }
        res.status(500).json({ error: 'Failed to rename item' });
    }
});

// Delete file or folder
app.post('/api/files/delete', async (req, res) => {
    const itemPathRelative = req.body.path;
    const itemPathFull = path.join(DATA_DIR, itemPathRelative);

    // Security Check
    const resolvedPath = path.resolve(itemPathFull);
    if (!resolvedPath.startsWith(path.resolve(DATA_DIR)) || resolvedPath === path.resolve(DATA_DIR)) {
         // Prevent deleting base data directory
        return res.status(400).json({ error: 'Invalid path' });
    }

    try {
        const stats = await fs.stat(itemPathFull);
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
        res.status(500).json({ error: 'Failed to delete item' });
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
        io.emit('file-changed', { event: 'add', path: path.relative(DATA_DIR, filePath), type: 'file' });
    })
    .on('change', filePath => {
        console.log(`File ${filePath} has been changed`);
        io.emit('file-changed', { event: 'change', path: path.relative(DATA_DIR, filePath), type: 'file' });
    })
    .on('unlink', filePath => {
        console.log(`File ${filePath} has been removed`);
        io.emit('file-changed', { event: 'unlink', path: path.relative(DATA_DIR, filePath), type: 'file' });
    })
    .on('addDir', dirPath => {
        console.log(`Directory ${dirPath} has been added`);
        io.emit('file-changed', { event: 'addDir', path: path.relative(DATA_DIR, dirPath), type: 'folder' });
    })
    .on('unlinkDir', dirPath => {
        console.log(`Directory ${dirPath} has been removed`);
        io.emit('file-changed', { event: 'unlinkDir', path: path.relative(DATA_DIR, dirPath), type: 'folder' });
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
server.listen(PORT, () => {
    console.log(`Edito server running on http://localhost:${PORT}`);
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
            if (err) {
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
