import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  Camera,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  Gift,
  Github,
  Home,
  Link2,
  Loader2,
  MapPin,
  Network,
  PlayCircle,
  Search,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import {
  analyzeStudent,
  EvidenceSource,
  inferJobTargets,
  JobListing,
  JobSearchTarget,
  ProjectRecommendation,
  rankJobs,
  Skill,
  StudentInput,
} from "./lib/agent";
import { buildApplicationDocx } from "./lib/applicationDoc";
import { importGithubRepo, inspectGithubRepoProgress, parseFiles, RepoProgressSnapshot } from "./lib/ingest";

const STORAGE_KEY = "sparkpath-workspace-v1";
const PROGRESS_KEY = "sparkpath-project-progress-v1";
const QUEST_KEY = "sparkpath-ai-quest-board-v1";
const APPLICATIONS_KEY = "sparkpath-job-applications-v1";
const SKILL_ANALYSIS_KEY = "sparkpath-ai-skill-analysis-v1";

type View = "home" | "jobs";

type ProviderStatus = {
  provider: string;
  ok: boolean;
  count: number;
  rawCount?: number;
  error?: string;
  searchUrl?: string;
};

type ProjectPhoto = {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: string;
};

type ProjectProgress = {
  proofUrl: string;
  status: "not_started" | "tracking" | "verified";
  projectTitle?: string;
  difficulty?: ProjectRecommendation["difficulty"];
  baseline?: RepoProgressSnapshot;
  lastSnapshot?: RepoProgressSnapshot;
  photos?: ProjectPhoto[];
  photoReview?: string;
  photoScore?: number;
  startedAt?: string;
  checkedAt?: string;
  verifiedAt?: string;
  message?: string;
};

type QuestBoardState = {
  projects: ProjectRecommendation[];
  signature: string;
  createdAt: string;
};

type JobApplication = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  appliedAt: string;
  interview: boolean;
  offer: boolean;
  rejected: boolean;
};

type ApplicationMilestone = "interview" | "offer" | "rejected";

type QuestRank = {
  name: string;
  threshold: number;
  reward: string;
  description: string;
  questDirective: string;
};

type QuestGameState = {
  xp: number;
  completed: number;
  currentRank: QuestRank;
  nextRank?: QuestRank;
  rankIndex: number;
  progressPercent: number;
  xpToNext: number;
};

type AiMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
    >;

type AiMessage = {
  role: "system" | "user" | "assistant";
  content: AiMessageContent;
};

type AiResponseFormat = {
  name: string;
  schema: Record<string, unknown>;
};

type SkillAnalysisState = {
  skills: Skill[];
  summary: string;
  confidenceNotes: string[];
  signature: string;
  analyzedAt: string;
};

type ParsedSkillAnalysis = Pick<SkillAnalysisState, "skills" | "summary" | "confidenceNotes">;

type SkillAnalysisPartition = {
  key: "github" | "resume" | "profile";
  label: string;
  profile: StudentInput;
};

type CompletedSkillAnalysisPartition = SkillAnalysisPartition & {
  analysis: ParsedSkillAnalysis;
};

const initialInput: StudentInput = {
  name: "",
  headline: "",
  targetRole: "",
  links: "",
  sources: [],
};

const skillAnalysisResponseFormat: AiResponseFormat = {
  name: "student_skill_analysis",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["skills", "summary", "confidenceNotes"],
    properties: {
      skills: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "category", "score", "terms", "evidence"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            score: { type: "integer" },
            terms: {
              type: "array",
              items: { type: "string" },
            },
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["sourceTitle", "quote"],
                properties: {
                  sourceTitle: { type: "string" },
                  quote: { type: "string" },
                },
              },
            },
          },
        },
      },
      summary: { type: "string" },
      confidenceNotes: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
};

