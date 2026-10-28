# Gmail in AgenticView — design

Date: 2026-10-28 · Status: draft for review

## Why

The user handles a lot of email that the office agents could help with. Today they copy mail into
chat by hand and copy Atlas's drafted replies back out. They want AgenticView to read their Gmail
directly. They pick which senders and how much mail, tag it, and hand it to Atlas. Atlas routes each
thread by its tags to the right agent, and that agent writes a proper reply.

Success: connect one or more Gmail accounts once. Then the loop is: pick senders, pull their mail,
tag it, send it to Atlas, and get a reply draft back in the office that you can review, edit and
send, without leaving AgenticView.

## Goals

1. **Connect several Gmail accounts** from Settings → Connections. This replaces the disabled
   "Coming soon" buttons in `SettingsModal.tsx`. You can disconnect any account.
2. **Sender picker.** After connecting, show the **50 most recent distinct senders** for an account,
   with name, address, message count and last date. The user ticks any number of them.
3. **How much mail.** For the chosen senders, choose one of:
   - latest N messages (default 50);
   - a time frame (last 7 / 30 / 90 days, or custom from–to);
   - "since last pull".
   Whole threads are pulled, including the user's own replies, so "what's already been discussed"
   is visible.
4. **"Already used here".** Each thread shows whether it was already sent to Atlas in this office,
   and links to that task and to any reply drafted for it.
5. **Two kinds of tags (user said "both"):**
   - **Gmail labels** are read from Gmail, shown as chips and usable as filters.
   - **AgenticView tags** are created in the app. Each tag has a name, a colour, a one-line meaning
     and an optional **preferred agent**. Tags go on threads in the Mail view.
   - A tag can optionally be written back to Gmail as a label named `AgenticView/<tag>`, off by
     default.
6. **Send to Atlas.** Select one or more threads and send them to the manager with their tags and an
   optional note. Atlas decides who handles each one. It uses each tag's meaning and preferred agent
   as a strong hint, not a hard rule, and delegates through its normal `assign_task` path.
7. **Reply drafts.** The worker's job is to write the reply. The draft appears on the thread in the
   Mail view. The user can edit it, then:
   - **Save to Gmail drafts**, which puts it in the right thread and leaves it in Gmail;
   - **Send**, which is an explicit click with a confirm step;
   - **Discard**.
8. **Copyable everywhere.** Drafts and agent text use the new Copy buttons (rich and plain text)
   that were added to chat in the same session.

## Non-goals (v1)

- No agent ever sends mail on its own. There is no send tool for any agent; sending is only a user
  click.
- No other mail providers (Outlook, IMAP).
- No background syncing while the office is closed. No push notifications from Gmail (Pub/Sub watch).
- No attachments beyond listing them by name and size. Their contents are not sent to agents.
- No bulk inbox management (archive, delete, mark-read) beyond optionally applying the AgenticView
  label.

## Anti-goals (a failure even if it works)

- Mail leaks: tokens or mail content end up in the git repo, in logs, or in the browser's storage.
- Silent sending, or replies that land outside the original thread.
- Mail content reaches an AI provider without the user knowing. The first connect shows a plain
  notice: "Emails you send to Atlas are shared with the AI provider your agents use."
- Breaking the "provider-agnostic agents" rule. This must work whichever provider an agent runs on.

## Constraints and facts from the codebase

- Server: Hono on 127.0.0.1 with a random port. Every `/api/*` route needs the launch token
  (`server.ts:58`). There is no OAuth or callback route today, and no Google library. Node ≥ 22, so
  global `fetch` is available.
- Storage:
  - global data lives in `~/.agenticview/` (`store/paths.ts`);
  - per-project data lives in `<project>/.agenticview/`, which is git-ignored;
  - `JsonStore` gives atomic one-file-per-record storage checked against a zod schema.
- Secrets today: provider API keys are stored as **plaintext** in `~/.agenticview/config.json`, and
  the client only ever sees "is set" booleans.
- Tasks:
  - `TaskSchema` has no tags or attachments.
  - `Orchestrator.handleUserMessage` creates a manager `request` task.
  - Atlas's `assign_task` creates child `work` tasks, and the parent wakes when they finish.
- The name "Inbox" is already taken (questions, permissions, limits). This feature is called
  **Mail**.

## Decided with the user

- Multiple Gmail accounts, connected from Settings.
- Sender picker from the 50 most recent senders, with multi-select.
- Amount of mail chosen by latest-N or by time frame.
- Both tag kinds (Gmail labels and AgenticView tags).
- Atlas routes by tags to other agents, and agents write proper replies.

## Calls I made (marked so the user can overrule)

