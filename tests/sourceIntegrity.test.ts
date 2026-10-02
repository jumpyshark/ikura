import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const captureFlow = readFileSync(new URL('../src/components/CaptureFlow.tsx', import.meta.url), 'utf8');

test('capture flow has no unresolved merge markers', () => {
  assert.doesNotMatch(captureFlow, /^(<<<<<<<|=======|>>>>>>>)(?:\s|$)/m);
});

test('capture discard action does not depend on a merge-prone stylesheet key', () => {
  assert.doesNotMatch(captureFlow, /s\.discard(?:Text)?\b/);
});

test('gallery picker opens after the capture modal is shown', () => {
  assert.match(captureFlow, /onShow=\{showGallery\}/);
  assert.doesNotMatch(captureFlow, /if\(entry==='gallery'\)pick/);
});
