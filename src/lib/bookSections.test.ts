import assert from "node:assert/strict";
import test from "node:test";
import { bookMapContext, bookResumeLessonId, buildBookMap, findRelevantBookSections, mapBookSectionsToChapters, MAX_SECTION_CHARS, selectRelevantBookPassage, splitBookIntoSections } from "./bookSections";

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

test("builds a compact chapter map from a PDF table of contents", () => {
  const map = buildBookMap([
    "Title page",
    "Table of Contents Part I. The Foundations of Learning 1. The Learning Landscape. . . . . 1 2. A Practical Project. . . . . 25",
    "3. Training Models. . . . . 61 4. A New Method. 72 Part II. More Ideas",
  ]);
  assert.deepEqual(map.map((entry) => [entry.number, entry.title, entry.printedPage]), [
    [1, "The Learning Landscape", 1],
    [2, "A Practical Project", 25],
    [3, "Training Models", 61],
    [4, "A New Method", 72],
  ]);
  assert.equal(map[0]?.part, "Part I: The Foundations of Learning");
  const outline = bookMapContext(map, "A Practical Project");
  assert.match(outline, /A Practical Project.*current section/);
  assert.match(outline, /Chapter 1: The Learning Landscape/);
  assert.match(bookMapContext(map, "Opening pages"), /Chapter 4: A New Method/);
});

test("locates the real chapter page without mistaking a chapter reference for its start", () => {
  const map = buildBookMap([
    "Title page",
    "Table of Contents 2. End-to-End Machine Learning Project. . . . . 25",
    "You will study a Machine Learning project end to end in Chapter 2.",
    "Page header CHAPTER 2 End-to-End Machine Learning Project. In this chapter you will build a model.",
  ]);
  assert.equal(map[0]?.pdfPage, 4);
});

test("assigns sections to their matching chapter and ignores contents listings", () => {
  const map = [
    { number: 1, title: "The Learning Landscape", printedPage: 1 },
    { number: 2, title: "A Practical Project", printedPage: 25 },
  ];
  const sections = [
    { id: "toc", pageStart: 1, pageEnd: 2, text: "[PDF page 1] Table of Contents The Learning Landscape A Practical Project" },
    { id: "one", pageStart: 3, pageEnd: 4, text: "[PDF page 3] The Learning Landscape explains how learning systems find patterns." },
    { id: "two", pageStart: 5, pageEnd: 6, text: "[PDF page 5] A Practical Project begins with a clear goal." },
  ];
  assert.deepEqual(mapBookSectionsToChapters(sections, map), ["Opening pages", "The Learning Landscape", "A Practical Project"]);
});

test("selects source sentences with PDF page references", () => {
  const passage = selectRelevantBookPassage("[PDF page 10] A decision tree asks questions. [PDF page 11] Linear regression chooses a line that reduces prediction error.", "How does the line reduce prediction error?", 120);
  assert.match(passage, /PDF page 11/);
  assert.match(passage, /reduces prediction error/);
});

test("retrieves relevant prior source sections from the whole earlier book", () => {
  const sections = [
    { id: "regression", pageStart: 10, pageEnd: 12, text: "[PDF page 10] Gradient descent adjusts parameters to reduce the cost function." },
    { id: "trees", pageStart: 80, pageEnd: 82, text: "[PDF page 80] A decision tree splits data by asking questions about features." },
    { id: "validation", pageStart: 40, pageEnd: 42, text: "[PDF page 40] A validation set estimates how well a model will perform on new data." },
  ];
  assert.deepEqual(findRelevantBookSections("How does gradient descent reduce the cost function?", sections, 1).map((section) => section.id), ["regression"]);
});