const questBoardResponseFormat: AiResponseFormat = {
  name: "student_quest_board",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["projects"],
    properties: {
      projects: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "why", "deliverables", "proofSignal", "difficulty", "proofMode", "resources"],
          properties: {
            title: { type: "string" },
            why: { type: "string" },
            deliverables: {
              type: "array",
              items: { type: "string" },
            },
            proofSignal: { type: "string" },
            difficulty: {
              type: "string",
              enum: ["Weekend", "Two weeks", "Capstone"],
            },
            proofMode: {
              type: "string",
              enum: ["github", "photo"],
            },
            resources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "url", "kind"],
                properties: {
                  label: { type: "string" },
                  url: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["video", "doc"],
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

const questRanks: QuestRank[] = [
  {
    name: "Starter",
    threshold: 0,
    reward: "Momentum Map",
    description: "See a clear route to your next rank and the value of every quest.",
    questDirective: "Create 3 to 5 practical quests with a balanced difficulty mix.",
  },
  {
    name: "Builder",
    threshold: 100,
    reward: "Bonus Quest Choice",
    description: "Future boards include at least four choices so you can follow your strongest interest.",
    questDirective: "Create 4 to 5 practical quests with distinct options and a balanced difficulty mix.",
  },
  {
    name: "Pathfinder",
    threshold: 350,
    reward: "Challenge Mode",
    description: "Future boards add one stretch quest designed to make your portfolio stand out.",
    questDirective: "Create 4 to 5 quests and include one ambitious stretch quest with a standout proof signal.",
  },
  {
    name: "Trailblazer",
    threshold: 750,
    reward: "Interview Story Mode",
    description: "New quests are shaped to produce strong problem, action, and result stories.",
    questDirective: "Create 4 to 5 quests. Make every quest produce measurable evidence that can become an interview story.",
  },
  {
    name: "Vanguard",
    threshold: 1300,
    reward: "Master Capstone",
    description: "Unlock flagship capstone quests built to become the centerpiece of a job application.",
    questDirective: "Create 5 advanced quests, including one flagship capstone with employer-ready proof and measurable impact.",
  },
];

export function App() {
  const [activeView, setActiveView] = useState<View>("home");
  const [input, setInput] = useState<StudentInput>(() => loadWorkspace());
  const [projectProgress, setProjectProgress] = useState<Record<string, ProjectProgress>>(() => loadProjectProgress());
  const [questBoard, setQuestBoard] = useState<QuestBoardState>(() => loadQuestBoard());
  const [applications, setApplications] = useState<JobApplication[]>(() => loadApplications());
  const [skillAnalysis, setSkillAnalysis] = useState<SkillAnalysisState>(() => loadSkillAnalysis());
  const [manualNote, setManualNote] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [jobCountry, setJobCountry] = useState("Singapore");
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);
  const [tailoredResumes, setTailoredResumes] = useState<Record<string, string>>({});
  const [aiBusyJob, setAiBusyJob] = useState("");
  const [skillAnalysisBusy, setSkillAnalysisBusy] = useState(false);
  const [questBusy, setQuestBusy] = useState(false);
  const [status, setStatus] = useState("Dashboard ready.");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const lastAutoJobSearchRef = useRef("");
  const lastAutoSkillAnalysisRef = useRef("");

  const quickResult = useMemo(() => analyzeStudent(input), [input]);
  const currentSkillSignature = useMemo(() => skillProfileSignature(input), [input]);
  const skillAnalysisCurrent = Boolean(skillAnalysis.signature) && skillAnalysis.signature === currentSkillSignature;
  const skillAnalysisStale = Boolean(skillAnalysis.signature) && !skillAnalysisCurrent;
  const githubEvidencePresent = useMemo(() => hasGithubEvidence(input), [input]);
  const currentGithubSkillCount = useMemo(
    () => skillAnalysis.skills.filter((skill) => skill.evidence.some((item) => isGithubEvidenceTitle(input, item.sourceTitle))).length,
    [input, skillAnalysis.skills],
  );
  const skillAnalysisMissingGithub = skillAnalysisCurrent && githubEvidencePresent && skillAnalysis.skills.length > 0 && !currentGithubSkillCount;
  const useAiSkillGraph = skillAnalysisCurrent && skillAnalysis.skills.length > 0 && !skillAnalysisMissingGithub;
  const skillAnalysisSummaryOnly = skillAnalysisCurrent && !skillAnalysis.skills.length && quickResult.skills.length > 0;
  const result = useMemo(
    () => useAiSkillGraph ? { ...quickResult, skills: skillAnalysis.skills } : quickResult,
    [quickResult, skillAnalysis.skills, useAiSkillGraph],
  );
  const jobTargets = useMemo(() => inferJobTargets(input, result), [input, result]);
  const currentQuestSignature = useMemo(() => questSignature(input, result), [input, result]);
  const questBoardStale = questBoard.projects.length > 0 && questBoard.signature !== currentQuestSignature;
  const questGame = useMemo(
    () => calculateQuestGame(questBoard.projects, projectProgress),
    [questBoard.projects, projectProgress],
  );
  const jobSearchSignature = useMemo(
    () => `${jobCountry}:${jobTargets.map((target) => `${target.title}:${target.confidence}`).join("|")}`,
    [jobCountry, jobTargets],
  );
  const rankedJobs = useMemo(
    () => rankJobs(
      jobs,
      result.skills,
      [input.targetRole, jobQuery, ...jobTargets.map((target) => target.title)].filter(Boolean).join(" "),
    ),
    [jobs, result.skills, input.targetRole, jobQuery, jobTargets],
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  }, [input]);

  useEffect(() => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(projectProgress));
  }, [projectProgress]);

  useEffect(() => {
    localStorage.setItem(QUEST_KEY, JSON.stringify(questBoard));
  }, [questBoard]);

  useEffect(() => {
    localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    localStorage.setItem(SKILL_ANALYSIS_KEY, JSON.stringify(skillAnalysis));
  }, [skillAnalysis]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Object.entries(projectProgress)
        .filter(([, progress]) => progress.status === "tracking" && progress.proofUrl)
        .forEach(([key]) => void checkProjectByKey(key, true));
    }, 90000);

    return () => window.clearInterval(timer);
  }, [projectProgress, questBoard.projects]);

  useEffect(() => {
    if (activeView !== "jobs" || busy || !jobTargets.length || lastAutoJobSearchRef.current === jobSearchSignature) {
      return;
    }
    lastAutoJobSearchRef.current = jobSearchSignature;
    void searchJobsFromTargets(jobTargets, true);
  }, [activeView, busy, jobSearchSignature, jobTargets]);

  useEffect(() => {
    const signature = skillProfileSignature(input);
    if (
      !input.sources.length ||
      skillAnalysisBusy ||
      (skillAnalysis.signature === signature && !skillAnalysisMissingGithub) ||
      lastAutoSkillAnalysisRef.current === signature
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      lastAutoSkillAnalysisRef.current = signature;
      void analyzeSkillsWithAi(input, true);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [input, skillAnalysis.signature, skillAnalysisBusy, skillAnalysisMissingGithub]);

  function updateField(field: keyof Pick<StudentInput, "name" | "headline" | "targetRole" | "links">, value: string) {
    setInput((current) => ({ ...current, [field]: value }));
  }

  function addSource(source: EvidenceSource) {
    setInput((current) => ({ ...current, sources: [source, ...current.sources] }));
  }

  function removeSource(id: string) {
    setInput((current) => ({ ...current, sources: current.sources.filter((source) => source.id !== id) }));
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setStatus(`Reading ${files.length} file${files.length === 1 ? "" : "s"}...`);
    try {
      const parsed = await parseFiles(files);
      setInput((current) => ({ ...current, sources: [...parsed, ...current.sources] }));
      setStatus(`Imported ${parsed.length} file${parsed.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "File import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGithubImport() {
    setBusy(true);
    setStatus("Importing GitHub evidence...");
    try {
      const source = await importGithubRepo(githubRepo);
      addSource(source);
      setGithubRepo("");
      setStatus(`Imported ${source.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "GitHub import failed.");
    } finally {
      setBusy(false);
    }
  }

  function addManualNote() {
    if (!manualNote.trim()) return;
    addSource({
      id: crypto.randomUUID(),
      type: "manual",
      title: `Manual evidence ${input.sources.filter((source) => source.type === "manual").length + 1}`,
      content: manualNote.trim(),
      createdAt: new Date().toISOString(),
    });
    setManualNote("");
    setStatus("Added manual evidence.");
  }

  async function analyzeSkillsWithAi(profile = input, automatic = false) {
    if (!hasSkillEvidence(profile)) {
      setStatus("Add a headline, portfolio link, resume, GitHub source, certificate, or evidence note before AI skill analysis.");
      return;
    }

    const signature = skillProfileSignature(profile);
    setSkillAnalysisBusy(true);
    setStatus(`${automatic ? "Analyzing new evidence" : "Refreshing skills"} with AI...`);
    try {
      const partitions = skillAnalysisPartitions(profile);
      const settled = await Promise.allSettled(partitions.map(async (partition) => {
        const content = await askAi(skillAnalysisMessages(partition.profile, partition.label), skillAnalysisResponseFormat);
        return {
          ...partition,
          analysis: parseAiSkillAnalysis(content, partition.profile),
        };
      }));
      const analyses = settled.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        const partition = partitions[index];
        return {
          ...partition,
          analysis: {
            skills: existingSkillsForPartition(skillAnalysis.skills, partition.profile),
            summary: "",
            confidenceNotes: [`${partition.label} analysis failed: ${result.reason instanceof Error ? result.reason.message : "AI request failed."}`],
          },
        };
      });
      const merged = mergeSkillAnalyses(analyses);
      setSkillAnalysis({
        ...merged,
        signature,
        analyzedAt: new Date().toISOString(),
      });
      const githubSkillCount = merged.skills.filter((skill) => skill.evidence.some((item) => isGithubEvidenceTitle(profile, item.sourceTitle))).length;
      const nonGithubSkillCount = merged.skills.filter((skill) => skill.evidence.some((item) => !isGithubEvidenceTitle(profile, item.sourceTitle))).length;
      setStatus(
        merged.skills.length
          ? `AI verified ${merged.skills.length} skill${merged.skills.length === 1 ? "" : "s"}: ${githubSkillCount} citing GitHub and ${nonGithubSkillCount} citing resume/profile evidence.`
          : "AI could not verify skills from the current evidence. Add more detailed project or work examples.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI skill analysis failed.");
    } finally {
      setSkillAnalysisBusy(false);
    }
  }

  async function searchJobs() {
    const manualQuery = jobQuery.trim();
    const targets = manualQuery
      ? [{ title: manualQuery, source: "profile", confidence: 100, reason: "Manual role override." } satisfies JobSearchTarget]
      : jobTargets;
    await searchJobsFromTargets(targets, false);
  }

  async function searchJobsFromTargets(targets: JobSearchTarget[], automatic: boolean) {
    const searchTargets = targets.slice(0, 4);
    if (!searchTargets.length) {
      setStatus("Upload a resume, GitHub profile, certificate, or add profile notes before matching jobs.");
      return;
    }

    setBusy(true);
    setStatus(`${automatic ? "Auto-matching" : "Searching"} ${jobCountry} roles from ${searchTargets.map((target) => target.title).join(", ")}...`);
    try {
      const responses = await Promise.all(searchTargets.map(async (target) => {
        const response = await fetch(`/api/jobs?q=${encodeURIComponent(target.title)}&country=${encodeURIComponent(jobCountry)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Job search failed for ${target.title}.`);
        return { target, data };
      }));

      const matchedJobs = dedupeJobListings(responses.flatMap(({ target, data }) => (
        (data.jobs ?? []).map((job: JobListing) => ({
          ...job,
          description: `${job.description}\n\nMatched from inferred search: ${target.title}. Reason: ${target.reason}`,
        }))
      )));
      setJobs(matchedJobs);
      setProviderStatus(mergeProviderStatus(responses.flatMap(({ data }) => data.providerStatus ?? [])));
      setStatus(`Found ${matchedJobs.length} listings from ${searchTargets.length} inferred profile target${searchTargets.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Job search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadJobDoc(job: ReturnType<typeof rankJobs>[number]) {
    setBusy(true);
    setStatus(`Generating DOCX for ${job.title}...`);
    try {
      const blob = await buildApplicationDocx(input, result, job);
      downloadBlob(`${slugify(input.name || "student")}-${slugify(job.company)}-${slugify(job.title)}.docx`, blob);
      setStatus(`Generated editable DOCX for ${job.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "DOCX generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function createTailoredResume(job: ReturnType<typeof rankJobs>[number]) {
    setAiBusyJob(job.id);
    setStatus(`Creating tailored resume for ${job.company}...`);
    try {
      const content = await askAi([
        {
          role: "system",
          content: "You are SparkPath, an AI career co-pilot for students. Create practical, honest application material only from the provided student evidence. Do not invent experience.",
        },
        {
          role: "user",
          content: `Create a tailored one-page resume draft for this job.\n\nStudent profile:\n${profileBrief(input, result)}\n\nJob:\n${JSON.stringify(job, null, 2)}\n\nReturn sections: headline, summary, selected skills, proof-of-work bullets, project highlights, gaps to fix before applying.`,
        },
      ]);
      setTailoredResumes((current) => ({ ...current, [job.id]: content }));
      setStatus(`Tailored resume ready for ${job.company}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI resume generation failed.");
    } finally {
      setAiBusyJob("");
    }
  }

  function toggleApplied(job: ReturnType<typeof rankJobs>[number]) {
    setApplications((current) => {
      if (current.some((application) => application.id === job.id)) {
        setStatus(`Removed ${job.title} from the application tracker.`);
        return current.filter((application) => application.id !== job.id);
      }
      setStatus(`Added ${job.title} to the application tracker.`);
      return [{
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: job.source,
        appliedAt: new Date().toISOString(),
        interview: false,
        offer: false,
        rejected: false,
      }, ...current];
    });
  }

  function updateApplicationMilestone(id: string, milestone: ApplicationMilestone, checked: boolean) {
    setApplications((current) => current.map((application) => {
      if (application.id !== id) return application;
      if (milestone === "offer" && checked) {
        return { ...application, interview: true, offer: true, rejected: false };
      }
      if (milestone === "rejected" && checked) {
        return { ...application, offer: false, rejected: true };
      }
      return { ...application, [milestone]: checked };
    }));
  }

  function removeApplication(id: string) {
    setApplications((current) => current.filter((application) => application.id !== id));
    setStatus("Removed application from the tracker.");
  }

  async function generateQuestBoard() {
    if (!hasQuestInputs(input)) {
      setStatus("Add a target role, headline, link, file, GitHub source, or note before generating quests.");
      return;
    }

    setQuestBusy(true);
    setStatus("Generating a custom AI quest board...");
    try {
      const content = await askAi([
        {
          role: "system",
          content: [
            "You are SparkPath's quest designer for student career portfolios.",
            "Create practical proof-of-work quests from the student's actual input only.",
            "You create the full quest cards yourself: title, why, deliverables, proof signal, difficulty, proof mode, and resources.",
            "Do not reuse generic skill labels, category headings, or prefixed template names as quest titles.",
            "Quest titles must be specific to the student's GitHub evidence, target role, and gaps.",
            "Do not use generic templates. Do not invent credentials or completed work.",
            "GitHub proofMode is only for technical students or code/data/security/software quests. Otherwise use photo proofMode.",
            "Every quest must include at least one YouTube resource and at least one documentation/article/course resource.",
            "Use exact useful URLs when you know them. If not, use a targeted YouTube search URL or official documentation URL.",
            `Current rank: ${questGame.currentRank.name}. Unlocked reward: ${questGame.currentRank.reward}.`,
            questGame.currentRank.questDirective,
            "Return only the structured quest board object.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            questGame.currentRank.questDirective,
            `Build quest cards from this profile and evidence. Favor tasks that turn existing GitHub work into stronger ${input.targetRole || "target role"} proof.`,
            "Each quest must have: title, why, deliverables, proofSignal, difficulty, proofMode, resources.",
            "difficulty must be one of: Weekend, Two weeks, Capstone.",
            "proofMode must be one of: github, photo.",
            "resources must contain objects with label, url, kind. kind must be video or doc.",
            "",
            `Student profile and evidence:\n${questProfileBrief(input, result)}`,
          ].join("\n"),
        },
      ], questBoardResponseFormat);
      const projects = parseAiQuestBoard(content, isTechnicalStudent(input, result));
      setStatus("Verifying YouTube videos for generated quests...");
      const verifiedProjects = await enrichQuestVideos(projects);
      setQuestBoard({
        projects: verifiedProjects,
        signature: currentQuestSignature,
        createdAt: new Date().toISOString(),
      });
      setStatus(`Generated ${verifiedProjects.length} custom quest${verifiedProjects.length === 1 ? "" : "s"} with verified videos.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI quest generation failed.");
    } finally {
      setQuestBusy(false);
    }
  }

  function updateProjectProof(project: ProjectRecommendation, proofUrl: string) {
    const key = projectKey(project.title);
    setProjectProgress((current) => ({
      ...current,
      [key]: {
        ...current[key],
        proofUrl,
        status: current[key]?.status ?? "not_started",
        projectTitle: project.title,
        difficulty: project.difficulty,
        message: proofUrl ? current[key]?.message : undefined,
      },
    }));
  }

  async function addProjectPhotos(project: ProjectRecommendation, files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setStatus(`Preparing ${files.length} progress picture${files.length === 1 ? "" : "s"}...`);
    try {
      const photos = await Promise.all(Array.from(files).map(prepareProjectPhoto));
      const key = projectKey(project.title);
      setProjectProgress((current) => {
        const existing = current[key] ?? { proofUrl: "", status: "not_started" as const };
        return {
          ...current,
          [key]: {
            ...existing,
            status: existing.status === "verified" ? "verified" : "tracking",
            projectTitle: project.title,
            difficulty: project.difficulty,
            photos: [...(existing.photos ?? []), ...photos].slice(-6),
            photoReview: undefined,
            photoScore: existing.status === "verified" ? 100 : undefined,
            startedAt: existing.startedAt ?? new Date().toISOString(),
            message: existing.status === "verified"
              ? "Quest remains verified. New pictures were added to the evidence."
              : "Pictures added. Run AI review to estimate visible completion.",
          },
        };
      });
      setStatus(`Added ${photos.length} picture${photos.length === 1 ? "" : "s"} for ${project.title}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare progress pictures.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewProjectPhotos(project: ProjectRecommendation) {
    const key = projectKey(project.title);
    const progress = projectProgress[key];
    const photos = progress?.photos ?? [];
    if (!photos.length) {
      setStatus("Upload progress pictures before asking AI to review them.");
      return;
    }

    setBusy(true);
    setStatus(`Reviewing pictures for ${project.title}...`);
    try {
      const content = await askAi([
        {
          role: "system",
          content: "You are SparkPath's visual progress reviewer. Estimate completion from uploaded project evidence only. Be honest, concise, and do not invent unseen work.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Project: ${project.title}`,
                `Goal: ${project.why}`,
                `Expected deliverables: ${project.deliverables.join(", ")}`,
                "Review these progress pictures. Return exactly: Completion: NN%, Evidence seen, Missing proof, Next action.",
              ].join("\n"),
            },
            ...photos.map((photo) => ({
              type: "image_url" as const,
              image_url: { url: photo.dataUrl, detail: "auto" as const },
            })),
          ],
        },
      ]);
      const score = extractCompletionScore(content);
      setProjectProgress((current) => {
        const existing = current[key] ?? { proofUrl: "", status: "not_started" as const };
        const verified = existing.status === "verified" || score >= 80;
        return {
          ...current,
          [key]: {
            ...existing,
            status: verified ? "verified" : "tracking",
            projectTitle: project.title,
            difficulty: project.difficulty,
            photoReview: content,
            photoScore: verified ? Math.max(score, existing.photoScore ?? 100) : score,
            checkedAt: new Date().toISOString(),
            verifiedAt: verified ? existing.verifiedAt ?? new Date().toISOString() : existing.verifiedAt,
            message: verified
              ? "Quest verified. XP has been added to your rank."
              : "AI review found more proof or work still needed.",
          },
        };
      });
      setStatus(`AI photo review complete${score ? `: ${score}%` : ""}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AI photo review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function startTrackingProject(project: ProjectRecommendation) {
    if (project.proofMode !== "github") {
      setStatus("This quest uses picture proof. Upload photos and run AI review.");
      return;
    }
    const key = projectKey(project.title);
    const progress = projectProgress[key];
    if (!progress?.proofUrl.trim()) {
      setStatus("Paste a public GitHub repo link before tracking progress.");
      return;
    }

    setBusy(true);
    setStatus(`Creating baseline for ${project.title}...`);
    try {
      const snapshot = await inspectGithubRepoProgress(progress.proofUrl);
      setProjectProgress((current) => ({
        ...current,
        [key]: {
          ...current[key],
          proofUrl: progress.proofUrl,
          status: current[key]?.status === "verified" ? "verified" : "tracking",
          projectTitle: project.title,
          difficulty: project.difficulty,
          baseline: snapshot,
          lastSnapshot: snapshot,
          startedAt: current[key]?.startedAt ?? new Date().toISOString(),
          checkedAt: snapshot.checkedAt,
          message: current[key]?.status === "verified"
            ? "Quest remains verified. A fresh tracking baseline was saved."
            : "Baseline saved. New commits after this point will verify progress.",
        },
      }));
      setStatus(`Tracking ${snapshot.fullName}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not inspect GitHub proof repo.");
    } finally {
      setBusy(false);
    }
  }

  async function checkProjectProgress(project: ProjectRecommendation) {
    if (project.proofMode !== "github") {
      await reviewProjectPhotos(project);
      return;
    }
    await checkProjectByKey(projectKey(project.title), false);
  }

  async function checkProjectByKey(key: string, silent: boolean) {
    const progress = projectProgress[key];
    if (!progress?.proofUrl.trim()) return;
    if (!silent) {
      setBusy(true);
      setStatus("Checking GitHub progress...");
    }

    try {
      const snapshot = await inspectGithubRepoProgress(progress.proofUrl);
      const baseline = progress.baseline ?? snapshot;
      const verified = progress.status === "verified" || hasNewProgress(baseline, snapshot);
      const project = questBoard.projects.find((candidate) => projectKey(candidate.title) === key);
      setProjectProgress((current) => ({
        ...current,
        [key]: {
          ...current[key],
          status: verified ? "verified" : "tracking",
          projectTitle: current[key]?.projectTitle ?? project?.title,
          difficulty: current[key]?.difficulty ?? project?.difficulty,
          baseline,
          lastSnapshot: snapshot,
          checkedAt: snapshot.checkedAt,
          verifiedAt: verified ? current[key]?.verifiedAt ?? new Date().toISOString() : current[key]?.verifiedAt,
          message: verified
            ? "Quest verified from repository activity. XP has been added to your rank."
            : "Still tracking. Push new work after the baseline checkpoint to verify completion.",
        },
      }));
      if (!silent) setStatus(verified ? "Project progress verified." : "No new GitHub progress detected yet.");
    } catch (error) {
      if (!silent) setStatus(error instanceof Error ? error.message : "Progress check failed.");
    } finally {
      if (!silent) setBusy(false);
    }
  }

  return (
    <main className="spark-shell">
      <div className="app-frame">
        <section className="page-surface">
          {activeView === "home" ? (
            <DashboardPage
              input={input}
              result={result}
              skillAnalysis={skillAnalysis}
              skillAnalysisBusy={skillAnalysisBusy}
              skillAnalysisCurrent={skillAnalysisCurrent}
              skillAnalysisStale={skillAnalysisStale}
              useAiSkillGraph={useAiSkillGraph}
              skillAnalysisSummaryOnly={skillAnalysisSummaryOnly}
              skillAnalysisMissingGithub={skillAnalysisMissingGithub}
              questProjects={questBoard.projects}
              questGeneratedAt={questBoard.createdAt}
              questBoardStale={questBoardStale}
              questGame={questGame}
              busy={busy}
              questBusy={questBusy}
              manualNote={manualNote}
              githubRepo={githubRepo}
              projectProgress={projectProgress}
              fileInputRef={fileInputRef}
              resumeInputRef={resumeInputRef}
              onFieldChange={updateField}
              onManualNoteChange={setManualNote}
              onGithubRepoChange={setGithubRepo}
              onFiles={handleFiles}
              onGithubImport={handleGithubImport}
              onAddManualNote={addManualNote}
              onRemoveSource={removeSource}
              onAnalyzeSkills={() => analyzeSkillsWithAi(input, false)}
              onGenerateQuestBoard={generateQuestBoard}
              onProofChange={updateProjectProof}
              onPhotoProof={addProjectPhotos}
              onReviewPhotos={reviewProjectPhotos}
              onStartTracking={startTrackingProject}
              onCheckProgress={checkProjectProgress}
            />
          ) : (
            <JobsPage
              input={input}
              jobTargets={jobTargets}
              rankedJobs={rankedJobs}
              applications={applications}
              providerStatus={providerStatus}
              jobQuery={jobQuery}
              jobCountry={jobCountry}
              busy={busy}
              aiBusyJob={aiBusyJob}
              tailoredResumes={tailoredResumes}
              onJobQueryChange={setJobQuery}
              onJobCountryChange={setJobCountry}
              onSearchJobs={searchJobs}
              onCreateTailoredResume={createTailoredResume}
              onDownloadJobDoc={downloadJobDoc}
              onToggleApplied={toggleApplied}
              onUpdateMilestone={updateApplicationMilestone}
              onRemoveApplication={removeApplication}
            />
          )}
        </section>

        <aside className="right-rail" aria-label="SparkPath navigation">
          <div className="rail-brand">
            <span><Sparkles size={18} /></span>
            <div>
              <strong>SparkPath</strong>
              <small>AI Career Co-Pilot</small>
            </div>
          </div>
          <nav className="rail-nav">
            <button type="button" className={activeView === "home" ? "active" : ""} onClick={() => setActiveView("home")}>
              <Home size={18} />
              Home
            </button>
            <button type="button" className={activeView === "jobs" ? "active" : ""} onClick={() => setActiveView("jobs")}>
              <BriefcaseBusiness size={18} />
              Job search
            </button>
          </nav>
          <div className="rail-rank">
            <Trophy size={17} />
            <div>
              <small>Quest rank</small>
              <strong>{questGame.currentRank.name}</strong>
            </div>
            <span>{questGame.xp} XP</span>
          </div>
          <div className="rail-status">
            <span>{busy || questBusy || skillAnalysisBusy || aiBusyJob ? <Loader2 size={16} className="spin" /> : <BadgeCheck size={16} />}</span>
            <p>{status}</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function DashboardPage(props: {
  input: StudentInput;
  result: ReturnType<typeof analyzeStudent>;
  skillAnalysis: SkillAnalysisState;
  skillAnalysisBusy: boolean;
  skillAnalysisCurrent: boolean;
  skillAnalysisStale: boolean;
  useAiSkillGraph: boolean;
  skillAnalysisSummaryOnly: boolean;
  skillAnalysisMissingGithub: boolean;
  questProjects: ProjectRecommendation[];
  questGeneratedAt: string;
  questBoardStale: boolean;
  questGame: QuestGameState;
  busy: boolean;
  questBusy: boolean;
  manualNote: string;
  githubRepo: string;
  projectProgress: Record<string, ProjectProgress>;
  fileInputRef: RefObject<HTMLInputElement>;
  resumeInputRef: RefObject<HTMLInputElement>;
  onFieldChange: (field: keyof Pick<StudentInput, "name" | "headline" | "targetRole" | "links">, value: string) => void;
  onManualNoteChange: (value: string) => void;
  onGithubRepoChange: (value: string) => void;
  onFiles: (files: FileList | null) => void;
  onGithubImport: () => void;
  onAddManualNote: () => void;
  onRemoveSource: (id: string) => void;
  onAnalyzeSkills: () => void;
  onGenerateQuestBoard: () => void;
  onProofChange: (project: ProjectRecommendation, proofUrl: string) => void;
  onPhotoProof: (project: ProjectRecommendation, files: FileList | null) => void;
  onReviewPhotos: (project: ProjectRecommendation) => void;
  onStartTracking: (project: ProjectRecommendation) => void;
  onCheckProgress: (project: ProjectRecommendation) => void;
}) {
  const {
    input,
    result,
    skillAnalysis,
    skillAnalysisBusy,
    skillAnalysisCurrent,
    skillAnalysisStale,
    useAiSkillGraph,
    skillAnalysisSummaryOnly,
    skillAnalysisMissingGithub,
    questProjects,
    questGeneratedAt,
    questBoardStale,
    questGame,
    busy,
    questBusy,
    manualNote,
    githubRepo,
    projectProgress,
    fileInputRef,
    resumeInputRef,
    onFieldChange,
    onManualNoteChange,
    onGithubRepoChange,
    onFiles,
    onGithubImport,
    onAddManualNote,
    onRemoveSource,
    onAnalyzeSkills,
    onGenerateQuestBoard,
    onProofChange,
    onPhotoProof,
    onReviewPhotos,
    onStartTracking,
    onCheckProgress,
  } = props;
  const topSkill = result.skills[0];

  return (
    <div className="view-stack">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">The bridge from learning to earning</p>
          <h1>SparkPath</h1>
          <p className="hero-text">
            Turn scattered school work, GitHub projects, certificates, and achievements into a living capability profile.
          </p>
        </div>
        <div className="signal-board" aria-label="Current top capability">
          <span>Top signal</span>
          <strong>{topSkill?.name ?? "Upload evidence to begin"}</strong>
          <div className="signal-bars">
            {result.skills.slice(0, 5).map((skill, index) => (
              <i key={skill.name} style={{ "--score": `${Math.max(22, skill.score)}%`, "--delay": `${index * 70}ms` } as CSSProperties}>
                {skill.category}
              </i>
            ))}
          </div>
        </div>
      </header>

      <section className="profile-grid" aria-label="Student profile import">
        <article className="profile-card">
          <div className="section-title">
            <ClipboardList size={20} />
            <h2>Student Profile</h2>
          </div>
          <label>Name<input value={input.name} onChange={(event) => onFieldChange("name", event.target.value)} placeholder="Your name" /></label>
          <label>Target role<input value={input.targetRole} onChange={(event) => onFieldChange("targetRole", event.target.value)} placeholder="AI Engineer Intern" /></label>
          <label>Headline<textarea value={input.headline} onChange={(event) => onFieldChange("headline", event.target.value)} rows={3} placeholder="What you build, study, and want next" /></label>
          <label>Portfolio links<textarea value={input.links} onChange={(event) => onFieldChange("links", event.target.value)} rows={3} placeholder="LinkedIn, deployed projects, certificates, personal site" /></label>
          <label>
            GitHub profile or repo
            <div className="inline-control">
              <input value={githubRepo} onChange={(event) => onGithubRepoChange(event.target.value)} placeholder="github.com/student or owner/repo" />
              <button type="button" onClick={onGithubImport} disabled={busy || !githubRepo.trim()} aria-label="Import GitHub evidence"><Github size={17} /></button>
            </div>
          </label>
        </article>

        <article
          className="drop-card"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFiles(event.dataTransfer.files);
          }}
        >
          <input ref={resumeInputRef} className="hidden-file" type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={(event) => onFiles(event.target.files)} />
          <div className="drop-icon"><FileUp size={30} /></div>
          <h2>Resume and evidence dropper</h2>
          <p>Resume, projects, GitHub exports, certificates, class work, and achievements.</p>
          <button type="button" onClick={() => resumeInputRef.current?.click()}><FileText size={17} />Choose files</button>
          <small>PDF, DOCX, TXT, MD, CSV, and JSON.</small>
        </article>
      </section>

      <section className="note-strip">
        <input ref={fileInputRef} className="hidden-file" type="file" multiple accept=".txt,.md,.csv,.json,.pdf,.docx" onChange={(event) => onFiles(event.target.files)} />
        <textarea value={manualNote} onChange={(event) => onManualNoteChange(event.target.value)} rows={3} placeholder="Paste achievements, project notes, competition results, leadership work, or course reflections." />
        <button type="button" onClick={onAddManualNote} disabled={!manualNote.trim()}><ArrowRight size={17} />Add evidence</button>
      </section>

      <section className="analysis-grid" aria-label="AI analysis">
        <article className="panel skills-panel">
          <div className="skill-panel-head">
            <div className="section-title"><Network size={20} /><h2>AI Skill Graph</h2></div>
            <div className="skill-analysis-actions">
              <span className={useAiSkillGraph ? "ai-current" : skillAnalysisStale || skillAnalysisMissingGithub ? "ai-stale" : "quick-scan"}>
                {skillAnalysisBusy ? "Analyzing evidence" : useAiSkillGraph ? "AI verified" : skillAnalysisMissingGithub ? "GitHub not cited" : skillAnalysisSummaryOnly ? "AI reviewed" : skillAnalysisStale ? "Evidence changed" : "Quick scan"}
              </span>
              <button type="button" onClick={onAnalyzeSkills} disabled={skillAnalysisBusy || !hasSkillEvidence(input)}>
                {skillAnalysisBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {skillAnalysisCurrent ? "Refresh analysis" : "Analyze with AI"}
              </button>
            </div>
          </div>
          {skillAnalysisCurrent && skillAnalysis.summary && (
            <div className="skill-analysis-summary">
              <strong>AI assessment</strong>
              <p>{skillAnalysis.summary}</p>
              {!!skillAnalysis.confidenceNotes.length && (
                <ul>{skillAnalysis.confidenceNotes.map((note) => <li key={note}>{note}</li>)}</ul>
              )}
            </div>
          )}
          {skillAnalysisSummaryOnly && (
            <p className="skill-analysis-notice">AI returned an assessment but no exact-quote skill nodes.</p>
          )}
          {skillAnalysisMissingGithub && (
            <p className="skill-analysis-notice">The saved analysis did not cite GitHub evidence, so it is not being used for the graph. Refresh analysis to generate repository-backed cards.</p>
          )}
          {skillAnalysisStale && (
            <p className="skill-analysis-notice">The evidence or profile changed. Refresh the AI analysis before relying on these matches.</p>
          )}
          {result.skills.length ? (
            <div className="skill-list">
              {result.skills.map((skill) => (
                <article className="skill-row" key={skill.name}>
                  <div>
                    <span>{skill.category}</span>
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.evidence[0]?.quote ?? skill.terms.join(", ")}
                      {skill.evidence[0]?.sourceTitle ? ` — ${skill.evidence[0].sourceTitle}` : ""}
                    </small>
                  </div>
                  <div className="skill-meter" aria-label={`${skill.name} strength`}>
                    <i style={{ width: `${skill.score}%` }} />
                    <b>{Math.round(skill.score)}</b>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="empty">Import GitHub, resume files, or detailed evidence notes to generate verified skills.</p>}
        </article>

        <article className="panel source-panel">
          <div className="section-title"><Link2 size={20} /><h2>Evidence Sources</h2></div>
          <div className="source-list">
            {input.sources.map((source) => (
              <article key={source.id}>
                <div>
                  <span>{source.type}</span>
                  <h3>{source.title}</h3>
                  <p>{source.content.slice(0, 180)}{source.content.length > 180 ? "..." : ""}</p>
                </div>
                <button type="button" className="icon-button" onClick={() => onRemoveSource(source.id)} aria-label={`Remove ${source.title}`}><Trash2 size={16} /></button>
              </article>
            ))}
            {!input.sources.length && <p className="empty">No evidence imported yet.</p>}
          </div>
        </article>

        <article className="panel project-panel">
          <div className="quest-panel-head">
            <div className="section-title"><Target size={20} /><h2>Quest Board</h2></div>
            <div className="quest-generate-actions">
              {questBoardStale && <span>Profile changed</span>}
              {questGeneratedAt && !questBoardStale && <span>AI generated</span>}
              <button type="button" onClick={onGenerateQuestBoard} disabled={busy || questBusy || !hasQuestInputs(input)}>
                {questBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                {questProjects.length ? "Regenerate quests" : "Generate quests"}
              </button>
            </div>
          </div>

          <section className="rank-command-center" aria-label="Quest rank and rewards">
            <div className="rank-summary">
              <div className="rank-crest"><Trophy size={22} /><span>Rank {questGame.rankIndex + 1}</span></div>
              <div className="rank-copy">
                <span className="eyebrow">Current rank</span>
                <h3>{questGame.currentRank.name}</h3>
                <p>{questGame.completed} verified quest{questGame.completed === 1 ? "" : "s"} · {questGame.xp} XP</p>
              </div>
              <div className="rank-progress">
                <div>
                  <strong>{questGame.nextRank ? `${questGame.xpToNext} XP to ${questGame.nextRank.name}` : "Top rank reached"}</strong>
                  <span>{questGame.progressPercent}%</span>
                </div>
                <div className="rank-meter" aria-label={`${questGame.progressPercent}% progress to the next rank`}>
                  <i style={{ width: `${questGame.progressPercent}%` }} />
                </div>
              </div>
            </div>
            <div className="reward-ladder">
              {questRanks.map((rank, index) => {
                const unlocked = questGame.xp >= rank.threshold;
                const current = index === questGame.rankIndex;
                return (
                  <article className={`${unlocked ? "unlocked" : "locked"} ${current ? "current" : ""}`} key={rank.name}>
                    <div>{unlocked ? <Gift size={17} /> : <Award size={17} />}<span>{rank.threshold} XP</span></div>
                    <strong>{rank.reward}</strong>
                    <small>{rank.description}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="project-stack">
            {questProjects.map((project) => {
              const progress = projectProgress[projectKey(project.title)] ?? { proofUrl: "", status: "not_started" };
              const progressPercent = getQuestProgressPercent(progress);
              const questXp = questXpForDifficulty(project.difficulty);
              return (
                <article className={`project ${progress.status}`} key={project.title}>
                  <div className="project-head">
                    <div className="quest-meta"><span>{project.difficulty}</span><b>+{questXp} XP</b></div>
                    <strong>{progress.status === "verified" ? <CheckCircle2 size={17} /> : <PlayCircle size={17} />}{project.title}</strong>
                  </div>
                  <p>{project.why}</p>
                  <div className="quest-progress-row">
                    <div className="quest-progress-meter" aria-label={`${progressPercent}% quest progress`}><i style={{ width: `${progressPercent}%` }} /></div>
                    <strong>{progressPercent}%</strong>
                  </div>
                  <ul>{project.deliverables.map((item) => <li key={item}>{item}</li>)}</ul>
                  <div className="resource-row">
                    {project.resources.map((resource) => (
                      <a key={resource.url} className={resource.kind} href={resource.url} target="_blank" rel="noreferrer">
                        {resource.kind === "video" ? <PlayCircle size={15} /> : <BookOpen size={15} />}
                        {resource.label}
                      </a>
                    ))}
                  </div>
                  {project.proofMode === "github" ? (
                    <>
                      <label>Proof repo<input value={progress.proofUrl} onChange={(event) => onProofChange(project, event.target.value)} placeholder="github.com/you/project-proof" /></label>
                      <div className="quest-actions">
                        <button type="button" onClick={() => onStartTracking(project)} disabled={busy || !progress.proofUrl.trim()}><Github size={16} />Start tracking</button>
                        <button type="button" className="secondary-button" onClick={() => onCheckProgress(project)} disabled={busy || !progress.proofUrl.trim()}><BadgeCheck size={16} />Check progress</button>
                      </div>
                    </>
                  ) : (
                    <div className="photo-proof">
                      <label>Picture proof<input type="file" accept="image/*" multiple onChange={(event) => onPhotoProof(project, event.target.files)} /></label>
                      {!!progress.photos?.length && (
                        <div className="photo-grid" aria-label={`${project.title} uploaded proof pictures`}>
                          {progress.photos.map((photo) => <img key={photo.id} src={photo.dataUrl} alt={photo.name} />)}
                        </div>
                      )}
                      <div className="quest-actions">
                        <button type="button" onClick={() => onReviewPhotos(project)} disabled={busy || !progress.photos?.length}><Camera size={16} />AI review pictures</button>
                        {typeof progress.photoScore === "number" && <span className="photo-score"><BadgeCheck size={15} />{progress.photoScore}% seen</span>}
                      </div>
                      {progress.photoReview && <pre className="photo-review">{progress.photoReview}</pre>}
                    </div>
                  )}
                  <small className="quest-status">
                    {progress.status === "verified" ? `${questXp} XP banked · ` : ""}
                    {progress.message ?? project.proofSignal}
                  </small>
                </article>
              );
            })}
            {!questProjects.length && (
              <article className="quest-empty">
                <Sparkles size={22} />
                <h3>Generate a board from this profile</h3>
                <p>Add a target role, evidence, links, or notes, then let AI create quests with useful resources and verifiable proof.</p>
                <button type="button" onClick={onGenerateQuestBoard} disabled={busy || questBusy || !hasQuestInputs(input)}>
                  {questBusy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}Generate quests
                </button>
              </article>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

function JobsPage(props: {
  input: StudentInput;
  jobTargets: JobSearchTarget[];
  rankedJobs: ReturnType<typeof rankJobs>;
  applications: JobApplication[];
  providerStatus: ProviderStatus[];
  jobQuery: string;
  jobCountry: string;
  busy: boolean;
  aiBusyJob: string;
  tailoredResumes: Record<string, string>;
  onJobQueryChange: (value: string) => void;
  onJobCountryChange: (value: string) => void;
  onSearchJobs: () => void;
  onCreateTailoredResume: (job: ReturnType<typeof rankJobs>[number]) => void;
  onDownloadJobDoc: (job: ReturnType<typeof rankJobs>[number]) => void;
  onToggleApplied: (job: ReturnType<typeof rankJobs>[number]) => void;
  onUpdateMilestone: (id: string, milestone: ApplicationMilestone, checked: boolean) => void;
  onRemoveApplication: (id: string) => void;
}) {
  const {
    input,
    jobTargets,
    rankedJobs,
    applications,
    providerStatus,
    jobQuery,
    jobCountry,
    busy,
    aiBusyJob,
    tailoredResumes,
    onJobQueryChange,
    onJobCountryChange,
    onSearchJobs,
    onCreateTailoredResume,
    onDownloadJobDoc,
    onToggleApplied,
    onUpdateMilestone,
    onRemoveApplication,
  } = props;

  return (
    <div className="view-stack">
      <header className="page-header compact">
        <p className="eyebrow">Evidence-driven opportunity matching</p>
        <h1>Job Search</h1>
        <p>Find roles from your evidence, apply, and keep every outcome in one clear pipeline.</p>
      </header>

      <section className="match-console">
        <div>
          <span className="eyebrow">Inferred targets</span>
          <div className="target-chip-row">
            {jobTargets.map((target) => (
              <span key={target.title} className={`target-chip ${target.source}`}>
                <strong>{target.title}</strong>
                <small>{target.source} / {target.confidence}</small>
              </span>
            ))}
            {!jobTargets.length && <p className="empty">Upload a resume, GitHub profile, certificate, or add notes to infer suited roles.</p>}
          </div>
        </div>
        <button type="button" onClick={onSearchJobs} disabled={busy || !jobTargets.length}><Search size={17} />Auto-match jobs</button>
      </section>

      <section className="search-console">
        <label>Manual override<input value={jobQuery} onChange={(event) => onJobQueryChange(event.target.value)} placeholder={input.targetRole || jobTargets[0]?.title || "Optional role override"} /></label>
        <label>Country<input value={jobCountry} onChange={(event) => onJobCountryChange(event.target.value)} placeholder="Singapore" /></label>
        <button type="button" onClick={onSearchJobs} disabled={busy}><Search size={17} />{jobQuery.trim() ? "Search override" : "Refresh matches"}</button>
      </section>

      <div className="provider-strip">
        {providerStatus.map((provider) => provider.searchUrl ? (
          <a key={provider.provider} href={provider.searchUrl} target="_blank" rel="noreferrer" className={provider.ok ? "provider-ok" : "provider-error"} title={provider.error || `${provider.count} matched listings`}>
            {provider.provider}<small>{provider.count ? `${provider.count} jobs` : "open search"}</small>
          </a>
        ) : (
          <span key={provider.provider} className={provider.ok ? "provider-ok" : "provider-error"}>{provider.provider}: {provider.count}</span>
        ))}
      </div>

      <section className="application-tracker" aria-labelledby="application-tracker-title">
        <div className="tracker-heading">
          <div><span className="eyebrow">Your application pipeline</span><h2 id="application-tracker-title">Application Tracker</h2></div>
          <strong>{applications.length} tracked</strong>
        </div>
        {applications.length ? (
          <div className="application-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Interview</th>
                  <th scope="col">Offer</th>
                  <th scope="col">Rejected</th>
                  <th scope="col"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => (
                  <tr key={application.id} className={application.offer ? "offer-row" : application.rejected ? "rejected-row" : ""}>
                    <td>
                      <a href={application.url} target="_blank" rel="noreferrer">{application.title}</a>
                      <small>{application.company} · {application.location}</small>
                    </td>
                    <td><time dateTime={application.appliedAt}>{formatApplicationDate(application.appliedAt)}</time></td>
                    {(["interview", "offer", "rejected"] as ApplicationMilestone[]).map((milestone) => (
                      <td key={milestone}>
                        <label className="tracker-check">
                          <input type="checkbox" checked={application[milestone]} onChange={(event) => onUpdateMilestone(application.id, milestone, event.target.checked)} />
                          <span>{milestone}</span>
                        </label>
                      </td>
                    ))}
                    <td>
                      <button type="button" className="tracker-remove" onClick={() => onRemoveApplication(application.id)} aria-label={`Remove ${application.title} from tracker`}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tracker-empty"><CheckCircle2 size={22} /><p>Click <strong>I applied</strong> on a job card and it will appear here automatically.</p></div>
        )}
      </section>

      <section className="jobs-list">
        {rankedJobs.map((job) => {
          const isApplied = applications.some((application) => application.id === job.id);
          return (
            <article key={job.id} className={`job-card ${isApplied ? "applied" : ""}`}>
              <div className="job-main">
                <span>{job.matchLabel} / {job.source}</span>
                <h2>{job.title}</h2>
                <p>{job.company}</p>
                <small><MapPin size={14} /> {job.location}</small>
                <em>{job.reasons[0] ?? job.missingSignal}</em>
              </div>
              <div className="job-actions">
                <a href={job.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />Apply</a>
                <button type="button" className={`applied-toggle ${isApplied ? "is-applied" : ""}`} aria-pressed={isApplied} onClick={() => onToggleApplied(job)}>
                  <CheckCircle2 size={16} />{isApplied ? "Applied ✓" : "I applied"}
                </button>
                <button type="button" onClick={() => onCreateTailoredResume(job)} disabled={aiBusyJob === job.id}>
                  {aiBusyJob === job.id ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}AI resume
                </button>
                <button type="button" className="secondary-button" onClick={() => onDownloadJobDoc(job)} disabled={busy}><Download size={16} />DOCX</button>
              </div>
              {tailoredResumes[job.id] && <pre className="ai-output">{tailoredResumes[job.id]}</pre>}
            </article>
          );
        })}
        {!rankedJobs.length && (
          <article className="empty-state">
            <BriefcaseBusiness size={24} />
            <h2>No job results yet</h2>
            <p>Use a target role and country to search listings that match the selected location.</p>
          </article>
        )}
      </section>
    </div>
  );
}

async function askAi(messages: AiMessage[], responseFormat?: AiResponseFormat) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, responseFormat }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "AI request failed.");
  if (typeof data.content !== "string" || !data.content.trim()) {
    throw new Error(data.error || "AI request returned no generated content. Try again, or increase OPENAI_MAX_OUTPUT_TOKENS.");
  }
  return data.content;
}

function profileBrief(input: StudentInput, result: ReturnType<typeof analyzeStudent>) {
  const skills = result.skills
    .slice(0, 6)
    .map((skill) => `- ${skill.name} (${Math.round(skill.score)}/100): ${skill.evidence[0]?.quote ?? skill.terms.join(", ")}`)
    .join("\n");
  const sources = input.sources
    .slice(0, 5)
    .map((source) => `- ${source.title}: ${source.content.slice(0, 420)}`)
    .join("\n");
  return [
    `Name: ${input.name || "Student"}`,
    `Target role: ${input.targetRole || "Not set"}`,
    `Headline: ${input.headline || "Not set"}`,
    `Links: ${input.links || "Not set"}`,
    `Detected skills:\n${skills || "No skills detected yet."}`,
    `Evidence sources:\n${sources || "No imported evidence yet."}`,
  ].join("\n\n");
}

function hasGithubEvidence(input: StudentInput) {
  return input.sources.some((source) => source.type === "github" || isGithubSourceTitle(source.title) || source.content.startsWith("GitHub"));
}

function isGithubSourceTitle(title: string) {
  return title.toLowerCase().includes("github");
}

function isGithubEvidenceTitle(input: StudentInput, title: string) {
  return input.sources.some((source) => source.title.toLowerCase() === title.toLowerCase() && (source.type === "github" || isGithubSourceTitle(source.title) || source.content.startsWith("GitHub")));
}

function skillAnalysisPartitions(input: StudentInput): SkillAnalysisPartition[] {
  const githubSources = input.sources.filter((source) => source.type === "github" || isGithubSourceTitle(source.title) || source.content.startsWith("GitHub"));
  const otherSources = input.sources.filter((source) => !githubSources.includes(source));
  const partitions: SkillAnalysisPartition[] = [];

  if (githubSources.length) {
    partitions.push({
      key: "github",
      label: "GitHub repositories",
      profile: { ...input, headline: "", links: "", sources: githubSources },
    });
  }
  if (otherSources.length || input.headline.trim() || input.links.trim()) {
    partitions.push({
      key: otherSources.length ? "resume" : "profile",
      label: otherSources.length ? "Resume and profile evidence" : "Profile evidence",
      profile: { ...input, sources: otherSources },
    });
  }
  return partitions.length ? partitions : [{ key: "profile", label: "Profile evidence", profile: input }];
}

function skillAnalysisMessages(profile: StudentInput, partitionLabel: string): AiMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are SparkPath's evidence-grounded career skills analyst.",
        `Analyze only the supplied ${partitionLabel} partition. Do not assume evidence from sources outside this partition.`,
        "Identify skills the student has actually demonstrated, not skills merely mentioned in a target job title.",
        "Every skill must cite an exact sourceTitle from the supplied evidence and a short verbatim quote from that source.",
        "Create the skill cards and their category labels yourself. Use specific skill names and specific category labels derived from the evidence.",
        "Do not reuse a predefined category taxonomy. Invent concise category labels from the evidence.",
        "The skills array is the data source for the visual skill graph. Do not rely on the summary to communicate skills.",
        "Each evidence quote must be an exact contiguous phrase or sentence copied from the matching source content.",
        "If you cannot provide an exact quote for a skill, omit that skill.",
        "For GitHub evidence, repository language statistics, dependency manifests, config files, file paths, README excerpts, source excerpts, and recent commit messages are valid evidence of demonstrated technical work.",
        "GitHub profile bio, stars, followers, or a technology name alone are weak evidence; score those low unless repository files or README text support the skill.",
        "Do not invent experience, tools, outcomes, credentials, or proficiency.",
        "Merge overlapping skills within this partition and use specific, employer-recognizable names.",
        "Category should be a concise AI-created label based only on the evidence.",
        "Score evidence strength consistently: 35 exposure, 50 guided practice, 65 independent application, 80 repeated delivery or measured impact, 90 advanced repeated impact.",
        "Prefer 3 to 8 strong skills. Return fewer or zero when evidence is limited.",
        "The target role is context for relevance only and is never evidence.",
        "The summary must describe only skills returned in the skills array. If the array is empty, say the evidence is insufficient.",
      ].join(" "),
    },
    {
      role: "user",
      content: skillAnalysisBrief(profile),
    },
  ];
}

function existingSkillsForPartition(skills: Skill[], profile: StudentInput) {
  const titles = new Set(skillEvidenceSources(profile).map((source) => source.title.toLowerCase()));
  return skills.filter((skill) => skill.evidence.some((item) => titles.has(item.sourceTitle.toLowerCase())));
}

function mergeSkillAnalyses(partitions: CompletedSkillAnalysisPartition[]): ParsedSkillAnalysis {
  const merged = new Map<string, Skill>();
  partitions.forEach(({ analysis }) => {
    analysis.skills.forEach((skill) => {
      const key = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const current = merged.get(key);
      if (!current) {
        merged.set(key, skill);
        return;
      }
      const evidence = uniqueBy(
        [...current.evidence, ...skill.evidence],
        (item) => `${item.sourceTitle.toLowerCase()}:${normalizeEvidenceText(item.quote)}`,
      ).slice(0, 5);
      merged.set(key, {
        ...(skill.score > current.score ? skill : current),
        score: Math.max(current.score, skill.score),
        terms: unique([...current.terms, ...skill.terms]).slice(0, 10),
        evidence,
      });
    });
  });

  return {
    skills: Array.from(merged.values()).sort((left, right) => right.score - left.score).slice(0, 16),
    summary: partitions
      .filter(({ analysis }) => analysis.summary)
      .map(({ label, analysis }) => `${label}: ${analysis.summary}`)
      .join(" "),
    confidenceNotes: partitions
      .flatMap(({ label, analysis }) => analysis.confidenceNotes.map((note) => `${label}: ${note}`))
      .slice(0, 6),
  };
}

function questProfileBrief(input: StudentInput, result: ReturnType<typeof analyzeStudent>) {
  const skills = result.skills
    .slice(0, 8)
    .map((skill) => `- ${skill.name} (${Math.round(skill.score)}/100): ${skill.evidence[0]?.quote ?? skill.terms.join(", ")}`)
    .join("\n");
  let remainingCharacters = 18000;
  const sources = input.sources
    .slice(0, 8)
    .flatMap((source) => {
      if (remainingCharacters <= 0) return [];
      const isGithub = source.type === "github" || source.content.startsWith("GitHub");
      const sourceLimit = isGithub ? 8000 : 3000;
      const excerpt = source.content.slice(0, Math.min(sourceLimit, remainingCharacters));
      remainingCharacters -= excerpt.length;
      return [[
        `Source: ${source.title}`,
        `Type: ${source.type}`,
        excerpt,
      ].join("\n")];
    })
    .join("\n\n---\n\n");

  return [
    `Name: ${input.name || "Student"}`,
    `Target role: ${input.targetRole || "Not set"}`,
    `Headline: ${input.headline || "Not set"}`,
    `Links: ${input.links || "Not set"}`,
    "",
    `Current evidence-derived skills:\n${skills || "No skills detected yet."}`,
    "",
    `Evidence sources:\n${sources || "No imported evidence yet."}`,
  ].join("\n\n");
}

function skillAnalysisBrief(input: StudentInput) {
  const sources = skillEvidenceSources(input);
  const githubSources = sources.filter((source) => isGithubSourceTitle(source.title) || source.content.startsWith("GitHub"));
  const otherSources = sources.filter((source) => !githubSources.includes(source));
  let remainingCharacters = 42000;
  const orderedSources = [...githubSources, ...otherSources];
  const evidence = orderedSources.flatMap((source, index) => {
    if (remainingCharacters <= 0) return [];
    const isGithub = isGithubSourceTitle(source.title) || source.content.startsWith("GitHub");
    const sourceLimit = isGithub ? 26000 : 4500;
    const content = isGithub ? compactGithubEvidence(source.content) : source.content;
    const excerpt = content.slice(0, Math.min(sourceLimit, remainingCharacters));
    remainingCharacters -= excerpt.length;
    return [[
      `SOURCE ${index + 1}`,
      `sourceTitle: ${source.title}`,
      `sourceType: ${isGithub ? "github" : "other"}`,
      "content:",
      excerpt,
    ].join("\n")];
  }).join("\n\n---\n\n");

  return [
    "Analyze the student's demonstrated skills from the evidence below.",
    `Student name: ${input.name || "Not provided"}`,
    `Target role (context only, not evidence): ${input.targetRole || "Not provided"}`,
    `GitHub evidence present: ${githubSources.length ? "yes" : "no"}`,
    "",
    "Use sourceTitle exactly as written. Quotes must be copied from the matching source content.",
    "If the evidence only names a skill without showing use, keep its score low or omit it.",
    "When GitHub evidence is present, analyze it before resume evidence and create repository-backed skill cards whenever README lines, language statistics, dependency/config files, file paths, source excerpts, or recent commit messages support them.",
    "Do not return only resume-backed skills when GitHub sources contain repository evidence. If GitHub evidence is present but unusable, state why in confidenceNotes.",
    "For GitHub evidence, quote exact lines from the digest or detailed repository evidence so the app can verify the skill.",
    "",
    evidence || "No usable evidence was supplied.",
  ].join("\n");
}

function compactGithubEvidence(content: string) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const priorityPatterns = [
    /^GitHub (profile )?evidence digest:/i,
    /^Repository evidence:/i,
    /^Repository .+ description:/i,
    /^Repository .+ primary language:/i,
    /^Repository .+ languages by bytes:/i,
    /^Repository .+ detected technologies:/i,
    /^Repository .+ README says:/i,
    /^Repository .+ topics:/i,
    /^Repository .+ dependency or config files include:/i,
    /^Repository .+ recent commit messages include:/i,
    /^Repository .+ project files include:/i,
    /^File type counts:/i,
    /^Dependency and configuration excerpts:/i,
    /^Representative source file excerpts:/i,
    /^File: /i,
    /\b(dependencies|devDependencies|scripts|import|from|export|function|class|interface|type|const|let|async|await)\b/i,
  ];
  const selected = unique(lines.filter((line) => priorityPatterns.some((pattern) => pattern.test(line))));
  const compact = takeLinesWithinBudget(selected.length ? selected : lines, 28000);
  return compact || content.slice(0, 28000);
}

function takeLinesWithinBudget(lines: string[], maxCharacters: number) {
  const selected: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = used + line.length + 1;
    if (next > maxCharacters) break;
    selected.push(line);
    used = next;
  }
  return selected.join("\n");
}

function parseAiSkillAnalysis(content: string, input: StudentInput): Pick<SkillAnalysisState, "skills" | "summary" | "confidenceNotes"> {
  const parsed = parseStructuredJson(content);
  const sources = skillEvidenceSources(input);
  const seen = new Set<string>();
  const skills = (Array.isArray(parsed.skills) ? parsed.skills : [])
    .map((candidate: any): Skill | null => {
      const name = cleanText(candidate?.name, 80);
      const category = cleanText(candidate?.category, 48);
      const score = Math.max(0, Math.min(100, Math.round(Number(candidate?.score ?? 0))));
      const key = name.toLowerCase();
      if (!name || !category || seen.has(key) || !Number.isFinite(score)) return null;

      const terms = (Array.isArray(candidate?.terms) ? candidate.terms : [])
        .map((term: unknown) => cleanText(term, 40).toLowerCase())
        .filter(Boolean)
        .filter((term: string, index: number, all: string[]) => all.indexOf(term) === index)
        .slice(0, 6);

      const exactEvidence = (Array.isArray(candidate?.evidence) ? candidate.evidence : [])
        .map((item: any) => verifySkillEvidence(item, sources))
        .filter((item: Skill["evidence"][number] | null): item is Skill["evidence"][number] => Boolean(item))
        .slice(0, 3);
      const evidence = exactEvidence.length ? exactEvidence : inferAiSkillEvidence(candidate, sources, name, terms);
      if (!evidence.length) return null;

      seen.add(key);
      return {
        name,
        category,
        score,
        terms: terms.length ? terms : [name.toLowerCase()],
        evidence,
      };
    })
    .filter((skill: Skill | null): skill is Skill => Boolean(skill))
    .sort((left: Skill, right: Skill) => right.score - left.score)
    .slice(0, 10);

  return {
    skills,
    summary: cleanText(parsed.summary, 360),
    confidenceNotes: (Array.isArray(parsed.confidenceNotes) ? parsed.confidenceNotes : [])
      .map((note: unknown) => cleanText(note, 180))
      .filter(Boolean)
      .slice(0, 3),
  };
}

function verifySkillEvidence(
  candidate: any,
  sources: Array<{ title: string; content: string }>,
): Skill["evidence"][number] | null {
  const requestedTitle = cleanText(candidate?.sourceTitle, 120);
  const quote = cleanText(candidate?.quote, 320);
  const source = sources.find((item) => item.title.toLowerCase() === requestedTitle.toLowerCase());
  if (!source || quote.length < 8) return null;

  const normalizedSource = normalizeEvidenceText(source.content);
  const normalizedQuote = normalizeEvidenceText(quote);
  if (!normalizedSource.includes(normalizedQuote)) return null;

  return { sourceTitle: source.title, quote };
}

function inferAiSkillEvidence(
  candidate: any,
  sources: Array<{ title: string; content: string }>,
  skillName: string,
  terms: string[],
): Skill["evidence"] {
  const requestedTitles = (Array.isArray(candidate?.evidence) ? candidate.evidence : [])
    .map((item: any) => cleanText(item?.sourceTitle, 120).toLowerCase())
    .filter(Boolean);
  const candidateQuotes = (Array.isArray(candidate?.evidence) ? candidate.evidence : [])
    .map((item: any) => cleanText(item?.quote, 220))
    .filter(Boolean)
    .join(" ");
  const pool = requestedTitles.length
    ? sources.filter((source) => requestedTitles.includes(source.title.toLowerCase()))
    : sources;
  const keywords = unique([
    ...terms,
    ...skillName.toLowerCase().split(/[^a-z0-9+#.]+/i),
    ...candidateQuotes.toLowerCase().split(/[^a-z0-9+#.]+/i),
  ])
    .map((word) => word.trim())
    .filter((word) => word.length >= 4)
    .slice(0, 18);

  return pool
    .flatMap((source) => sourceEvidenceLines(source.content)
      .map((line) => ({
        sourceTitle: source.title,
        quote: cleanText(line, 320),
        score: scoreEvidenceLine(line, keywords),
      })))
    .filter((item) => item.quote.length >= 8 && item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ sourceTitle, quote }) => ({ sourceTitle, quote }));
}

function sourceEvidenceLines(content: string) {
  return content
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 16 && line.length <= 700);
}

function scoreEvidenceLine(line: string, keywords: string[]) {
  const lower = line.toLowerCase();
  const keywordScore = keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 3 : 0), 0);
  const githubEvidenceScore = /repository .+ (readme says|recent commit messages include|dependency or config files include|languages by bytes|detected technologies|project files include|description:)/i.test(line)
    ? 8
    : 0;
  return keywordScore + githubEvidenceScore;
}

function skillEvidenceSources(input: StudentInput) {
  const sources = input.sources
    .filter((source) => source.content.trim())
    .slice(0, 10)
    .map((source) => ({ title: source.title, content: source.content }));
  const profileStatement = [input.headline, input.links].filter((value) => value.trim()).join("\n");
  return profileStatement
    ? [{ title: "Profile statement and links", content: profileStatement }, ...sources]
    : sources;
}

function normalizeEvidenceText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function enrichQuestVideos(projects: ProjectRecommendation[]) {
  return Promise.all(projects.map(async (project) => {
    const query = [project.title, project.deliverables[0] ?? "", "tutorial"].filter(Boolean).join(" ");
    const response = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!response.ok || !data.video?.url) throw new Error(`Could not verify a YouTube video for "${project.title}". Try regenerating.`);
    const docs = project.resources.filter((resource) => resource.kind === "doc");
    return {
      ...project,
      resources: [{
        label: cleanText(data.video.title, 42) || "Verified YouTube video",
        url: data.video.url,
        kind: "video" as const,
      }, ...docs].slice(0, 5),
    };
  }));
}

function parseAiQuestBoard(content: string, allowGithubProof: boolean): ProjectRecommendation[] {
  const parsed = parseStructuredJson(content);
  const projects = (Array.isArray(parsed.projects) ? parsed.projects : [])
    .map((project: unknown) => normalizeQuestProject(project, allowGithubProof))
    .filter((project: ProjectRecommendation | null): project is ProjectRecommendation => Boolean(project))
    .slice(0, 5);
  if (!projects.length) throw new Error("AI did not return usable quests. Try regenerating with a clearer target role or more evidence.");
  return projects;
}

function normalizeQuestProject(project: any, allowGithubProof: boolean): ProjectRecommendation | null {
  const title = cleanText(project?.title, 80);
  const why = cleanText(project?.why, 220);
  const proofSignal = cleanText(project?.proofSignal, 180);
  const deliverables = Array.isArray(project?.deliverables)
    ? project.deliverables.map((item: unknown) => cleanText(item, 70)).filter(Boolean).slice(0, 6)
    : [];
  if (!title || !why || !proofSignal || deliverables.length < 3) return null;
  const difficulty = ["Weekend", "Two weeks", "Capstone"].includes(project?.difficulty)
    ? project.difficulty as ProjectRecommendation["difficulty"]
    : "Two weeks";
  return {
    title,
    why,
    deliverables,
    proofSignal,
    difficulty,
    proofMode: project?.proofMode === "github" && allowGithubProof ? "github" : "photo",
    resources: normalizeQuestResources(project?.resources, title),
  };
}

function normalizeQuestResources(resources: unknown, title: string): ProjectRecommendation["resources"] {
  const normalized = Array.isArray(resources)
    ? resources.map((resource: any) => {
        const url = cleanUrl(resource?.url);
        const label = cleanText(resource?.label, 36);
        const kind = resource?.kind === "video" ? "video" : "doc";
        return url && label ? { label, url, kind } : null;
      }).filter((resource): resource is ProjectRecommendation["resources"][number] => Boolean(resource)).slice(0, 5)
    : [];
  if (!normalized.some((resource) => resource.kind === "video")) {
    normalized.unshift({ label: "YouTube tutorial", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} student project tutorial`)}`, kind: "video" });
  }
  if (!normalized.some((resource) => resource.kind === "doc")) {
    normalized.push({ label: "Guide search", url: `https://www.google.com/search?q=${encodeURIComponent(`${title} documentation guide`)}`, kind: "doc" });
  }
  return normalized.slice(0, 5);
}

function calculateQuestGame(projects: ProjectRecommendation[], progressMap: Record<string, ProjectProgress>): QuestGameState {
  const currentProjectMap = new Map(projects.map((project) => [projectKey(project.title), project]));
  const completedEntries = Object.entries(progressMap).filter(([, progress]) => progress.status === "verified");
  const xp = completedEntries.reduce((total, [key, progress]) => {
    const difficulty = progress.difficulty ?? currentProjectMap.get(key)?.difficulty ?? "Weekend";
    return total + questXpForDifficulty(difficulty);
  }, 0);
  let rankIndex = 0;
  questRanks.forEach((rank, index) => {
    if (xp >= rank.threshold) rankIndex = index;
  });
  const currentRank = questRanks[rankIndex];
  const nextRank = questRanks[rankIndex + 1];
  const progressPercent = nextRank
    ? Math.round(((xp - currentRank.threshold) / (nextRank.threshold - currentRank.threshold)) * 100)
    : 100;
  return {
    xp,
    completed: completedEntries.length,
    currentRank,
    nextRank,
    rankIndex,
    progressPercent: Math.max(0, Math.min(100, progressPercent)),
    xpToNext: nextRank ? Math.max(0, nextRank.threshold - xp) : 0,
  };
}

function questXpForDifficulty(difficulty: ProjectRecommendation["difficulty"]) {
  return difficulty === "Capstone" ? 300 : difficulty === "Two weeks" ? 180 : 100;
}

function getQuestProgressPercent(progress: ProjectProgress) {
  if (progress.status === "verified") return 100;
  if (typeof progress.photoScore === "number") return Math.max(0, Math.min(99, progress.photoScore));
  if (progress.status === "tracking") return 35;
  return 0;
}

function extractJson(content: string) {
  const withoutFence = content.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    const preview = withoutFence.slice(0, 180);
    throw new Error(`AI returned text instead of structured skill data. Check that OPENAI_API_KEY is set and the latest deployment is running. Response started with: ${preview || "empty response"}`);
  }
  return withoutFence.slice(start, end + 1);
}

function parseStructuredJson(content: string) {
  try {
    return JSON.parse(content);
  } catch {
    return JSON.parse(extractJson(content));
  }
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanUrl(value: unknown) {
  const url = String(value ?? "").trim();
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function hasQuestInputs(input: StudentInput) {
  return Boolean(input.name.trim() || input.headline.trim() || input.targetRole.trim() || input.links.trim() || input.sources.length);
}

function hasSkillEvidence(input: StudentInput) {
  return Boolean(input.headline.trim() || input.links.trim() || input.sources.some((source) => source.content.trim()));
}

function skillProfileSignature(input: StudentInput) {
  return simpleHash(JSON.stringify({
    headline: input.headline,
    links: input.links,
    sources: input.sources.map((source) => ({
      id: source.id,
      title: source.title,
      type: source.type,
      content: source.content,
    })),
  }));
}

function isTechnicalStudent(input: StudentInput, result: ReturnType<typeof analyzeStudent>) {
  const skillText = result.skills.map((skill) => `${skill.name} ${skill.category} ${skill.terms.join(" ")}`).join(" ");
  const profileText = `${input.targetRole} ${input.headline} ${input.links} ${skillText} ${input.sources.map((source) => `${source.title} ${source.content.slice(0, 1200)}`).join(" ")}`;
  return /\b(ai|software|developer|engineer|frontend|backend|full stack|data|analytics|cyber|security|computer science|programming|code|cloud|devops|machine learning|python|javascript|typescript|react|sql)\b/i.test(profileText);
}

function questSignature(input: StudentInput, result: ReturnType<typeof analyzeStudent>) {
  return simpleHash(JSON.stringify({
    name: input.name,
    headline: input.headline,
    targetRole: input.targetRole,
    links: input.links,
    sources: input.sources.map((source) => ({ id: source.id, title: source.title, type: source.type, size: source.content.length, sample: source.content.slice(0, 240) })),
    skills: result.skills.map((skill) => ({ name: skill.name, category: skill.category, score: Math.round(skill.score) })),
  }));
}

function simpleHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return String(hash);
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasNewProgress(baseline: RepoProgressSnapshot, snapshot: RepoProgressSnapshot) {
  return snapshot.defaultBranchSha !== baseline.defaultBranchSha
    || snapshot.commitCount > baseline.commitCount
    || new Date(snapshot.pushedAt).getTime() > new Date(baseline.pushedAt).getTime();
}

async function prepareProjectPhoto(file: File): Promise<ProjectPhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image file.`);
  return { id: crypto.randomUUID(), name: file.name, dataUrl: await compressImage(file), createdAt: new Date().toISOString() };
}

function compressImage(file: File, maxEdge = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Browser could not prepare the image for AI review."));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}.`));
    };
    image.src = objectUrl;
  });
}

