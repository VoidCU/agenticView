/** Runs a mail action, reporting its error to the Mail modal; resolves true when it succeeded. */
export type MailRun = (fn: () => Promise<unknown>) => Promise<boolean>;

export function mailDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

/** "Alice <alice@x.com>" → "Alice"; a bare address stays as it is. */
export function senderName(from: string, email: string): string {
  const name = from.replace(/<[^>]*>/, "").replace(/"/g, "").trim();
  return name || email;
}
