/**
 * Overview clicks on an agent's robot open the CONVERSATION, never a game: the click selects the agent
 * (Robot.tsx) and, when that selected it, the Chat panel is revealed if it was collapsed. Rock-paper-
 * scissors is one step further, from the chat header's Play button (or the agent menu), for lounging
 * and working agents alike. Walk-mode keys (E/H/G/C) are unaffected.
 *
 * Expanding uses useHudPrefs.showChat (not persisted) and happens only on the click itself, so a user
 * who collapses the chat again keeps it collapsed: nothing re-opens it until they click an agent again,
 * and clicking the selected agent to deselect it never expands anything.
 */
import { useHudPrefs } from "./hudPrefs";
import { useStore } from "./store";

/** Robot body click in the overview, after the robot toggled the selection. */
export function overviewAgentClick(agentId: string): void {
  const s = useStore.getState();
  if (s.selectedAgentId !== agentId || !s.agents[agentId]) return; // that click deselected it (or it is not an agent: You)
  const hud = useHudPrefs.getState();
  if (hud.chatCollapsed) hud.showChat();
}
