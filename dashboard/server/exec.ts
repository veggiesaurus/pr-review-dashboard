export type RunResult = { code: number; stdout: string; stderr: string };

// The Linear key never reaches a child process, and neither tool is allowed to stop and ask a question.
export function childEnv() {
  const { LINEAR_API_KEY: _dropped, ...rest } = process.env;
  return { ...rest, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" };
}

// A program that isn't installed, or a folder that has gone, fails the spawn itself; that comes back as a failed run.
export async function run(cmd: string[], cwd: string, timeoutMs = 20_000, input?: string): Promise<RunResult> {
  const stdin = input === undefined ? "ignore" : new Blob([input]);
  try {
    const proc = Bun.spawn(cmd, { cwd, env: childEnv(), stdin, stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: -1, stdout: "", stderr: `${cmd[0]} didn't run: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
