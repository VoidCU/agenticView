import { useStore } from "../state/store";
import { Modal } from "./ui";
import type { PlayerStats, Match } from "@agenticview/shared";

const MOVE_EMOJI: Record<string, string> = { rock: "✊", paper: "✋", scissors: "✌" };

function winPct(s: PlayerStats): string {
  const total = s.wins + s.losses + s.draws;
  return total === 0 ? "—" : `${Math.round((s.wins / total) * 100)}%`;
}

function MatchRow({ match, agents }: { match: Match; agents: Record<string, import("@agenticview/shared").Agent> }) {
  const nameOf = (id: string) => (id === "you" ? "You" : agents[id]?.name ?? id);
  const [pA, pB] = match.players;
  const winnerName = match.winner ? nameOf(match.winner) : null;
  const dateStr = new Date(match.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <tr className="scoreboard-match-row">
      <td className="scoreboard-match-players">
        <span>{nameOf(pA!)}</span>
        <span className="scoreboard-vs">vs</span>
        <span>{nameOf(pB!)}</span>
      </td>
      <td className="scoreboard-match-moves">
        {MOVE_EMOJI[match.moves[0]] ?? "?"} {MOVE_EMOJI[match.moves[1]] ?? "?"}
      </td>
      <td className="scoreboard-match-result">
        {winnerName ? <span className="scoreboard-winner-badge">{winnerName} wins</span> : <span className="scoreboard-draw-badge">Draw</span>}
      </td>
      <td className="scoreboard-match-date">{dateStr}</td>
    </tr>
  );
}

export function ScoreboardModal({ onClose, onPlay }: { onClose: () => void; onPlay: (agentId: string) => void }) {
  const games = useStore((s) => s.games);
  const agents = useStore((s) => s.agents);

  const leaderboard = games?.leaderboard ?? [];
  const recent = games?.recent ?? [];

  // Sort by wins desc, then losses asc
  const sorted = [...leaderboard].sort((a, b) => b.wins - a.wins || a.losses - b.losses);

  const nameOf = (id: string) => (id === "you" ? "You" : agents[id]?.name ?? id);

  return (
    <Modal title="Lounge Scoreboard" onClose={onClose} wide>
      <div className="scoreboard-layout">
        {/* Leaderboard */}
        <section className="scoreboard-section">
          <h4 className="scoreboard-section-title">Leaderboard</h4>
          {sorted.length === 0 ? (
            <p className="scoreboard-empty">No matches yet. Challenge an agent!</p>
          ) : (
            <table className="scoreboard-table" aria-label="Leaderboard">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>W</th>
                  <th>L</th>
                  <th>D</th>
                  <th>Win %</th>
                  <th aria-label="Challenge" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((p, i) => {
                  const isAgent = p.playerId !== "you" && !!agents[p.playerId];
                  return (
                    <tr key={p.playerId} className="scoreboard-row">
                      <td className="scoreboard-rank">{i + 1}</td>
                      <td className="scoreboard-player">
                        <span
                          className="scoreboard-dot"
                          style={{ background: agents[p.playerId]?.appearance?.color ?? "#6b7280" }}
                        />
                        {nameOf(p.playerId)}
                      </td>
                      <td className="scoreboard-wins">{p.wins}</td>
                      <td className="scoreboard-losses">{p.losses}</td>
                      <td className="scoreboard-draws">{p.draws}</td>
                      <td className="scoreboard-pct">{winPct(p)}</td>
                      <td>
                        {isAgent && (
                          <button
                            type="button"
                            className="btn btn-xs btn-primary"
                            onClick={() => onPlay(p.playerId)}
                            aria-label={`Play ${nameOf(p.playerId)}`}
                          >
                            Play
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Recent matches */}
        {recent.length > 0 && (
          <section className="scoreboard-section">
            <h4 className="scoreboard-section-title">Recent matches</h4>
            <div className="scoreboard-matches-scroll">
              <table className="scoreboard-table scoreboard-matches" aria-label="Recent matches">
                <thead>
                  <tr>
                    <th>Players</th>
                    <th>Moves</th>
                    <th>Result</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, 20).map((m) => (
                    <MatchRow key={m.id} match={m} agents={agents} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
