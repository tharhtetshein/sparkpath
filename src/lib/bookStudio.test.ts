import assert from "node:assert/strict";
import test from "node:test";
import { parseBookStudio } from "./bookStudio";

test("keeps only concepts and checks anchored to the PDF excerpt", () => {
  const source = "Training data helps systems learn patterns. Feedback can reveal errors in a prediction.";
  const response = JSON.stringify({
    diagramTitle: "From data to feedback",
    concepts: [
      { label: "Training data", explanation: "Examples used to learn patterns.", sourcePhrase: "Training data helps systems learn patterns" },
      { label: "Unsupported", explanation: "Not in the book.", sourcePhrase: "quantum unicorns optimize everything" },
    ],
    steps: [{ title: "Try a prediction", action: "Use a learned pattern.", outcome: "Compare the result with feedback." }],
    check: [{ question: "What reveals errors?", choices: ["Feedback", "A title page", "A random guess"], correctIndex: 0, explanation: "The excerpt says feedback reveals errors.", sourcePhrase: "Feedback can reveal errors" }],
  });
  const studio = parseBookStudio(response, source);
  assert.equal(studio.diagramTitle, "From data to feedback");
  assert.deepEqual(studio.concepts.map((concept) => concept.label), ["Training data"]);
  assert.equal(studio.check.length, 1);
  assert.equal(studio.check[0].correctIndex, 0);
});

test("discards malformed quick checks and supports front matter with no activities", () => {
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Title page",
    concepts: [],
    steps: [],
    check: [{ question: "Pick one", choices: ["A", "B"], correctIndex: 8, explanation: "", sourcePhrase: "Title page" }],
  }), "Title page");
  assert.deepEqual(studio.concepts, []);
  assert.deepEqual(studio.steps, []);
  assert.deepEqual(studio.check, []);
});

test("builds a grounded quick check from two concepts when AI omits one", () => {
  const source = "Experience improves performance on a task. A performance measure tracks the result.";
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Learning loop",
    concepts: [
      { label: "Experience", explanation: "Practice used to improve a task.", sourcePhrase: "Experience improves performance on a task" },
      { label: "Measure", explanation: "A way to track results.", sourcePhrase: "A performance measure tracks the result" },
    ],
    steps: [],
    check: [],
  }), source);
  assert.equal(studio.check.length, 1);
  assert.equal(studio.check[0].choices[studio.check[0].correctIndex], "Practice used to improve a task.");
  assert.equal(studio.check[0].sourcePhrase, "Experience improves performance on a task");
});

test("rejects a book clue that does not support the marked answer", () => {
  const source = "Experience improves performance on a task. A performance measure tracks the result.";
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Learning loop",
    concepts: [
      { label: "Experience", explanation: "Practice used to improve a task.", sourcePhrase: "Experience improves performance on a task" },
      { label: "Measure", explanation: "A way to track results.", sourcePhrase: "A performance measure tracks the result" },
    ],
    steps: [],
    check: [{ question: "What tracks the result?", choices: ["The performance measure", "Experience", "The task"], correctIndex: 0, explanation: "The measure tracks results.", sourcePhrase: "Experience improves performance on a task" }],
  }), source);
  assert.match(studio.check[0].question, /Which statement best explains Experience/);
});
