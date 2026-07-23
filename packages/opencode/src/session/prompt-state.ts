import { Database, eq } from "@/storage"
import { Effect } from "effect"
import type { SessionID } from "./schema"
import { SessionPromptStateTable } from "./prompt-state.sql"

function claim(sessionID: SessionID, field: "last_recall_message_id" | "last_pressure_epoch", value: string) {
  return Database.transaction(
    (db) => {
      const row = db
        .select()
        .from(SessionPromptStateTable)
        .where(eq(SessionPromptStateTable.session_id, sessionID))
        .get()
      if (row?.[field] === value) return false
      const now = Date.now()
      if (!row) {
        db.insert(SessionPromptStateTable)
          .values({
            session_id: sessionID,
            last_recall_message_id: field === "last_recall_message_id" ? value : null,
            last_pressure_epoch: field === "last_pressure_epoch" ? value : null,
            time_updated: now,
          })
          .run()
        return true
      }
      db.update(SessionPromptStateTable)
        .set({ [field]: value, time_updated: now })
        .where(eq(SessionPromptStateTable.session_id, sessionID))
        .run()
      return true
    },
    { behavior: "immediate" },
  )
}

export const claimRecall = Effect.fn("SessionPromptState.claimRecall")(function* (sessionID: SessionID, messageID: string) {
  return yield* Effect.sync(() => claim(sessionID, "last_recall_message_id", messageID))
})

export const claimPressure = Effect.fn("SessionPromptState.claimPressure")(function* (sessionID: SessionID, epoch: string) {
  return yield* Effect.sync(() => claim(sessionID, "last_pressure_epoch", epoch))
})

export * as SessionPromptState from "./prompt-state"
