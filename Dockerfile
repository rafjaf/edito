# Dockerfile

# ---- Base Stage ----
# Use an official Node.js runtime as a parent image.
# The 'alpine' version is lightweight, which is great for production.
FROM node:20-alpine

# ---- Security Best Practice: Create a non-root user ----
# Create a dedicated user and group for the application.
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# ---- Build Stage ----
# Set the working directory in the container.
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker layer caching.
# This step is only re-run if these files change.
COPY package*.json ./

# Install app dependencies using 'npm ci' which is faster and more reliable
# for CI/CD and Docker builds than 'npm install'.
# --only=production skips devDependencies.
RUN npm ci --only=production

# Copy the rest of the application's source code.
# The .dockerignore file will prevent unwanted files from being copied.
COPY . .

# Change the ownership of the app directory to the non-root user.
RUN chown -R appuser:appgroup /app

# Switch to the non-root user.
USER appuser

# ---- Final Stage ----
# Expose the port the app runs on. This is for documentation and can be used by tools.
EXPOSE 3000

# The command to run when the container starts.
CMD ["node", "server.js"]