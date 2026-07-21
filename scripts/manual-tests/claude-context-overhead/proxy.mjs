/**
 * Records the structure, sizes, and cache placement of Claude /v1/messages
 * requests, then forwards them to the real Anthropic API unchanged.
 * Request content is not persisted beyond 120-character block previews.
 */
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const port = Number(process.argv[2] || 8377);
const logPath =
  process.env.CLAUDE_CONTEXT_PROXY_LOG ??
  "/tmp/nimbalyst-claude-context-proxy.jsonl";
const upstream = "api.anthropic.com";

function blockSummary(block) {
  const text =
    typeof block === "string" ? block : block.text ?? block.content ?? "";
  const chars =
    typeof block === "string" ? block.length : JSON.stringify(block).length;
  return {
    type: typeof block === "string" ? "text" : block.type,
    chars,
    cacheControl:
      typeof block === "object" && block.cache_control
        ? block.cache_control.type
        : null,
    preview: String(text).slice(0, 120).replace(/\n/g, " "),
  };
}

function summarize(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { parseError: true, chars: body.length };
  }

  const rawSystem = parsed.system;
  const system =
    typeof rawSystem === "string"
      ? [blockSummary(rawSystem)]
      : (rawSystem ?? []).map(blockSummary);
  const tools = (parsed.tools ?? []).map((tool) => ({
    name: tool.name,
    chars: JSON.stringify(tool).length,
    cacheControl: tool.cache_control?.type ?? null,
  }));
  const messages = (parsed.messages ?? []).map((message) => ({
    role: message.role,
    blocks: Array.isArray(message.content)
      ? message.content.map(blockSummary)
      : [blockSummary(message.content)],
  }));

  return {
    timestamp: new Date().toISOString(),
    model: parsed.model,
    stream: Boolean(parsed.stream),
    totalChars: body.length,
    system,
    tools,
    toolCount: tools.length,
    toolChars: tools.reduce((total, tool) => total + tool.chars, 0),
    messages,
  };
}

http
  .createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      if (
        request.method === "POST" &&
        request.url.includes("/v1/messages") &&
        !request.url.includes("count_tokens")
      ) {
        try {
          fs.appendFileSync(
            logPath,
            `${JSON.stringify(summarize(body.toString("utf8")))}\n`
          );
        } catch (error) {
          console.error("Failed to write proxy summary:", error);
        }
      }

      const upstreamRequest = https.request(
        {
          hostname: upstream,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, host: upstream },
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode,
            upstreamResponse.headers
          );
          upstreamResponse.pipe(response);
        }
      );
      upstreamRequest.on("error", (error) => {
        console.error("Anthropic upstream error:", error.message);
        response.writeHead(502);
        response.end();
      });
      upstreamRequest.end(body);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Claude context proxy listening on http://127.0.0.1:${port}`);
    console.log(`Writing structural summaries to ${logPath}`);
  });
