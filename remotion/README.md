# ContentGen AI — Remotion Cloud Rendering Pipeline

This directory contains the standalone Remotion composition and rendering project for **ContentGen AI**.

When a user triggers a Cloud Render in ContentGen AI, the server dispatches a render job to an AWS Lambda rendering cluster with the `StoryboardVideo` composition and custom `inputProps`.

---

## Architecture & Data Flow

```
[ContentGen AI UI (Browser)]
           │
           │ (Submits Export Payload with clips, timings, subtitles, audio)
           ▼
[ContentGen Express Server (/api/cloud-render/dispatch)]
           │
           │ (Invokes renderMediaOnLambda with serveUrl & inputProps)
           ▼
[AWS Lambda Worker Cluster (Serverless Headless Chromium)]
           │
           │ (Loads Remotion Bundle from S3 Site URL)
           ▼
[Remotion StoryboardVideo Composition (Root.tsx)]
           │
           │ (Renders each frame: pan/zoom, visuals, audio mix, subtitles)
           ▼
[Rendered MP4 Video Saved to S3 Bucket]
           │
           ▼
[Returned to User for Instant Playback & Download]
```

---

## Quick Setup & Deployment

### 1. Install Dependencies
```bash
cd remotion
npm install
```

### 2. Local Preview
Test the composition and visual layout in the Remotion Preview Studio:
```bash
npm run preview
```

### 3. Deploy to AWS (Automated)
Run the automated deployment script from the project root:
```bash
# Provide AWS credentials in your environment or command:
export REMOTION_AWS_ACCESS_KEY_ID="your-aws-access-key-id"
export REMOTION_AWS_SECRET_ACCESS_KEY="your-aws-secret-access-key"
export REMOTION_AWS_REGION="us-east-1"

npm run remotion:deploy:aws
```
Or run directly inside `remotion/`:
```bash
cd remotion
chmod +x deploy-aws.sh
./deploy-aws.sh
```

### 4. Deploy to AWS (Manual Steps)

**Step A: Deploy Lambda Function**
```bash
npm run deploy:function
# Or customize region/specs:
# npx remotion lambda functions deploy --memory=2048 --timeout=300 --disk=2048 --region=us-east-1
```

**Step B: Deploy the Remotion Site Bundle to S3**
```bash
npm run deploy:site
# Or specify:
# npx remotion lambda sites create src/index.ts --site-name=storyboard-video --region=us-east-1
```

Note the output `serveUrl` (e.g., `https://remotionlambda-xxx.s3.amazonaws.com/sites/storyboard-video/index.html`) and function name.

### 5. Configure ContentGen AI Environment
Update the `.env` file at the root of ContentGen AI:
```env
REMOTION_AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
REMOTION_AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
REMOTION_AWS_REGION=us-east-1
REMOTION_FUNCTION_NAME=remotion-render-4-0-xxx
REMOTION_SERVE_URL=https://remotionlambda-xxx.s3.amazonaws.com/sites/storyboard-video/index.html
```
