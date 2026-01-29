FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for ChromaDB and other libraries
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Expose the port FastAPI runs on
EXPOSE 8000

# Command to run the application using shell form for environment variable expansion
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
