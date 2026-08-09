import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arg, has } from './cliArgs.js';

function withArgv(extra: string[], fn: () => void): void {
  const original = process.argv;
  process.argv = [...original.slice(0, 2), ...extra];
  try {
    fn();
  } finally {
    process.argv = original;
  }
}

test('arg returns the value following the flag', () => {
  withArgv(['--slug', 'barbell-back-squat'], () => {
    assert.equal(arg('slug'), 'barbell-back-squat');
  });
});

test('arg returns undefined when the flag is absent', () => {
  withArgv(['--other', 'x'], () => {
    assert.equal(arg('slug'), undefined);
  });
});

test('arg throws when the flag has no following value', () => {
  withArgv(['--slug'], () => {
    assert.throws(() => arg('slug'), /--slug needs a value/);
  });
});

test('arg throws when the following token is itself a flag', () => {
  withArgv(['--slug', '--other'], () => {
    assert.throws(() => arg('slug'), /--slug needs a value/);
  });
});

test('has returns true when the flag is present', () => {
  withArgv(['--all'], () => {
    assert.equal(has('all'), true);
  });
});

test('has returns false when the flag is absent', () => {
  withArgv(['--slug', 'x'], () => {
    assert.equal(has('all'), false);
  });
});
