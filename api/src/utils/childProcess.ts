import type { ChildProcess } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

/** Wait for a spawned process and reject on either spawn failure or non-zero exit. */
export function waitForSuccessfulExit(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit ${code}`;
      reject(new Error(`${label} failed (${detail})`));
    });
  });
}

/**
 * Connect two array-spawned processes without invoking a shell. By default,
 * both exit codes and the stream are checked. A consumer that intentionally
 * reads only part of its input can opt into the final-command shell semantics.
 */
export async function pipeChildProcesses(
  producer: ChildProcess,
  producerLabel: string,
  consumer: ChildProcess,
  consumerLabel: string,
  options: { allowEarlyConsumerExit?: boolean } = {},
): Promise<void> {
  if (!producer.stdout || !consumer.stdin) {
    producer.kill();
    consumer.kill();
    throw new Error('child pipeline requires producer stdout and consumer stdin');
  }

  const producerDone = waitForSuccessfulExit(producer, producerLabel);
  const consumerDone = waitForSuccessfulExit(consumer, consumerLabel);
  if (options.allowEarlyConsumerExit) {
    // Attach a rejection handler immediately: an expected SIGPIPE may arrive
    // before the successful consumer and stream promises settle.
    void producerDone.catch(() => {});
  }
  const streamDone = pipeline(producer.stdout, consumer.stdin).catch((err: unknown) => {
    // pg_restore can finish successfully after reading the archive TOC or one
    // selected table, before gunzip has emitted the archive's remaining data.
    // Its closed stdin then produces the same benign EPIPE a shell pipeline
    // would ignore when pg_restore (the final command) exits zero.
    if (
      options.allowEarlyConsumerExit &&
      err instanceof Error &&
      'code' in err &&
      err.code === 'EPIPE'
    ) {
      return;
    }
    throw err;
  });

  try {
    if (options.allowEarlyConsumerExit) {
      await Promise.all([consumerDone, streamDone]);
      if (producer.exitCode === null && producer.signalCode === null) producer.kill();
      await Promise.allSettled([producerDone]);
    } else {
      await Promise.all([producerDone, consumerDone, streamDone]);
    }
  } catch (err) {
    if (producer.exitCode === null && producer.signalCode === null) producer.kill();
    if (consumer.exitCode === null && consumer.signalCode === null) consumer.kill();
    await Promise.allSettled([producerDone, consumerDone, streamDone]);
    throw err;
  }
}
