export const REDIS_PREFIX = "kilo:debug";
export const KEY_BUG = (id: string) => `${REDIS_PREFIX}:bug:${id}`;
export const KEY_FIX = (id: string) => `${REDIS_PREFIX}:fix:${id}`;
export const KEY_PATTERN = (type: string) => `${REDIS_PREFIX}:pattern:${type}`;
export const KEY_INDEX = `${REDIS_PREFIX}:index`;

export type DebugEntry = {
  id: string;
  timestamp: string;
  type: "bug" | "fix" | "pattern";
  problem?: string;
  root_cause?: string;
  fix_applied?: string;
  outcome?: string;
  session_id?: string;
  tags?: string[];
};
