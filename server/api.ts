import type { IncomingMessage, ServerResponse } from "node:http";

type ApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  description: string;
  postedAt?: string;
};

type JobProvider = {
  provider: string;
  searchUrl: string;
  search: () => Promise<Job[]>;
};

export function jobSearchApi() {
  const handler: ApiHandler = async (request, response) => {
        const requestUrl = new URL(request.url ?? "", "http://localhost");
        const query = requestUrl.searchParams.get("q") || "AI Engineer Intern";
        const country = requestUrl.searchParams.get("country") || requestUrl.searchParams.get("location") || "Singapore";

        try {
          const providers: JobProvider[] = [
            {
              provider: "LinkedIn",
              searchUrl: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(country)}`,
              search: () => searchLinkedIn(query, country),
            },
            {
              provider: "JobStreet",
              searchUrl: jobStreetSearchUrl(query, country),
              search: () => searchJobStreet(query, country),
            },
            {
              provider: "FastJobs",
              searchUrl: fastJobsSearchUrl(query),
              search: () => searchFastJobs(query, country),
            },
            {
              provider: "Indeed",
              searchUrl: indeedSearchUrl(query, country),
              search: () => searchIndeed(query, country),
            },
            {
              provider: "Remotive",
              searchUrl: `https://remotive.com/remote-jobs/search?search=${encodeURIComponent(query)}`,
              search: () => searchRemotive(query),
            },
            {
              provider: "Arbeitnow",
              searchUrl: `https://www.arbeitnow.com/jobs?search=${encodeURIComponent(query)}`,
              search: () => searchArbeitnow(query, country),
            },
            {
              provider: "RemoteOK",
              searchUrl: `https://remoteok.com/remote-${slug(query)}-jobs`,
              search: () => searchRemoteOk(query),
            },
            {
              provider: "Himalayas",
              searchUrl: `https://himalayas.app/jobs?query=${encodeURIComponent(query)}`,
              search: () => searchHimalayas(query),
            },
          ];
          const settled = await Promise.allSettled(providers.map((provider) => provider.search()));
          const providerStatus = settled.map((result, index) => {
            const jobs = result.status === "fulfilled" ? result.value : [];
            const countryJobs = jobs.filter((job) => locationMatchesCountry(job.location, country));
            const provider = providers[index];
            return {
              provider: provider.provider,
              ok: result.status === "fulfilled",
              count: countryJobs.length,
              rawCount: jobs.length,
              error: result.status === "rejected" ? cleanProviderError(result.reason) : undefined,
              searchUrl: provider.searchUrl,
            };
          });
          const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
            .filter((job) => locationMatchesCountry(job.location, country));
          const uniqueJobs = dedupeJobs(jobs).slice(0, 60);

          json(response, {
            jobs: uniqueJobs,
            providerStatus,
            country,
          });
        } catch (error) {
          response.statusCode = 500;
          json(response, { error: error instanceof Error ? error.message : "Job search failed." });
        }
      };

  return {
    name: "job-search-api",
    handler,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/jobs", handler);
    },
  };
}

export function youtubeSearchApi() {
  const handler: ApiHandler = async (request, response) => {
        const requestUrl = new URL(request.url ?? "", "http://localhost");
        const query = requestUrl.searchParams.get("q")?.trim();
        if (!query) {
          response.statusCode = 400;
          json(response, { error: "q is required." });
          return;
        }

        try {
          const video = await findVerifiedYoutubeVideo(query);
          if (!video) {
            response.statusCode = 404;
            json(response, { error: "No verified YouTube video found." });
            return;
          }
          json(response, { video });
        } catch (error) {
          response.statusCode = 500;
          json(response, { error: error instanceof Error ? error.message : "YouTube search failed." });
        }
      };

  return {
    name: "youtube-search-api",
    handler,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/youtube", handler);
    },
  };
}

export function githubImportApi(env: Record<string, string>) {
  const handler: ApiHandler = async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      json(response, { error: "POST required." });
      return;
    }

    try {
      const body = await readJson(request);
      const targetInput = typeof body.target === "string" ? body.target : "";
      const target = normalizeGithubTarget(targetInput);
      if (!target.value) {
        response.statusCode = 400;
        json(response, { error: "Enter a GitHub profile, repo URL, username, or owner/repo." });
        return;
      }

      const token = (env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || "").trim();
      const source = target.type === "repo"
        ? await importGithubRepoEvidence(target.value, token)
        : await importGithubProfileEvidence(target.value, token);
      json(response, { source });
    } catch (error) {
      const status = error instanceof GithubApiError ? error.status : 500;
      response.statusCode = status;
      json(response, { error: error instanceof Error ? error.message : "GitHub import failed." });
    }
  };

  return {
    name: "github-import-api",
    handler,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/github/import", handler);
    },
  };
}

type VerifiedYoutubeVideo = {
  id: string;
  title: string;
  url: string;
  authorName?: string;
};

async function findVerifiedYoutubeVideo(query: string): Promise<VerifiedYoutubeVideo | null> {
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  const ids = unique([...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((match) => match[1])).slice(0, 18);

  for (const id of ids) {
    const verified = await verifyYoutubeVideo(id);
    if (verified) return verified;
  }

  return null;
}

async function verifyYoutubeVideo(id: string): Promise<VerifiedYoutubeVideo | null> {
  const url = `https://www.youtube.com/watch?v=${id}`;
  const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
    headers: { "User-Agent": "Mozilla/5.0 SparkPath/1.0" },
  });
  if (!response.ok) return null;

  const data = await response.json();
  if (typeof data.title !== "string" || !data.title.trim()) return null;

  return {
    id,
    title: strip(data.title),
    url,
    authorName: typeof data.author_name === "string" ? strip(data.author_name) : undefined,
  };
}

