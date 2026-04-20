# Explicit Dockerfile for the Scout backend.
# We use this (instead of Railpack auto-detection) because Railpack kept
# detecting the service as a static site and deploying Caddy, even after
# renaming the public/ folder and adding railpack.json with provider: node.
# A Dockerfile forces Railpack to step aside and build exactly what we want.

FROM node:20-alpine

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
# package-lock.json is copied if present; npm ci prefers it when available.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the backend source.
COPY . .

# Railway injects PORT at runtime; backend reads process.env.PORT.
# EXPOSE is informational only — it doesn't actually publish the port.
EXPOSE 3000

CMD ["node", "index.js"]
