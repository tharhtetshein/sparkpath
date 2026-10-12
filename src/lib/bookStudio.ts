export type BookStudio = {
  diagramTitle: string;
  concepts: Array<{ label: string; explanation: string; sourcePhrase: string }>;
  steps: Array<{ title: string; action: string; outcome: string }>;
  check: Array<{ question: string; choices: string[]; correctIndex: number; explanation: string; sourcePhrase: string }>;
  generatedAt: string;
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

export function parseBookStudio(content: string, sourceText: string): BookStudio {
  const parsed = JSON.parse(content);
  const source = normalized(sourceText);
  const anchored = (phrase: string) => normalized(phrase).length >= 8 && source.includes(normalized(phrase));
  const diagramTitle = compact(parsed.diagramTitle, 100) || "See how the ideas connect";
  const concepts = (Array.isArray(parsed.concepts) ? parsed.concepts : [])
    .map((item: any) => ({
      label: compact(item?.label, 72),
      explanation: compact(item?.explanation, 360),
      sourcePhrase: compact(item?.sourcePhrase, 160),
    }))
    .filter((item: BookStudio["concepts"][number]) => item.label && item.explanation && anchored(item.sourcePhrase))
    .slice(0, 5);
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .map((item: any) => ({
      title: compact(item?.title, 80),
      action: compact(item?.action, 280),
      outcome: compact(item?.outcome, 280),
    }))
    .filter((item: BookStudio["steps"][number]) => item.title && item.action && item.outcome)
    .slice(0, 5);
  let check = (Array.isArray(parsed.check) ? parsed.check : [])
    .map((item: any) => ({
      question: compact(item?.question, 280),
      choices: Array.isArray(item?.choices) ? item.choices.map((choice: unknown) => compact(choice, 160)) : [],
      correctIndex: Number(item?.correctIndex),
      explanation: compact(item?.explanation, 420),
      sourcePhrase: compact(item?.sourcePhrase, 160),
    }))
    .filter((item: BookStudio["check"][number]) => item.question && item.explanation && item.choices.length === 3 && item.choices.every(Boolean) && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < 3 && anchored(item.sourcePhrase) && clueSupportsAnswer(item.choices[item.correctIndex], item.sourcePhrase))
    .slice(0, 1);
  if (!check.length && concepts.length >= 2) {
    const [focus, alternative] = concepts;
    const choices = [alternative.explanation, `The PDF does not discuss ${focus.label}.`];
    const correctIndex = diagramTitle.length % 3;
    choices.splice(correctIndex, 0, focus.explanation);
    check = [{
      question: `Which statement best explains ${focus.label}?`,
      choices,
      correctIndex,
      explanation: `The book connects ${focus.label} with this passage.`,
      sourcePhrase: focus.sourcePhrase,
    }];
  }
  return {
    diagramTitle,
    concepts,
    steps,
    check,
    generatedAt: new Date().toISOString(),
  };
}
