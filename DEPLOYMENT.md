# Deploy SparkPath to Render

SparkPath is deployed as a single Node.js web service:

- The Vite/React frontend is built into `dist/`.
- `server.ts` serves the frontend and the `/api/jobs`, `/api/youtube`, and `/api/ai` endpoints.
- `render.yaml` contains the Render service configuration.
- `GEMINI_API_KEY` remains server-side and is never included in the browser bundle.

## 1. Test the production build locally

Open PowerShell in the project directory:

```powershell
cd C:\Users\micro\Documents\Opper
npm ci
npm run build
$env:PORT="3000"
npm start
```

Open:

```text
http://localhost:3000
```

Check the health endpoint:

```text
http://localhost:3000/api/health
```

It should return:

```json
{"ok":true,"service":"sparkpath"}
```

Press `Ctrl+C` in PowerShell when finished.

## 2. Create a Gemini API key

1. Open the Google AI Studio API Keys page:
   `https://aistudio.google.com/apikey`
2. Sign in.
3. Select **Create API key**.
4. Use a new authorization key or an appropriately restricted key.
5. Copy the key temporarily.

Do not place this key in source code, `render.yaml`, GitHub, screenshots, or chat messages.

For local development only, copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Then enter the key in `.env`:

```text
GEMINI_API_KEY=your_real_key
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/interactions
GEMINI_MODEL=gemini-3.5-flash
```

The repository's `.gitignore` prevents `.env` from being committed.

## 3. Push the project to GitHub

### Create the GitHub repository

1. Open `https://github.com/new`.
2. Name the repository, for example `sparkpath`.
3. Choose **Private** or **Public**.
4. Do not initialize it with a README, `.gitignore`, or license.
5. Select **Create repository**.

### Commit and push from PowerShell

Run these commands from the project directory:

```powershell
cd C:\Users\micro\Documents\Opper
git add .
git commit -m "Prepare SparkPath for production deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sparkpath.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

If an `origin` remote already exists, inspect it:

```powershell
git remote -v
```

To replace an incorrect URL:

```powershell
git remote set-url origin https://github.com/YOUR_USERNAME/sparkpath.git
```

## 4. Deploy the Render Blueprint

1. Open `https://dashboard.render.com/`.
2. Sign in with GitHub.
3. Select **New** and then **Blueprint**.
4. Connect the GitHub account or organization containing the repository.
5. Select the `sparkpath` repository.
6. Keep the Blueprint path as `render.yaml`.
7. Render should detect one web service named `sparkpath`.
8. When Render requests `GEMINI_API_KEY`, paste the Gemini key.
9. Select **Deploy Blueprint**.

The Blueprint supplies:

```text
Runtime: Node
Build command: npm ci && npm run build
Start command: npm start
Health check: /api/health
```

Render will install packages, run the TypeScript/Vite build, start the Node server, and assign an `onrender.com` URL.

## 5. Verify the live deployment

Open the URL shown by Render, such as:

```text
https://sparkpath.onrender.com
```

Verify:

1. The homepage loads.
2. `https://YOUR_URL/api/health` returns an `ok` response.
3. Enter a target role and open **Job search**.
4. Run a job search and confirm listings appear.
5. Add profile evidence and generate quests.
6. Generate an AI resume or quest to confirm the Gemini key works.
7. Mark a job as applied, refresh the page, and confirm it remains in the tracker.

## 6. Deploy future updates

After changing the code:

```powershell
git add .
git commit -m "Describe the update"
git push
```

Render normally deploys new commits from the linked branch automatically.

## 7. Add a custom domain

1. Open the SparkPath service in Render.
2. Open **Settings**.
3. Find **Custom Domains**.
4. Select **Add Custom Domain**.
5. Enter the domain or subdomain.
6. Add the DNS records Render provides at the domain registrar.
7. Wait for DNS verification and HTTPS certificate provisioning.

## Important data limitation

Application tracking, profile information, and quest progress currently use browser `localStorage`. This means:

- Data remains on the same browser and device after refreshes.
- Data does not synchronize between devices.
- Clearing browser storage removes the data.
- There are no user accounts yet.

Adding accounts and cross-device persistence requires a database and authentication.

## Troubleshooting

### The build fails

Confirm the local build succeeds:

```powershell
npm ci
npm run build
```

The project requires Node.js `22.12.0` or newer.

### The site loads but AI actions fail

In Render:

1. Open the SparkPath service.
2. Open **Environment**.
3. Confirm `GEMINI_API_KEY` exists.
4. Confirm there are no spaces or quotation marks around the value.
5. Save the environment variables.
6. Manually redeploy the latest commit.

### Job providers return no listings

The job endpoint queries multiple third-party providers. A provider can temporarily block, throttle, or change its public response. The app continues using providers that still respond and shows direct provider search links.

### Render's free service is slow on the first visit

Free services can sleep when inactive. The first request after inactivity may take longer while the service starts.

### The Render Blueprint already exists

Secrets declared with `sync: false` are requested during initial Blueprint creation. If `GEMINI_API_KEY` is added later, enter it manually in the service's **Environment** settings and redeploy.
