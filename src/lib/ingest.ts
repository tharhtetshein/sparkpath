import mammoth from "mammoth/mammoth.browser";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { EvidenceSource, OpportunityInput } from "./agent";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function parseFiles(files: FileList | File[]): Promise<EvidenceSource[]> {
  return Promise.all(Array.from(files).map(parseFile));
}

export async function parseFile(file: File): Promise<EvidenceSource> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  let content = "";

  if (extension === "pdf") {
    content = await parsePdf(file);
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    content = result.value;
  } else {
    content = await file.text();
  }

  return {
    id: crypto.randomUUID(),
    type: "file",
    title: file.name,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
}

export async function importGithubRepo(repoInput: string): Promise<EvidenceSource> {
  const target = normalizeGithubTarget(repoInput);
  if (!target.value) {
    throw new Error("Enter a GitHub profile, repo URL, username, or owner/repo.");
  }

  return target.type === "repo" ? importSingleRepo(target.value) : importGithubProfile(target.value);
}

export type RepoProgressSnapshot = {
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  defaultBranchSha: string;
  commitCount: number;
  pushedAt: string;
  checkedAt: string;
};

export async function inspectGithubRepoProgress(repoInput: string): Promise<RepoProgressSnapshot> {
  const target = normalizeGithubTarget(repoInput);
  if (target.type !== "repo" || !target.value) {
    throw new Error("Use a public GitHub repository URL or owner/repo for proof tracking.");
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${target.value}`);
  if (!repoResponse.ok) {
    throw new Error(`GitHub returned ${repoResponse.status} for ${target.value}. Check that the proof repo is public.`);
  }

  const repo = await repoResponse.json();
  const branchResponse = await fetch(`https://api.github.com/repos/${repo.full_name}/branches/${repo.default_branch}`);
  const commitsResponse = await fetch(`https://api.github.com/repos/${repo.full_name}/commits?sha=${repo.default_branch}&per_page=1`);
  const branch = branchResponse.ok ? await branchResponse.json() : null;

  return {
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    defaultBranchSha: branch?.commit?.sha ?? repo.pushed_at,
    commitCount: countCommits(commitsResponse),
    pushedAt: repo.pushed_at,
    checkedAt: new Date().toISOString(),
  };
}

type GithubRepo = {
  full_name: string;
  name: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  topics?: string[];
  html_url: string;
  default_branch?: string;
  pushed_at?: string;
  updated_at?: string;
  fork?: boolean;
  archived?: boolean;
};

type RepoEvidence = {
  digest: string;
  detail: string;
  technologies: string[];
};

const githubJsonHeaders = {
  Accept: "application/vnd.github+json",
};

async function importSingleRepo(repo: string): Promise<EvidenceSource> {
  const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers: githubJsonHeaders });

  if (!repoResponse.ok) {
    throw new Error(`GitHub returned ${repoResponse.status} for ${repo}. Public repos work without a token.`);
  }

  const repoJson = await repoResponse.json() as GithubRepo;
  const evidence = await buildRepoEvidence(repoJson, {
    readmeLimit: 14000,
    maxManifestFiles: 6,
    maxSourceFiles: 4,
  });

  return {
    id: crypto.randomUUID(),
    type: "github",
    title: `${repoJson.full_name}`,
    url: repoJson.html_url,
    createdAt: new Date().toISOString(),
    content: [
      "GitHub evidence digest:",
      evidence.digest,
      "",
      "Detailed repository evidence:",
      evidence.detail,
    ].join("\n"),
  };
}

async function importGithubProfile(username: string): Promise<EvidenceSource> {
  const [userResponse, reposResponse] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`, { headers: githubJsonHeaders }),
    fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=30`, { headers: githubJsonHeaders }),
  ]);

  if (!userResponse.ok) {
    throw new Error(`GitHub returned ${userResponse.status} for user ${username}. Check that the profile is public.`);
  }
  if (!reposResponse.ok) {
    throw new Error(`GitHub returned ${reposResponse.status} while reading repos for ${username}.`);
  }

  const user = await userResponse.json();
  const repos = await reposResponse.json() as GithubRepo[];
  const selectedRepos = selectProfileRepos(repos).slice(0, 5);
  const repoEvidenceResults = await Promise.allSettled(
    selectedRepos.map((repo) => buildRepoEvidence(repo, {
      readmeLimit: 5200,
      maxManifestFiles: 3,
      maxSourceFiles: 1,
    })),
  );
  const repoEvidence = repoEvidenceResults
    .filter((result): result is PromiseFulfilledResult<RepoEvidence> => result.status === "fulfilled")
    .map((result) => result.value);
  const technologies = unique(repoEvidence.flatMap((item) => item.technologies)).slice(0, 18);

  return {
    id: crypto.randomUUID(),
    type: "github",
    title: `${user.login} GitHub profile`,
    url: user.html_url,
    createdAt: new Date().toISOString(),
    content: [
      "GitHub profile evidence digest:",
      `GitHub profile: ${user.name ?? user.login}`,
      `Username: ${user.login}`,
      `Bio: ${user.bio ?? "No bio"}`,
      `Public repos: ${user.public_repos}`,
      `Imported repositories for skill analysis: ${selectedRepos.map((repo) => repo.full_name).join(", ") || "None"}`,
      `Detected technologies across imported repos: ${technologies.join(", ") || "Not enough public repository metadata"}`,
      "",
      repoEvidence.map((item) => item.digest).join("\n"),
      "",
      "Detailed repository evidence:",
      repoEvidence.map((item) => item.detail).join("\n\n---\n\n"),
    ].filter(Boolean).join("\n"),
  };
}

