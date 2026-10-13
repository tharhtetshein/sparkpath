export type BookStudio = {
  diagramTitle: string;
  concepts: Array<{ label: string; explanation: string; sourcePhrase: string }>;
  steps: Array<{ title: string; action: string; outcome: string }>;
  check: Array<{ question: string; choices: string[]; correctIndex: number; explanation: string; sourcePhrase: string }>;
  pageCoverage?: Array<{ page: number; complete: boolean; missing: string[] }>;
  coverageComplete?: boolean;
  unverifiedVisualPages?: number[];
  generatedAt: string;
  emptyReason?: "front_matter" | "source_check" | "visual_content";
};

const text = { type: "string" };
export const bookStudioResponseFormat = {
  name: "book_study_studio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["diagramTitle", "concepts", "steps", "check"],
    properties: {
      diagramTitle: text,
      concepts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "explanation", "sourcePhrase"],
          properties: { label: text, explanation: text, sourcePhrase: text },
        },
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "action", "outcome"],
          properties: { title: text, action: text, outcome: text },
        },
      },
      check: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "choices", "correctIndex", "explanation", "sourcePhrase"],
          properties: {
            question: text,
            choices: { type: "array", items: text },
            correctIndex: { type: "integer" },
            explanation: text,
            sourcePhrase: text,
          },
        },
      },
    },
  },
};

export const bookStudioAuditResponseFormat = {
  name: "book_studio_source_audit",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["conceptSupported", "stepSupported", "checkSupported", "pageCoverage"],
    properties: {
      conceptSupported: { type: "array", items: { type: "boolean" } },
      stepSupported: { type: "array", items: { type: "boolean" } },
      checkSupported: { type: "array", items: { type: "boolean" } },
      pageCoverage: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["page", "complete", "missing"],
          properties: { page: { type: "integer" }, complete: { type: "boolean" }, missing: { type: "array", items: text } },
        },
      },
    },
  },
};

