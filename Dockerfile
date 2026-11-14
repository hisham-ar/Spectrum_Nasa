# Lost in the Spectrum: one container that serves the website, the pre-built Featured
# frames and the live-search API. Works on Google Cloud Run, Render, or any Docker host.
#
#   docker build -t lits .
#   docker run -p 8080:8080 lits          # then open http://localhost:8080

# --- 1. Build the website ----------------------------------------------------------
FROM node:20-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# public/featured (the checked, pre-built Featured frames) is copied into dist/featured here
RUN npm run build

# --- 2. Run the server --------------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LITS_CACHE_DIR=/tmp/lits-cache \
    LITS_CUTOUT_CACHE_MB=400 \
    LITS_SEQ_CACHE_MB=150 \
    LITS_FEATURED_DIR=/app/frontend/dist/featured
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /app/frontend/dist frontend/dist
RUN useradd --create-home lits && mkdir -p /tmp/lits-cache && chown -R lits /tmp/lits-cache
USER lits
EXPOSE 8080
# One process: search jobs and their progress live in memory, so every request must
# reach the same process (on Cloud Run also set maximum instances to 1).
CMD ["sh", "-c", "exec uvicorn lits.api:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8080}"]
