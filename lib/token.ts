import { createHash } from "node:crypto";

/** Sync tokens are stored hashed, so a leaked database row is not a live token. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
