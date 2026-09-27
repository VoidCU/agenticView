import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Modal } from "./ui";
import { useEngage } from "../scene/engage";
import { rpsResultLine, rpsThrowLine, sayRps } from "../state/rps";
import type { Move, GameRoundResult } from "@agenticview/shared";

const MOVES: { key: Move; emoji: string; label: string; hint: string }[] = [
  { key: "rock", emoji: "✊", label: "Rock", hint: "1/R" },
  { key: "paper", emoji: "✋", label: "Paper", hint: "2/P" },
  { key: "scissors", emoji: "✌", label: "Scissors", hint: "3/S" },
];

const KEY_MOVES: Record<string, Move> = { "1": "rock", r: "rock", "2": "paper", p: "paper", "3": "scissors", s: "scissors" };

/** Keyboard play: 1/2/3 or R/P/S (any case, top row or numpad) pick a move. Exported for tests. */
export function rpsMoveForKey(key: string, code = ""): Move | undefined {
  const numpad = /^Numpad([123])$/.exec(code);
  return KEY_MOVES[numpad ? numpad[1]! : key.toLowerCase()];
}

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
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);

  // The agent stops what it is doing and faces the player for the match; it resumes on close.
  useEffect(() => {
    useEngage.getState().engage(agentId);
    return () => {
      if (useEngage.getState().agentId === agentId) useEngage.getState().engage(undefined);
    };
  }, [agentId]);

  // Listen for incoming round results
  useEffect(() => {
    if (!lastGameRound) return;
    // Only process if same matchId or no matchId yet
    if (matchId && lastGameRound.matchId !== matchId) return;
    if (lastRoundRef.current?.matchId === lastGameRound.matchId && lastRoundRef.current?.round === lastGameRound.round) return;
    lastRoundRef.current = lastGameRound;

    if (!matchId) setMatchId(lastGameRound.matchId);

    // Emotes over the robot: its throw now, its reaction on the reveal.
    const round = lastGameRound;
    sayRps(agentId, rpsThrowLine(round));

    // Start with unrevealed, reveal after brief delay
    setRounds((prev) => {
      // Avoid duplicates
      if (prev.some((r) => r.round === lastGameRound.round)) return prev;
      return [...prev, { ...lastGameRound, revealed: false }];
    });

    // Reveal after animation delay. The timer lives in a ref: setMatchId above re-runs this effect,
    // and clearing the timer in that cleanup used to leave the first round unrevealed.
    revealTimers.current.push(setTimeout(() => {
      setRounds((prev) => prev.map((r) => (r.round === lastGameRound.round ? { ...r, revealed: true } : r)));
      setWaiting(false);
      if (lastGameRound.done) setDone(true);
      sayRps(agentId, rpsResultLine(round));
    }, 700));
  }, [lastGameRound, matchId, agentId]);

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


  // Keyboard play (works in walk and overview): 1/2/3 or R/P/S, Enter = play again when finished.
  const keyActions = useRef({ play, playAgain, done });
  keyActions.current = { play, playAgain, done };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const a = keyActions.current;
      if (e.key === "Enter" && a.done) { e.preventDefault(); a.playAgain(); return; }
      const move = rpsMoveForKey(e.key, e.code);
      if (!move) return;
      e.preventDefault();
      e.stopPropagation();
      a.play(move);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
            {MOVES.map(({ key, emoji, label, hint }) => (
              <button
                key={key}
                type="button"
                className="rps-move-btn"
                onClick={() => play(key)}
                disabled={waiting}
                aria-label={label}
                aria-keyshortcuts={hint.split("/").join(" ")}
                data-testid={`rps-move-${key}`}
              >
                <span className="rps-btn-emoji">{emoji}</span>
                <span className="rps-btn-label">{label} <kbd className="rps-btn-key">[{hint}]</kbd></span>
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
