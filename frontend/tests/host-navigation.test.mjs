import assert from 'node:assert/strict';
import test from 'node:test';
import { hostWorkspaceHref, isHostEmbedded, isHostScriptWorkflow } from '../lib/host-navigation.ts';

test('iframe presentation distinguishes the independent feature from the project script workflow', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousLaunch = process.env.NEXT_PUBLIC_HOST_LAUNCH_URL;
  try {
    process.env.NEXT_PUBLIC_HOST_LAUNCH_URL = '/api/v1/script-master/launch';
    delete globalThis.window;
    assert.equal(isHostScriptWorkflow(), false);
    const frame = { name: '', parent: {} };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: frame });
    assert.equal(isHostScriptWorkflow(), true, 'legacy unnamed embedded frames keep the project workflow');
    frame.name = 'seqora-script-master-script';
    assert.equal(isHostScriptWorkflow(), true);
    frame.name = 'seqora-script-master-standalone';
    assert.equal(isHostEmbedded(), true, 'standalone iframe still uses host session binding');
    assert.equal(isHostScriptWorkflow(), false);
    frame.name = 'seqora-script-master-script';
    frame.parent = frame;
    assert.equal(isHostScriptWorkflow(), false, 'a top-level page always keeps full features');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousLaunch === undefined) delete process.env.NEXT_PUBLIC_HOST_LAUNCH_URL; else process.env.NEXT_PUBLIC_HOST_LAUNCH_URL = previousLaunch;
  }
});

test('host return links keep local and production origins and encode the exact import target', () => {
  const original = { home: process.env.NEXT_PUBLIC_HOST_HOME_URL, base: process.env.NEXT_PUBLIC_BASE_PATH };
  try {
    delete process.env.NEXT_PUBLIC_HOST_HOME_URL;
    process.env.NEXT_PUBLIC_BASE_PATH = '/script-master';
    assert.equal(hostWorkspaceHref(), '/');
    assert.equal(hostWorkspaceHref('target / one'), '/?projectId=target+%2F+one&view=script');
    assert.equal(hostWorkspaceHref('target / one', 'assets'), '/?projectId=target+%2F+one&view=assets');
    assert.equal(hostWorkspaceHref('target / one', 'storyboard'), '/?projectId=target+%2F+one&view=storyboard');
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.equal(hostWorkspaceHref(), 'http://localhost:5173/');
    process.env.NEXT_PUBLIC_HOST_HOME_URL = 'http://localhost:5177/';
    assert.equal(hostWorkspaceHref('target'), 'http://localhost:5177/?projectId=target&view=script');
  } finally {
    for (const [key, value] of [['NEXT_PUBLIC_HOST_HOME_URL', original.home], ['NEXT_PUBLIC_BASE_PATH', original.base]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
