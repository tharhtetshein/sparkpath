export type BookSection = {
  id: string;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export const MAX_SECTION_CHARS = 4500;

export function isBookLessonLocked(lessons: Array<{ id: string; completedAt?: string }>, lessonId: string): boolean {
  const index = lessons.findIndex((lesson) => lesson.id === lessonId);
  return index < 0 || lessons.slice(0, index).some((lesson) => !lesson.completedAt);
}

export function splitBookIntoSections(pages: string[]): BookSection[] {
  const sections: BookSection[] = [];
  let text = "";
  let start = 1;
  let end = 1;
  const flush = () => {
    if (!text.trim()) return;
    sections.push({ id: crypto.randomUUID(), pageStart: start, pageEnd: end, text: text.trim() });
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