async function buildRepoEvidence(
  repo: GithubRepo,
  options: { readmeLimit: number; maxManifestFiles: number; maxSourceFiles: number },
): Promise<RepoEvidence> {
  const branch = repo.default_branch || "main";
  const [languages, readme, treePaths, commits] = await Promise.all([
    fetchGithubJson<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`).catch(() => ({})),
    fetchGithubRaw(repo.full_name, "readme", branch).catch(() => ""),
    fetchGithubTree(repo.full_name, branch).catch(() => []),
    fetchGithubJson<Array<{ commit?: { message?: string } }>>(`https://api.github.com/repos/${repo.full_name}/commits?sha=${encodeURIComponent(branch)}&per_page=5`).catch(() => []),
  ]);
  const manifestPaths = selectManifestPaths(treePaths).slice(0, options.maxManifestFiles);
  const sourcePaths = selectSourcePaths(treePaths, manifestPaths).slice(0, options.maxSourceFiles);
  const [manifestFiles, sourceFiles] = await Promise.all([
    fetchGithubFiles(repo.full_name, branch, manifestPaths, 4200),
    fetchGithubFiles(repo.full_name, branch, sourcePaths, 1600),
  ]);
  const technologies = detectTechnologies(repo, languages, treePaths, manifestFiles, readme);
  const fileMap = summarizeFileMap(treePaths);
  const commitLines = commits
    .map((item) => cleanGithubText(item.commit?.message ?? "").split("\n")[0])
    .filter(Boolean)
    .slice(0, 5);
  const languageSummary = formatLanguages(languages);
  const digest = [
    `Repository evidence: ${repo.full_name}`,
    `Repository ${repo.full_name} description: ${repo.description || "No description"}`,
    `Repository ${repo.full_name} primary language: ${repo.language || "Not listed"}`,
    `Repository ${repo.full_name} languages by bytes: ${languageSummary}`,
    `Repository ${repo.full_name} detected technologies: ${technologies.join(", ") || "Not enough technology signals"}`,
    `Repository ${repo.full_name} topics: ${(repo.topics ?? []).join(", ") || "No topics"}`,
    `Repository ${repo.full_name} project files include: ${fileMap.featuredPaths.join(", ") || "No file map available"}`,
    manifestPaths.length ? `Repository ${repo.full_name} dependency or config files include: ${manifestPaths.join(", ")}` : "",
    commitLines.length ? `Repository ${repo.full_name} recent commit messages include: ${commitLines.join(" | ")}` : "",
  ].filter(Boolean).join("\n");
  const detail = [
    digest,
    "",
    `Repository URL: ${repo.html_url}`,
    `Stars: ${repo.stargazers_count ?? 0}`,
    `Forks: ${repo.forks_count ?? 0}`,
    `Open issues: ${repo.open_issues_count ?? 0}`,
    `Last pushed: ${repo.pushed_at ?? "Not listed"}`,
    `File type counts: ${fileMap.extensionSummary || "No source file counts available"}`,
    manifestFiles.length ? `Dependency and configuration excerpts:\n${formatGithubFiles(manifestFiles)}` : "",
    sourceFiles.length ? `Representative source file excerpts:\n${formatGithubFiles(sourceFiles)}` : "",
    readme ? `README excerpt:\n${cleanGithubText(readme).slice(0, options.readmeLimit)}` : "README unavailable.",
  ].filter(Boolean).join("\n");

  return { digest, detail, technologies };
}

function selectProfileRepos(repos: GithubRepo[]) {
  const usable = repos.filter((repo) => !repo.archived);
  const nonForks = usable.filter((repo) => !repo.fork);
  const pool = nonForks.length >= 3 ? nonForks : usable;
  return pool.sort((left, right) => repoEvidenceScore(right) - repoEvidenceScore(left));
}

