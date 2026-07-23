import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const RuntimeLeaseTable = sqliteTable(
  "runtime_lease",
  {
    resource_type: text().$type<"session-run" | "session-admin" | "checkpoint" | "project-memory">().notNull(),
    resource_id: text().notNull(),
    subresource_id: text().notNull().default(""),
    owner_instance_id: text().notNull(),
    owner_pid: integer().notNull(),
    lease_id: text().notNull(),
    fencing_token: integer().notNull(),
    heartbeat_at: integer().notNull(),
    expires_at: integer().notNull(),
    cancel_requested_at: integer(),
    cancel_reason: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resource_type, table.resource_id, table.subresource_id] }),
    index("runtime_lease_expiry_idx").on(table.expires_at),
    index("runtime_lease_owner_idx").on(table.owner_instance_id),
  ],
)