function extractCompletionScore(content: string) {
  const score = content.match(/(?:completion|complete|progress)?\D*(\d{1,3})\s*%/i)?.[1];
  return Math.max(0, Math.min(100, Number(score ?? 0)));
}

function dedupeJobListings(listings: JobListing[]) {
  const seen = new Set<string>();
  return listings.filter((job) => {
    const key = `${job.title}-${job.company}-${job.location}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeProviderStatus(statuses: ProviderStatus[]) {
  const merged = new Map<string, ProviderStatus>();
  statuses.forEach((status) => {
    const existing = merged.get(status.provider);
    merged.set(status.provider, existing ? {
      ...existing,
      ok: existing.ok || status.ok,
      count: existing.count + status.count,
      rawCount: (existing.rawCount ?? 0) + (status.rawCount ?? 0),
      error: existing.error && status.error ? existing.error : undefined,
      searchUrl: existing.searchUrl ?? status.searchUrl,
    } : { ...status });
  });
  return Array.from(merged.values());
}

function loadWorkspace(): StudentInput {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return initialInput;
  try {
    const parsed = JSON.parse(saved);
    return { ...initialInput, ...parsed, sources: parsed.sources ?? [] };
  } catch {
    return initialInput;
  }
}

function loadProjectProgress(): Record<string, ProjectProgress> {
  const saved = localStorage.getItem(PROGRESS_KEY);
  if (!saved) return {};
  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function loadQuestBoard(): QuestBoardState {
  const saved = localStorage.getItem(QUEST_KEY);
  if (!saved) return { projects: [], signature: "", createdAt: "" };
  try {
    const parsed = JSON.parse(saved);
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      signature: typeof parsed.signature === "string" ? parsed.signature : "",
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return { projects: [], signature: "", createdAt: "" };
  }
}

function loadApplications(): JobApplication[] {
  const saved = localStorage.getItem(APPLICATIONS_KEY);
  if (!saved) return [];
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadSkillAnalysis(): SkillAnalysisState {
  const saved = localStorage.getItem(SKILL_ANALYSIS_KEY);
  if (!saved) return { skills: [], summary: "", confidenceNotes: [], signature: "", analyzedAt: "" };
  try {
    const parsed = JSON.parse(saved);
    if (hasLegacyGenericSkillCards(parsed.skills)) {
      return { skills: [], summary: "", confidenceNotes: [], signature: "", analyzedAt: "" };
    }
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      confidenceNotes: Array.isArray(parsed.confidenceNotes) ? parsed.confidenceNotes : [],
      signature: typeof parsed.signature === "string" ? parsed.signature : "",
      analyzedAt: typeof parsed.analyzedAt === "string" ? parsed.analyzedAt : "",
    };
  } catch {
    return { skills: [], summary: "", confidenceNotes: [], signature: "", analyzedAt: "" };
  }
}

function hasLegacyGenericSkillCards(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((skill: any) => typeof skill?.group === "string" || typeof skill?.category !== "string");
}

function formatApplicationDate(date: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "student";
}

function projectKey(title: string) {
  return slugify(title);
}
