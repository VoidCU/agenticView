import type { ReactNode } from "react";

/**
 * Small safe markdown renderer (board detail sheet, chat replies, inbox). It only ever produces React
 * elements and text nodes: no HTML string is parsed or injected, so markup in the source shows as text.
 *
 * Supports **bold**, *italic*, `inline code`, fenced ``` code blocks, "- " / "* " bullet lists,
 * "1. " numbered lists, and paragraphs (blank line) with single line breaks kept.
 */
export function inlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("**")) parts.push(<strong key={key++}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("*")) parts.push(<em key={key++}>{s.slice(1, -1)}</em>);
    else parts.push(<code key={key++}>{s.slice(1, -1)}</code>);
    last = m.index + s.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}

const BULLET = /^\s*[-*] /;
const NUMBERED = /^\s*\d+[.)] /;
const FENCE = /^\s*```/;

export function SimpleMarkdown({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++; // closing fence (or end of text while still streaming)
      elements.push(
        <pre key={`code-${i}`} className="smd-code" data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(pattern, ""));
        i++;
      }
      const lis = items.map((item, j) => <li key={j}>{inlineMarkdown(item)}</li>);
      elements.push(ordered ? <ol key={`ol-${i}`} className="smd-list">{lis}</ol> : <ul key={`list-${i}`} className="smd-list">{lis}</ul>);
    } else if (line.trim() === "") {
      i++;
    } else {
      const paras: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && !BULLET.test(lines[i] ?? "") && !NUMBERED.test(lines[i] ?? "") && !FENCE.test(lines[i] ?? "")) {
        paras.push(lines[i] ?? "");
        i++;
      }
      // Single line breaks inside a paragraph are kept (the paragraph is white-space: pre-wrap).
      elements.push(<p key={`p-${i}`} className="smd-p">{inlineMarkdown(paras.join("\n"))}</p>);
    }
  }
  return <div className={className ? `simple-md ${className}` : "simple-md"}>{elements}</div>;
}
