/**
 * Chat from walk mode (C while looking at an agent within CHAT_RANGE): opens that agent's chat panel
 * expanded with the mouse freed and the message box focused, so you can type straight away. Escape
 * closes it again: the panel goes back to how it was (collapsed if it was), focus leaves the box and
 * walk mode resumes (the next click on the view re-captures the mouse, as after any overlay).
 *
 * While a walk chat is open the app carries .app-walk-chat, which brings the chat column back over the
 * walk view (walk mode otherwise hides the HUD). Clicking the view instead (pointer re-locked) or leaving
 * walk mode just ends the walk chat: the column hides with the rest of the walk HUD and the panel's
 * collapsed state is left as it is.
 */
import { create } from "zustand";
import { useStore } from "./store";
import { useHudPrefs } from "./hudPrefs";
import { openOverlayFromWalk } from "./pointerLock";
import { useWalk } from "./walk";

interface WalkChatSession {
  agentId: string;
  /** Chat panel state before C opened it. */
  prevCollapsed: boolean;
  /** Hands the mouse back to walk mode (openOverlayFromWalk's restore; idempotent). */
  release: () => void;
}

interface WalkChatState {
  session: WalkChatSession | undefined;
  /** Bumped on every open: the chat panel focuses its message box when it changes. */
  focusSeq: number;
}

export const useWalkChat = create<WalkChatState>(() => ({ session: undefined, focusSeq: 0 }));

/** Opens `agentId`'s chat from walk mode: expand the panel, free the mouse, focus the message box. */
export function openWalkChat(agentId: string, doc: Document = document): void {
  const prev = useWalkChat.getState().session;
  const hud = useHudPrefs.getState();
  // A second C on another agent keeps the original "before" state and the one pointer release.
  const prevCollapsed = prev ? prev.prevCollapsed : hud.chatCollapsed;
  const release = prev?.release ?? openOverlayFromWalk(doc);
  if (hud.chatCollapsed) hud.setChatCollapsed(false);
  useStore.getState().select(agentId);
  useWalkChat.setState((s) => ({ session: { agentId, prevCollapsed, release }, focusSeq: s.focusSeq + 1 }));
}

/**
 * Escape from a walk chat: restore the panel's collapsed state, drop focus from the message box and
 * resume walking. Returns false when no walk chat is open.
 */
export function closeWalkChat(doc: Document = document): boolean {
  const session = useWalkChat.getState().session;
  if (!session) return false;
  useWalkChat.setState({ session: undefined });
  if (session.prevCollapsed) useHudPrefs.getState().setChatCollapsed(true);
  const active = doc.activeElement;
  if (active instanceof HTMLElement && active.closest(".panel-chat")) active.blur();
  session.release();
  return true;
}

/** Forget the walk chat without undoing anything (pointer re-locked by a click, walk mode ended). */
export function endWalkChat(): void {
  if (useWalkChat.getState().session) useWalkChat.setState({ session: undefined });
}

/**
 * Whether a keydown is the walk-mode chat key: C (by key position, like E/H/G) with no modifier
 * (Ctrl/Cmd+C is copy), not a repeat, not typed into any text field or contenteditable, no dialog
 * open, and no overlay currently holding the mouse.
 */
export function isWalkChatKey(e: KeyboardEvent, doc: Document = document): boolean {
  if (e.code !== "KeyC" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (isTypingTarget(doc.activeElement) || isTypingTarget(e.target instanceof Element ? e.target : null)) return false;
  if (doc.querySelector('[role="dialog"]')) return false;
  return !useWalk.getState().paused;
}

/**
 * Escape while a walk chat is open closes the chat (even from inside its message box) instead of
 * leaving walk mode. Installed on window in the capture phase (WalkMode does, while walking), so it
 * runs before every other Escape handler. Returns the uninstall function.
 */
export function installWalkChatEscape(win: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !useWalkChat.getState().session) return;
    // A dialog opened from the chat (agent menu, switch modal) closes first.
    if (win.document.querySelector('[role="dialog"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeWalkChat(win.document);
  };
  win.addEventListener("keydown", onKey, true);
  return () => win.removeEventListener("keydown", onKey, true);
}

/** True while typing somewhere: a text field or contenteditable has focus (walk keys must not fire). */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if (!(el instanceof HTMLElement)) return false;
  // isContentEditable, with an attribute fallback for environments that do not compute it.
  return el.isContentEditable === true || el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}
