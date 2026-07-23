import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"

export const SessionPromptStateTable = sqliteTable("session_prompt_state", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  last_recall_message_id: text(),
  last_pressure_epoch: text(),
  time_updated: integer().notNull(),
})