export function aiApi(env: Record<string, string>) {
  const handler: ApiHandler = async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      json(response, { error: "POST required." });
      return;
    }

    const apiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const apiUrl = env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
    const model = env.OPENAI_MODEL || "gpt-5-nano";
    const maxOutputTokens = positiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS, 1800);
    const reasoningEffort = normalizeReasoningEffort(env.OPENAI_REASONING_EFFORT);
    const researchModel = env.OPENAI_RESEARCH_MODEL || "gpt-5.5";
    const researchMaxOutputTokens = positiveInteger(env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS, 5000);
    const researchReasoningEffort = normalizeResearchReasoningEffort(env.OPENAI_RESEARCH_REASONING_EFFORT);

    if (!apiKey) {
      response.statusCode = 500;
      json(response, { error: "OPENAI_API_KEY is missing. Add it to the server environment and restart the service." });
      return;
    }

    try {
      const body = await readJson(request);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (!messages.length) {
        response.statusCode = 400;
        json(response, { error: "messages[] is required." });
        return;
      }

      const responseFormat = normalizeResponseFormat(body.responseFormat);
      const webSearch = body.webSearch === true;
      const requestedMaxOutputTokens = boundedPositiveInteger(body.maxOutputTokens, 12000);
      const outputTokenBudget = requestedMaxOutputTokens ?? (webSearch ? researchMaxOutputTokens : maxOutputTokens);
      const upstream = await callOpenAiProvider(apiUrl, apiKey, {
        model: webSearch ? researchModel : model,
        instructions: messagesToOpenAiInstructions(messages),
        input: messagesToOpenAiInput(messages),
        max_output_tokens: outputTokenBudget,
        reasoning: { effort: webSearch ? researchReasoningEffort : reasoningEffort },
        ...(webSearch ? {
          tools: [{
            type: "web_search",
            search_context_size: "high",
            external_web_access: true,
            filters: {
              blocked_domains: ["reddit.com", "quora.com", "pinterest.com", "wikipedia.org", "wikihow.com"],
            },
          }],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
        } : {}),
        ...(responseFormat ? { text: responseFormat } : {}),
      });

      if (!upstream.ok) {
        response.statusCode = upstream.status;
        json(response, { error: openAiErrorMessage(upstream.text, upstream.status) });
        return;
      }

      const content = parseOpenAiResponseContent(upstream.text);
      const sources = webSearch ? parseOpenAiResponseSources(upstream.text) : [];
      json(response, { content, sources });
    } catch (error) {
      response.statusCode = 500;
      json(response, { error: error instanceof Error ? error.message : "AI request failed." });
    }
  };

  return {
    name: "openai-api",
    handler,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/ai", handler);
    },
  };
}

type OpenAiProviderPayload = {
  model: string;
  instructions?: string;
  input: OpenAiInputMessage[];
  max_output_tokens: number;
  reasoning?: { effort: "minimal" | "low" | "medium" | "high" };
  text?: OpenAiTextFormat;
  tools?: Array<{
    type: "web_search";
    search_context_size: "high";
    external_web_access: true;
    filters: { blocked_domains: string[] };
  }>;
  tool_choice?: "required";
  include?: string[];
};

