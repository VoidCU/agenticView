import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Modal } from "./ui";
import type { Move, GameRoundResult } from "@agenticview/shared";

const MOVES: { key: Move; emoji: string; label: string }[] = [
  { key: "rock", emoji: "✊", label: "Rock" },
  { key: "paper", emoji: "✋", label: "Paper" },
  { key: "scissors", emoji: "✌", label: "Scissors" },
];

const RESULT_LABEL: Record<"you" | "agent" | "draw", string> = {
  you: "You win!",
  agent: "Agent wins!",
  draw: "Draw!",
};

type RoundDisplay = GameRoundResult & { revealed: boolean };

export function PlayRpsModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const agents = useStore((s) => s.agents);
  const send = useStore((s) => s.send);
  const lastGameRound = useStore((s) => s.lastGameRound);

  const agentName = agents[agentId]?.name ?? agentId;

  // Rounds played this match
  const [rounds, setRounds] = useState<RoundDisplay[]>([]);
  const [matchId, setMatchId] = useState<string | undefined>();
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState(false);
  const lastRoundRef = useRef<GameRoundResult | undefined>(undefined);

  // Listen for incoming round results
  useEffect(() => {
    if (!lastGameRound) return;
    // Only process if same matchId or no matchId yet
    if (matchId && lastGameRound.matchId !== matchId) return;
    if (lastRoundRef.current?.matchId === lastGameRound.matchId && lastRoundRef.current?.round === lastGameRound.round) return;
    lastRoundRef.current = lastGameRound;

    if (!matchId) setMatchId(lastGameRound.matchId);

    // Start with unrevealed, reveal after brief delay
    setRounds((prev) => {
      // Avoid duplicates
      if (prev.some((r) => r.round === lastGameRound.round)) return prev;
      return [...prev, { ...lastGameRound, revealed: false }];
    });

    // Reveal after animation delay
    const tid = setTimeout(() => {
      setRounds((prev) => prev.map((r) => (r.round === lastGameRound.round ? { ...r, revealed: true } : r)));
      setWaiting(false);
      if (lastGameRound.done) setDone(true);
    }, 700);
    return () => clearTimeout(tid);
  }, [lastGameRound, matchId]);

  const score = rounds.length > 0 ? rounds[rounds.length - 1]!.score : { you: 0, agent: 0 };
  const finalWinner: "you" | "agent" | "draw" | null = done
    ? score.you > score.agent
      ? "you"
      : score.agent > score.you
        ? "agent"
        : "draw"
    : null;

  const play = (move: Move) => {
    if (waiting || done) return;
    setWaiting(true);
    send({ type: "game.play", opponentId: agentId, matchId, move });
  };

  const playAgain = () => {
    setRounds([]);
    setMatchId(undefined);
    setWaiting(false);
    setDone(false);
    lastRoundRef.current = undefined;
  };

  const roundsNeeded = 2; // need 2 wins for best-of-3

  return (
    <Modal title={`RPS vs ${agentName}`} onClose={onClose}>
      <div className="rps-play-layout" data-testid="play-rps-modal">
        {/* Score header */}
        <div className="rps-score-bar" aria-label="Score">
          <div className="rps-score-side">
            <span className="rps-score-label">You</span>
            <span className="rps-score-num" data-testid="score-you">{score.you}</span>
          </div>
          <span className="rps-score-sep">—</span>
          <div className="rps-score-side">
            <span className="rps-score-num" data-testid="score-agent">{score.agent}</span>
            <span className="rps-score-label">{agentName}</span>
          </div>
        </div>

        {/* Round history */}
        {rounds.length > 0 && (
          <ul className="rps-round-list" aria-label="Round results">
            {rounds.map((r) => (
              <li
                key={r.round}
                className={`rps-round-item${r.revealed ? " rps-round-revealed" : " rps-round-pending"}${r.winner === "you" ? " rps-round-win" : r.winner === "agent" ? " rps-round-loss" : " rps-round-draw"}`}
                aria-label={`Round ${r.round}`}
              >
                <span className="rps-round-label">Round {r.round}</span>
                <span className="rps-round-moves">
                  {r.revealed ? (
                    <>
                      <span className="rps-move-reveal" title="Your move">{MOVES.find((m) => m.key === r.userMove)?.emoji ?? "?"}</span>
                      <span className="rps-vs-sep">vs</span>
                      <span className="rps-move-reveal" title={`${agentName}'s move`}>{MOVES.find((m) => m.key === r.agentMove)?.emoji ?? "?"}</span>
                    </>
                  ) : (
                    <span className="rps-move-hidden" aria-label="Revealing…">…</span>
                  )}
                </span>
                <span className="rps-round-result">
                  {r.revealed ? (r.winner === "you" ? "You win" : r.winner === "agent" ? `${agentName} wins` : "Draw") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Final result */}
        {done && finalWinner && (
          <div
            className={`rps-final${finalWinner === "you" ? " rps-final-win" : finalWinner === "agent" ? " rps-final-loss" : " rps-final-draw"}`}
            role="status"
            aria-live="polite"
            data-testid="rps-final-result"
          >
            {RESULT_LABEL[finalWinner]}
          </div>
        )}

        {/* Move buttons */}
        {!done && (
          <div className="rps-move-btns" role="group" aria-label="Choose your move">
            {MOVES.map(({ key, emoji, label }) => (
              <button
                key={key}
                type="button"
                className="rps-move-btn"
                onClick={() => play(key)}
                disabled={waiting}
                aria-label={label}
                data-testid={`rps-move-${key}`}
              >
                <span className="rps-btn-emoji">{emoji}</span>
                <span className="rps-btn-label">{label}</span>
              </button>
            ))}
          </div>
        )}

        {waiting && !done && (
          <p className="rps-waiting" role="status" aria-live="polite">Waiting for {agentName}…</p>
        )}

        {done && (
          <div className="rps-play-actions">
            <button type="button" className="btn btn-primary" onClick={playAgain}>
              Play again
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {/* Progress pips: best of {2*roundsNeeded-1} */}
        <div className="rps-progress" aria-label={`Best of ${2 * roundsNeeded - 1}`}>
          {Array.from({ length: 2 * roundsNeeded - 1 }).map((_, i) => (
            <span key={i} className="rps-progress-pip" />
          ))}
        </div>
      </div>
    </Modal>
  );
}
