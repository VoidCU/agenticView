// A tiny OpenAI-compatible endpoint for tests: answers POST /v1/responses (streamed SSE, what Codex
// speaks) and POST /v1/chat/completions (streamed or not) with a fixed reply. Records every request
// (path, auth header, model) so tests can assert on the wiring. No real model, no network.
import { createServer } from "node:http";

/**
 * Start the server on 127.0.0.1 with a random port.
 * @param {{ reply?: string, status?: number, errorBody?: string }} [opts]
 * @returns {Promise<{ url: string, requests: Array<{ path: string, auth: string | undefined, model: string | undefined }>, close: () => Promise<void> }>}
 */
export async function startFakeOpenAI(opts = {}) {
  const reply = opts.reply ?? "PONG from fake endpoint";
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const path = (req.url ?? "").split("?")[0];
      requests.push({ path, auth: req.headers.authorization, model: body.model });
      if (opts.status && opts.status !== 200) {
        res.writeHead(opts.status, { "content-type": "application/json" });
        res.end(opts.errorBody ?? JSON.stringify({ error: { message: "Rate limit reached", type: "rate_limit_exceeded" } }));
        return;
      }
      if (path.endsWith("/responses")) return responses(res, body, reply);
      if (path.endsWith("/chat/completions")) return chat(res, body, reply);
      if (path.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "fake-model", object: "model" }] }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `no route ${path}` } }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  for (const ev of events) res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  res.end();
}

function responses(res, body, reply) {
  const id = `resp_${Date.now().toString(36)}`;
  const msgId = `msg_${Date.now().toString(36)}`;
  const model = body.model ?? "fake-model";
  const item = { type: "message", id: msgId, role: "assistant", status: "completed", content: [{ type: "output_text", text: reply, annotations: [] }] };
  const base = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model, output: [] };
  sse(res, [
    { type: "response.created", sequence_number: 0, response: { ...base, status: "in_progress" } },
    { type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.content_part.added", sequence_number: 2, item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", sequence_number: 3, item_id: msgId, output_index: 0, content_index: 0, delta: reply },
    { type: "response.output_text.done", sequence_number: 4, item_id: msgId, output_index: 0, content_index: 0, text: reply },
    { type: "response.content_part.done", sequence_number: 5, item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: reply, annotations: [] } },
    { type: "response.output_item.done", sequence_number: 6, output_index: 0, item },
    {
      type: "response.completed",
      sequence_number: 7,
      response: { ...base, status: "completed", output: [item], usage: { input_tokens: 42, input_tokens_details: { cached_tokens: 0 }, output_tokens: 7, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 49 } },
    },
  ]);
}

function chat(res, body, reply) {
  const id = `chatcmpl_${Date.now().toString(36)}`;
  const model = body.model ?? "fake-model";
  const created = Math.floor(Date.now() / 1000);
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (delta, finish) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] });
  res.write(`data: ${JSON.stringify(chunk({ role: "assistant", content: reply }, null))}\n\n`);
  res.write(`data: ${JSON.stringify({ ...chunk({}, "stop"), usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}