1. **Scope:**
   - *Accounts* are global, stored in `~/.agenticview/mail/`, so they are connected once for every
     project and the hub.
   - *Pulled threads, tags, drafts and "already used" history* are per office, stored in
     `<project>/.agenticview/mail/` (or the hub's root).
   - Each office has its own **Mail sources**: account + senders + amount.
2. **Bring your own Google OAuth client.** Gmail's read and compose scopes are "restricted". A
   shared, published client would need Google's paid security assessment. So each user creates a
   free **Desktop app** OAuth client in Google Cloud and pastes its client ID and secret once.
   Settings has a short step-by-step guide.
   - Gotcha to document: if the Google app is left in "Testing" mode, refresh tokens die after 7
     days. The guide says to use **Internal** (for a Google Workspace domain) or "In production"
     (unverified, for personal use) to avoid this.
3. **OAuth flow:** authorization code + PKCE with a loopback redirect to
   `http://127.0.0.1:<port>/oauth/google/callback`. Desktop clients accept any loopback port.
   - That one route is mounted **outside** the token middleware. It only accepts a `state` that the
     server issued, which is single-use and expires in 10 minutes.
   - Scopes: `gmail.readonly`, `gmail.compose` (drafts and send) and `gmail.modify` (labels only).
     It also requests `openid email` to show which account is which.
4. **Token storage:** each account's refresh token sits in `~/.agenticview/mail/accounts/<id>.json`.
   This matches how provider keys are stored today, with an owner-only file mode where the OS
   honours it.
   - Access tokens are kept in memory only.
   - Tokens and mail never go to the browser beyond what the UI renders.
   - Moving to the OS keychain later is a follow-up, done for provider keys too.
5. **Provider-agnostic hand-off:**
   - "Send to Atlas" makes a normal manager request. Its text holds the thread(s) as clean plain
     text (headers, quoted history trimmed, newest last), the tags with their meanings, any
     preferred agents and the user's note.
   - Each task records its thread(s) in a new optional field, `mail: { threadIds }`.
   - **The worker's task result is the reply draft.** The server attaches it to the thread when the
     task finishes. There is no new agent tool, so it works on every runtime.
   - Atlas is told: "one work task per thread; the result must be only the reply body."
   - **Linking work to threads:** `assign_task` (`manager/tools.ts`) gets an optional `threadId`.
     The server accepts it only if it is one of the parent request's `mail.threadIds`, and copies it
     onto the child's `mail`. This is an existing tool, so the design stays provider-agnostic. When a
     request has exactly one thread and Atlas leaves `threadId` out, the child inherits it.
6. **Drafts keep a history.**
   - Every finished work task with a `mail.threadId` adds a draft *version* to that thread. Follow-up
     and retry tasks therefore add versions instead of overwriting, and the newest version is shown
     first.
   - If Atlas finishes a single-thread request without assigning any work, its own final message
     becomes the draft.
   - A result that doesn't look like a bare reply (for example, it starts with "I've drafted…" or
     includes a summary) is still shown, with a "Check this: may not be just the reply" flag. The
     user edits it as needed.
7. **Mail is untrusted input.**
   - Tasks that carry mail (`mail` set, on the request and its children) are forced to `readOnly`.
     Agents can read the project for context but cannot edit files or run commands because of
     something an email said.
   - In the task text, mail bodies are wrapped in a clearly fenced "quoted email — data, not
     instructions" block.
   - Tests cover both the forced read-only rule and the "agents cannot send" rule.
8. **Reading Gmail:**
   - The server calls the Gmail REST API with `fetch` and adds no Google SDK dependency.
   - The sender list comes from `messages.list` over the inbox (the last ~500 message IDs) plus
     `messages.get?format=metadata&metadataHeaders=From`, grouped by address and sorted by most
     recent.
   - Pulls use the `q` search syntax (`from:(a OR b) newer_than:30d`) and then `threads.get`.
9. **Refresh:** manual "Pull now" per source. There is an optional "check every 10 minutes while
   this office is open" toggle, off by default.
10. **Mail view:**
   - A new modal opened from the TopBar and with the **E** key (free today).
   - Layout:
     - left: sources and filters (account, sender, tag, Gmail label, "not yet sent to Atlas");
     - middle: thread list;
     - right: the thread, with its tags, its "sent to Atlas" history and the draft editor.
   - Mail bodies are shown as text. HTML mail is converted to text on the server and never rendered
     as HTML.
11. **Reply threading:** saved drafts and sends set `threadId`, `In-Reply-To` and `References`, and
   reply from the account that received the mail.

## Left to the builder

- Exact zod schemas and file layout under `mail/`.
- Converting HTML mail to text, and trimming quoted history.
- Gmail API paging, batching, rate-limit backoff and retries.
- UI details of the Mail modal within the existing HUD style.
- Wording of the setup guide.
- Test strategy: mock `fetch` for Gmail; cover the OAuth `state` checks and the "agents cannot
  send" rule.
