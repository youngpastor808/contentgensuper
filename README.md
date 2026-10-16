# ContentGen AI — Setup & Deployment Guide

Welcome to **ContentGen AI**, an AI-powered storyboard and video generation platform built with TypeScript, Node.js/Express, Vite, Tailwind CSS, and Firebase.

This guide contains everything you need to set up, configure, and host ContentGen AI using your own Firebase project and whichever hosting provider or server you prefer.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Quick Start (Local Development)](#quick-start-local-development)
4. [Setting Up Your Own Firebase](#setting-up-your-own-firebase)
   - [Step 1: Create a Firebase Project](#step-1-create-a-firebase-project)
   - [Step 2: Enable Firebase Authentication](#step-2-enable-firebase-authentication)
   - [Step 3: Enable Cloud Firestore](#step-3-enable-cloud-firestore)
   - [Step 4: Configure `firebase-applet-config.json`](#step-4-configure-firebase-applet-configjson)
   - [Step 5: Deploy Firestore Security Rules](#step-5-deploy-firestore-security-rules)
   - [Step 6: Configure the Master Administrator Email](#step-6-configure-the-master-administrator-email)
5. [Environment Variables (`.env`)](#environment-variables-env)
6. [Remotion Cloud Rendering (AWS Lambda)](#remotion-cloud-rendering-aws-lambda)
   - [Overview & Architecture](#overview--architecture)
   - [AWS IAM & Lambda Setup](#aws-iam--lambda-setup)
   - [User Quota & Admin Controls](#user-quota--admin-controls)
7. [Hosting & Deployment Options](#hosting--deployment-options)
   - [Option A: Google Cloud Run (Recommended)](#option-a-google-cloud-run-recommended)
   - [Option B: VPS / Linux Server (Docker, PM2 & Nginx)](#option-b-vps--linux-server-docker-pm2--nginx)
   - [Option C: Render / Railway / Fly.io](#option-c-render--railway--flyio)
   - [Option D: Amazon Web Services (AWS App Runner / ECS / Lightsail)](#option-d-amazon-web-services-aws-app-runner--ecs--lightsail)
8. [Desktop App with Electron (Optional)](#desktop-app-with-electron-optional)
9. [First-Time Admin Setup & User Management](#first-time-admin-setup--user-management)
10. [Troubleshooting & FAQs](#troubleshooting--faqs)

---

## Architecture Overview

- **Backend**: Node.js & Express (`server.ts`) handling AI proxying, FFmpeg audio/video processing, WebSocket streaming (`/ffmpeg-export`), and serving static assets.
- **Frontend**: Single-page application built with Vite, TypeScript, and Tailwind CSS (`index.html`, `index.tsx`, `src/`).
- **Database & Auth**: Google Firebase (Authentication & Cloud Firestore) for role-based access control (Admin, Reseller, User), credit transactions, storyboard persistence, and cloud settings.
- **Desktop Runtime**: Electron (`electron/main.cjs`) for standalone Windows packaging.

---

## Prerequisites

Before running the application, make sure you have:

- **Node.js**: v18.x or v20.x or newer ([Download Node.js](https://nodejs.org/))
- **npm** (bundled with Node.js) or **yarn** / **pnpm**
- **FFmpeg** (Optional but recommended): While the app includes `ffmpeg-static` as a fallback, installing system FFmpeg provides optimal rendering and hardware acceleration.
- **Firebase Account**: A Google account to create a Firebase project at [Firebase Console](https://console.firebase.google.com/).

---

## Quick Start (Local Development)

1. **Clone the Repository**:
   ```bash
   git clone <your-repository-url>
   cd contentgen-ai
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   *(See the [Environment Variables](#environment-variables-env) section below for details).*

4. **Start the Development Server**:
   ```bash
   npm run dev
   ```
   Open your browser to `http://localhost:3000`.

5. **Build and Run for Production**:
   ```bash
   npm run build
   npm run start
   ```

---

## Setting Up Your Own Firebase

To run ContentGen AI independently, connect it to your own Firebase project:

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** (or **Create a project**).
3. Enter a project name (e.g. `my-contentgen-app`) and follow the on-screen steps. Google Analytics is optional.

### Step 2: Enable Firebase Authentication
1. In the Firebase Console left navigation, select **Build** > **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab, enable:
   - **Email/Password**: Toggle **Enable** and save.
   - **Google**: Toggle **Enable**, enter your support email, and save.
4. *(Optional)* Add your domain (e.g. `localhost`, your custom domain, or your Cloud Run URL) to **Authorized domains** under **Authentication** > **Settings** > **Authorized domains**.

### Step 3: Enable Cloud Firestore
1. In the Firebase Console, navigate to **Build** > **Firestore Database**.
2. Click **Create database**.
3. Choose your database location (select the region closest to your users) and start in **Production mode**.
4. If you use the standard default database, the Database ID will be `(default)`.

### Step 4: Configure `firebase-applet-config.json`
1. In Firebase Console, go to **Project settings** (gear icon next to Project Overview) > **General**.
2. Scroll down to **Your apps**, click the **Web** icon (`</>`), and register your web app (e.g. `ContentGen Web`).
3. Firebase will display your web configuration SDK snippet.
4. Open the `firebase-applet-config.json` file in the project root and fill in your values:

```json
{
  "projectId": "your-firebase-project-id",
  "appId": "1:123456789012:web:abcdef1234567890",
  "apiKey": "AIzaSyYourGeneratedWebApiKeyHere",
  "authDomain": "your-firebase-project-id.firebaseapp.com",
  "firestoreDatabaseId": "(default)",
  "storageBucket": "your-firebase-project-id.firebasestorage.app",
  "messagingSenderId": "123456789012",
  "measurementId": "",
  "recaptchaSiteKey": ""
}
```

> **Note**: If your Firestore database ID is `(default)`, set `"firestoreDatabaseId": "(default)"`. If you created a named database in Firestore, put that database name here.

### Step 5: Deploy Firestore Security Rules
ContentGen AI includes a comprehensive `firestore.rules` file that protects user records, ensures secure role-based access, and guards credits.

Install the Firebase CLI if you haven't already:
```bash
npm install -g firebase-tools
```

Log in and set your project:
```bash
firebase login
firebase use your-firebase-project-id
```

Deploy the rules:
```bash
firebase deploy --only firestore:rules
```

### Step 6: Configure the Master Administrator Email
By default, the master super admin email is defined in `src/auth.ts` and `firestore.rules`.

1. **In `src/auth.ts`**:
   Find the constant near the top:
   ```typescript
   export const SUPER_ADMIN_EMAIL = 'your-admin-email@example.com';
   ```
   Change it to the email address you will use to log in.

2. **In `firestore.rules`**:
   Find the super admin email definition near the top:
   ```javascript
   function isSuperAdmin() {
     return request.auth != null &&
            request.auth.token.email.lower() == 'your-admin-email@example.com';
   }
   ```
   Change it to match your admin email address, then re-deploy rules (`firebase deploy --only firestore:rules`).

3. Rebuild the application:
   ```bash
   npm run build
   ```

When you log in with that email address via Google or Email/Password, you will automatically be granted the **admin** role with full access to the Admin Dashboard.

---

## Environment Variables (`.env`)

Create a `.env` file in the project root to configure optional integrations and services:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | The HTTP port the Express server listens on. | `3000` |
| `GEMINI_API_KEY` | Server-side Google Gemini API key for storyboards and AI prompts. | `AIzaSy...` |
| `VERTEXAI` | Set to `true` if you use Google Cloud Vertex AI instead of AI Studio. | `false` |
| `VERTEX_PROJECT_ID` | Your Google Cloud project ID (if using Vertex AI). | `your-gcp-project` |
| `VERTEX_LOCATION` | Vertex AI region. | `us-central1` or `europe-west1` |
| `DEEPGRAM_API_KEY` | Deepgram API key for speech-to-text / timeline transcription. | `Optional` |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth Client ID (for Google Sign-in button). | `Optional` |
| `DESKTOP_STUDIO_PASSWORD` | Password required to unlock desktop offline studio mode. | `Optional` |
| `VITE_FIREBASE_API_KEY` | Optional runtime override for the Firebase Web API key. | `Optional` |
| `REMOTION_AWS_ACCESS_KEY_ID` | AWS IAM Access Key ID for Remotion serverless cloud rendering. | `Optional (Cloud Render)` |
| `REMOTION_AWS_SECRET_ACCESS_KEY` | AWS IAM Secret Access Key for Remotion cloud rendering. | `Optional (Cloud Render)` |
| `REMOTION_AWS_REGION` | AWS Region where the Remotion Lambda function and S3 bucket are deployed. | `us-east-1` |
| `REMOTION_SERVE_URL` | S3 Serve URL for the bundled Remotion composition bundle. | `https://remotionlambda-xyz.s3.us-east-1.amazonaws.com/sites/...` |
| `REMOTION_FUNCTION_NAME` | Name of the deployed Remotion Lambda rendering function. | `remotion-render-4-0-x-mem2048mb-disk2048mb-120sec` |

---

## Remotion Cloud Rendering (AWS Lambda)

ContentGen AI features a **Dual Rendering Engine Architecture**:
1. **Local Browser Render**: Renders directly in the user's web browser using Canvas, WebCodecs, and client-side FFmpeg. It is 100% free and consumes zero cloud minutes.
2. **Remotion Cloud Render (AWS Lambda)**: Dispatches timeline rendering jobs to an AWS Lambda serverless render cluster. Offloads heavy video processing to the cloud with up to 10x rendering speeds, letting users continue editing without taxing client hardware.

### Overview & Architecture

- **Endpoints**:
  - `GET /api/cloud-render/config`: Returns infrastructure status and cloud availability.
  - `POST /api/cloud-render/dispatch`: Submits a composition timeline to the Remotion Lambda cluster, records duration, and begins background rendering.
  - `GET /api/cloud-render/status/:jobId`: Streams real-time progress and provides the downloadable video URL upon completion.
- **Fail-Safe Fallback**: If AWS credentials are not yet configured or are in development mode, the system automatically uses an intelligent asynchronous cloud worker simulation to ensure non-blocking UI behavior while testing.

### AWS IAM & Lambda Setup

To deploy Remotion Lambda in your AWS account:

1. **Install Remotion CLI**:
   ```bash
   npx remotion lambda policies
   ```
2. **Create IAM User & Attach Permissions**:
   Remotion requires permissions for AWS Lambda, S3, and CloudWatch. Generate an IAM policy with:
   ```bash
   npx remotion lambda policies
   ```
   Save your `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

3. **Deploy the Lambda Function**:
   ```bash
   npx remotion lambda functions deploy --memory=2048 --disk=2048 --timeout=120
   ```
   Note the returned function name (e.g. `remotion-render-4-0-x-mem2048mb-disk2048mb-120sec`).

4. **Deploy the Site / Bundle to S3**:
   ```bash
   npx remotion lambda sites create --site-name=contentgen-site
   ```
   Note the returned `serveUrl`.

5. **Update `.env`**:
   ```env
   REMOTION_AWS_ACCESS_KEY_ID=your_access_key
   REMOTION_AWS_SECRET_ACCESS_KEY=your_secret_key
   REMOTION_AWS_REGION=us-east-1
   REMOTION_FUNCTION_NAME=your_function_name
   REMOTION_SERVE_URL=your_serve_url
   ```

### User Quota & Admin Controls

- **Default Quota**: Every user receives an initial cloud render quota of **300 minutes**.
- **Transactional Metering**: When initiating a cloud render, the exact video duration (rounded up to the nearest minute) is verified against the user's available quota and transactionally recorded in Firestore (`renderMinutesUsed`).
- **Live Quota Display**: The Export modal displays current remaining cloud minutes (e.g. `300 mins remaining`) and dynamically previews estimated deductions before starting.
- **Administrator Management**:
  - In the **Admin Dashboard**, the user table includes a dedicated **Cloud Render (Mins)** column.
  - Admins can adjust any user's allocated cloud render minutes directly.
  - Use the quick `+60m` button to grant an instant 60-minute quota top-up with real-time feedback.
  - Tracks total minutes used vs. granted quota in real-time (`Used: 15m / 300m`).

---

## Hosting & Deployment Options

Because ContentGen AI includes a Node.js backend (`server.ts`) for AI proxying, audio processing, and WebSocket streaming, it runs best on container or Node-capable hosting environments.

### Option A: Google Cloud Run (Recommended)

Google Cloud Run provides automatic scaling, SSL certificates, and WebSocket support out of the box.

1. **Install Google Cloud SDK** (`gcloud`).
2. **Deploy directly from source**:
   ```bash
   gcloud run deploy contentgen-ai \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --port 3000 \
     --memory 2Gi \
     --cpu 2 \
     --concurrency 80 \
     --max-instances 1 \
     --clear-base-image-args
   ```
3. Set your environment variables in the Cloud Run console or via `--set-env-vars`.
4. Ensure **WebSocket support** is enabled (enabled by default on Cloud Run HTTP/1.1 and HTTP/2).

---

### Option B: VPS / Linux Server (Docker, PM2 & Nginx)

You can host on any Linux server (Ubuntu/Debian on DigitalOcean, Linode, AWS EC2, Hetzner, etc.):

#### 1. Using Docker
The production multi-stage `Dockerfile` is located in the project root.

Build and run:
```bash
docker build -t contentgen-ai .
docker run -d -p 8080:8080 --env-file .env --name contentgen contentgen-ai
```

#### 2. Using PM2 Directly on Server
```bash
npm install -g pm2
npm install
npm run build
pm2 start dist/server.js --name "contentgen-ai"
pm2 save
pm2 startup
```

#### 3. Nginx Reverse Proxy with WebSocket Support
Configure your Nginx virtual host (`/etc/nginx/sites-available/contentgen`):
```nginx
server {
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Crucial for WebSockets (/ffmpeg-export)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

### Option C: Render / Railway / Fly.io

You can easily deploy via Git:

- **Render**: Create a **Web Service**, set runtime to `Node`, build command: `npm install && npm run build`, start command: `npm run start`.
- **Railway**: Connect your Git repository; Railway auto-detects Node.js. Set the port variable or expose port `3000`.
- **Fly.io**: Run `fly launch` and follow the prompts to deploy the Node container.

---

### Option D: Amazon Web Services (AWS App Runner / ECS / Lightsail)

ContentGen AI can be deployed on AWS using containerized services.

#### 1. AWS App Runner (Recommended for AWS)
AWS App Runner provides fully managed container deployments with auto-scaling, HTTPS, and WebSocket support:

1. **Push your Docker image to AWS Elastic Container Registry (ECR)**:
   ```bash
   # Authenticate Docker to your ECR registry
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com

   # Create repository (if it doesn't exist)
   aws ecr create-repository --repository-name contentgen-ai --region us-east-1

   # Build and tag image
   docker build -t contentgen-ai .
   docker tag contentgen-ai:latest <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/contentgen-ai:latest

   # Push to ECR
   docker push <aws_account_id>.dkr.ecr.us-east-1.amazonaws.com/contentgen-ai:latest
   ```
2. **Create App Runner Service**:
   - In AWS Console, go to **App Runner** > **Create service**.
   - Select **Container registry** > **Amazon ECR** and choose `contentgen-ai:latest`.
   - Set **Port** to `3000`.
   - Add environment variables (`GEMINI_API_KEY`, etc.) under **Environment variables**.
   - Deploy! App Runner automatically provides a secure HTTPS URL.

#### 2. AWS Lightsail Containers (Budget Friendly)
1. Go to **AWS Lightsail Console** > **Containers**.
2. Click **Create container service** and choose a scale capacity (e.g. Nano or Micro).
3. Push your image using the AWS Lightsail CLI plugin (`aws lightsail push-container-image`).
4. Set container port to `3000` and configure environment variables.

#### 3. AWS ECS with Fargate
1. Create an **ECS Cluster** with AWS Fargate.
2. Define a **Task Definition** using the Docker image from ECR, set container port `3000`, and set environment variables.
3. Create an **ECS Service** with an Application Load Balancer (ALB) to handle incoming traffic and WebSockets.

---

## Desktop App with Electron (Optional)

ContentGen AI can also be packaged as a native desktop application for Windows:

1. **Install Electron Sub-package Dependencies**:
   ```bash
   npm run electron:install
   ```

2. **Run in Electron Development Mode**:
   ```bash
   npm run electron:dev
   ```

3. **Build Windows Executable Installer (`.exe`)**:
   ```bash
   npm run electron:build
   ```
   The generated installer will be located in the `dist_electron/` directory.

### Desktop Workspace Structure
When running on the desktop, ContentGen AI automatically initializes a structured workspace directory in your user's `Documents/ContentGen/` (or customizable via the **Change** button in the Export modal):
- **`Projects/`**: Stores your `.cgproj`, `.contentgenai`, and project save files.
- **`Videos/`**: Automatically receives exported video files (`.mp4`, `.webm`, `.mov`).
- **`Audio/`**: Automatically receives mastered audio tracks, sound effects, voiceovers, and exported `.wav`, `.mp3`, `.m4a`, and `.ogg` files.
- **`Assets/`**: Stores story images, b-roll footage, thumbnails, subtitle/caption files (`.srt`), and JSON exports.

---

## First-Time Admin Setup & User Management

1. **Initial Login**:
   - Open your deployed URL (or `http://localhost:3000`).
   - Click the User Profile / Login button in the header.
   - Log in or register using the email address you defined as `SUPER_ADMIN_EMAIL`.
2. **Accessing the Admin Panel**:
   - Once logged in, click your avatar or username in the top bar and select **Admin Panel** (or press the shield icon).
3. **System Settings & Policies**:
   - **Require Approval for New Users**: When enabled, new registrations are put in `pending` status until approved by an admin or reseller.
   - **Enforce Guest Restrictions**: When enabled, anonymous visitors cannot consume system credits without their own API key.
   - **Generation Toggles**: Temporarily disable image or video generation system-wide if needed.
   - **Desktop Studio Password**: Set a custom password required to unlock offline/desktop studio mode.
4. **User & Reseller Management**:
   - Search registered users, adjust credit balances, change roles (`admin`, `reseller`, `user`), and approve or ban accounts.
   - Resellers can approve users and allocate credits up to their reseller quota without seeing system-level administrative settings.

---

## Troubleshooting & FAQs

### Q: I see "Could not reach Cloud Firestore backend" in the console.
- **Cause**: Firestore client is unable to establish a WebSocket or long-polling connection to Firebase, or rules are blocking read/write.
- **Fix**: Check that your `projectId` and `apiKey` in `firebase-applet-config.json` are correct and that Firestore is initialized in Native mode. Ensure your device has an active internet connection.

### Q: Users cannot sign up or log in with Google.
- **Fix**: Ensure your deployment domain (e.g. `yourdomain.com` or `*.run.app`) is added to **Authorized domains** under **Firebase Console** > **Authentication** > **Settings** > **Authorized domains**.

### Q: Export / Video rendering fails on the server.
- **Fix**: Make sure FFmpeg is installed or that `ffmpeg-static` has execute permissions on your server OS (`chmod +x node_modules/ffmpeg-static/ffmpeg`).

### Q: How do users add their own API keys?
- Users can click the **Settings** gear icon in the app header and enter their personal Gemini API key or OpenAI Gateway credentials. When a personal key is provided, calls bypass system quota restrictions.

---

## License & Credits

- **Author**: Jones Mbuso
- **Application**: ContentGen AI
