import { useState, type FormEvent } from "react";
import { useStore, type PendingPermission, type PendingQuestion } from "../state/store";
import { Modal, prettyInput } from "./ui";

function InboxQuestionItem({ question }: { question: PendingQuestion }) {
  const send = useStore((s) => s.send);
  const agent = useStore((s) => s.agents[question.agentId]);
  const task = useStore((s) => s.tasks[question.taskId]);
  const select = useStore((s) => s.select);
  const [answer, setAnswer] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = answer.trim();
    if (!a) return;
    send({ type: "question.respond", id: question.id, answer: a });
    setAnswer("");
  };

  const agentName = agent?.name ?? question.agentId;

  return (
    <li className="inbox-item inbox-item-question" data-testid={`inbox-question-${question.id}`}>
      <div className="inbox-item-header">
        <span
          className="task-dot"
          aria-hidden="true"
          style={agent ? { background: agent.appearance.color } : undefined}
        />
        <button
          type="button"
          className="link"
          onClick={() => select(question.agentId)}
          aria-label={`View agent ${agentName}`}
        >
          {agentName}
        </button>
        {task && (
          <span className="inbox-item-task" title={`Task: ${task.title}`}>
            · {task.title}
          </span>
        )}
      </div>
      <p className="inbox-question-text">{question.question}</p>
      <form className="inbox-form" onSubmit={submit}>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type an answer"
          aria-label={`Answer for ${agentName}`}
        />
        <button type="submit" className="btn btn-primary btn-xs" disabled={!answer.trim()}>
          Answer
        </button>
      </form>
    </li>
  );
}

function InboxPermissionItem({ permission }: { permission: PendingPermission }) {
  const send = useStore((s) => s.send);
  const agent = useStore((s) => s.agents[permission.agentId]);
  const task = useStore((s) => s.tasks[permission.taskId]);
  const select = useStore((s) => s.select);
  const detail = prettyInput(permission.tool, permission.input);

  const respond = (allow: boolean) => send({ type: "permission.respond", id: permission.id, allow });
  const agentName = agent?.name ?? permission.agentId;

  return (
    <li className="inbox-item inbox-item-permission" data-testid={`inbox-permission-${permission.id}`}>
      <div className="inbox-item-header">
        <span
          className="task-dot"
          aria-hidden="true"
          style={agent ? { background: agent.appearance.color } : undefined}
        />
        <button
          type="button"
          className="link"
          onClick={() => select(permission.agentId)}
          aria-label={`View agent ${agentName}`}
        >
          {agentName}
        </button>
        {task && (
          <span className="inbox-item-task" title={`Task: ${task.title}`}>
            · {task.title}
          </span>
        )}
        <span>
          wants to run <code>{permission.tool}</code>
        </span>
      </div>
      {detail && <pre className="inbox-detail">{detail}</pre>}
      <div className="inbox-actions">
        <button
          type="button"
          className="btn btn-primary btn-xs"
          onClick={() => respond(true)}
          aria-label={`Allow ${permission.tool}`}
        >
          Allow
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => respond(false)}
          aria-label={`Deny ${permission.tool}`}
        >
          Deny
        </button>
      </div>
    </li>
  );
}

export function Inbox({ onClose }: { onClose: () => void }) {
  const questions = useStore((s) => s.questions);
  const permissions = useStore((s) => s.permissions);
  const total = questions.length + permissions.length;

  return (
    <Modal title={`Inbox${total > 0 ? ` (${total})` : ""}`} onClose={onClose} wide>
      <div className="inbox-panel" aria-label="Inbox">
        {total === 0 ? (
          <p className="empty">Your inbox is clear. No pending questions or permission requests.</p>
        ) : (
          <ul className="inbox-list" aria-label="Pending items">
            {questions.map((q) => (
              <InboxQuestionItem key={q.id} question={q} />
            ))}
            {permissions.map((p) => (
              <InboxPermissionItem key={p.id} permission={p} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
