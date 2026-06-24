import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { aiApi, jobSearchApi, youtubeSearchApi } from "./server/api";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const staticDirectory = resolve(rootDirectory, "dist");
const mode = process.env.NODE_ENV || "production";
const fileEnv = loadEnv(mode, rootDirectory, "");
const runtimeEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

const routes = new Map([
  ["/api/jobs", jobSearchApi().handler],
  ["/api/youtube", youtubeSearchApi().handler],
  ["/api/ai", aiApi({ ...fileEnv, ...runtimeEnv }).handler],
]);

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, 500, { error: "Internal server error." });
    else response.destroy();
  });
});

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  setSecurityHeaders(response);

  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "sparkpath" });
    return;
  }

  const apiHandler = routes.get(requestUrl.pathname);
  if (apiHandler) {
    response.setHeader("Cache-Control", "no-store");
    await apiHandler(request, response);
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "API route not found." });
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  await serveFrontend(request, response, requestUrl.pathname);
}

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

server.listen(port, host, () => {
  console.log(`SparkPath is running on http://${host}:${port}`);
});

server.on("error", (error) => {
  console.error("SparkPath server failed:", error);
  process.exitCode = 1;
});

async function serveFrontend(request: IncomingMessage, response: ServerResponse, pathname: string) {
  const requestedPath = safeStaticPath(pathname);
  const requestedFile = requestedPath ? join(staticDirectory, requestedPath) : join(staticDirectory, "index.html");
  const file = await findFile(requestedFile);

  if (file) {
    streamFile(request, response, file);
    return;
  }

  if (extname(pathname)) {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const indexFile = join(staticDirectory, "index.html");
  if (await findFile(indexFile)) {
    streamFile(request, response, indexFile);
    return;
  }

  sendJson(response, 503, { error: "Frontend build is missing. Run npm run build before npm start." });
}

function safeStaticPath(pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return "";
  }
  const relativePath = normalize(decoded).replace(/^([/\\])+/, "");
  const absolutePath = resolve(staticDirectory, relativePath);
  return absolutePath === staticDirectory || absolutePath.startsWith(`${staticDirectory}${sep}`) ? relativePath : "";
}

async function findFile(path: string) {
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

function streamFile(request: IncomingMessage, response: ServerResponse, path: string) {
  response.statusCode = 200;
  response.setHeader("Content-Type", contentType(path));
  response.setHeader(
    "Cache-Control",
    path.includes(`${join("dist", "assets")}`) || path.includes("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = createReadStream(path);
  stream.on("error", () => {
    if (!response.headersSent) sendJson(response, 500, { error: "Could not read frontend file." });
    else response.destroy();
  });
  stream.pipe(response);
}

function contentType(path: string) {
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
