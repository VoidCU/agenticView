import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

test("plugin.json is valid and points at skills and hooks that exist", () => {
  const plugin = readJson(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "agenticview");
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20);
  assert.equal(plugin.skills, "skills/");
  assert.equal(plugin.hooks, "hooks/hooks.json");
  assert.ok(existsSync(join(root, "skills", "agenticview", "SKILL.md")));
  assert.ok(existsSync(join(root, "skills", "agenticview-hub", "SKILL.md")));
});

test("marketplace.json lists the plugin with a github source", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  assert.equal(m.name, "agenticview");
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, "agenticview");
  assert.equal(m.plugins[0].source.source, "github");
  assert.match(m.plugins[0].source.repo, /^[\w.-]+\/agenticview$/i);
});

test("skills have frontmatter and launch through the recorded plugin root", () => {
  for (const [name, cmd] of [["agenticview", 'open --project "$PWD"'], ["agenticview-hub", "hub"]]) {
    const md = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
    assert.match(md, /^---\nname: /);
    assert.match(md, /\ndescription: .+/);
    assert.ok(md.includes(`node "$(cat ~/.agenticview/plugin-root)/bin/agenticview.mjs" ${cmd}`), `${name} must run ${cmd}`);
    assert.match(md, /plugin-root/);
    assert.match(md, /bin\/agenticview\.mjs" (open|hub)/);
  }
});

test("hooks.json registers SessionStart, UserPromptSubmit, PostToolUse and SessionEnd against hook.mjs", () => {
  const h = readJson("hooks/hooks.json").hooks;
  for (const ev of ["SessionStart", "UserPromptSubmit", "PostToolUse", "SessionEnd"]) {
    assert.ok(Array.isArray(h[ev]) && h[ev].length > 0, `${ev} missing`);
    for (const group of h[ev]) {
      for (const hook of group.hooks) {
        assert.equal(hook.type, "command");
        assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/hook\.mjs/);
        const file = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/)[1];
        assert.ok(existsSync(join(root, file)), `${file} must exist`);
      }
    }
  }
  assert.match(h.SessionStart[0].hooks[0].command, /record-root "\$\{CLAUDE_PLUGIN_ROOT\}"/);
  assert.match(h.PostToolUse[0].matcher, /Edit\|Write/);
});

test("hook.mjs mirror exits 0 fast with no server and record-root writes the file", () => {
  const home = mkdtempSync(join(tmpdir(), "av-plugin-"));
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [join(root, "hooks", "hook.mjs"), "mirror"], { input: "{}", encoding: "utf8", env: { ...process.env, AGENTICVIEW_HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Date.now() - t0 < 1500, "hook took too long");
    const r2 = spawnSync(process.execPath, [join(root, "hooks", "hook.mjs"), "record-root", "C:/x y/plugin"], { encoding: "utf8", env: { ...process.env, AGENTICVIEW_HOME: home } });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(readFileSync(join(home, "plugin-root"), "utf8"), "C:/x y/plugin");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("README covers install, commands, providers, scopes and security", () => {
  const md = readFileSync(join(root, "README.md"), "utf8");
  for (const needle of ["/plugin marketplace add", "/agenticview", "/agenticview-hub", "ANTHROPIC_API_KEY", "codex", "gemini", "global", "127.0.0.1", "npm run release"]) {
    assert.ok(md.includes(needle), `README missing ${needle}`);
  }
});