function repoEvidenceScore(repo: GithubRepo) {
  const pushedTime = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const daysSincePush = pushedTime ? Math.max(0, (Date.now() - pushedTime) / 86_400_000) : 3650;
  const recencyScore = Math.max(0, 120 - daysSincePush);
  return (
    recencyScore +
    (repo.stargazers_count ?? 0) * 8 +
    (repo.description ? 22 : 0) +
    (repo.language ? 16 : 0) +
    ((repo.topics ?? []).length * 5) -
    (repo.fork ? 18 : 0)
  );
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: githubJsonHeaders });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${url}`);
  return response.json() as Promise<T>;
}

async function fetchGithubRaw(fullName: string, path: string, branch: string): Promise<string> {
  const url = path === "readme"
    ? `https://api.github.com/repos/${fullName}/readme`
    : `https://api.github.com/repos/${fullName}/contents/${encodeGithubPath(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: { Accept: "application/vnd.github.raw" } });
  if (!response.ok) throw new Error(`GitHub returned ${response.status} for ${fullName}/${path}`);
  return response.text();
}

async function fetchGithubTree(fullName: string, branch: string): Promise<string[]> {
  const data = await fetchGithubJson<{ tree?: Array<{ path?: string; type?: string }> }>(
    `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return (data.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => item.path as string)
    .filter((path) => !isGeneratedOrVendorPath(path))
    .slice(0, 650);
}

async function fetchGithubFiles(fullName: string, branch: string, paths: string[], limit: number) {
  const results = await Promise.allSettled(
    paths.map(async (path) => ({
      path,
      content: cleanGithubText(await fetchGithubRaw(fullName, path, branch)).slice(0, limit),
    })),
  );
  return results
    .filter((result): result is PromiseFulfilledResult<{ path: string; content: string }> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((file) => file.content.trim());
}

function selectManifestPaths(paths: string[]) {
  const manifestNames = new Set([
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "environment.yml",
    "environment.yaml",
    "setup.py",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "composer.json",
    "Gemfile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "firebase.json",
    "supabase.toml",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
  ]);
  return paths
    .filter((path) => manifestNames.has(path.split("/").pop() ?? "") || /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path))
    .sort((left, right) => manifestPriority(left) - manifestPriority(right));
}

function selectSourcePaths(paths: string[], manifestPaths: string[]) {
  const manifestSet = new Set(manifestPaths);
  return paths
    .filter((path) => !manifestSet.has(path))
    .filter((path) => /\.(tsx?|jsx?|py|ipynb|go|rs|java|kt|swift|php|rb|cs)$/i.test(path))
    .sort((left, right) => sourcePriority(left) - sourcePriority(right));
}

function manifestPriority(path: string) {
  const file = path.split("/").pop()?.toLowerCase() ?? "";
  const order = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "cargo.toml", "dockerfile"];
  const index = order.indexOf(file);
  return (index === -1 ? 99 : index) + path.split("/").length;
}

function sourcePriority(path: string) {
  const normalized = path.toLowerCase();
  const preferred = [
    "src/app.tsx",
    "src/main.tsx",
    "app/page.tsx",
    "pages/index.tsx",
    "server.ts",
    "server.js",
    "main.py",
    "app.py",
    "src/main.py",
    "index.ts",
    "index.js",
  ];
  const direct = preferred.indexOf(normalized);
  if (direct >= 0) return direct;
  if (/\/(app|main|index|server|route)\.(tsx?|jsx?|py)$/i.test(path)) return 20;
  if (path.startsWith("src/")) return 35;
  return 70 + path.split("/").length;
}

function summarizeFileMap(paths: string[]) {
  const featuredPaths = paths
    .filter((path) => /\.(tsx?|jsx?|py|ipynb|go|rs|java|kt|swift|php|rb|cs|html|css|scss|sql|ya?ml|json|toml)$/i.test(path))
    .slice(0, 42);
  const counts = new Map<string, number>();
  paths.forEach((path) => {
    const extension = path.includes(".") ? path.split(".").pop()?.toLowerCase() ?? "file" : "file";
    if (extension.length > 8) return;
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  });
  const extensionSummary = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([extension, count]) => `${extension}:${count}`)
    .join(", ");
  return { featuredPaths, extensionSummary };
}

