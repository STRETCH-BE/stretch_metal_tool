/**
 * Audit log writer — every rate change, override decision, quote send,
 * status change and user-role change goes through here.
 * File path: /lib/audit.ts
 *
 * Writes with the service-role client because audit_log has no insert
 * policy for users (rows must be tamper-proof). Never throws: an audit
 * failure is logged to the server console but does not break the action.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/db/types";

export type AuditEntry = {
  actor: string | null;
  /** e.g. "quote.send", "rate_version.activate", "override.approve" */
  action: string;
  /** Table / entity name, e.g. "quotes" */
  entity: string;
  entityId?: string | null;
  before?: Json | null;
  after?: Json | null;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("audit_log").insert({
      actor: entry.actor,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  } catch (error) {
    console.error("[audit] failed to write entry", entry.action, error);
  }
}
