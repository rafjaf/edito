# Edito

A self-hosted, file-based Markdown editor for small trusted teams. Written by Rafaël Jafferali.

## Philosophy

- Your files, your server. Stored as plain .md files in a data/ folder you control.
- No user management. Put it behind a reverse proxy for authentication.
- Collaborative by design. All connected users share the same workspace.

## Features

- File browser with folder support
- Markdown editor (EasyMDE)
- Live Preview mode - renders formatting in place, click to edit
- Legal heading numbering toggle (1 / 1.1 / 1.1.1) in editor and outline
- Resizable sidebars (saved to localStorage)
- Real-time sync via WebSockets
- Import/export to .md or .html

## Running with Docker

```sh
git clone https://github.com/rafjaf/edito.git && cd edito
mkdir -p data
docker-compose up --build -d
```

Open http://localhost:3000

## Running with Node.js

```sh
npm install
node server.js
```

Open http://localhost:3000

## Authentication

Edito has no built-in login. Use a reverse proxy (Nginx, Caddy, Traefik).

## License

GPL v3
