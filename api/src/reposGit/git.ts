import { spawn } from 'node:child_process';

/** Trusted clone only. Never point this runner at an agent-owned repository. */
export const GIT_HARDENING: readonly string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'credential.helper=',
  '-c',
  'http.followRedirects=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.https.allow=always',
  '-c',
  'protocol.file.allow=always',
];

export function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  // An allowlist also excludes broker/operator secrets and inherited Git
  // index, object-directory, config-injection, tracing and transport overrides.
  return {
    PATH: process.env.PATH,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    GIT_NO_REPLACE_OBJECTS: '1',
    ...extra,
  };
}

export interface GitResult {
  code: number;
  stdout: string;
}
export async function runGit(
  repoDir: string,
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...GIT_HARDENING, ...args], {
      cwd: repoDir,
      env: gitEnvironment(options.env),
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let bytes = 0;
    let stdout = '';
    let failed = false;
    const fail = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(fail, 30_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) fail();
      else stdout += chunk.toString('utf8');
    });
    // Never propagate stderr: transport failures can include credentials.
    child.stderr!.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) fail();
    });
    child.stdin?.on('error', fail);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('git could not start'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: failed ? 1 : (code ?? 1), stdout });
    });
    if (options.input !== undefined) child.stdin!.end(options.input, 'utf8');
  });
}
