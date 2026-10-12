import assert from "node:assert/strict";
import test from "node:test";
import { bookResumeLessonId, MAX_SECTION_CHARS, splitBookIntoSections } from "./bookSections";

test("splits a long PDF page without losing source text", () => {
  const page = "A".repeat(11000);
  const sections = splitBookIntoSections([page]);
  assert.ok(sections.length >= 3);
  assert.ok(sections.every((section) => section.text.length <= MAX_SECTION_CHARS));
  assert.ok(sections.every((section) => section.pageStart === 1 && section.pageEnd === 1));
  assert.equal(sections.map((section) => section.text.replace(/\[PDF page \d+\]\s*/g, "")).join(""), page);
});

test("keeps PDF page order and page references across sections", () => {
  const pages = ["first page", "", "third page", "fourth page"];
  const sections = splitBookIntoSections(pages);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].pageStart, 1);
  assert.equal(sections[0].pageEnd, 4);
  assert.match(sections[0].text, /\[PDF page 1\] first page.*\[PDF page 3\] third page.*\[PDF page 4\] fourth page/s);
});

test("resumes a legacy book at its viewed or latest prepared section", () => {
  const course = {
    id: "book-1",
    kind: "book",
    modules: [{ lessons: [
      { id: "first", content: { researchedAt: "earlier" } },
      { id: "second", content: { researchedAt: "later" } },
      { id: "third" },
    ] }],
  };
  assert.equal(bookResumeLessonId(course, "book-1", "first"), "first");
  assert.equal(bookResumeLessonId(course, "", ""), "second");
  assert.equal(bookResumeLessonId({ ...course, lastOpenedLessonId: "third" }, "", ""), "third");
});
