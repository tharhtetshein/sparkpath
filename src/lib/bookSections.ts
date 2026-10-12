export type BookSection = {
  id: string;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export const MAX_SECTION_CHARS = 4500;

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
