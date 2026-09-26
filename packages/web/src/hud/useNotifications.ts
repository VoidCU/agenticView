import { useEffect, useRef } from "react";
import { useStore } from "../state/store";

const LS_KEY = "agenticview:notifications";

/** Read/write the opt-in preference from localStorage safely. */
export function getNotificationPref(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNotificationPref(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(LS_KEY, "true");
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch {
    // ignore
  }
}

/** Request notification permission and, if granted, save the pref. Returns final pref state. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    setNotificationPref(true);
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  const granted = result === "granted";
  setNotificationPref(granted);
  return granted;
}

/** Fire a desktop notification if the tab is hidden and notifications are enabled. */
function notify(title: string, body?: string) {
  if (typeof document === "undefined" || !document.hidden) return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!getNotificationPref()) return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch {
    // ignore
  }
}

/**
 * Hook: fires desktop notifications when the user needs attention (new
 * question / permission / limit) or when a request task finishes.
 * Only fires when the tab is hidden and the user has opted in.
 */
export function useDesktopNotifications() {
  const questions = useStore((s) => s.questions);
  const permissions = useStore((s) => s.permissions);
  const limits = useStore((s) => s.limits);
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);

  const prevQIds = useRef(new Set<string>());
  const prevPermIds = useRef(new Set<string>());
  const prevLimitIds = useRef(new Set<string>());
  const prevDoneIds = useRef(new Set<string>());

  // Questions
  useEffect(() => {
    const cur = new Set(questions.map((q) => q.id));
    for (const q of questions) {
      if (!prevQIds.current.has(q.id)) {
        const agent = agents[q.agentId];
        notify(
          `${agent?.name ?? "Agent"} has a question`,
          q.question.slice(0, 100),
        );
      }
    }
    prevQIds.current = cur;
  }, [questions, agents]);

  // Permissions
  useEffect(() => {
    const cur = new Set(permissions.map((p) => p.id));
    for (const p of permissions) {
      if (!prevPermIds.current.has(p.id)) {
        const agent = agents[p.agentId];
        notify(
          `${agent?.name ?? "Agent"} needs permission`,
          `Tool: ${p.tool}`,
        );
      }
    }
    prevPermIds.current = cur;
  }, [permissions, agents]);

  // Limits
  useEffect(() => {
    const cur = new Set(limits.map((l) => l.id));
    for (const l of limits) {
      if (!prevLimitIds.current.has(l.id)) {
        const agent = agents[l.agentId];
        notify(
          `${agent?.name ?? "Agent"} hit a limit`,
          l.reason ?? "Provider limit reached",
        );
      }
    }
    prevLimitIds.current = cur;
  }, [limits, agents]);

  // Task done (request kind)
  useEffect(() => {
    const taskList = Object.values(tasks);
    const cur = new Set(taskList.filter((t) => t.status === "done").map((t) => t.id));
    for (const t of taskList) {
      if (t.status === "done" && !prevDoneIds.current.has(t.id)) {
        const agent = agents[t.assigneeId];
        notify(
          `Task finished: ${t.title}`,
          agent ? `by ${agent.name}` : undefined,
        );
      }
    }
    prevDoneIds.current = cur;
  }, [tasks, agents]);
}
