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

test("uses GPT-5.4 through the OpenAI Responses API with structured outputs", async () => {
  const result = await callAi({ OPENAI_API_KEY: "test-openai-key" }, {
    messages: [{ role: "system", content: "Teach simply" }, { role: "user", content: "Book section" }],
    responseFormat: { name: "lesson", schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false } },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.content, "Grounded answer");
  assert.equal(result.body.provider, "openai");
  assert.equal(result.upstreamRequests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(result.upstreamRequests[0].payload.model, "gpt-5.4");
  assert.equal(result.upstreamRequests[0].payload.text.format.type, "json_schema");
});

test("supports OpenAI hosted web search and returns citation sources", async () => {
  const result = await callAi({ OPENAI_API_KEY: "test-openai-key" }, {
    messages: [{ role: "user", content: "Research this topic" }], webSearch: true,
  }, {
    output_text: "Grounded answer",
    output: [{ type: "message", content: [{ type: "output_text", text: "Grounded answer", annotations: [
      { type: "url_citation", url: "https://example.org/guide", title: "Example guide" },
    ] }] }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.upstreamRequests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(result.upstreamRequests[0].payload.model, "gpt-5.4");
  assert.deepEqual(result.upstreamRequests[0].payload.tools, [{ type: "web_search" }]);
  assert.equal(result.upstreamRequests[0].payload.tool_choice, "required");
  assert.deepEqual(result.body.sources, [{ title: "Example guide", url: "https://example.org/guide" }]);
});

test("routes image input through the configured OpenAI vision model", async () => {
  const result = await callAi({ OPENAI_API_KEY: "test-openai-key", OPENAI_VISION_MODEL: "gpt-5.4-vision" }, {
    messages: [{ role: "user", content: [{ type: "text", text: "Review this" }, { type: "image_url", image_url: { url: "data:image/png;base64,YWJj", detail: "auto" } }] }],
  });
  assert.equal(result.status, 200);
  assert.equal(result.upstreamRequests[0].payload.model, "gpt-5.4-vision");
  assert.equal(result.upstreamRequests[0].payload.input[0].content[1].type, "input_image");
});

test("requires OPENAI_API_KEY before making an upstream request", async () => {
  const result = await callAi({}, {
    messages: [{ role: "user", content: "Prepare a book section" }],
  });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /OPENAI_API_KEY/);
  assert.equal(result.upstreamRequests.length, 0);
});
