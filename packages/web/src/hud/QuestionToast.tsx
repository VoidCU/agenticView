import { useState, type FormEvent } from "react";
import { useStore, type PendingQuestion } from "../state/store";
import { SimpleMarkdown } from "./markdown";

function QuestionCard({ question }: { question: PendingQuestion }) {
  const send = useStore((s) => s.send);
  const agent = useStore((s) => s.agents[question.agentId]);
  const select = useStore((s) => s.select);
  const task = useStore((s) => s.tasks[question.taskId]);
  const [answer, setAnswer] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = answer.trim();
    if (!a) return;
    send({ type: "question.respond", id: question.id, answer: a });
    setAnswer("");
  };
  return (
    <form className="toast toast-question" onSubmit={submit} aria-label={`Question from ${agent?.name ?? question.agentId}`}>
      <div className="toast-body">
        <div className="toast-title">
          <button type="button" className="link inbox-agent" onClick={() => select(question.agentId)}>
            {agent?.name ?? question.agentId}
          </button>
          <span className="inbox-kind inbox-kind-question">asks</span>
        </div>
        {task && <div className="toast-task" title={`Task: ${task.title}`}>{task.title}</div>}
        <SimpleMarkdown text={question.question} className="toast-question-text" />
        <div className="toast-row">
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" placeholder="Type an answer" autoFocus />
          <button type="submit" className="btn btn-primary btn-xs" disabled={!answer.trim()}>
            Answer
          </button>
        </div>
      </div>
    </form>
  );
}

export function QuestionToast() {
  const questions = useStore((s) => s.questions);
  if (questions.length === 0) return null;
  return (
    <div className="toasts toasts-question" aria-live="assertive">
      {questions.map((q) => (
        <QuestionCard key={q.id} question={q} />
      ))}
    </div>
  );
}
