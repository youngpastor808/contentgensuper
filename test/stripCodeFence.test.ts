import assert from 'node:assert';
import { stripCodeFence as serverStrip } from '../server/_core/geminiCookieProxy';
import { stripCodeFence as clientStrip } from '../src/api/core';

const cases = [
    { input: '{"a":1}', expected: '{"a":1}' },
    { input: '```json\n{"a":1}\n```', expected: '{"a":1}' },
    { input: 'Sure!\n```json\n{"a":1}\n```\nHope that helps', expected: '{"a":1}' },
    { input: '```json\n{"a":1}', expected: '{"a":1}' },
    { input: '```json\n{"code":"```hi```"}\n```', expected: '{"code":"```hi```"}' },
    { input: '{"note":"use ```code``` here"}', expected: '{"note":"use ```code``` here"}' },
    { input: '```html\n<p>hi</p>\n```', expected: '<p>hi</p>' },
    { input: '', expected: '' }
];

for (const fn of [serverStrip, clientStrip]) {
    for (const { input, expected } of cases) {
        const actual = fn(input);
        assert.strictEqual(actual, expected, `Failed for input: ${JSON.stringify(input)}\nExpected: ${expected}\nActual: ${actual}`);
    }
}

console.log('All stripCodeFence test cases passed successfully!');