type OpenAiTextFormat = {
  format: {
    type: "json_schema";
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
};

type AiProviderResult = {
  ok: boolean;
  status: number;
  text: string;
};

type OpenAiInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

type OpenAiInputMessage = {
  role: "user";
  content: OpenAiInputContent[];
};

async function callOpenAiProvider(apiUrl: string, apiKey: string, payload: OpenAiProviderPayload): Promise<AiProviderResult> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

type GithubEvidenceSource = {
  id: string;
  type: "github";
  title: string;
  content: string;
  url?: string;
  trustLevel: "platform_verified";
  trustReason: string;
  createdAt: string;
};

type GithubTarget = {
  type: "repo" | "user";
  value: string;
};

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

type GithubUser = {
  login: string;
  name?: string | null;
  bio?: string | null;
  public_repos?: number;
  followers?: number;
  html_url: string;
};

type GithubFile = {
  path: string;
  content: string;
};

type GithubRepoEvidence = {
  digest: string;
  detail: string;
  technologies: string[];
};

type GithubPageResult<T> = {
  items: T[];
  truncated: boolean;
};

const githubProfileDetailRepoLimit = 10;
const githubProfileRepoPageLimit = 5;

class GithubApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function importGithubRepoEvidence(repo: string, token: string): Promise<GithubEvidenceSource> {
  const repoJson = await githubJson<GithubRepo>(`https://api.github.com/repos/${repo}`, token, repo);
  const evidence = await buildGithubRepoEvidence(repoJson, token, {
    readmeLimit: 14000,
    maxManifestFiles: 6,
    maxSourceFiles: 4,
  });

  return {
    id: crypto.randomUUID(),
    type: "github",
    title: repoJson.full_name,
    url: repoJson.html_url,
    trustLevel: "platform_verified",
    trustReason: "SparkPath pulled repository metadata and content directly from GitHub.",
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

async function importGithubProfileEvidence(username: string, token: string): Promise<GithubEvidenceSource> {
  const [user, repoPages] = await Promise.all([
    githubJson<GithubUser>(`https://api.github.com/users/${username}`, token, `user ${username}`),
    githubPagedJson<GithubRepo>(
      `https://api.github.com/users/${username}/repos?sort=updated&per_page=100`,
      token,
      `repos for ${username}`,
      githubProfileRepoPageLimit,
    ),
  ]);
  const repos = repoPages.items;
  const selectedRepos = selectGithubProfileRepos(repos).slice(0, githubProfileDetailRepoLimit);
  const repoEvidenceResults = await Promise.allSettled(
    selectedRepos.map((repo) => buildGithubRepoEvidence(repo, token, {
      readmeLimit: 5200,
      maxManifestFiles: 3,
      maxSourceFiles: 1,
    })),
  );
  const repoEvidence = repoEvidenceResults
    .filter((result): result is PromiseFulfilledResult<GithubRepoEvidence> => result.status === "fulfilled")
    .map((result) => result.value);
  const technologies = unique(repoEvidence.flatMap((item) => item.technologies)).slice(0, 18);

  return {
    id: crypto.randomUUID(),
    type: "github",
    title: `${user.login} GitHub profile`,
    url: user.html_url,
    trustLevel: "platform_verified",
    trustReason: "SparkPath pulled the public profile and repository evidence directly from GitHub.",
    createdAt: new Date().toISOString(),
    content: [
      "GitHub profile evidence digest:",
      `GitHub profile: ${user.name ?? user.login}`,
      `Username: ${user.login}`,
      `Bio: ${user.bio ?? "No bio"}`,
      `Public repos: ${user.public_repos ?? 0}`,
      `Imported detailed repositories for AI skill analysis: ${selectedRepos.map((repo) => repo.full_name).join(", ") || "None"}`,
      `Detected technologies across imported repos: ${technologies.join(", ") || "Not enough public repository metadata"}`,
      "",
      repoEvidence.map((item) => item.digest).join("\n"),
      "",
      "Public repository inventory:",
      formatGithubRepoInventory(repos, user.public_repos, repoPages.truncated),
      "",
      "Detailed repository evidence:",
      repoEvidence.map((item) => item.detail).join("\n\n---\n\n"),
    ].filter(Boolean).join("\n"),
  };
}

async function buildGithubRepoEvidence(
  repo: GithubRepo,
  token: string,
  options: { readmeLimit: number; maxManifestFiles: number; maxSourceFiles: number },
): Promise<GithubRepoEvidence> {
  const branch = repo.default_branch || "main";
  const [languages, readme, treePaths, commits] = await Promise.all([
    githubJson<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`, token, `${repo.full_name} languages`).catch(() => ({})),
    githubRaw(repo.full_name, "readme", branch, token).catch(() => ""),
    githubTree(repo.full_name, branch, token).catch(() => []),
    githubJson<Array<{ commit?: { message?: string } }>>(`https://api.github.com/repos/${repo.full_name}/commits?sha=${encodeURIComponent(branch)}&per_page=5`, token, `${repo.full_name} commits`).catch(() => []),
  ]);
  const manifestPaths = selectGithubManifestPaths(treePaths).slice(0, options.maxManifestFiles);
  const sourcePaths = selectGithubSourcePaths(treePaths, manifestPaths).slice(0, options.maxSourceFiles);
  const [manifestFiles, sourceFiles] = await Promise.all([
    githubFiles(repo.full_name, branch, manifestPaths, token, 4200),
    githubFiles(repo.full_name, branch, sourcePaths, token, 1600),
  ]);
  const technologies = detectGithubTechnologies(repo, languages, treePaths, manifestFiles, readme);
  const fileMap = summarizeGithubFileMap(treePaths);
  const readmeSummary = summarizeGithubReadme(readme);
  const commitLines = commits
    .map((item) => cleanGithubText(item.commit?.message ?? "").split("\n")[0])
    .filter(Boolean)
    .slice(0, 5);
  const digest = [
    `Repository evidence: ${repo.full_name}`,
    `Repository ${repo.full_name} description: ${repo.description || "No description"}`,
    `Repository ${repo.full_name} primary language: ${repo.language || "Not listed"}`,
    `Repository ${repo.full_name} languages by bytes: ${formatGithubLanguages(languages)}`,
    `Repository ${repo.full_name} detected technologies: ${technologies.join(", ") || "Not enough technology signals"}`,
    readmeSummary ? `Repository ${repo.full_name} README says: ${readmeSummary}` : `Repository ${repo.full_name} README: unavailable`,
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
    manifestFiles.length ? `Dependency and configuration excerpts:\n${formatGithubFileExcerpts(manifestFiles)}` : "",
    sourceFiles.length ? `Representative source file excerpts:\n${formatGithubFileExcerpts(sourceFiles)}` : "",
    readme ? `README excerpt:\n${cleanGithubText(readme).slice(0, options.readmeLimit)}` : "README unavailable.",
  ].filter(Boolean).join("\n");

  return { digest, detail, technologies };
}

async function githubJson<T>(url: string, token: string, label: string): Promise<T> {
  const { data } = await githubJsonWithResponse<T>(url, token, label);
  return data;
}

async function githubJsonWithResponse<T>(url: string, token: string, label: string): Promise<{ data: T; response: Response }> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) throw await githubError(response, label);
  return { data: await response.json() as T, response };
}

async function githubPagedJson<T>(url: string, token: string, label: string, maxPages: number): Promise<GithubPageResult<T>> {
  const items: T[] = [];
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const pageUrl = `${url}${url.includes("?") ? "&" : "?"}page=${page}`;
    const { data, response } = await githubJsonWithResponse<T[]>(pageUrl, token, `${label} page ${page}`);
    items.push(...data);

    const hasNextPage = /rel="next"/i.test(response.headers.get("link") ?? "");
    if (!hasNextPage) return { items, truncated };
    truncated = page === maxPages;
  }

  return { items, truncated };
}

