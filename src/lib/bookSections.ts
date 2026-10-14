export type BookSection = {
  id: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  codeBlocks?: BookCodeBlock[];
};

export type BookCodeBlock = {
  id: string;
  page: number;
  language: string;
  code: string;
  symbols: string[];
  definedSymbols: string[];
  startsNearTop: boolean;
  endsNearBottom: boolean;
};

export type BookMapEntry = {
  number: number;
  title: string;
  printedPage: number;
  pdfPage?: number;
  part?: string;
};

export const MAX_SECTION_CHARS = 4500;

const searchStopWords = new Set([
  "about", "after", "again", "also", "been", "being", "book", "could", "does", "from", "have", "into", "just", "more", "most", "only", "other", "over", "section", "should", "some", "than", "that", "their", "them", "there", "these", "they", "this", "those", "through", "under", "very", "what", "when", "where", "which", "while", "with", "would",
]);

function searchWords(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.filter((word) => !searchStopWords.has(word)) ?? []);
}

export function buildBookMap(pages: string[]): BookMapEntry[] {
  const searchEnd = Math.min(pages.length, Math.max(24, Math.ceil(pages.length * 0.12)));
  const tocPage = pages.slice(0, searchEnd).findIndex((page) => /\btable\s+of\s+contents\b|\bcontents\b/i.test(page));
  if (tocPage < 0) return [];

  const chapterPattern = /(?:^|\s)(\d{1,2})\.\s+([A-Z][^.!?]{4,90})\.(?:\s*\.){2,}\s*(\d{1,3})\b/g;
  const compactChapterPattern = /(?:^|\s)(\d{1,2})\.\s+([A-Z][^.!?]{4,140})\.\s+(\d{1,3})(?=\s|$)/g;
  const partPattern = /\bPart\s+([IVXLCDM]+)\.\s+([A-Z][^.!?]{4,90})/g;
  const entries: BookMapEntry[] = [];
  let activePart = "";
  const tocEnd = Math.min(pages.length, tocPage + 16);
  for (const page of pages.slice(tocPage, tocEnd)) {
    const chapterMatches = [
      ...[...page.matchAll(chapterPattern)],
      ...[...page.matchAll(compactChapterPattern)],
    ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const structureMatches = [
      ...[...page.matchAll(partPattern)].map((match) => ({ kind: "part" as const, match, index: match.index ?? 0 })),
      ...chapterMatches.map((match) => ({ kind: "chapter" as const, match, index: match.index ?? 0 })),
    ].sort((a, b) => a.index - b.index);
    for (const { kind, match } of structureMatches) {
      if (kind === "part") {
        activePart = `Part ${match[1]}: ${match[2].replace(/\s+\d{1,3}$/, "").trim()}`;
        continue;
      }
      const number = Number(match[1]);
      const title = match[2].replace(/\s+/g, " ").trim();
      const printedPage = Number(match[3]);
      if (!title || entries.some((entry) => entry.number === number)) continue;
      entries.push({ number, title, printedPage, ...(activePart ? { part: activePart } : {}) });
    }
  }
  const ordered = entries.sort((a, b) => a.printedPage - b.printedPage).slice(0, 48);
  const actualContentStart = tocPage + 1;
  return ordered.map((entry) => {
    const expectedHeading = `chapter ${entry.number} ${entry.title}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const headingPage = pages.findIndex((page, pageIndex) => {
      if (pageIndex < actualContentStart) return false;
      const chapterMatch = /\bchapter\s+(\d+)\b/i.exec(page);
      if (!chapterMatch || Number(chapterMatch[1]) !== entry.number || (chapterMatch.index ?? Infinity) > 700) return false;
      const heading = page.slice(chapterMatch.index, chapterMatch.index + 300).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      return heading.startsWith(expectedHeading);
    });
    return headingPage < 0 ? entry : { ...entry, pdfPage: headingPage + 1 };
  });
}

export function bookMapContext(entries: BookMapEntry[], chapterTitle?: string): string {
  if (!entries.length) return "";
  const current = chapterTitle?.trim().toLowerCase();
  return entries.map((entry) =>
    `${entry.part ? `${entry.part} · ` : ""}Chapter ${entry.number}: ${entry.title} (printed page ${entry.printedPage}${entry.pdfPage ? `; PDF page ${entry.pdfPage}` : ""})${current === entry.title.toLowerCase() ? " ← current section" : ""}`,
  ).join("\n").slice(0, 5000);
}

export function mapBookSectionsToChapters(sections: BookSection[], entries: BookMapEntry[]): string[] {
  let currentTitle = "Opening pages";
  return sections.map((section) => {
    const source = section.text.toLowerCase();
    const physicalMatch = entries.find((entry) => entry.pdfPage && entry.pdfPage >= section.pageStart && entry.pdfPage <= section.pageEnd);
    if (physicalMatch) currentTitle = physicalMatch.title;
    if (physicalMatch || /\btable\s+of\s+contents\b/i.test(source)) return currentTitle;
    const opening = source.slice(0, 260);
    const matches = entries.filter((entry) => opening.includes(entry.title.toLowerCase()));
    if (matches.length === 1) currentTitle = matches[0].title;
    return currentTitle;
  });
}

export function findRelevantBookSections(query: string, sections: BookSection[], limit = 2): BookSection[] {
  if (!sections.length || limit < 1) return [];
  const queryWords = searchWords(query);
  if (!queryWords.size) return sections.slice(-limit).reverse();
  const documentFrequency = new Map<string, number>();
  const indexed = sections.map((section) => {
    const words = searchWords(section.text);
    words.forEach((word) => documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1));
    return { section, words };
  });
  const scored = indexed.map(({ section, words }, index) => {
    let score = 0;
    queryWords.forEach((word) => {
      if (!words.has(word)) return;
      const frequency = documentFrequency.get(word) ?? 1;
      score += Math.log(1 + sections.length / frequency);
    });
    return { section, score, index };
  }).filter((item) => item.score > 0);
  if (!scored.length) return sections.slice(-limit).reverse();
  return scored.sort((a, b) => b.score - a.score || b.index - a.index).slice(0, limit).map((item) => item.section);
}

const codeKeywords = new Set(["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "false", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nn", "none", "nonlocal", "not", "np", "numpy", "or", "pass", "raise", "return", "self", "super", "torch", "true", "try", "while", "with", "yield"]);

export function findRelevantBookCodeBlocks(query: string, currentBlocks: BookCodeBlock[], previousSections: BookSection[], currentPageStart?: number, limit = 3): BookCodeBlock[] {
  const currentSymbols = new Set((query.match(/[A-Za-z_]\w{2,}/g) ?? []).map((symbol) => symbol.toLowerCase()).filter((symbol) => !codeKeywords.has(symbol)));
  currentBlocks.forEach((block) => block.symbols.forEach((symbol) => currentSymbols.add(symbol.toLowerCase())));
  const candidates = new Map<string, BookCodeBlock>();
  previousSections.forEach((section) => section.codeBlocks?.forEach((block) => candidates.set(block.id, block)));
  const ranked = [...candidates.values()].map((block, index) => {
    let score = 0;
    block.definedSymbols.forEach((symbol) => { if (currentSymbols.has(symbol.toLowerCase())) score += 6; });
    block.symbols.forEach((symbol) => { if (currentSymbols.has(symbol.toLowerCase())) score += 1; });
    if (currentPageStart && block.page === currentPageStart - 1 && block.endsNearBottom && currentBlocks.some((current) => current.startsNearTop)) score += 10;
    return { block, index, score };
  }).filter((item) => item.score > 0);
  return ranked.sort((a, b) => b.score - a.score || b.block.page - a.block.page || a.index - b.index).slice(0, limit).map((item) => item.block);
}

export function formatBookCodeContext(blocks: BookCodeBlock[], maxChars = 6000, relatedBlocks: BookCodeBlock[] = []): string {
  const unique = [...new Map(blocks.map((block) => [block.id, block])).values()].sort((a, b) => a.page - b.page);
  const allBlocks = [...unique, ...relatedBlocks].sort((a, b) => a.page - b.page);
  let output = "";
  for (const [index, block] of unique.entries()) {
    const blockIndex = allBlocks.findIndex((candidate) => candidate.id === block.id);
    const previous = allBlocks[blockIndex - 1];
    const next = allBlocks[blockIndex + 1];
    const mayContinue = (block.endsNearBottom && next?.page === block.page + 1 && next.startsNearTop)
      || (block.startsNearTop && previous?.page === block.page - 1 && previous.endsNearBottom);
    const definitions = block.definedSymbols.length ? `; defines ${block.definedSymbols.slice(0, 8).join(", ")}` : "";
    const edge = mayContinue ? "; likely continues across adjacent page" : block.endsNearBottom ? "; reaches bottom of page" : block.startsNearTop ? "; starts near top of page" : "";
    const header = `[PDF page ${block.page}; ${block.language}${definitions}${edge}]\n`;
    const remaining = maxChars - output.length - header.length;
    if (remaining <= 0) break;
    const code = block.code.length > remaining ? `${block.code.slice(0, Math.max(0, remaining - 45))}\n[code excerpt shortened]` : block.code;
    output += `${output ? "\n\n" : ""}${header}${code}`;
    if (code.length < block.code.length || output.length >= maxChars) break;
  }
  return output;
}

export function selectRelevantBookPassage(source: string, query: string, maxChars = 1100): string {
  const queryWords = searchWords(query);
  const pages = [...source.matchAll(/\[PDF page (\d+)\]([\s\S]*?)(?=\[PDF page \d+\]|$)/g)];
  const sentences = pages.flatMap((page) => {
    const pageNumber = page[1];
    const body = page[2].trim();
    const parts = body.match(/[^.!?]+[.!?]?/g) ?? [body];
    return parts.map((sentence, index) => {
      const clean = sentence.replace(/\s+/g, " ").trim();
      const words = searchWords(clean);
      let score = 0;
      queryWords.forEach((word) => { if (words.has(word)) score += 1; });
      return { pageNumber, clean, score, order: Number(page.index) + index / 1000 };
    }).filter((item) => item.clean);
  });
  const selected = queryWords.size
    ? sentences.filter((sentence) => sentence.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 5).sort((a, b) => a.order - b.order)
    : [];
  const candidates = selected.length ? selected : sentences.slice(0, 5);
  let output = "";
  let currentPage = "";
  for (const sentence of candidates) {
    const prefix = sentence.pageNumber === currentPage ? "" : `${output ? "\n" : ""}[PDF page ${sentence.pageNumber}] `;
    const remaining = maxChars - output.length - prefix.length;
    if (remaining <= 0) break;
    output += prefix + sentence.clean.slice(0, remaining);
    currentPage = sentence.pageNumber;
    if (output.length >= maxChars) break;
  }
  return output;
}

export function bookResumeLessonId(
  course: { id: string; lastOpenedLessonId?: string; modules: Array<{ lessons: Array<{ id: string; content?: { researchedAt?: string } }> }> },
  activeCourseId: string,
  activeLessonId: string,
): string {
  const lessons = course.modules.flatMap((module) => module.lessons);
  const valid = (id: string | undefined) => Boolean(id && lessons.some((lesson) => lesson.id === id));
  if (valid(course.lastOpenedLessonId)) return course.lastOpenedLessonId!;
  if (course.id === activeCourseId && valid(activeLessonId)) return activeLessonId;
  return [...lessons].reverse().find((lesson) => lesson.content?.researchedAt)?.id ?? lessons[0]?.id ?? "";
}

export function splitBookIntoSections(pages: string[], codeBlocks: BookCodeBlock[] = []): BookSection[] {
  const sections: BookSection[] = [];
  let text = "";
  let start = 1;
  let end = 1;
  const flush = () => {
    if (!text.trim()) return;
    sections.push({
      id: crypto.randomUUID(),
      pageStart: start,
      pageEnd: end,
      text: text.trim(),
      ...(codeBlocks.some((block) => block.page >= start && block.page <= end) ? { codeBlocks: codeBlocks.filter((block) => block.page >= start && block.page <= end) } : {}),
    });
    text = "";
  };
  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    let remaining = page.trim();
    if (!remaining) return;
    while (remaining.length) {
      const prefix = `\n[PDF page ${pageNumber}] `;
      if (text && text.length + prefix.length + remaining.length > MAX_SECTION_CHARS && remaining.length <= MAX_SECTION_CHARS - prefix.length) {
        flush();
      }
      if (!text) start = pageNumber;
      end = pageNumber;
      const capacity = MAX_SECTION_CHARS - text.length - prefix.length;
      if (capacity < 1) {
        flush();
        continue;
      }
      const slice = remaining.slice(0, capacity);
      text += prefix + slice;
      remaining = remaining.slice(slice.length);
      if (remaining) flush();
    }
  });
  flush();
  return sections;
}
