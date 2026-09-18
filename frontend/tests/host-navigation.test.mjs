import assert from 'node:assert/strict';
import test from 'node:test';
import { hostWorkspaceHref } from '../lib/host-navigation.ts';

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
