// A change the checkout has that the reviewed head doesn't: after head line `after`, the lines in `gone` are
// replaced by those in `add`. Either can be empty, for lines only added or only removed.
export type LocalEdit = { after: number; gone: string[]; add: string[] };

// By file id. where is the folder the branch is checked out in, or null when it is checked out nowhere.
export type LocalChanges = { where: string | null; files: Record<string, LocalEdit[]>; truncated?: boolean };
