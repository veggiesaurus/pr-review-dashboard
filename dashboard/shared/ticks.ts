import type { Meta } from "./payload";

export const TICK_PREFIX = "prg:tick:";

// A PR as stored records name it; a branch with no PR goes by its name.
export const prKey = (meta: Pick<Meta, "repo" | "number" | "head">) =>
  meta.number ? `${meta.repo}#${meta.number}` : `${meta.repo}@${meta.head}`;
