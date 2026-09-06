// What production is ACTUALLY running.
//
// The SHA is read from the live container's APP_SHA rather than from a
// registry tag or a compose file, because those record what was intended to
// be deployed. Ship detection must not tell somebody their bug is fixed
// because a deploy was requested.
import { spawn } from 'node:child_process';
import { waitForSuccessfulExit } from '../utils/childProcess.js';

const SHA_RE = /^[0-9a-f]{40}$/;
const TIMEOUT_MS = 15_000;
const CONTAINER = 'RepOS';

export type DeployedRevErrorCode = 'unreadable' | 'malformed' | 'not_configured';

export class DeployedRevError extends Error {
  readonly code: DeployedRevErrorCode;
  constructor(code: DeployedRevErrorCode, message: string) {
    super(message);
    this.name = 'DeployedRevError';
    this.code = code;
  }
}

type Runner = (argv: string[]) => Promise<string>;
let runnerOverride: Runner | null = null;

export function __setDeployedRevRunnerForTesting(r: Runner | null): void {
  runnerOverride = r;
}

const defaultRunner: Runner = async (argv) => {
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c: string) => {
    out += c;
  });
  child.stderr.resume();
  try {
    await waitForSuccessfulExit(child, 'ssh docker inspect');
  } finally {
    clearTimeout(timer);
  }
  return out;
};

/**
 * The full lowercase 40-hex commit the production container was built from.
 *
 * Throws rather than returning a placeholder for every failure mode. A caller
 * that cannot read this must no-op; guessing is how somebody gets told their
 * bug shipped when it did not.
 */
export async function readDeployedRev(): Promise<string> {
  const host = process.env.UNRAID_SSH_HOST;
  const user = process.env.UNRAID_SSH_USER ?? 'root';
  if (!host) {
    throw new DeployedRevError('not_configured', 'UNRAID_SSH_HOST is not set');
  }

  // Fixed argv. Nothing here is built by string concatenation, and the remote
  // command is a literal docker invocation with no user-supplied component.
  // Format string includes .State.Running on first line (must be 'true' for
  // running container), then environment variables.
  const formatArg = '{{.State.Running}}\n{{range .Config.Env}}{{println .}}{{end}}';
  const argv = [
    'ssh',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `ConnectTimeout=10`,
    `${user}@${host}`,
    'docker',
    'inspect',
    '--format',
    formatArg,
    CONTAINER,
  ];

  let raw: string;
  try {
    raw = await (runnerOverride ?? defaultRunner)(argv);
  } catch (err) {
    throw new DeployedRevError('unreadable', `could not read ${CONTAINER}'s env: ${String(err)}`);
  }

  const lines = raw.split('\n').map((l) => l.trim());
  const runningLine = lines[0];
  if (runningLine !== 'true') {
    throw new DeployedRevError('unreadable', `container ${CONTAINER} is not running`);
  }

  const envLines = lines.slice(1);
  const appShaLine = envLines.find((l) => l.startsWith('APP_SHA='));
  if (!appShaLine) {
    throw new DeployedRevError(
      'malformed',
      `container ${CONTAINER} does not have APP_SHA in environment`,
    );
  }
  const value = appShaLine.slice('APP_SHA='.length).trim();

  if (!SHA_RE.test(value)) {
    throw new DeployedRevError(
      'malformed',
      `container reported ${JSON.stringify(value.slice(0, 64))}, not a 40-hex SHA`,
    );
  }
  return value;
}
