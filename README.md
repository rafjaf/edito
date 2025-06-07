# Edito 📝

A simple, self-hosted, file-based Markdown editor designed for small, trusted teams. Edit your markdown files directly on your server through a clean, modern web interface.

![Edito Screenshot](https://raw.githubusercontent.com/rafjaf/edito/master/docs/screenshot.png)

## About The Project

Edito was born from the need for a straightforward, no-frills Markdown editor that can be easily self-hosted. It's built to manage a central repository of Markdown files on a home server or private VPS. The application provides a live-updating file browser, a powerful Markdown editor (thanks to [EasyMDE](https://github.com/Ionaru/easy-markdown-editor)), and real-time synchronization for a seamless editing experience.

### Philosophy and Goal

The core philosophy of Edito is simplicity. It is designed with a specific use case in mind:

*   **Self-Hosted First:** This application is intended to be run by you, on your own hardware or cloud instance. You control your data.
*   **Small, Trusted Teams:** The editor does not have a user management system. It assumes that anyone with access to the application is a trusted colleague or collaborator.
*   **Shared File System:** Every user connected to the application sees and can edit the same set of files. It's a collaborative workspace, not a multi-tenant platform for strangers.
*   **External Authentication:** Security and user authentication should be handled by a layer in front of the application, such as a reverse proxy (Nginx, Caddy, Traefik, etc.) on your home server. This keeps the application lean and focused on its primary job: editing Markdown.

### Features

*   **File Browser:** Navigate through folders and files in your data directory.
*   **Powerful Editor:** A feature-rich Markdown editor powered by EasyMDE, including a toolbar, live preview, and side-by-side modes.
*   **Real-time Updates:** File changes made by other users or directly on the server are reflected instantly in the UI, thanks to WebSockets.
*   **File Operations:** Create, rename, and delete files and folders directly from the web interface.
*   **Live Outline:** A dynamic table of contents is generated from your document's headers for quick navigation.
*   **Status Bar:** Keep track of line, word, and character counts, as well as file size and sync status.
*   **Import/Export:** Easily import local `.md` files or export your work as `.md` or `.html`.
*   **Optimized Performance:** Debounced actions for saving and UI updates to ensure a smooth experience.

### Tech Stack

*   **Backend:** Node.js, Express.js
*   **Real-time:** Socket.IO, Chokidar (file system watcher)
*   **Frontend:** Vanilla JavaScript (ESM), EasyMDE, Font Awesome
*	**Disclaimer:** Written with a lot of vibe coding with the help of Gemini and ChatGPT. Use at your own risks!

## Deployment

There are two ways to deploy Edito. Using Docker is the recommended method for a simple and reproducible setup.

### Using Docker (Recommended)

This method uses Docker and Docker Compose to run Edito in an isolated container. Your markdown files are stored on your host machine in the `data` directory, ensuring they are safe and persistent.

**Prerequisites:**
*   [Docker](https://www.docker.com/get-started/)
*   [Docker Compose](https://docs.docker.com/compose/install/)

**Instructions:**

1.  Clone the repository to your server:
    ```sh
    git clone https://github.com/rafjaf/edito.git
    cd edito
    ```
2.  Create the data directory if it doesn't exist. This is where your files will be stored.
    ```sh
    mkdir -p data
    ```
3.  Build and start the container in the background:
    ```sh
    docker-compose up --build -d
    ```
4.  The application is now running! Access it in your browser at `http://localhost:3000`.

**To stop the application:**
```sh
docker-compose down
```

### Manual Setup (Using Node.js)

This method runs the application directly on your host machine using Node.js.

**Prerequisites:**
*   [Node.js](https://nodejs.org/) (which includes npm)

**Instructions:**

1.  Clone the repository and navigate into the directory:
    ```sh
    git clone https://github.com/rafjaf/edito.git
    cd edito
    ```
2.  Install the required NPM packages:
    ```sh
    npm install
    ```
3.  Start the application:
    ```sh
    node server.js
    ```
4.  The server will start, and you can access the editor by navigating to `http://localhost:3000` in your web browser.


## A Note on Authentication

**Edito does not include any built-in authentication or user management.** This is a deliberate design choice.

You are expected to secure the application using a reverse proxy. This is a standard and highly secure practice for self-hosted services. Here are some popular options:
*   **[Nginx](https://www.nginx.com/):** Use `ngx_http_auth_basic_module` for basic password protection or services like [Authelia](https://www.authelia.com/) for more advanced SSO.
*   **[Caddy](https://caddyserver.com/):** Use the `basicauth` directive.
*   **[Traefik](https://traefik.io/):** Use the `BasicAuth` middleware.

By placing Edito behind such a proxy, you ensure that only authorized users can access the editor.

## Project Structure

```
edito/
├── data/                 # Your markdown files and folders (mounted as a Docker volume)
├── node_modules/         # Dependencies (used for local dev, ignored in Docker)
├── public/               # All frontend assets
│   ├── css/
│   │   └── style.css
│   └── modules/
├── .dockerignore         # Specifies files to exclude from the Docker image
├── .gitignore            # Specifies files for git to ignore
├── Dockerfile            # Instructions to build the Docker image
├── docker-compose.yml    # Defines the Docker service for easy deployment
├── package.json
└── server.js             # The Node.js/Express backend
```

## Contributing

Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1.  Fork the Project
2.  Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3.  Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4.  Push to the Branch (`git push origin feature/AmazingFeature`)
5.  Open a Pull Request

## License

Distributed under the GPL Version 3. See `LICENSE` for more information.
