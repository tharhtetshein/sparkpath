import type { BookCodeBlock } from "./bookSections";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
};

type CodeLine = { y: number; items: PdfTextItem[] };

const definitionPattern = /\b(?:class|def)\s+([A-Za-z_]\w*)/g;
const assignmentPattern = /^\s*(?:self\.)?([A-Za-z_]\w*)\s*=(?!=)/gm;
const identifierPattern = /\b[A-Za-z_]\w{2,}\b/g;
const codeSignal = /\b(?:class|def|return|import|from|for|if|elif|else|self)\b|\w+\s*=|\w+\s*\(/;
const strongCodeSignal = /^\s*(?:(?:class|def|return|import|from|for|if|elif|else|with|try|raise|pass)\b|(?:self\.)?[A-Za-z_]\w*\s*=(?!=))/m;

function median(values: number[]): number {
  if (!values.length) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function codeIdentifiers(code: string): { symbols: string[]; definedSymbols: string[] } {
  const defined = new Set<string>();
  for (const match of code.matchAll(definitionPattern)) defined.add(match[1]);
  for (const match of code.matchAll(assignmentPattern)) defined.add(match[1]);
  const symbols = [...new Set(code.match(identifierPattern) ?? [])];
  return { symbols, definedSymbols: [...defined] };
}

function reconstructLine(items: PdfTextItem[], baseX: number, characterWidth: number): string {
  const sorted = [...items].sort((a, b) => a.transform[4] - b.transform[4]);
  if (!sorted.length) return "";
  const lineStartX = sorted[0].transform[4];
  let result = " ".repeat(Math.max(0, Math.round((lineStartX - baseX) / characterWidth)));
  let previousEnd = lineStartX;
  sorted.forEach((item, index) => {
    const x = item.transform[4];
    if (index > 0) {
      const gap = Math.round((x - previousEnd) / characterWidth);
      if (gap > 0) result += " ".repeat(Math.min(24, gap));
    }
    result += item.str;
    previousEnd = x + item.width;
  });
  return result.trimEnd();
}

export function extractPageCodeBlocks(
  page: number,
  items: unknown[],
  styles: Record<string, { fontFamily?: string }>,
  pageHeight: number,
): BookCodeBlock[] {
  const monospaceItems = items.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Partial<PdfTextItem>;
    if (typeof item.str !== "string" || !item.str.trim() || !Array.isArray(item.transform) || typeof item.width !== "number" || typeof item.height !== "number" || !item.fontName || styles[item.fontName]?.fontFamily !== "monospace") return [];
    return [item as PdfTextItem];
  });
  if (!monospaceItems.length) return [];

  const fontSizes = monospaceItems.map((item) => item.height).filter((height) => height > 0);
  const characterWidths = monospaceItems.filter((item) => item.str.length > 1).map((item) => item.width / item.str.length).filter((width) => width > 0);
  const lineHeight = median(fontSizes);
  const characterWidth = Math.max(1, median(characterWidths));
  const sorted = [...monospaceItems].sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines: CodeLine[] = [];
  for (const item of sorted) {
    const y = item.transform[5];
    const existing = lines.find((line) => Math.abs(line.y - y) <= Math.max(1.4, lineHeight * 0.2));
    if (existing) existing.items.push(item);
    else lines.push({ y, items: [item] });
  }
  lines.sort((a, b) => b.y - a.y);
  const groups: CodeLine[][] = [];
  for (const line of lines) {
    const current = groups[groups.length - 1];
    const gap = current ? current[current.length - 1].y - line.y : 0;
    if (!current || gap > Math.max(22, lineHeight * 2.7)) groups.push([line]);
    else current.push(line);
  }

  return groups.flatMap((group, index) => {
    const preliminary = group.map((line) => ({
      line,
      text: reconstructLine(line.items, Math.min(...line.items.map((item) => item.transform[4])), characterWidth),
    }));
    let firstCodeLine = preliminary.findIndex((line) => codeSignal.test(line.text));
    let lastCodeLine = preliminary.length - 1;
    while (lastCodeLine > firstCodeLine && !codeSignal.test(preliminary[lastCodeLine].text)) lastCodeLine -= 1;
    if (firstCodeLine < 0 || lastCodeLine < firstCodeLine) return [];
    const codeLines = preliminary.slice(firstCodeLine, lastCodeLine + 1);
    const baseX = Math.min(...codeLines.flatMap(({ line }) => line.items.map((item) => item.transform[4])));
    const code = codeLines.map(({ line }) => reconstructLine(line.items, baseX, characterWidth)).join("\n").trim();
    if (!strongCodeSignal.test(code)) return [];
    if (codeLines.length > 1 && code.length < 35) return [];
    if (codeLines.length === 1 && (code.length < 16 || (group[0].y < pageHeight * 0.7 && group[0].y > pageHeight * 0.2))) return [];
    const { symbols, definedSymbols } = codeIdentifiers(code);
    return [{
      id: `pdf-${page}-code-${index + 1}`,
      page,
      language: /\b(?:class|def|self|import|from)\b|torch|nn\./.test(code) ? "Python" : "Code",
      code,
      symbols,
      definedSymbols,
      startsNearTop: group[0].y >= pageHeight * 0.7,
      endsNearBottom: group[group.length - 1].y <= pageHeight * 0.2,
    } satisfies BookCodeBlock];
  });
}
