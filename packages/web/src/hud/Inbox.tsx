import { useState, type FormEvent, type ReactNode } from "react";
import { SimpleMarkdown } from "./markdown";
import { PROVIDER_LABELS } from "@agenticview/shared";
import type { Provider } from "@agenticview/shared";
import { useStore, type PendingPermission, type PendingQuestion, type PendingLimit } from "../state/store";
import { Modal, prettyInput } from "./ui";
import { timeAgo } from "./ui";

/**
 * Item header: who (agent, clickable) and what kind on the first line, the task it concerns on the
 * second. Keeps long task titles from running into the body text.
 */
function InboxHeader({ agentId, kind, kindLabel, extra }: { agentId: string; kind: "question" | "permission" | "limit"; kindLabel: string; extra?: ReactNode }) {
  const agent = useStore((s) => s.agents[agentId]);
  const select = useStore((s) => s.select);
  const agentName = agent?.name ?? agentId;
  return (
    <div className="inbox-item-header">
      <div className="inbox-item-who">
        <span className="task-dot" aria-hidden="true" style={agent ? { background: agent.appearance.color } : undefined} />
        <button type="button" className="link inbox-agent" onClick={() => select(agentId)} aria-label={`View agent ${agentName}`}>
          {agentName}
        </button>
        <span className={`inbox-kind inbox-kind-${kind}`}>{kindLabel}</span>
        {extra}
      </div>
    </div>
  );
}

function InboxTaskLine({ taskId }: { taskId: string }) {
  const task = useStore((s) => s.tasks[taskId]);
  if (!task) return null;
  return (
    <div className="inbox-item-task" title={`Task: ${task.title}`}>
      {task.title}
    </div>
  );
}

function InboxQuestionItem({ question }: { question: PendingQuestion }) {
  const send = useStore((s) => s.send);
  const agent = useStore((s) => s.agents[question.agentId]);
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
      <InboxHeader agentId={question.agentId} kind="question" kindLabel="asks" />
      <InboxTaskLine taskId={question.taskId} />
      <SimpleMarkdown text={question.question} className="inbox-question-text" />
      <form className="inbox-form inbox-actions-row" onSubmit={submit}>
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
  const detail = prettyInput(permission.tool, permission.input);

  const respond = (allow: boolean) => send({ type: "permission.respond", id: permission.id, allow });
  const agentName = agent?.name ?? permission.agentId;

  return (
    <li className="inbox-item inbox-item-permission" data-testid={`inbox-permission-${permission.id}`}>
      <InboxHeader agentId={permission.agentId} kind="permission" kindLabel="wants to run" extra={<code className="inbox-tool">{permission.tool}</code>} />
      <InboxTaskLine taskId={permission.taskId} />
      {detail && <pre className="inbox-detail">{detail}</pre>}
      <div className="inbox-actions inbox-actions-row">
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

function InboxLimitItem({ limit }: { limit: PendingLimit }) {
  const send = useStore((s) => s.send);
  const agent = useStore((s) => s.agents[limit.agentId]);
  const agentName = agent?.name ?? limit.agentId;

  const [mode, setMode] = useState<"idle" | "choose">("idle");
  const [chosenProvider, setChosenProvider] = useState<Provider | "">(limit.suggested?.provider ?? "");
  const [chosenModel, setChosenModel] = useState(limit.suggested?.model ?? "");

  const accept = () => {
    send({
      type: "limit.respond",
      id: limit.id,
      answer: "accept",
      provider: limit.suggested?.provider,
      model: limit.suggested?.model,
    });
  };

  const choose = (e: FormEvent) => {
    e.preventDefault();
    send({
      type: "limit.respond",
      id: limit.id,
      answer: "choose",
      provider: chosenProvider || undefined,
      model: chosenModel.trim() || undefined,
    });
  };

  const dismiss = () => {
    send({ type: "limit.respond", id: limit.id, answer: "dismiss" });
  };

  const resetLabel = limit.resetAt ? `resets ${timeAgo(limit.resetAt)}` : undefined;
  const suggestedLabel = limit.suggested ? PROVIDER_LABELS[limit.suggested.provider] + (limit.suggested.model ? ` / ${limit.suggested.model}` : "") : undefined;

  return (
    <li className="inbox-item inbox-item-limit" data-testid={`inbox-limit-${limit.id}`}>
      <InboxHeader agentId={limit.agentId} kind="limit" kindLabel="hit a limit" extra={resetLabel ? <span className="inbox-limit-reset">{resetLabel}</span> : undefined} />
      <InboxTaskLine taskId={limit.taskId} />
      {limit.reason && <SimpleMarkdown text={limit.reason} className="inbox-limit-reason" />}

      {mode === "idle" && (
        <div className="inbox-actions inbox-actions-row">
          {suggestedLabel && (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={accept}
              aria-label={`Accept switch to ${suggestedLabel}`}
            >
              Accept ({suggestedLabel})
            </button>
          )}
          {!suggestedLabel && (
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={() => setMode("choose")}
              aria-label="Choose provider for limit"
            >
              Choose provider
            </button>
          )}
          {suggestedLabel && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setMode("choose")}
              aria-label="Choose other provider"
            >
              Choose other
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={dismiss}
            aria-label={`Dismiss limit for ${agentName}`}
          >
            Dismiss
          </button>
        </div>
      )}

      {mode === "choose" && (
        <form className="inbox-form inbox-limit-form inbox-actions-row" onSubmit={choose}>
          <select
            value={chosenProvider}
            onChange={(e) => setChosenProvider(e.target.value as Provider | "")}
            aria-label="Provider"
          >
            <option value="">Auto</option>
            {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
            ))}
          </select>
          <input
            value={chosenModel}
            onChange={(e) => setChosenModel(e.target.value)}
            placeholder="model (optional)"
            aria-label="Model"
            autoComplete="off"
          />
          <button type="submit" className="btn btn-primary btn-xs">
            Switch
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMode("idle")}>
            Back
          </button>
        </form>
      )}
    </li>
  );
}

export function Inbox({ onClose }: { onClose: () => void }) {
  const questions = useStore((s) => s.questions);
  const permissions = useStore((s) => s.permissions);
  const limits = useStore((s) => s.limits);
  const total = questions.length + permissions.length + limits.length;

  return (
    <Modal title={`Inbox${total > 0 ? ` (${total})` : ""}`} onClose={onClose} wide>
      <div className="inbox-panel" aria-label="Inbox">
        {total === 0 ? (
          <p className="empty">Your inbox is clear. No pending questions or permission requests.</p>
        ) : (
          <ul className="inbox-list" aria-label="Pending items">
            {limits.map((l) => (
              <InboxLimitItem key={l.id} limit={l} />
            ))}
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
