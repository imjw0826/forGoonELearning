import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
export const lectures = sqliteTable("lectures", {
  id: text("id").primaryKey(), owner: text("owner").notNull(),
  title: text("title").notNull(), filename: text("filename").notNull(),
  bytes: integer("bytes").notNull(), duration: integer("duration").notNull(),
  total: integer("total").notNull(), status: text("status").notNull().default("uploading"),
  notes: text("notes"), created: integer("created").notNull(),
  lockUntil: integer("lock_until").notNull().default(0),
}, t => [index("idx_lectures_owner_created").on(t.owner, t.created)]);
export const chunks = sqliteTable("chunks", {
  lectureId: text("lecture_id").notNull().references(() => lectures.id, {onDelete:"cascade"}),
  ordinal: integer("ordinal").notNull(), audioKey: text("audio_key").notNull(),
  transcript: text("transcript"), correctedTranscript: text("corrected_transcript"), correctionAudit: text("correction_audit"), outline: text("outline"),
  startSeconds: integer("start_seconds"),
  lockUntil: integer("lock_until").notNull().default(0),
}, t => [primaryKey({columns:[t.lectureId, t.ordinal]})]);
export const mediaJobs = sqliteTable("media_jobs", {
  lectureId: text("lecture_id").primaryKey().references(() => lectures.id, {onDelete:"cascade"}),
  provider: text("provider").notNull().default("assemblyai"),
  transferUrl: text("transfer_url"), transferParts: text("transfer_parts"), transferReady: integer("transfer_ready").notNull().default(0), providerExpiresAt: integer("provider_expires_at"),
  sourceKey: text("source_key").notNull(), uploadId: text("upload_id").notNull(),
  mediaType: text("media_type").notNull(), ready: integer("ready").notNull().default(0),
  uploadUrl: text("upload_url"), remoteId: text("remote_id"),
  remoteStatus: text("remote_status"), lockUntil: integer("lock_until").notNull().default(0),
  sourceDeletedAt: integer("source_deleted_at"), providerDeletedAt: integer("provider_deleted_at"),
});
export const uploadParts = sqliteTable("upload_parts", {
  lectureId: text("lecture_id").notNull().references(() => lectures.id, {onDelete:"cascade"}),
  partNumber: integer("part_number").notNull(), etag: text("etag").notNull(),
  bytes: integer("bytes").notNull(),
}, t => [primaryKey({columns:[t.lectureId,t.partNumber]})]);
export const providerCredentials = sqliteTable("provider_credentials", {
  owner: text("owner").notNull(), provider: text("provider").notNull(),
  ciphertext: text("ciphertext").notNull(), iv: text("iv").notNull(),
  version: integer("version").notNull().default(1), updated: integer("updated").notNull(),
}, t => [primaryKey({columns:[t.owner,t.provider]})]);