async function githubRaw(fullName: string, path: string, branch: string, token: string): Promise<string> {
  const url = path === "readme"
    ? `https://api.github.com/repos/${fullName}/readme`
    : `https://api.github.com/repos/${fullName}/contents/${encodeGithubPath(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(url, { headers: githubHeaders(token, "application/vnd.github.raw") });
  if (!response.ok) throw await githubError(response, `${fullName}/${path}`);
  return response.text();
}

async function githubTree(fullName: string, branch: string, token: string): Promise<string[]> {
  const data = await githubJson<{ tree?: Array<{ path?: string; type?: string }> }>(
    `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token,
    `${fullName} file tree`,
  );
  return (data.tree ?? [])
    .filter((item) => item.type === "blob" && item.path)
    .map((item) => item.path as string)
    .filter((path) => !isGeneratedOrVendorPath(path))
    .slice(0, 650);
}

async function githubFiles(fullName: string, branch: string, paths: string[], token: string, limit: number): Promise<GithubFile[]> {
  const results = await Promise.allSettled(
    paths.map(async (path) => ({
      path,
      content: cleanGithubText(await githubRaw(fullName, path, branch, token)).slice(0, limit),
    })),
  );
  return results
    .filter((result): result is PromiseFulfilledResult<GithubFile> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((file) => file.content.trim());
}

function githubHeaders(token: string, accept = "application/vnd.github+json") {
  return {
    Accept: accept,
    "User-Agent": "SparkPath/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubError(response: Response, label: string) {
  const body = await response.json().catch(() => ({}));
  const message = typeof body.message === "string" ? body.message : "";
  const remaining = response.headers.get("x-ratelimit-remaining");
  const reset = response.headers.get("x-ratelimit-reset");
  const resetText = reset ? ` Reset: ${new Date(Number(reset) * 1000).toLocaleString()}.` : "";

  if (response.status === 403 && (remaining === "0" || /rate limit/i.test(message))) {
    return new GithubApiError(
      429,
      `GitHub API rate limit exceeded while reading ${label}.${resetText} Add GITHUB_TOKEN in Render/local .env and redeploy, or wait for the limit to reset.`,
    );
  }
  if (response.status === 404) {
    return new GithubApiError(404, `GitHub could not find ${label}. Check that the profile or repo is public and spelled correctly.`);
  }
  if (response.status === 401) {
    return new GithubApiError(401, "GitHub token was rejected. Replace GITHUB_TOKEN with a valid fine-grained token that can read public repositories.");
  }
  if (response.status === 403) {
    return new GithubApiError(403, `GitHub denied access while reading ${label}. ${message || "If this keeps happening, add or replace GITHUB_TOKEN."}`);
  }
  return new GithubApiError(response.status, `GitHub returned ${response.status} while reading ${label}. ${message}`);
}

function normalizeGithubTarget(input: string): GithubTarget {
  const trimmed = input.trim();
  const githubMatch = trimmed.match(/github\.com\/([^/\s#?]+)(?:\/([^/\s#?]+))?/i);
  if (githubMatch?.[2]) {
    return { type: "repo", value: `${githubMatch[1]}/${githubMatch[2].replace(/\.git$/, "")}` };
  }
  if (githubMatch?.[1]) return { type: "user", value: githubMatch[1] };
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { type: "repo", value: `${shortMatch[1]}/${shortMatch[2].replace(/\.git$/, "")}` };
  const usernameMatch = trimmed.match(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i);
  return usernameMatch ? { type: "user", value: trimmed } : { type: "user", value: "" };
}

function selectGithubProfileRepos(repos: GithubRepo[]) {
  const usable = repos.filter((repo) => !repo.archived);
  const nonForks = usable.filter((repo) => !repo.fork);
  const pool = nonForks.length >= 3 ? nonForks : usable;
  return [...pool].sort((left, right) => githubRepoEvidenceScore(right) - githubRepoEvidenceScore(left));
}

function githubRepoEvidenceScore(repo: GithubRepo) {
  const pushedTime = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const daysSincePush = pushedTime ? Math.max(0, (Date.now() - pushedTime) / 86_400_000) : 3650;
  const recencyScore = Math.max(0, 120 - daysSincePush);
  return recencyScore + (repo.stargazers_count ?? 0) * 8 + (repo.description ? 22 : 0) + (repo.language ? 16 : 0) + ((repo.topics ?? []).length * 5) - (repo.fork ? 18 : 0);
}

function formatGithubRepoInventory(repos: GithubRepo[], publicRepoCount = repos.length, truncated = false) {
  const sortedRepos = [...repos].sort((left, right) => {
    const leftTime = left.pushed_at || left.updated_at || "";
    const rightTime = right.pushed_at || right.updated_at || "";
    return rightTime.localeCompare(leftTime);
  });
  const heading = [
    `Loaded ${repos.length} of ${publicRepoCount} public repos.`,
    truncated ? `Repo pagination stopped after ${githubProfileRepoPageLimit} pages to avoid excessive GitHub API usage.` : "",
  ].filter(Boolean).join(" ");
  const lines = sortedRepos.map((repo) => {
    const flags = [repo.fork ? "fork" : "", repo.archived ? "archived" : ""].filter(Boolean).join(", ");
    const description = truncateGithubText(repo.description || "No description", 150);
    const topics = truncateGithubText((repo.topics ?? []).join(", ") || "none", 100);
    return `- ${repo.full_name}${flags ? ` (${flags})` : ""}: ${description}; language ${repo.language || "not listed"}; topics ${topics}; last pushed ${repo.pushed_at ?? "not listed"}`;
  });
  return [heading, ...lines].join("\n");
}

function selectGithubManifestPaths(paths: string[]) {
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
    .sort((left, right) => githubManifestPriority(left) - githubManifestPriority(right));
}

function selectGithubSourcePaths(paths: string[], manifestPaths: string[]) {
  const manifestSet = new Set(manifestPaths);
  return paths
    .filter((path) => !manifestSet.has(path))
    .filter((path) => /\.(tsx?|jsx?|py|ipynb|go|rs|java|kt|swift|php|rb|cs)$/i.test(path))
    .sort((left, right) => githubSourcePriority(left) - githubSourcePriority(right));
}

function githubManifestPriority(path: string) {
  const file = path.split("/").pop()?.toLowerCase() ?? "";
  const order = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "cargo.toml", "dockerfile"];
  const index = order.indexOf(file);
  return (index === -1 ? 99 : index) + path.split("/").length;
}

function githubSourcePriority(path: string) {
  const normalized = path.toLowerCase();
  const preferred = ["src/app.tsx", "src/main.tsx", "app/page.tsx", "pages/index.tsx", "server.ts", "server.js", "main.py", "app.py", "src/main.py", "index.ts", "index.js"];
  const direct = preferred.indexOf(normalized);
  if (direct >= 0) return direct;
  if (/\/(app|main|index|server|route)\.(tsx?|jsx?|py)$/i.test(path)) return 20;
  if (path.startsWith("src/")) return 35;
  return 70 + path.split("/").length;
}

function summarizeGithubFileMap(paths: string[]) {
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

function detectGithubTechnologies(repo: GithubRepo, languages: Record<string, number>, paths: string[], files: GithubFile[], readme: string) {
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

function formatGithubLanguages(languages: Record<string, number>) {
  const entries = Object.entries(languages).sort((left, right) => right[1] - left[1]);
  if (!entries.length) return "No language data";
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0) || 1;
  return entries.slice(0, 8).map(([language, bytes]) => `${language} ${Math.round((bytes / total) * 100)}%`).join(", ");
}

function formatGithubFileExcerpts(files: GithubFile[]) {
  return files.map((file) => `File: ${file.path}\n${file.content}`).join("\n\n");
}

function summarizeGithubReadme(readme: string) {
  const lines = cleanGithubText(readme)
    .split("\n")
    .map((line) => stripGithubMarkdown(line).trim())
    .filter((line) => line && !isGithubBadgeOrDecoration(line));
  return truncateGithubText(lines.slice(0, 6).join(" "), 620);
}

function stripGithubMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, " ");
}

function isGithubBadgeOrDecoration(value: string) {
  return /^[-=*_#\s]+$/.test(value)
    || /^badge:/i.test(value)
    || /shields\.io|badgen\.net|github\/workflows|travis-ci|circleci|codecov/i.test(value);
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

function truncateGithubText(value: string, maxLength: number) {
  const cleaned = cleanGithubText(value).replace(/\s+/g, " ");
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

async function searchLinkedIn(query: string, location: string): Promise<Job[]> {
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(query)}&location=${encodeURIComponent(location)}&start=0`;
  const html = await fetchText(url);
  return html
    .split(/<li>/g)
    .slice(1)
    .map((block, index) => {
      const title = strip(extract(block, /base-search-card__title[^>]*>([\s\S]*?)<\/h3>/));
      const company = strip(extract(block, /base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/));
      const jobUrl = decodeHtml(extract(block, /base-card__full-link[^>]*href="([^"]+)"/));
      const place = strip(extract(block, /job-search-card__location[^>]*>([\s\S]*?)<\/span>/));
      const postedAt = extract(block, /datetime="([^"]+)"/);
      if (!title || !company || !jobUrl) return null;
      return {
        id: `linkedin-${index}-${jobUrl}`,
        title,
        company,
        location: place,
        source: "LinkedIn",
        url: jobUrl,
        description: `${title} at ${company}. LinkedIn listing summary. Open the job page for the full description.`,
        postedAt,
      };
    })
    .filter(Boolean) as Job[];
}

async function searchJobStreet(query: string, country: string): Promise<Job[]> {
  try {
    const data = await fetchJson(jobStreetApiUrl(query, country));
    return (data.data ?? [])
      .slice(0, 25)
      .map((job: any) => {
        const id = String(job.id ?? "");
        const title = strip(String(job.title ?? ""));
        const company = strip(String(job.companyName ?? job.employer?.name ?? job.advertiser?.description ?? "Unknown company"));
        const location = Array.isArray(job.locations)
          ? job.locations.map((place: any) => strip(String(place.label ?? ""))).filter(Boolean).join(", ")
          : country;
        if (!id || !title) return null;
        return {
          id: `jobstreet-${id}`,
          title,
          company,
          location: location || country,
          source: "JobStreet",
          url: `https://sg.jobstreet.com/job/${id}`,
          description: strip(String(job.teaser ?? `${title} at ${company}.`)),
          postedAt: typeof job.listingDate === "string" ? job.listingDate : undefined,
        };
      })
      .filter(Boolean)
      .filter((job: Job) => locationMatchesCountry(job.location, country))
      .slice(0, 20) as Job[];
  } catch {
    const html = await fetchText(jobStreetSearchUrl(query, country));
    return parseJobStreetHtml(html, country);
  }
}

function parseJobStreetHtml(html: string, country: string): Job[] {
  const cards = [...html.matchAll(/<a href="([^"]+)"[^>]+data-automation="jobTitle"[^>]*>([\s\S]*?)<\/a>/g)]
    .slice(0, 25)
    .map((match, index) => {
      const href = decodeHtml(match[1]);
      const title = strip(match[2]);
      const tail = html.slice(match.index ?? 0, (match.index ?? 0) + 5000);
      const head = html.slice(Math.max(0, (match.index ?? 0) - 700), match.index ?? 0);
      const company = strip(extract(tail, /data-automation="jobCompany"[^>]*>([\s\S]*?)<\/a>/)) || "Unknown company";
      const locations = [...tail.matchAll(/data-automation="jobLocation"[^>]*>([\s\S]*?)<\/a>/g)]
        .map((match) => strip(match[1]))
        .filter(Boolean);
      const location = locations.join(", ") || strip(extract(tail, /data-automation="jobCardLocation"[^>]*>([\s\S]*?)<\/span>/)) || country;
      const listed = strip(extract(head + tail, /(Listed\s+[\s\S]{1,80}?ago)/i));
      if (!title || !href) return null;
      return {
        id: `jobstreet-${index}-${href}`,
        title,
        company,
        location,
        source: "JobStreet",
        url: href.startsWith("http") ? href : `https://sg.jobstreet.com${href}`,
        description: `${title} at ${company}. ${listed ? `${listed}. ` : ""}Open JobStreet for the full description.`,
      };
    })
    .filter(Boolean) as Job[];

  return cards.filter((job) => locationMatchesCountry(job.location, country)).slice(0, 20);
}

async function searchFastJobs(query: string, country: string): Promise<Job[]> {
  if (!locationMatchesCountry("Singapore", country)) return [];

  let jobs: Job[] = [];
  try {
    const html = await fetchText(fastJobsSearchUrl(query));
    jobs = parseFastJobsHtml(html);
    if (!jobs.length) {
      const markdown = await fetchTextViaReader(fastJobsSearchUrl(query));
      jobs = parseFastJobsMarkdown(markdown);
    }
  } catch {
    const markdown = await fetchTextViaReader(fastJobsSearchUrl(query));
    jobs = parseFastJobsMarkdown(markdown);
  }

  const terms = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2 || ["ai", "hr", "it"].includes(word));
  return jobs
    .filter((job) => fastJobsMatchesQuery(job, terms))
    .slice(0, 20);
}

