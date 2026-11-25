# ==============================================================================
# Stage 1: Build React Frontend (supports internal npm registry via frontend/.npmrc)
# ==============================================================================
FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS frontend-builder

USER 0
WORKDIR /build/frontend

COPY frontend/package.json frontend/.npmrc ./
RUN npm install --no-audit --no-fund && rm -f .npmrc

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Stage 2: Python FastAPI Runtime (OpenShift arbitrary UID compatible)
# ==============================================================================
FROM registry.access.redhat.com/ubi9/python-311:latest

USER 0

# Set working directory
WORKDIR /app

# Copy requirements and install using internal pip.config (removed after install)
COPY backend/requirements.txt ./requirements.txt
COPY pip.config /tmp/pip.config
RUN PIP_CONFIG_FILE=/tmp/pip.config \
    pip install --no-cache-dir --progress-bar off -r requirements.txt && rm -f /tmp/pip.config

# Copy backend application and compiled React frontend
COPY backend/app ./app
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# Create data directory for SQLite PVC persistence (OpenShift group-0 writable)
RUN mkdir -p /app/data && \
    chown -R 1001:0 /app && \
    chmod -R g=u /app

USER 1001

# Expose port
EXPOSE 8000

# Default environment variables (overridden by OpenShift ConfigMap / Secret)
ENV DATABASE_URL=sqlite:////app/data/signal.db

# Run FastAPI (serves both /api/* and the React SPA)
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
