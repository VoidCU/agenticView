import { join } from "node:path";
import { MailSourceSchema, MailTagSchema, MailThreadSchema } from "@agenticview/shared";
import { JsonStore } from "../store/jsonStore.js";
/**
 * Per-office mail data under `<office root>/mail/`: pull sources, pulled threads (one file per
 * `${accountId}_${gmailThreadId}`) and tags. Accounts and secrets are global (MailAccounts), never here.
 */
export class MailStore {
    sources;
    threads;
    tags;
    constructor(dir) {
        this.sources = new JsonStore(join(dir, "sources"), MailSourceSchema);
        this.threads = new JsonStore(join(dir, "threads"), MailThreadSchema);
        this.tags = new JsonStore(join(dir, "tags"), MailTagSchema);
    }
}
//# sourceMappingURL=store.js.map