function parseFastJobsHtml(html: string): Job[] {
  return [...html.matchAll(/<a href="([^"]+)" class="joblink"[\s\S]*?<\/a>/g)]
    .slice(0, 40)
    .map((match, index) => {
      const block = match[0];
      const title = strip(extract(block, /class="job-card__title">([\s\S]*?)<\/h3>/));
      const company = strip(extract(block, /alt="([^"]+)"/)) || "Unknown company";
      const location = normalizeFastJobsLocation(strip(extract(block, /class="joblocation-info">([\s\S]*?)<\/span>/)) || "Singapore");
      const description = strip(extract(block, /class="hidden-xs job-card__desc">([\s\S]*?)<\/p>/)) || `${title} at ${company}.`;
      const url = decodeHtml(match[1]);
      if (!title || !url) return null;
      return {
        id: `fastjobs-${index}-${url}`,
        title,
        company,
        location,
        source: "FastJobs",
        url,
        description,
      };
    })
    .filter(Boolean) as Job[];
}

function parseFastJobsMarkdown(markdown: string): Job[] {
  const seenUrls = new Set<string>();
  return [...markdown.matchAll(/\]\((https:\/\/www\.fastjobs\.sg\/singapore-job-ad\/[^)]+)\)/g)]
    .filter((match) => {
      if (seenUrls.has(match[1])) return false;
      seenUrls.add(match[1]);
      return true;
    })
    .slice(0, 60)
    .map((match, index) => {
      const end = match.index ?? 0;
      const start = markdown.lastIndexOf("[![Image", end);
      const block = markdown.slice(Math.max(0, start), end);
      const title = stripMarkdown(extract(block, /###\s+([\s\S]*?)(?:\s+Featured\b|\s+\*|\s+Last Updated|$)/)) || "FastJobs listing";
      const company = stripMarkdown(extract(block, /!\[Image\s+\d+:[^\]]*]\([^)]+\)\s*([^![\]]+?)\s+Last Updated/i)) || "Open FastJobs listing";
      const location = normalizeFastJobsLocation(stripMarkdown(extract(block, /\*\s+([^*]+?(?:Region|Singapore|others))\s+\*/i)) || "Singapore");
      const titleEnd = block.indexOf(" * ");
      const descriptionSource = titleEnd > -1 ? block.slice(0, titleEnd) : block;
      const description = stripMarkdown(descriptionSource.replace(/^[\s\S]*?###\s+/, "").replace(title, "")) || `${title} at ${company}.`;
      return {
        id: `fastjobs-reader-${index}-${match[1]}`,
        title,
        company,
        location,
        source: "FastJobs",
        url: decodeHtml(match[1]),
        description,
      };
    })
    .filter((job) => job.title !== "FastJobs listing");
}

function fastJobsMatchesQuery(job: Job, terms: string[]) {
  if (!terms.length) return true;
  const text = `${job.title} ${job.company} ${job.description}`.toLowerCase();
  const hits = terms.filter((term) => termAppears(text, term)).length;
  return hits >= (terms.length >= 3 ? 2 : 1);
}

function normalizeFastJobsLocation(location: string) {
  return /singapore/i.test(location) ? location : `${location}, Singapore`;
}

function termAppears(text: string, term: string) {
  if (term === "intern") return /\bintern(?:ship|s)?\b/.test(text);
  return new RegExp(`\\b${escapeRegExp(term)}\\w*\\b`, "i").test(text);
}

async function searchIndeed(query: string, country: string): Promise<Job[]> {
  const html = await fetchText(indeedSearchUrl(query, country)).catch(() => fetchTextViaReader(indeedSearchUrl(query, country)));
  if (/Security Check - Indeed\.com|captcha|Just a moment/i.test(html)) {
    throw new Error("Indeed returned a security check for automated fetching. Use the direct provider link.");
  }

  return [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*data-jk="([^"]+)"[\s\S]*?<\/a>/g)]
    .slice(0, 20)
    .map((match, index) => {
      const block = match[0];
      const title = strip(extract(block, /<span[^>]*title="([^"]+)"/) || extract(block, />([^<>]{4,160})<\/span>/));
      const url = decodeHtml(match[1]);
      if (!title) return null;
      return {
        id: `indeed-${match[2] || index}`,
        title,
        company: "Open Indeed listing",
        location: country,
        source: "Indeed",
        url: url.startsWith("http") ? url : `https://sg.indeed.com${url}`,
        description: `${title}. Open Indeed for company and full description.`,
      };
    })
    .filter(Boolean) as Job[];
}

