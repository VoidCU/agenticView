import { create } from "zustand";

interface HudPrefs {
  showTags: boolean;
  chatCollapsed: boolean;
  tasksCollapsed: boolean;
  setShowTags(value: boolean): void;
  setChatCollapsed(value: boolean): void;
  setTasksCollapsed(value: boolean): void;
  /**
   * Expand the Chat panel for now without changing the saved preference: opening an agent's chat
   * (an overview robot click, C in walk mode) reveals it, but a user who keeps chat collapsed gets it
   * collapsed again on reload, and collapsing it themselves simply puts it back.
   */
  showChat(): void;
}

function read(key: string, fallback: boolean): boolean {
  try { const value = localStorage.getItem(`av:hud:${key}`); return value === null ? fallback : value === "true"; }
  catch { return fallback; }
}
function write(key: string, value: boolean) { try { localStorage.setItem(`av:hud:${key}`, String(value)); } catch { /* storage may be disabled */ } }

export const useHudPrefs = create<HudPrefs>((set) => ({
  showTags: read("show-tags", true), chatCollapsed: read("chat-collapsed", false), tasksCollapsed: read("tasks-collapsed", false),
  setShowTags: (showTags) => { write("show-tags", showTags); set({ showTags }); },
  setChatCollapsed: (chatCollapsed) => { write("chat-collapsed", chatCollapsed); set({ chatCollapsed }); },
  setTasksCollapsed: (tasksCollapsed) => { write("tasks-collapsed", tasksCollapsed); set({ tasksCollapsed }); },
  showChat: () => set({ chatCollapsed: false }),
}));
