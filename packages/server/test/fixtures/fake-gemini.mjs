// Fake `gemini` CLI used by gemini.test.ts. Prints its argv to stderr as JSON, then streams JSONL on stdout.
// Env FAKE_GEMINI_MODE: "ok" (default) | "fail" | "hang" | "maxturns" | "stdin"
const mode = process.env.FAKE_GEMINI_MODE ?? "ok";

const lines = [
  { type: "init", session_id: "g1", model: "gemini-2.5-pro" },
  { type: "message", role: "user", content: "ignored" },
  { type: "message", role: "assistant", content: "Hello" },
  { type: "tool_use", name: "write_file", input: { file_path: "b.ts", content: "x" } },
  { type: "tool_result", name: "write_file", status: "success", output: "wrote b.ts" },
  "this is not json",
  { type: "message", role: "assistant", content: " world" },
];

const emit = (o) => process.stdout.write((typeof o === "string" ? o : JSON.stringify(o)) + "\n");

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const main = async () => {
  const stdinText = mode === "stdin" ? await readStdin() : "";
  console.error(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), ...(mode === "stdin" ? { stdinLength: stdinText.length } : {}) }));

  if (mode === "fail") {
    emit(lines[0]);
    console.error("boom: something broke");
    process.exit(1);
  }
  if (mode === "maxturns") {
    emit(lines[0]);
    emit({ type: "result", status: "error", error: "turn limit" });
    process.exit(53);
  }
  if (mode === "hang") {
    emit(lines[0]);
    setInterval(() => undefined, 1000);
    return;
  }
  for (const l of lines) emit(l);
  emit({ type: "result", status: "success", stats: { total_tokens: 12 } });
  process.exit(0);
};
main();
