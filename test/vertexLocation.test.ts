import assert from 'node:assert';
import { isGlobalOnly as serverIsGlobalOnly, pickLocation as serverPickLocation, getVertexHost } from '../server/routes/vertex';
import { isGlobalOnly as clientIsGlobalOnly, pickLocation as clientPickLocation } from '../src/api/core';

// Test isGlobalOnly
const previewExpModels = [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.0-flash-exp',
    'gemini-experimental',
    'gemini-pro-vision-preview',
    'models/gemini-preview-001'
];

const standardModels = [
    'gemini-3.8-flash',
    'gemini-flash-latest',
    'gemini-3.1-flash-lite',
    'imagen-3.0-generate-002',
    'veo-2.0-generate-001'
];

for (const fn of [serverIsGlobalOnly, clientIsGlobalOnly]) {
    for (const model of previewExpModels) {
        assert.strictEqual(fn(model), true, `Expected ${model} to be global-only`);
    }
    for (const model of standardModels) {
        assert.strictEqual(fn(model), false, `Expected ${model} not to be global-only`);
    }
}

// Test pickLocation
for (const fn of [serverPickLocation, clientPickLocation]) {
    assert.strictEqual(fn('gemini-3.1-pro-preview', 'us-central1'), 'global');
    assert.strictEqual(fn('gemini-3.1-pro-preview', 'europe-west1'), 'global');
    assert.strictEqual(fn('gemini-2.0-flash-exp', 'asia-east1'), 'global');
    assert.strictEqual(fn('gemini-3.8-flash', 'us-central1'), 'us-central1');
    assert.strictEqual(fn('gemini-3.8-flash', 'europe-west1'), 'europe-west1');
    assert.strictEqual(fn('gemini-3.8-flash', ''), 'us-central1');
}

// Test getVertexHost
assert.strictEqual(getVertexHost('global'), 'aiplatform.googleapis.com');
assert.strictEqual(getVertexHost('us-central1'), 'us-central1-aiplatform.googleapis.com');
assert.strictEqual(getVertexHost('europe-west1'), 'europe-west1-aiplatform.googleapis.com');
assert.strictEqual(getVertexHost('asia-northeast1'), 'asia-northeast1-aiplatform.googleapis.com');

console.log('All vertexLocation test cases passed successfully!');
