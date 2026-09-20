import assert from 'node:assert/strict';
import test from 'node:test';
import { generationDiagnostics } from '../lib/generation-diagnostics.ts';

test('durable quick timeout receipts expose useful bounded diagnostics without content or credentials', () => {
  const receipt = { error_code: 'quick_model_timeout', operation_id: 'op-test', candidate: { content: 'private draft' },
    diagnostics: { error_type: 'LLMRequestError', category: 'deadline', deadline_scope: 'request', elapsed_ms: 120000,
      physical_requests: 1, http_status: 504, message: 'private upstream response', url: 'https://secret.invalid',
      api_key: 'secret-credential' } };
  const report = generationDiagnostics({ projectId: 'project-test', stage: 'plan', error: receipt, operationId: receipt.operation_id });
  assert.equal(report.failureClass, 'quick_model_timeout');
  assert.equal(report.errorType, 'LLMRequestError');
  assert.equal(report.category, 'deadline');
  assert.equal(report.deadlineScope, 'request');
  assert.equal(report.elapsedMs, 120000);
  assert.equal(report.physicalRequests, 1);
  assert.equal(report.upstreamStatus, 504);
  assert.doesNotMatch(JSON.stringify(report), /private|secret|credential|api_key|candidate/);
});

test('untrusted malformed diagnostic values cannot leak URLs or produce invalid timing/status', () => {
  const report = generationDiagnostics({ projectId: 'test', stage: 'plan', error: { diagnostics: {
    error_type: 'https://secret.invalid', category: 'Bearer secret', deadline_scope: 'private\nbody',
    elapsed_ms: -1, physical_requests: Infinity, http_status: 900,
  } } });
  for (const key of ['errorType', 'category', 'deadlineScope', 'elapsedMs', 'physicalRequests', 'upstreamStatus']) assert.equal(report[key], undefined);
});
