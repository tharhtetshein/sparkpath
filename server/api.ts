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

        const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
        const apiUrl = env.GEMINI_API_URL || "https://generativelanguage.googleapis.com/v1beta/interactions";
        const model = env.GEMINI_MODEL || "gemini-3.5-flash";

        if (!apiKey) {
          response.statusCode = 500;
          json(response, { error: "GEMINI_API_KEY is missing. Add it to the server environment and restart the service." });
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

          const upstream = await callGeminiProvider(apiUrl, apiKey, {
            model,
            input: messagesToGeminiInput(messages),
          });

          if (!upstream.ok) {
            response.statusCode = upstream.status;
            json(response, { error: geminiErrorMessage(upstream.text, upstream.status) });
            return;
          }

          const content = parseGeminiInteractionContent(upstream.text);
          json(response, { content });
        } catch (error) {
          response.statusCode = 500;
          json(response, { error: error instanceof Error ? error.message : "AI request failed." });
        }
      };

  return {
    name: "gemini-ai-api",
    handler,
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/ai", handler);
    },
  };
}

type GeminiProviderPayload = {
  model: string;
  input: GeminiInput;
};

type AiProviderResult = {
  ok: boolean;
  status: number;
  text: string;
};

type GeminiInput = string | Array<{ type: "text"; text: string } | { type: "image"; mime_type: string; data: string }>;

async function callGeminiProvider(apiUrl: string, apiKey: string, payload: GeminiProviderPayload): Promise<AiProviderResult> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
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

function messagesToGeminiInput(messages: any[]): GeminiInput {
  const parts = messages.flatMap((message) => {
    const prefix = message.role === "system" ? "System instruction" : message.role === "assistant" ? "Previous assistant response" : "User";
    if (typeof message.content === "string") {
      return [{ type: "text" as const, text: `${prefix}:\n${message.content}` }];
    }
    if (!Array.isArray(message.content)) {
      return [];
    }

    return message.content.flatMap((part: any) => {
      if (part?.type === "text") {
        return [{ type: "text" as const, text: `${prefix}:\n${part.text ?? ""}` }];
      }
      if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
        const image = dataUrlToGeminiImage(part.image_url.url);
        return image ? [image] : [];
      }
      return [];
    });
  });

  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text;
  }
  return parts.length ? parts : "Respond to the user.";
}

function dataUrlToGeminiImage(dataUrl: string): { type: "image"; mime_type: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    type: "image",
    mime_type: match[1],
    data: match[2],
  };
}

function parseGeminiInteractionContent(raw: string) {
  const data = JSON.parse(raw);
  if (typeof data.output_text === "string") return data.output_text;
  if (typeof data.outputText === "string") return data.outputText;
  if (Array.isArray(data.steps)) {
    return data.steps
      .filter((step: any) => step?.type === "model_output")
      .flatMap((step: any) => Array.isArray(step.content) ? step.content : [])
      .map((part: any) => part?.text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(data.output)) {
    return data.output
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : [item])
      .map((item: any) => item.text ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function geminiErrorMessage(raw: string, status: number) {
  const cleaned = strip(raw);
  return cleaned.slice(0, 420) || `Gemini API returned ${status}.`;
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
