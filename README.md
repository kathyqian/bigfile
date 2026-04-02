# CSV viewer (DuckDB WASM)

Browser-only app: drag and drop a CSV, load it into **DuckDB WebAssembly**, and browse it in a read-only **react-data-grid** with windowed queries so large files do not need every row in memory at once.

Stack: Next.js (App Router), Tailwind CSS, shadcn/ui, `@duckdb/duckdb-wasm`, `react-data-grid`.

## Requirements

- Node.js 20+ (see `package.json` engines if specified)

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The dev server uses webpack (`next dev --webpack`) so DuckDB WASM assets resolve correctly.

## Production build

Static HTML/CSS/JS is emitted to `out/`:

```bash
npm run build
```

For a local preview of the static output, serve `out/` with any static file server (paths assume the site is served at `/`, not under a subpath).

## Deploy to GitHub Pages (GitHub Actions)

This repo includes [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It runs on every push to `main` and can be run manually. It runs `npm ci`, `npm run build` with `NEXT_PUBLIC_BASE_PATH` set to `/<repository-name>` so assets work on `https://<user>.github.io/<repo>/`.

### 1. Enable GitHub Actions

1. On GitHub, open the repository.
2. Go to **Settings** → **Actions** → **General**.
3. Under **Actions permissions**, choose **Allow all actions and reusable workflows** (or restrict to trusted sources if your org requires it).
4. Click **Save** if you changed anything.

Forks and some org repos may need **Settings** → **Actions** → **General** → **Fork pull request workflows** configured separately; for a normal repo you own, the default is usually enough.

### 2. Allow the workflow to deploy Pages

The workflow uses `actions/deploy-pages` and needs permission to write to GitHub Pages:

1. Push the workflow file to the `main` branch (or merge a PR that adds it).
2. Open the **Actions** tab and select **Deploy to GitHub Pages**.
3. Run the workflow once (or push to `main`). If GitHub prompts to approve workflows for first-time contributors, approve the run.
4. If the job fails with a permissions error, go to **Settings** → **Actions** → **General** → **Workflow permissions** and set **Read and write permissions**, then re-run the workflow.

### 3. Point GitHub Pages at Actions (not a branch)

1. Go to **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions** (not “Deploy from a branch”).
3. After a successful workflow run, the site URL appears on the same page and in the workflow summary (typically `https://<username>.github.io/<repository>/`).

### 4. Optional: environment protection

The workflow uses the `github-pages` environment. If you add protection rules under **Settings** → **Environments**, deployments may wait for approval; for a personal repo you can leave the environment with no rules.

### Local env for Pages-style URLs

For a local build that matches GitHub Pages asset paths, create `.env.local`:

```bash
NEXT_PUBLIC_BASE_PATH=/your-repo-name
```

See [`.env.example`](.env.example). Omit it for root-hosted previews (e.g. `localhost`).
