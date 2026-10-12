import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { aiApi } from "./api";

type AiRequest = { messages: unknown[]; webSearch?: boolean; responseFormat?: unknown };

async function callAi(env: Record<string, string>, body: AiRequest, upstreamBody: unknown = { output_text: "Grounded answer", output: [] }) {
  const upstreamRequests: Array<{ url: string; payload: any }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    upstreamRequests.push({ url: String(url), payload: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(upstreamBody), { status: 200, headers: { "content-type": "application/json" } });
  };
  const server = createServer((incoming, outgoing) => { void aiApi(env).handler(incoming, outgoing); });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port.");
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const outgoing = request({ hostname: "127.0.0.1", port: address.port, method: "POST", path: "/api/ai", headers: { "content-type": "application/json" } }, (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) }));
      });
      outgoing.on("error", reject);
      outgoing.end(JSON.stringify(body));
    });
    return { ...result, upstreamRequests };
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("uses Groq GPT OSS 120B for ordinary and structured lesson requests", async () => {
  const result = await callAi({ GROQ_API_KEY: "test-key" }, {
    messages: [{ role: "system", content: "Teach" }, { role: "user", content: "Section text" }],
    responseFormat: { name: "lesson", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.content, "Grounded answer");
  assert.equal(result.upstreamRequests[0].url, "https://api.groq.com/openai/v1/responses");
  assert.equal(result.upstreamRequests[0].payload.model, "openai/gpt-oss-120b");
  assert.equal(result.upstreamRequests[0].payload.reasoning.effort, "low");
  assert.equal(result.upstreamRequests[0].payload.text.format.type, "json_schema");
});

test("uses Groq browser search for researched course requests", async () => {
  const result = await callAi({ GROQ_API_KEY: "test-key" }, {
    messages: [{ role: "user", content: "Research this topic" }], webSearch: true,
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.upstreamRequests[0].payload.tools, [{ type: "browser_search" }]);
  assert.equal(result.upstreamRequests[0].payload.include, undefined);
});

test("routes image proof to a Groq vision model", async () => {
  const result = await callAi({ GROQ_API_KEY: "test-key" }, {
    messages: [{ role: "user", content: [{ type: "text", text: "Review this" }, { type: "image_url", image_url: { url: "data:image/png;base64,YWJj", detail: "auto" } }] }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.upstreamRequests[0].payload.model, "qwen/qwen3.8-27b");
});

test("keeps a completed browser-search answer when Groq marks tool use incomplete", async () => {
  const result = await callAi({ GROQ_API_KEY: "test-key" }, {
    messages: [{ role: "user", content: "Find a source" }], webSearch: true,
  }, {
    status: "incomplete",
    incomplete_details: { reason: "tool_required_not_called" },
    output: [
      { type: "mcp_call", name: "browser.search", status: "completed" },
      { type: "message", status: "completed", content: [{ type: "output_text", text: "Source found", annotations: [] }] },
    ],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.content, "Source found");
});

test("returns source links from Groq browser open results", async () => {
  const result = await callAi({ GROQ_API_KEY: "test-key" }, {
    messages: [{ role: "user", content: "Find a source" }], webSearch: true,
  }, {
    status: "completed",
    output: [
      { type: "mcp_call", name: "browser.open", status: "completed", output: "L0: \nL1: URL: https://example.org/guide\nL2: Example guide\nL3: Content" },
      { type: "message", status: "completed", content: [{ type: "output_text", text: "Source found" }] },
    ],
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.sources, [{ title: "Example guide", url: "https://example.org/guide" }]);
});
