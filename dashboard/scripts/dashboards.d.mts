export function cacheDir(): string;
export function dashboardsFor(session: string): { origin: string; token: string }[];
export function trimInput(input: Record<string, unknown>): Record<string, unknown>;
