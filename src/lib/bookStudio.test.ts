import assert from "node:assert/strict";
import test from "node:test";
import { applyBookStudioAudit, parseBookStudio } from "./bookStudio";

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

test("supports front matter with no activities", () => {
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Title page",
    concepts: [],
    steps: [],
    check: [],
  }), "Title page");
  assert.deepEqual(studio.concepts, []);
  assert.deepEqual(studio.steps, []);
  assert.deepEqual(studio.check, []);
  assert.equal(studio.emptyReason, "front_matter");
});

test("discards a malformed quick check", () => {
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Title page",
    concepts: [],
    steps: [],
    check: [{ question: "Pick one", choices: ["A", "B"], correctIndex: 8, explanation: "", sourcePhrase: "Title page" }],
  }), "Title page");
  assert.deepEqual(studio.check, []);
  assert.equal(studio.emptyReason, "source_check");
});

test("builds a grounded quick check from two concepts when AI omits one", () => {
  const source = "Experience improves performance on a task. A performance measure tracks the result.";
  const draft = parseBookStudio(JSON.stringify({
    diagramTitle: "Learning loop",
    concepts: [
      { label: "Experience", explanation: "Practice used to improve a task.", sourcePhrase: "Experience improves performance on a task" },
      { label: "Measure", explanation: "A way to track results.", sourcePhrase: "A performance measure tracks the result" },
    ],
    steps: [],
    check: [],
  }), source);
  const studio = applyBookStudioAudit(draft, JSON.stringify({ conceptSupported: [true, true], stepSupported: [], checkSupported: [], pageCoverage: [] }));
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
  assert.equal(studio.check.length, 0);
});

test("rejects an increase claim when the PDF says decrease", () => {
  const source = "The algorithm decreases accuracy on this task.";
  const studio = parseBookStudio(JSON.stringify({
    diagramTitle: "Effect on accuracy",
    concepts: [
      { label: "Algorithm", explanation: "The algorithm increases accuracy on this task.", sourcePhrase: "The algorithm decreases accuracy on this task" },
      { label: "Accuracy", explanation: "Accuracy changes on this task.", sourcePhrase: "The algorithm decreases accuracy on this task" },
    ],
    steps: [],
    check: [{ question: "What happens?", choices: ["The algorithm increases accuracy", "It decreases", "Nothing changes"], correctIndex: 0, explanation: "Accuracy increases.", sourcePhrase: "The algorithm decreases accuracy on this task" }],
  }), source);
  assert.deepEqual(studio.concepts.map((concept) => concept.label), ["Accuracy"]);
  assert.equal(studio.check.length, 0);
});

test("independent audit removes unsupported concepts, steps, and checks", () => {
  const source = "The algorithm selects the largest value. Feedback reveals errors.";
  const draft = parseBookStudio(JSON.stringify({
    diagramTitle: "Selection",
    concepts: [
      { label: "Selection", explanation: "The algorithm selects the smallest value.", sourcePhrase: "The algorithm selects the largest value" },
      { label: "Feedback", explanation: "Feedback reveals errors.", sourcePhrase: "Feedback reveals errors" },
    ],
    steps: [{ title: "Select", action: "Pick a value", outcome: "The smallest value wins." }],
    check: [{ question: "What does feedback reveal?", choices: ["Feedback reveals errors", "Nothing", "It depends"], correctIndex: 0, explanation: "It reveals errors.", sourcePhrase: "Feedback reveals errors" }],
  }), source);
  const studio = applyBookStudioAudit(draft, JSON.stringify({ conceptSupported: [false, true], stepSupported: [false], checkSupported: [false], pageCoverage: [] }));
  assert.deepEqual(studio.concepts.map((concept) => concept.label), ["Feedback"]);
  assert.deepEqual(studio.steps, []);
  assert.deepEqual(studio.check, []);
});

test("marks an unverified visual activity for retry", () => {
  const source = "The algorithm selects the largest value.";
  const draft = parseBookStudio(JSON.stringify({
    diagramTitle: "Selection",
    concepts: [{ label: "Selection", explanation: "The algorithm picks the smallest value.", sourcePhrase: "The algorithm selects the largest value" }],
    steps: [],
    check: [],
  }), source);
  const studio = applyBookStudioAudit(draft, JSON.stringify({ conceptSupported: [false], stepSupported: [], checkSupported: [], pageCoverage: [] }));
  assert.deepEqual(studio.concepts, []);
  assert.equal(studio.emptyReason, "source_check");
});

test("coverage audit reports omitted and unreadable PDF pages", () => {
  const source = "[PDF page 31] The first page explains the model. [PDF page 32] The next page shows a decision boundary.";
  const draft = parseBookStudio(JSON.stringify({ diagramTitle: "Decision boundary", concepts: [], steps: [], check: [] }), source);
  const studio = applyBookStudioAudit(draft, JSON.stringify({
    conceptSupported: [],
    stepSupported: [],
    checkSupported: [],
    pageCoverage: [{ page: 31, complete: true, missing: [] }],
  }), { unreadablePages: [33], visualPages: [31] });
  assert.equal(studio.coverageComplete, false);
  const pageCoverage = studio.pageCoverage ?? [];
  assert.deepEqual(pageCoverage.map((page) => page.page), [31, 32, 33]);
  assert.equal(pageCoverage.find((page) => page.page === 31)?.complete, false);
  assert.match(pageCoverage.find((page) => page.page === 32)?.missing[0] ?? "", /not reported/);
  assert.match(pageCoverage.find((page) => page.page === 33)?.missing[0] ?? "", /No selectable text/);
});
