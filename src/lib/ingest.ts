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

  return importGithubViaServer(repoInput);
}

async function importGithubViaServer(target: string): Promise<EvidenceSource> {
  const response = await fetch("/api/github/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("GitHub import API route is missing. Deploy SparkPath as the Node web service, not a static site, and redeploy the latest commit.");
    }
    throw new Error(data.error || "GitHub import failed.");
  }
  if (!data.source || typeof data.source.content !== "string") {
    throw new Error("GitHub import returned no evidence source.");
  }
  return data.source as EvidenceSource;
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
