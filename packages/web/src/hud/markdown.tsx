import { useState, type ReactNode } from "react";

/**
 * Small safe markdown renderer (board detail sheet, chat replies, inbox). It only ever produces React
 * elements and text nodes: no HTML string is parsed or injected, so markup in the source shows as text.
 *
 * Supports **bold**, *italic*, `inline code`, [links](https://...), fenced ``` code blocks, "# " headings,
 * "> " quotes, "---" rules, "- " / "* " bullet lists, "1. " numbered lists, and paragraphs (blank line)
 * with single line breaks kept.
 */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
const LINK = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/;
/** Only these schemes become clickable; anything else (javascript:, data:...) stays as plain text. */
const SAFE_HREF = /^(https?:|mailto:)/i;

export function inlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const s = m[0];
    const link = LINK.exec(s);
    if (s.startsWith("**")) parts.push(<strong key={key++}>{s.slice(2, -2)}</strong>);
    else if (s.startsWith("*")) parts.push(<em key={key++}>{s.slice(1, -1)}</em>);
    else if (s.startsWith("`")) parts.push(<code key={key++}>{s.slice(1, -1)}</code>);
    else if (link && SAFE_HREF.test(link[2]!)) parts.push(<a key={key++} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>);
    else parts.push(s);
    last = m.index + s.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts;
}

const BULLET = /^\s*[-*] /;
const NUMBERED = /^\s*\d+[.)] /;
const FENCE = /^\s*```/;
const HEADING = /^\s*(#{1,6})\s+/;
const QUOTE = /^\s*> ?/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** True when a line starts a block of its own, so it ends the paragraph before it. */
function startsBlock(line: string): boolean {
  return BULLET.test(line) || NUMBERED.test(line) || FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line);
}

/** Copy text to the clipboard, as rich HTML too when given (pastes formatted into Gmail, Docs...). */
export function copyToClipboard(text: string, html?: string): Promise<void> {
  const clip = navigator.clipboard;
  if (!clip) return Promise.reject(new Error("Clipboard unavailable"));
  if (html && typeof ClipboardItem !== "undefined" && clip.write) {
    const item = new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    });
    return clip.write([item]).catch(() => clip.writeText(text));
  }
  return clip.writeText(text);
}

/** A small Copy button that says "Copied" for a moment after a successful copy. */
export function CopyButton({ getText, getHtml, label = "Copy", className }: { getText: () => string; getHtml?: () => string | undefined; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className ? `copy-btn ${className}` : "copy-btn"}
      aria-label={copied ? "Copied" : label}
      title={label}
      onClick={() => {
        copyToClipboard(getText(), getHtml?.()).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The markdown as clean plain text, for pasting where formatting is lost (an email body, a form):
 * emphasis and code markers and fences are dropped, links become "text (url)", list markers stay.
 */
export function markdownToPlainText(text: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(raw);
      continue;
    }
    if (RULE.test(raw)) {
      out.push("");
      continue;
    }
    const line = raw.replace(HEADING, "").replace(QUOTE, "");
    out.push(
      line.replace(INLINE, (s) => {
        const link = LINK.exec(s);
        if (link) return link[1] === link[2] ? link[1]! : `${link[1]} (${link[2]})`;
        if (s.startsWith("**")) return s.slice(2, -2);
        return s.slice(1, -1);
      }),
    );
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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
      const code = body.join("\n");
      elements.push(
        <div key={`code-${i}`} className="smd-code-wrap">
          <pre className="smd-code" data-lang={lang || undefined}>
            <code>{code}</code>
          </pre>
          <CopyButton className="smd-code-copy" label="Copy code" getText={() => code} />
        </div>,
      );
    } else if (HEADING.test(line)) {
      const level = Math.min((HEADING.exec(line)![1] ?? "#").length, 4);
      const Tag = `h${level + 2}` as "h3" | "h4" | "h5" | "h6";
      elements.push(<Tag key={`h-${i}`} className="smd-h">{inlineMarkdown(line.replace(HEADING, ""))}</Tag>);
      i++;
    } else if (RULE.test(line)) {
      elements.push(<hr key={`hr-${i}`} className="smd-hr" />);
      i++;
    } else if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) quoted.push((lines[i++] ?? "").replace(QUOTE, ""));
      elements.push(<blockquote key={`q-${i}`} className="smd-quote">{inlineMarkdown(quoted.join("\n"))}</blockquote>);
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
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && !startsBlock(lines[i] ?? "")) {
        paras.push(lines[i] ?? "");
        i++;
      }
      // Single line breaks inside a paragraph are kept (the paragraph is white-space: pre-wrap).
      elements.push(<p key={`p-${i}`} className="smd-p">{inlineMarkdown(paras.join("\n"))}</p>);
    }
  }
  return <div className={className ? `simple-md ${className}` : "simple-md"}>{elements}</div>;
}