function detectTechnologies(
  repo: GithubRepo,
  languages: Record<string, number>,
  paths: string[],
  files: Array<{ path: string; content: string }>,
  readme: string,
) {
  const signals = new Set<string>();
  Object.keys(languages).forEach((language) => signals.add(language));
  if (repo.language) signals.add(repo.language);
  (repo.topics ?? []).forEach((topic) => signals.add(topic));

  const joinedFiles = `${files.map((file) => `${file.path}\n${file.content}`).join("\n")}\n${readme}`.toLowerCase();
  const pathText = paths.join("\n").toLowerCase();
  const signalMap: Array<[RegExp, string]> = [
    [/\breact\b|\.tsx\b|jsx\b/, "React"],
    [/\bnext\b|next\.config/, "Next.js"],
    [/\bvite\b|vite\.config/, "Vite"],
    [/\btypescript\b|\.ts\b|\.tsx\b/, "TypeScript"],
    [/\bnode\b|\bexpress\b|server\.js|server\.ts/, "Node.js"],
    [/\bopenai\b|\bllm\b|\brag\b|\bembedding\b/, "AI integration"],
    [/\bpython\b|\.py\b|requirements\.txt|pyproject\.toml/, "Python"],
    [/\bpandas\b|\bnumpy\b|\bscikit-learn\b|\bsklearn\b/, "Data science"],
    [/\bfastapi\b|\bflask\b|\bdjango\b/, "Python web API"],
    [/\bpytorch\b|\btorch\b|\btensorflow\b|\bkeras\b/, "Machine learning"],
    [/\bsql\b|postgres|sqlite|mysql|prisma|supabase/, "Databases"],
    [/\bdocker\b|dockerfile|docker-compose/, "Docker"],
    [/\.github\/workflows|github actions/, "CI/CD"],
    [/\bplaywright\b|\bcypress\b|\bjest\b|\bvitest\b/, "Testing"],
    [/\btailwind\b|shadcn|css\b/, "UI styling"],
    [/\bunity\b|godot|unreal/, "Game development"],
    [/\bsolidity\b|hardhat|web3/, "Blockchain"],
  ];
  signalMap.forEach(([pattern, label]) => {
    if (pattern.test(joinedFiles) || pattern.test(pathText)) signals.add(label);
  });
  return unique(Array.from(signals).map((value) => cleanGithubText(value)).filter(Boolean)).slice(0, 24);
}

function formatLanguages(languages: Record<string, number>) {
  const entries = Object.entries(languages).sort((left, right) => right[1] - left[1]);
  if (!entries.length) return "No language data";
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  return entries
    .slice(0, 8)
    .map(([language, bytes]) => `${language} ${Math.round((bytes / total) * 100)}%`)
    .join(", ");
}

function formatGithubFiles(files: Array<{ path: string; content: string }>) {
  return files.map((file) => `File: ${file.path}\n${file.content}`).join("\n\n");
}

function encodeGithubPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function isGeneratedOrVendorPath(path: string) {
  return /(^|\/)(node_modules|dist|build|coverage|vendor|\.next|\.nuxt|target|bin|obj|__pycache__|\.git)(\/|$)/i.test(path)
    || /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mov|avi|mp3|wav|woff2?|ttf|eot|lock)$/i.test(path);
}

function cleanGithubText(value: string) {
  return value.replace(/\r/g, "").replace(/\t/g, "  ").replace(/\n{4,}/g, "\n\n\n").trim();
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function parseOpportunityText(raw: string): OpportunityInput[] {
  return raw
    .split(/\n-{3,}\n|\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const first = lines[0] ?? "Untitled opportunity";
      const [title, organization = "Unknown organization"] = first.includes("@")
        ? first.split("@").map((part) => part.trim())
        : [first, "Unknown organization"];
      const url = lines.find((line) => /^https?:\/\//i.test(line));
      return {
        id: crypto.randomUUID(),
        title,
        organization,
        url,
        description: lines.slice(1).join("\n") || block,
      };
    });
}

async function parsePdf(file: File) {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const textContent = await page.getTextContent();
    pages.push(textContent.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n\n");
}

function normalizeGithubTarget(input: string): { type: "repo" | "user"; value: string } {
  const trimmed = input.trim();
  const githubMatch = trimmed.match(/github\.com\/([^/\s#?]+)(?:\/([^/\s#?]+))?/i);
  if (githubMatch?.[2]) {
    return { type: "repo", value: `${githubMatch[1]}/${githubMatch[2].replace(/\.git$/, "")}` };
  }
  if (githubMatch?.[1]) {
    return { type: "user", value: githubMatch[1] };
  }
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) {
    return { type: "repo", value: `${shortMatch[1]}/${shortMatch[2].replace(/\.git$/, "")}` };
  }
  const usernameMatch = trimmed.match(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
  return usernameMatch ? { type: "user", value: trimmed } : { type: "user", value: "" };
}

function countCommits(response: Response) {
  if (!response.ok) return 0;
  const link = response.headers.get("Link") ?? "";
  const lastPage = link.match(/[?&]page=(\d+)>;\s*rel="last"/)?.[1];
  return lastPage ? Number(lastPage) : 1;
}
