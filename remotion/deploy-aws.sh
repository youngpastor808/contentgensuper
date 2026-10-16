#!/bin/bash
# ==============================================================================
# Remotion AWS Lambda & S3 Site Deployment Script for ContentGen AI
# ==============================================================================
# Usage:
#   chmod +x deploy-aws.sh
#   ./deploy-aws.sh
#
# Optional Environment Overrides:
#   AWS_REGION=us-east-1
#   SITE_NAME=storyboard-video
#   ARCHITECTURE=arm64
#   MEMORY_MB=2048
#   TIMEOUT_SEC=900
#   DISK_MB=10240
# ==============================================================================

set -e

# Resolve credentials from REMOTION_AWS_* or standard AWS_*
AWS_ACCESS_KEY="${REMOTION_AWS_ACCESS_KEY_ID:-$AWS_ACCESS_KEY_ID}"
AWS_SECRET_KEY="${REMOTION_AWS_SECRET_ACCESS_KEY:-$AWS_SECRET_ACCESS_KEY}"
REGION="${REMOTION_AWS_REGION:-${AWS_REGION:-us-east-1}}"
SITE_NAME="${REMOTION_SITE_NAME:-storyboard-video}"
ARCHITECTURE="${REMOTION_LAMBDA_ARCHITECTURE:-arm64}"
MEMORY_MB="${REMOTION_LAMBDA_MEMORY:-2048}"
TIMEOUT_SEC="${REMOTION_LAMBDA_TIMEOUT:-900}"
DISK_MB="${REMOTION_LAMBDA_DISK:-10240}"

echo "=============================================================================="
echo "🚀 Remotion AWS Lambda & S3 Deployment"
echo "=============================================================================="
echo "📍 AWS Region: $REGION"
echo "🌐 Site Name: $SITE_NAME"
echo "🏗️ Architecture: $ARCHITECTURE"
echo "🧠 Function Memory: ${MEMORY_MB} MB"
echo "⏱️  Function Timeout: ${TIMEOUT_SEC}s"
echo "💾 Ephemeral Disk: ${DISK_MB} MB"
echo "=============================================================================="

if [ -z "$AWS_ACCESS_KEY" ] || [ -z "$AWS_SECRET_KEY" ]; then
  echo ""
  echo "❌ Missing AWS Credentials!"
  echo "Please set AWS credentials before running deployment:"
  echo "  export REMOTION_AWS_ACCESS_KEY_ID='your-access-key-id'"
  echo "  export REMOTION_AWS_SECRET_ACCESS_KEY='your-secret-access-key'"
  echo "  export REMOTION_AWS_REGION='${REGION}'"
  echo ""
  exit 1
fi

export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_KEY"
export AWS_REGION="$REGION"

echo ""
echo "Step 1: Validating TypeScript & Remotion bundle..."
npm run build
npm run bundle

echo ""
echo "Step 2: Deploying Remotion Lambda rendering function..."
FUNCTION_DEPLOY_OUTPUT=$(npx remotion lambda functions deploy \
  --region="$REGION" \
  --architecture="$ARCHITECTURE" \
  --memory="$MEMORY_MB" \
  --disk="$DISK_MB" \
  --timeout="$TIMEOUT_SEC")

echo "$FUNCTION_DEPLOY_OUTPUT"

# Extract function name if present
FUNCTION_NAME=$(echo "$FUNCTION_DEPLOY_OUTPUT" | grep -o 'remotion-render-[a-zA-Z0-9_-]*' | head -n 1 || true)

echo ""
echo "Step 3: Deploying Remotion Composition Bundle to AWS S3..."
SITE_DEPLOY_OUTPUT=$(npx remotion lambda sites create src/index.ts \
  --site-name="$SITE_NAME" \
  --region="$REGION" \
  --enable-folder-expiry)

echo "$SITE_DEPLOY_OUTPUT"

SERVE_URL=$(echo "$SITE_DEPLOY_OUTPUT" | grep -o 'https://[^ ]*index.html' | head -n 1 || true)

echo ""
echo "=============================================================================="
echo "✅ AWS Deployment Complete!"
echo "=============================================================================="
if [ -n "$SERVE_URL" ]; then
  echo "🌐 Serve URL: $SERVE_URL"
fi
if [ -n "$FUNCTION_NAME" ]; then
  echo "⚡ Function Name: $FUNCTION_NAME"
fi
echo ""
echo "Add these environment variables to the server's secret/configuration store:"
echo "------------------------------------------------------------------"
echo "REMOTION_AWS_ACCESS_KEY_ID=<stored securely>"
echo "REMOTION_AWS_SECRET_ACCESS_KEY=<stored securely>"
echo "REMOTION_AWS_REGION=$REGION"

if [ -n "$FUNCTION_NAME" ]; then
  echo "REMOTION_FUNCTION_NAME=$FUNCTION_NAME"
else
  echo "REMOTION_FUNCTION_NAME=remotion-render-4-0-527-arm64-mem2048mb-disk10240mb-900sec"
fi

if [ -n "$SERVE_URL" ]; then
  echo "REMOTION_SERVE_URL=$SERVE_URL"
else
  echo "REMOTION_SERVE_URL=<PASTE_SERVE_URL_FROM_STEP_3_OUTPUT>"
fi

echo "REMOTION_MAX_CONCURRENT_RENDERS=3"
echo "REMOTION_AWS_CONCURRENCY_BUDGET=540"
echo "REMOTION_AWS_MAX_LAMBDA_CONCURRENCY=180"
echo "REMOTION_AWS_MIN_LAMBDA_CONCURRENCY=16"
echo "REMOTION_TARGET_CHUNK_SECONDS=20"
echo "REMOTION_AWS_MAX_DURATION_MINUTES=75"
echo "REMOTION_AWS_OUTPUT_PRIVACY=private"
echo "REMOTION_AWS_OUTPUT_URL_TTL_SECONDS=900"
echo "=============================================================================="
