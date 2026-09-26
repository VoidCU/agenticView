import { create } from "zustand";

export type AgentActivity = "desk" | "lounge" | "break" | "fainted" | "walking" | "meeting" | "waiting";

export interface AgentPosition {
  x: number;
  z: number;
  /** Id of the hex space the agent currently occupies (undefined during transitions). */
  spaceId?: string;
  activity: AgentActivity;
}

export interface PlayerPosition {
  x: number;
  z: number;
  yaw: number;
  spaceId?: string;
}

interface PositionsState {
  byAgent: Record<string, AgentPosition>;
  player?: PlayerPosition;
  /** Replace a complete position snapshot. */
  set(positions: Record<string, AgentPosition>): void;
  setPosition(agentId: string, position: AgentPosition): void;
  removePosition(agentId: string): void;
  replacePositions(positions: Record<string, AgentPosition>): void;
  setPlayer(position?: PlayerPosition): void;
}

export const usePositions = create<PositionsState>((set) => ({
  byAgent: {},
  player: undefined,
  set: (byAgent) => set({ byAgent }),
  setPosition: (agentId, position) => set((state) => ({ byAgent: { ...state.byAgent, [agentId]: position } })),
  removePosition: (agentId) => set((state) => {
    if (!(agentId in state.byAgent)) return state;
    const byAgent = { ...state.byAgent };
    delete byAgent[agentId];
    return { byAgent };
  }),
  replacePositions: (byAgent) => set({ byAgent }),
  setPlayer: (player) => set({ player }),
}));
