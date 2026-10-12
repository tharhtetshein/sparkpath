import assert from "node:assert/strict";
import test from "node:test";
import { isBookLessonLocked, MAX_SECTION_CHARS, splitBookIntoSections } from "./bookSections";

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

test("unlocks book sections only after all earlier sections are complete", () => {
  const lessons: Array<{ id: string; completedAt?: string }> = [{ id: "first" }, { id: "second" }, { id: "third" }];
  assert.equal(isBookLessonLocked(lessons, "first"), false);
  assert.equal(isBookLessonLocked(lessons, "second"), true);
  lessons[0].completedAt = "2026-10-12T00:00:00.000Z";
  assert.equal(isBookLessonLocked(lessons, "second"), false);
  assert.equal(isBookLessonLocked(lessons, "third"), true);
  lessons[1].completedAt = "2026-10-12T00:00:00.000Z";
  assert.equal(isBookLessonLocked(lessons, "third"), false);
});