async function searchRemotive(query: string): Promise<Job[]> {
  const data = await fetchJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}`);
  return (data.jobs ?? []).map((job: any) => ({
    id: `remotive-${job.id}`,
    title: job.title,
    company: job.company_name,
    location: job.candidate_required_location || "Remote",
    source: "Remotive",
    url: job.url,
    description: strip(job.description || ""),
    postedAt: job.publication_date,
  }));
}

async function searchArbeitnow(query: string, location: string): Promise<Job[]> {
  const data = await fetchJson("https://www.arbeitnow.com/api/job-board-api");
  const terms = `${query} ${location}`.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  return (data.data ?? [])
    .filter((job: any) => terms.some((term) => `${job.title} ${job.company_name} ${job.location} ${job.description}`.toLowerCase().includes(term)))
    .slice(0, 20)
    .map((job: any) => ({
      id: `arbeitnow-${job.slug}`,
      title: job.title,
      company: job.company_name,
      location: job.location || "Not listed",
      source: "Arbeitnow",
      url: job.url,
      description: strip(job.description || ""),
      postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : undefined,
    }));
}

async function searchRemoteOk(query: string): Promise<Job[]> {
  const data = await fetchJson("https://remoteok.com/api");
  const terms = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2);
  return data
    .slice(1)
    .filter((job: any) => terms.some((term) => `${job.position} ${job.company} ${job.description} ${(job.tags ?? []).join(" ")}`.toLowerCase().includes(term)))
    .slice(0, 20)
    .map((job: any) => ({
      id: `remoteok-${job.id}`,
      title: job.position,
      company: job.company,
      location: job.location || "Remote",
      source: "RemoteOK",
      url: job.url,
      description: strip(job.description || ""),
      postedAt: job.date,
    }));
}

async function searchHimalayas(query: string): Promise<Job[]> {
  const data = await fetchJson(`https://himalayas.app/jobs/api?query=${encodeURIComponent(query)}`);
  return (data.jobs ?? []).slice(0, 20).map((job: any) => ({
    id: `himalayas-${job.id || job.slug || job.title}`,
    title: job.title,
    company: job.companyName || job.company?.name || "Unknown company",
    location: job.location || job.locations?.join(", ") || "Remote",
    source: "Himalayas",
    url: job.applicationLink || job.url || `https://himalayas.app/jobs/${job.slug}`,
    description: strip(job.description || job.excerpt || ""),
    postedAt: job.pubDate || job.createdAt,
  }));
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: jobFetchHeaders() });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: jobFetchHeaders() });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchTextViaReader(url: string) {
  const readerUrl = `https://r.jina.ai/http://r.jina.ai/http://https://${url.replace(/^https?:\/\//, "")}`;
  const response = await fetch(readerUrl, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${url} reader fallback returned ${response.status}`);
  return response.text();
}

function jobFetchHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-SG,en;q=0.9",
  };
}

function dedupeJobs(jobs: Job[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.title}-${job.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function json(response: import("node:http").ServerResponse, body: unknown) {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function extract(value: string, pattern: RegExp) {
  return value.match(pattern)?.[1] ?? "";
}

function strip(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function stripMarkdown(value: string) {
  return strip(value
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/[#*_`>]+/g, " "));
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function jobStreetSearchUrl(query: string, country: string) {
  const location = slug(country) || "singapore";
  return `https://sg.jobstreet.com/${slug(query)}-jobs/in-${location}`;
}

