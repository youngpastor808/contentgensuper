#!/bin/bash
# ==============================================================================
# Remotion Cloud Run Deployment Script for ContentGen AI
# ==============================================================================
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ==============================================================================

set -e

REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${REMOTION_GCP_SERVICE_NAME:-remotion-4-0-524-mem2gi-cpu1-0-t300}"
SITE_NAME="${REMOTION_SITE_NAME:-storyboard-video}"

CPU_LIMIT="${REMOTION_CPU_LIMIT:-4}"
MEMORY_LIMIT="${REMOTION_MEMORY_LIMIT:-8Gi}"
MIN_INSTANCES="${REMOTION_MIN_INSTANCES:-0}"
MAX_INSTANCES="${REMOTION_MAX_INSTANCES:-10}"
TIMEOUT_SEC="${REMOTION_TIMEOUT_SECONDS:-600}"

echo "🚀 Starting Remotion Cloud Run Deployment..."
echo "📍 Region: $REGION"
echo "💻 CPU Limit: $CPU_LIMIT vCPUs"
echo "🧠 Memory Limit: $MEMORY_LIMIT"
echo "⏱️  Timeout: ${TIMEOUT_SEC}s"
echo "🌐 Site Name: $SITE_NAME"

echo ""
echo "Step 1: Installing dependencies..."
npm install

echo ""
echo "Step 2: Deploying Cloud Run Service Worker..."
DEPLOY_SERVICE_OUTPUT=$(npx remotion cloudrun services deploy \
  --region="$REGION" \
  --cpuLimit="$CPU_LIMIT" \
  --memoryLimit="$MEMORY_LIMIT" \
  --minInstances="$MIN_INSTANCES" \
  --maxInstances="$MAX_INSTANCES" \
  --timeoutSeconds="$TIMEOUT_SEC" \
  --onlyAllocateCpuDuringRequestProcessing)

echo "$DEPLOY_SERVICE_OUTPUT"

echo ""
echo "Step 3: Deploying Remotion Composition Bundle to Cloud Storage..."
SERVE_OUTPUT=$(npx remotion cloudrun sites create src/index.ts \
  --site-name="$SITE_NAME" \
  --region="$REGION")

echo "$SERVE_OUTPUT"

echo ""
echo "=============================================================================="
echo "✅ Deployment Successful!"
echo "Copy the serve URL from above and add it to your ContentGen AI .env file:"
echo "REMOTION_GCP_SERVE_URL=<YOUR_SERVE_URL_FROM_ABOVE>"
echo "REMOTION_GCP_SERVICE_NAME=$SERVICE_NAME"
echo "=============================================================================="