function compact(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const evidenceStopWords = new Set(["about", "after", "also", "been", "could", "does", "from", "have", "into", "more", "most", "that", "their", "them", "there", "these", "this", "those", "were", "what", "when", "where", "which", "while", "with", "would"]);

function clueSupportsAnswer(answer: string, phrase: string): boolean {
  const keywords = [...new Set(normalized(answer).split(" ").filter((word) => word.length >= 4 && !evidenceStopWords.has(word)))];
  const phraseWords = new Set(normalized(phrase).split(" "));
  const overlaps = keywords.filter((word) => phraseWords.has(word)).length;
  return overlaps >= Math.min(2, keywords.length) && keywords.length > 0;
}

function contradictsSource(claim: string, phrase: string): boolean {
  const claimWords = normalized(claim);
  const sourceWords = normalized(phrase);
  const opposites: Array<[RegExp, RegExp]> = [
    [/\bincreas\w*\b/, /\bdecreas\w*\b/],
    [/\bimprov\w*\b/, /\bworsen\w*\b/],
    [/\bhigher\b/, /\blower\b/],
    [/\bcan\b/, /\bcannot\b/],
  ];
  return opposites.some(([positive, negative]) =>
    (positive.test(claimWords) && negative.test(sourceWords)) || (negative.test(claimWords) && positive.test(sourceWords)));
}

export function parseBookStudio(content: string, sourceText: string): BookStudio {
  const parsed = JSON.parse(content);
  const source = normalized(sourceText);
  const pages = [...new Set([...sourceText.matchAll(/\[PDF page (\d+)\]/g)].map((match) => Number(match[1])))];
  const anchored = (phrase: string) => normalized(phrase).length >= 8 && source.includes(normalized(phrase));
  const diagramTitle = compact(parsed.diagramTitle, 100) || "See how the ideas connect";
  const concepts = (Array.isArray(parsed.concepts) ? parsed.concepts : [])
    .map((item: any) => ({
      label: compact(item?.label, 72),
      explanation: compact(item?.explanation, 360),
      sourcePhrase: compact(item?.sourcePhrase, 160),
    }))
    .filter((item: BookStudio["concepts"][number]) => item.label && item.explanation && anchored(item.sourcePhrase) && !contradictsSource(item.explanation, item.sourcePhrase))
    .slice(0, 5);
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .map((item: any) => ({
      title: compact(item?.title, 80),
      action: compact(item?.action, 280),
      outcome: compact(item?.outcome, 280),
    }))
    .filter((item: BookStudio["steps"][number]) => item.title && item.action && item.outcome)
    .slice(0, 5);
  const check = (Array.isArray(parsed.check) ? parsed.check : [])
    .map((item: any) => ({
      question: compact(item?.question, 280),
      choices: Array.isArray(item?.choices) ? item.choices.map((choice: unknown) => compact(choice, 160)) : [],
      correctIndex: Number(item?.correctIndex),
      explanation: compact(item?.explanation, 420),
      sourcePhrase: compact(item?.sourcePhrase, 160),
    }))
    .filter((item: BookStudio["check"][number]) => item.question && item.explanation && item.choices.length === 3 && item.choices.every(Boolean) && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < 3 && anchored(item.sourcePhrase) && clueSupportsAnswer(item.choices[item.correctIndex], item.sourcePhrase) && !contradictsSource(`${item.choices[item.correctIndex]} ${item.explanation}`, item.sourcePhrase))
    .slice(0, 1);
  return {
    diagramTitle,
    concepts,
    steps,
    check,
    pageCoverage: pages.map((page) => ({ page, complete: false, missing: [] })),
    coverageComplete: false,
    unverifiedVisualPages: [],
    generatedAt: new Date().toISOString(),
    ...(!concepts.length && !steps.length && !check.length ? {
      emptyReason: (parsed.concepts?.length || parsed.steps?.length || parsed.check?.length ? "source_check" : "front_matter") as BookStudio["emptyReason"],
    } : {}),
  };
}

export function applyBookStudioAudit(studio: BookStudio, response: string, flags: { unreadablePages?: number[]; visualPages?: number[] } = {}): BookStudio {
  const audit = JSON.parse(response);
  if (!Array.isArray(audit.conceptSupported) || !Array.isArray(audit.stepSupported) || !Array.isArray(audit.checkSupported) || !Array.isArray(audit.pageCoverage)) {
    throw new Error("AI did not return a complete source audit. Try building the study tools again.");
  }
  const concepts = studio.concepts.filter((_, index) => audit.conceptSupported[index] === true);
  const steps = studio.steps.filter((_, index) => audit.stepSupported[index] === true);
  let check = studio.check.filter((_, index) => audit.checkSupported[index] === true);
  if (!check.length && concepts.length >= 2) {
    const [focus, alternative] = concepts;
    const choices = [alternative.explanation, `The PDF does not discuss ${focus.label}.`];
    const correctIndex = studio.diagramTitle.length % 3;
    choices.splice(correctIndex, 0, focus.explanation);
    check = [{
      question: `Which statement best explains ${focus.label}?`,
      choices,
      correctIndex,
      explanation: `The book connects ${focus.label} with this passage.`,
      sourcePhrase: focus.sourcePhrase,
    }];
  }
  const unreadablePages = Array.from(new Set(flags.unreadablePages ?? []));
  const visualPages = Array.from(new Set(flags.visualPages ?? []));
  const reports = new Map<number, any>(audit.pageCoverage.filter((item: any) => Number.isInteger(item?.page)).map((item: any) => [item.page, item]));
  const pageCoverage = (studio.pageCoverage ?? []).map(({ page }) => {
    const report = reports.get(page);
    const missing = Array.isArray(report?.missing) ? report.missing.map((item: unknown) => compact(item, 220)).filter(Boolean).slice(0, 8) : [];
    if (!report) missing.push("This page was not reported by the coverage audit.");
    const visualUnverified = visualPages.includes(page);
    if (visualUnverified) missing.push("A figure or embedded image on this page was not included in the text coverage check.");
    const complete = report?.complete === true && !missing.length && !unreadablePages.includes(page);
    return { page, complete, missing };
  });
  unreadablePages.forEach((page) => {
    if (pageCoverage.some((entry) => entry.page === page)) return;
    pageCoverage.push({ page, complete: false, missing: ["No selectable text was extracted from this page."] });
  });
  return {
    ...studio,
    concepts,
    steps,
    check,
    pageCoverage: pageCoverage.sort((a, b) => a.page - b.page),
    coverageComplete: pageCoverage.length > 0 && pageCoverage.every((entry) => entry.complete),
    unverifiedVisualPages: visualPages,
    emptyReason: concepts.length || steps.length || check.length
      ? undefined
      : flags.unreadablePages?.length || visualPages.length
        ? "visual_content"
        : studio.emptyReason === "front_matter" && pageCoverage.every((page) => page.complete) ? "front_matter" : "source_check",
  };
}