function jobStreetApiUrl(query: string, country: string) {
  return `https://sg.jobstreet.com/api/jobsearch/v5/search?siteKey=SG-Main&keywords=${encodeURIComponent(query)}&where=${encodeURIComponent(country)}&page=1`;
}

function fastJobsSearchUrl(query: string) {
  return `https://www.fastjobs.sg/singapore-jobs/?q=${encodeURIComponent(query)}`;
}

function indeedSearchUrl(query: string, country: string) {
  return `https://sg.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(country)}`;
}

function locationMatchesCountry(location: string, country: string) {
  const wanted = normalizeLocation(country);
  if (!wanted) return true;

  const normalized = normalizeLocation(location);
  if (!normalized) return false;
  if (/\b(worldwide|anywhere|global|remote)\b/.test(normalized) && !normalized.includes(wanted)) {
    return false;
  }

  return countryAliases(wanted).some((alias) => tokenIncludes(normalized, alias));
}

function normalizeLocation(value: string) {
  return value.toLowerCase().replace(/&amp;/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenIncludes(value: string, token: string) {
  return new RegExp(`(^|\\s)${escapeRegExp(token)}(\\s|$)`, "i").test(value);
}

function countryAliases(country: string) {
  const aliases: Record<string, string[]> = {
    singapore: ["singapore", "sg"],
    malaysia: ["malaysia", "my", "kuala lumpur", "selangor", "penang"],
    indonesia: ["indonesia", "id", "jakarta", "bandung"],
    thailand: ["thailand", "th", "bangkok"],
    vietnam: ["vietnam", "vn", "ho chi minh", "hanoi"],
    philippines: ["philippines", "ph", "manila"],
    india: ["india", "in", "bengaluru", "bangalore", "mumbai", "delhi", "hyderabad"],
    australia: ["australia", "au", "sydney", "melbourne", "brisbane", "perth"],
    "united states": ["united states", "usa", "u s", "us", "america", "new york", "california", "san francisco", "seattle", "austin", "boston"],
    usa: ["united states", "usa", "u s", "us", "america", "new york", "california", "san francisco", "seattle", "austin", "boston"],
    "united kingdom": ["united kingdom", "uk", "u k", "england", "london", "manchester"],
    uk: ["united kingdom", "uk", "u k", "england", "london", "manchester"],
    canada: ["canada", "ca", "toronto", "vancouver", "montreal"],
    japan: ["japan", "jp", "tokyo", "osaka"],
    korea: ["korea", "kr", "seoul", "south korea"],
    "south korea": ["korea", "kr", "seoul", "south korea"],
    germany: ["germany", "de", "berlin", "munich", "hamburg"],
    france: ["france", "fr", "paris"],
    netherlands: ["netherlands", "nl", "amsterdam"],
  };
  return aliases[country] ?? [country];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").slice(0, 180);
}

function messagesToOpenAiInstructions(messages: any[]) {
  const instructions = messages
    .filter((message) => message?.role === "system" && typeof message.content === "string")
    .map((message) => message.content.trim())
    .filter(Boolean);
  return instructions.length ? instructions.join("\n\n") : undefined;
}

function messagesToOpenAiInput(messages: any[]): OpenAiInputMessage[] {
  const content = messages
    .filter((message) => message?.role !== "system")
    .flatMap((message) => {
      const prefix = message?.role === "assistant" ? "Previous assistant response:\n" : "";
      if (typeof message?.content === "string") {
        return [{ type: "input_text" as const, text: `${prefix}${message.content}` }];
      }
      if (!Array.isArray(message?.content)) return [];

      return message.content.flatMap((part: any) => {
        if (part?.type === "text" && typeof part.text === "string") {
          return [{ type: "input_text" as const, text: `${prefix}${part.text}` }];
        }
        if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
          return [{
            type: "input_image" as const,
            image_url: part.image_url.url,
            detail: normalizeImageDetail(part.image_url.detail),
          }];
        }
        return [];
      });
    });

  return [{
    role: "user",
    content: content.length ? content : [{ type: "input_text", text: "Respond to the user." }],
  }];
}

function normalizeImageDetail(detail: unknown): "low" | "high" | "auto" {
  return detail === "low" || detail === "high" ? detail : "auto";
}

function normalizeResponseFormat(value: unknown): OpenAiTextFormat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { name?: unknown; schema?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !candidate.schema || typeof candidate.schema !== "object") {
    return undefined;
  }
  return {
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema: candidate.schema as Record<string, unknown>,
    },
  };
}

