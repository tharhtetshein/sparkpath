export type EvidenceSourceType = "manual" | "file" | "github" | "opportunity";

export type EvidenceSource = {
  id: string;
  type: EvidenceSourceType;
  title: string;
  content: string;
  url?: string;
  createdAt: string;
};

export type OpportunityInput = {
  id: string;
  title: string;
  organization: string;
  description: string;
  url?: string;
};

export type JobListing = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  url: string;
  description: string;
  postedAt?: string;
};

export type RankedJob = JobListing & {
  matchLabel: "Strong match" | "Good match" | "Explore";
  reasons: string[];
  missingSignal: string;
};

export type JobSearchTarget = {
  title: string;
  source: "profile" | "github" | "resume" | "certificate" | "skills";
  confidence: number;
  reason: string;
};

export type StudentInput = {
  name: string;
  headline: string;
  targetRole: string;
  links: string;
  sources: EvidenceSource[];
};

export type Skill = {
  name: string;
  category: string;
  score: number;
  terms: string[];
  evidence: Array<{
    sourceTitle: string;
    quote: string;
  }>;
};

export type ProjectRecommendation = {
  title: string;
  why: string;
  deliverables: string[];
  proofSignal: string;
  difficulty: "Weekend" | "Two weeks" | "Capstone";
  proofMode: "github" | "photo";
  resources: Array<{
    label: string;
    url: string;
    kind: "video" | "doc";
  }>;
};

export type Opportunity = {
  id: string;
  company: string;
  role: string;
  fit: number;
  reason: string;
  missingSignal: string;
  url?: string;
};

export type AgentResult = {
  skills: Skill[];
  projects: ProjectRecommendation[];
  proofPortfolio: string[];
  portfolioMarkdown: string;
};

export function analyzeStudent(input: StudentInput): AgentResult {
  const skills: Skill[] = [];
  const target = input.targetRole || "career opportunities";
  const portfolioMarkdown = buildPortfolioMarkdown(input, skills);

  return {
    skills,
    projects: [],
    proofPortfolio: [
      `Lead with a one-page ${target} portfolio organized by skill evidence.`,
      "Attach source-backed proof: repo links, screenshots, certificates, class artifacts, and short result notes.",
      "Run AI skill analysis to generate evidence-backed skill cards from the imported sources.",
      "Generate a tailored DOCX application pack for each job before applying.",
    ],
    portfolioMarkdown,
  };
}

export function sourceFromText(id: string, title: string, content: string): EvidenceSource {
  return {
    id,
    type: "manual",
    title,
    content,
    createdAt: new Date().toISOString(),
  };
}

