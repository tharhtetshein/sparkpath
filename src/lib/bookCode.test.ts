import assert from "node:assert/strict";
import test from "node:test";
import { extractPageCodeBlocks } from "./bookCode";
import { findRelevantBookCodeBlocks, formatBookCodeContext, type BookSection } from "./bookSections";

function textItem(str: string, x: number, y: number, fontName = "mono") {
  return { str, transform: [8, 0, 0, 8, x, y], width: str.length * 4.8, height: 8, fontName };
}

test("extracts monospaced PDF code with line breaks and indentation", () => {
  const blocks = extractPageCodeBlocks(49, [
    textItem("Model", 220, 620),
    textItem("Tokenizer", 220, 610),
    textItem("class Tiny:", 100, 600),
    textItem("def run(self):", 119.2, 590),
    textItem("return self.value", 138.4, 580),
    textItem("ordinary paragraph text", 100, 570, "serif"),
  ], { mono: { fontFamily: "monospace" }, serif: { fontFamily: "serif" } }, 792);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].code, "class Tiny:\n    def run(self):\n        return self.value");
  assert.deepEqual(blocks[0].definedSymbols, ["Tiny", "run"]);
  assert.equal(blocks[0].startsNearTop, true);
});

test("retrieves a prior class when a later page uses it and marks a page continuation", () => {
  const prior: BookSection[] = [{
    id: "section-1",
    pageStart: 49,
    pageEnd: 49,
    text: "[PDF page 49] SimpleTokenizerV1 defines the token conversion rules.",
    codeBlocks: [{
      id: "pdf-49-code-1",
      page: 49,
      language: "Python",
      code: "class SimpleTokenizerV1:\n    def encode(self, text):\n        return ids",
      symbols: ["SimpleTokenizerV1", "encode", "text", "ids"],
      definedSymbols: ["SimpleTokenizerV1", "encode"],
      startsNearTop: false,
      endsNearBottom: true,
    }],
  }];
  const current = [{
    id: "pdf-50-code-1",
    page: 50,
    language: "Python",
    code: "tokenizer = SimpleTokenizerV1(vocab)",
    symbols: ["tokenizer", "SimpleTokenizerV1", "vocab"],
    definedSymbols: ["tokenizer"],
    startsNearTop: true,
    endsNearBottom: false,
  }];
  const related = findRelevantBookCodeBlocks("Use the SimpleTokenizerV1 class", current, prior, 50);
  assert.equal(related[0]?.id, "pdf-49-code-1");
  assert.match(formatBookCodeContext([...prior[0].codeBlocks!, ...current]), /likely continues across adjacent page/);
});
