# Deploy SparkPath to Render

SparkPath is deployed as a single Node.js web service:

- The Vite/React frontend is built into `dist/`.
- `server.ts` serves the frontend and the `/api/jobs`, `/api/youtube`, and `/api/ai` endpoints.
- `render.yaml` contains the Render service configuration.
- `OPENAI_API_KEY` remains server-side and is never included in the browser bundle.

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

## 2. Create an OpenAI API key

1. Open the OpenAI API Keys page:
   `https://platform.openai.com/api-keys`
2. Sign in.
3. Select **Create new secret key**.
4. Create a restricted project key when possible.
5. Copy the key temporarily.

Do not place this key in source code, `render.yaml`, GitHub, screenshots, or chat messages.

For local development only, copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Then enter the key in `.env`:

```text
OPENAI_API_KEY=your_real_key
OPENAI_API_URL=https://api.openai.com/v1/responses
OPENAI_MODEL=gpt-5-nano
OPENAI_MAX_OUTPUT_TOKENS=1800
OPENAI_REASONING_EFFORT=minimal
GITHUB_TOKEN=your_github_token_for_public_repo_reads
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
8. When Render requests `OPENAI_API_KEY`, paste the new OpenAI key.
9. When Render requests `GITHUB_TOKEN`, paste a GitHub personal access token used only for authenticated public GitHub API reads. It does not need private repo access; it is for reading public repos across GitHub, not only repos owned by your account.
10. Select **Deploy Blueprint**.

The Blueprint supplies:

```text
Runtime: Node
Build command: npm ci --include=dev && npm run build
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
6. Generate an AI resume or quest to confirm the OpenAI key works.
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
3. Confirm `OPENAI_API_KEY` exists.
4. Confirm there are no spaces or quotation marks around the value.
5. Save the environment variables.
6. Manually redeploy the latest commit.

### GitHub import returns 403 for every profile

This usually means GitHub rate-limited unauthenticated API requests. Add a server-side `GITHUB_TOKEN` in Render so SparkPath can make authenticated reads of public repos across GitHub:

1. Create a GitHub fine-grained personal access token.
2. Do not grant private repository access. A minimal token for public GitHub API reads is enough.
3. In Render, open the SparkPath service.
4. Open **Environment**.
5. Add `GITHUB_TOKEN`.
6. Save and redeploy.

Do not put `GITHUB_TOKEN` in frontend code. SparkPath reads it only on the Node server.

### Job providers return no listings

The job endpoint queries multiple third-party providers. A provider can temporarily block, throttle, or change its public response. The app continues using providers that still respond and shows direct provider search links.

### Render's free service is slow on the first visit

Free services can sleep when inactive. The first request after inactivity may take longer while the service starts.

### The Render Blueprint already exists

Secrets declared with `sync: false` are requested during initial Blueprint creation. If `OPENAI_API_KEY` or `GITHUB_TOKEN` is added later, enter it manually in the service's **Environment** settings and redeploy.