function matchesTerm(text: string, term: string) {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return false;
  const normalizedText = text.toLowerCase();
  if (normalizedTerm.includes(" ")) return normalizedText.includes(normalizedTerm);
  return new RegExp(`(^|[^a-z0-9+#.])${escapeRegExp(normalizedTerm)}([^a-z0-9+#.]|$)`, "i").test(normalizedText);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rankJobs(jobs: JobListing[], skills: Skill[], target: string): RankedJob[] {
  return jobs
    .map((job) => {
      const text = `${job.title} ${job.company} ${job.description}`.toLowerCase();
      const matchedSkills = skills.filter((skill) => skill.terms.some((term) => matchesTerm(text, term)));
      const targetHits = target.toLowerCase().split(/\W+/).filter((word) => word.length > 3 && text.includes(word)).length;
      const score = matchedSkills.reduce((sum, skill) => sum + skill.score, 0) + targetHits * 18;
      const matchLabel: RankedJob["matchLabel"] = score > 150 ? "Strong match" : score > 70 ? "Good match" : "Explore";
      return {
        ...job,
        matchLabel,
        reasons: matchedSkills.slice(0, 3).map((skill) => `${skill.name}: ${skill.evidence[0]?.quote ?? skill.terms.join(", ")}`),
        missingSignal: buildMissingSignal(text, matchedSkills),
        sortScore: score,
      };
    })
    .sort((a, b) => b.sortScore - a.sortScore)
    .map(({ sortScore: _sortScore, ...job }) => job);
}

export function inferJobTargets(input: StudentInput, result: AgentResult): JobSearchTarget[] {
  const text = profileSearchCorpus(input);
  const targets: JobSearchTarget[] = [];

  if (input.targetRole.trim()) {
    targets.push({
      title: input.targetRole.trim(),
      source: "profile",
      confidence: 96,
      reason: "Target role entered in the profile.",
    });
  }

  const sourceTypes = new Set(input.sources.map((source) => source.type));
  const hasGithub = sourceTypes.has("github");
  const hasCertificate = /\b(certificate|certification|certified|credential|diploma|course|coursera|udemy|google career certificate|linkedin learning|edx|certificate of completion)\b/i.test(text);

  if (hasGithub || result.skills.length) {
    addSkillTargets(targets, result, hasGithub);
    if (hasGithub && !targets.some((target) => ["github", "skills"].includes(target.source))) {
      targets.push({
        title: "Software Engineer Intern",
        source: "github",
        confidence: 72,
        reason: "GitHub profile or repository was imported, but the repo text had limited stack detail.",
      });
    }
  }

  if (hasCertificate || !targets.length) {
    addCertificateTargets(targets, text, hasCertificate);
  }

  if (!targets.length && result.skills.length) {
    result.skills.slice(0, 2).forEach((skill) => {
      targets.push({
        title: `${skill.name.replace(/ and /g, " ")} intern`,
        source: "skills",
        confidence: Math.round(skill.score),
        reason: `Derived from detected ${skill.name.toLowerCase()} evidence.`,
      });
    });
  }

  return dedupeTargets(targets)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

function addSkillTargets(targets: JobSearchTarget[], result: AgentResult, hasGithub: boolean) {
  const hasTerm = (...terms: string[]) => result.skills.some((skill) => skill.terms.some((skillTerm) => terms.some((term) => matchesTerm(skillTerm, term) || matchesTerm(term, skillTerm))));

  if (hasTerm("llm", "openai", "agent", "ai-agents", "claude-code", "codex", "machine learning", "model")) {
    targets.push({ title: "AI Engineer Intern", source: hasGithub ? "github" : "skills", confidence: 90, reason: "Matched AI/LLM project evidence." });
    targets.push({ title: "Machine Learning Intern", source: hasGithub ? "github" : "skills", confidence: 82, reason: "Matched model or machine learning evidence." });
  }
  if (hasTerm("react", "next.js", "frontend", "typescript", "javascript", "vite")) {
    targets.push({ title: "Frontend Developer Intern", source: hasGithub ? "github" : "skills", confidence: 88, reason: "Matched React, UI, JavaScript, or frontend evidence." });
  }
  if (hasTerm("api", "backend", "node.js", "python", "cli", "package.json")) {
    targets.push({ title: "Backend Developer Intern", source: hasGithub ? "github" : "skills", confidence: 86, reason: "Matched API, backend, Python, Node, or server evidence." });
  }
  if (hasTerm("analytics", "dashboard", "timeline", "pandas", "sql")) {
    targets.push({ title: "Data Analyst Intern", source: "skills", confidence: 86, reason: "Matched analytics, SQL, dashboard, spreadsheet, or modeling evidence." });
  }
  if (hasTerm("security", "privacy", "redaction", "csp", "auth")) {
    targets.push({ title: "Cybersecurity Intern", source: hasGithub ? "github" : "skills", confidence: 84, reason: "Matched security, OWASP, CTF, auth, or vulnerability evidence." });
  }
  if (hasTerm("product", "ux", "prototype", "research")) {
    targets.push({ title: "Product Design Intern", source: "skills", confidence: 78, reason: "Matched product, UX, prototype, or user research evidence." });
  }
}

function addCertificateTargets(targets: JobSearchTarget[], text: string, hasCertificate: boolean) {
  const catalog: Array<{ title: string; pattern: RegExp; confidence: number; reason: string }> = [
    { title: "Project Coordinator Intern", pattern: /\b(project management|pmp|scrum|agile|kanban|risk management|stakeholder)\b/i, confidence: 86, reason: "Matched project management certificate or coursework." },
    { title: "Data Analyst Intern", pattern: /\b(data analytics|tableau|power bi|excel|spreadsheet|sql|business analytics)\b/i, confidence: 84, reason: "Matched data analytics certificate or coursework." },
    { title: "Digital Marketing Intern", pattern: /\b(digital marketing|seo|sem|google ads|social media marketing|content marketing|analytics certification)\b/i, confidence: 82, reason: "Matched marketing certificate or campaign evidence." },
    { title: "UX Research Intern", pattern: /\b(ux|user experience|figma|design thinking|wireframe|prototype|user research)\b/i, confidence: 80, reason: "Matched UX/design certificate or portfolio evidence." },
    { title: "Business Development Intern", pattern: /\b(business|entrepreneurship|sales|crm|lead generation|market research)\b/i, confidence: 76, reason: "Matched business, sales, or market research evidence." },
    { title: "Human Resources Intern", pattern: /\b(human resources|hr|recruitment|talent acquisition|employee relations)\b/i, confidence: 76, reason: "Matched HR certificate or people-operations evidence." },
    { title: "Accounting Intern", pattern: /\b(accounting|bookkeeping|quickbooks|finance|financial accounting|tax)\b/i, confidence: 78, reason: "Matched accounting or finance certificate evidence." },
    { title: "Customer Success Intern", pattern: /\b(customer service|customer success|support|client relations|service excellence)\b/i, confidence: 74, reason: "Matched customer service or client-facing evidence." },
    { title: "Teaching Assistant", pattern: /\b(teaching|education|tutoring|lesson plan|classroom|pedagogy)\b/i, confidence: 74, reason: "Matched education, teaching, or tutoring evidence." },
    { title: "Hospitality Intern", pattern: /\b(hospitality|hotel|tourism|food and beverage|guest relations|front office)\b/i, confidence: 74, reason: "Matched hospitality or tourism evidence." },
  ];

  catalog.forEach((item) => {
    if (item.pattern.test(text)) {
      targets.push({
        title: item.title,
        source: hasCertificate ? "certificate" : "resume",
        confidence: item.confidence,
        reason: item.reason,
      });
    }
  });
}

function profileSearchCorpus(input: StudentInput) {
  return [
    input.name,
    input.headline,
    input.targetRole,
    input.links,
    ...input.sources.map((source) => `${source.title}\n${source.content}`),
  ].join("\n").toLowerCase();
}

function dedupeTargets(targets: JobSearchTarget[]) {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMissingSignal(opportunityText: string, matchingSkills: Skill[]) {
  if (!matchingSkills.length) {
    return "Add a small project or case study using the exact tools mentioned in this opportunity.";
  }
  if (opportunityText.includes("user") || opportunityText.includes("customer")) {
    return "Add interview notes, usage metrics, or a short product decision log.";
  }
  if (opportunityText.includes("security") || opportunityText.includes("owasp")) {
    return "Add a reproducible finding write-up with command output and remediation.";
  }
  return "Add measurable impact: users helped, time saved, latency reduced, revenue influenced, or grade/result achieved.";
}

function buildPortfolioMarkdown(input: StudentInput, skills: Skill[]) {
  const skillBlocks = skills
    .map((skill) => {
      const evidence = skill.evidence.map((entry) => `- ${entry.quote} (${entry.sourceTitle})`).join("\n") || "- Add stronger proof for this skill.";
      return `## ${skill.name}\nScore: ${Math.round(skill.score)}/100\n\n${evidence}`;
    })
    .join("\n\n");
  return `# ${input.name || "Student"} - Proof-of-Work Portfolio

${input.headline || "A focused portfolio generated from uploaded work, GitHub projects, certificates, and notes."}

Target: ${input.targetRole || "Not set"}

${skillBlocks || "## Evidence Needed\nUpload files, add GitHub repositories, or paste school/project notes to generate skill proof."}
`;
}