function parseOpenAiResponseContent(raw: string) {
  const data = JSON.parse(raw);
  if (data?.status === "incomplete") {
    throw new Error(openAiEmptyContentMessage(data));
  }
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  if (Array.isArray(data.output)) {
    const text = collectOutputText(data.output).join("\n").trim();
    if (text) return text;
  }
  throw new Error(openAiEmptyContentMessage(data));
}

function parseOpenAiResponseSources(raw: string) {
  const data = JSON.parse(raw);
  const sources = new Map<string, { title: string; url: string }>();

  function visit(value: unknown) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;

    const item = value as Record<string, unknown>;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (url && /^https?:\/\//i.test(url)) {
      const fallbackTitle = sourceHostname(url);
      const title = typeof item.title === "string" && item.title.trim()
        ? strip(item.title).slice(0, 180)
        : fallbackTitle;
      const existing = sources.get(url);
      if (!existing || (existing.title === fallbackTitle && title !== fallbackTitle)) {
        sources.set(url, { title, url });
      }
    }
    Object.values(item).forEach(visit);
  }

  visit(data.output);
  return Array.from(sources.values()).slice(0, 16);
}

function sourceHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function openAiErrorMessage(raw: string, status: number) {
  try {
    const data = JSON.parse(raw);
    const message = typeof data?.error?.message === "string" ? data.error.message : "";
    return message.slice(0, 420) || `OpenAI API returned ${status}.`;
  } catch {
    const cleaned = strip(raw);
    return cleaned.slice(0, 420) || `OpenAI API returned ${status}.`;
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedPositiveInteger(value: unknown, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, max);
}

function normalizeReasoningEffort(value: string | undefined): "minimal" | "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high" ? value : "minimal";
}

function normalizeResearchReasoningEffort(value: string | undefined): "minimal" | "low" | "medium" | "high" {
  return value === "minimal" || value === "medium" || value === "high" ? value : "low";
}

function collectOutputText(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectOutputText);
  if (typeof value !== "object") return [];

  const item = value as Record<string, unknown>;
  const type = typeof item.type === "string" ? item.type : "";
  const text = typeof item.text === "string" ? item.text : "";
  const content = item.content;

  return [
    ...(text && (type === "output_text" || type === "text" || !type) ? [text] : []),
    ...collectOutputText(content),
  ];
}

function openAiEmptyContentMessage(data: any) {
  const status = typeof data?.status === "string" ? data.status : "unknown";
  const reason = typeof data?.incomplete_details?.reason === "string" ? data.incomplete_details.reason : "";
  const outputTypes = Array.isArray(data?.output)
    ? data.output.map((item: any) => item?.type).filter(Boolean).join(", ")
    : "";
  const hint = reason === "max_output_tokens"
    ? " Increase OPENAI_MAX_OUTPUT_TOKENS or keep OPENAI_REASONING_EFFORT=minimal."
    : "";
  return [
    `OpenAI returned no generated text. Status: ${status}.`,
    reason ? `Reason: ${reason}.` : "",
    outputTypes ? `Output item types: ${outputTypes}.` : "",
    hint,
  ].filter(Boolean).join(" ");
}

function readJson(request: import("node:http").IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
