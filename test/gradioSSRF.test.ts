import assert from 'node:assert';
import { isPrivateAddress } from '../server/routes/gradio';

assert.strictEqual(isPrivateAddress('127.0.0.1'), true);
assert.strictEqual(isPrivateAddress('10.0.0.1'), true);
assert.strictEqual(isPrivateAddress('172.16.0.1'), true);
assert.strictEqual(isPrivateAddress('192.168.1.1'), true);
assert.strictEqual(isPrivateAddress('169.254.169.254'), true);
assert.strictEqual(isPrivateAddress('100.64.0.1'), true);
assert.strictEqual(isPrivateAddress('8.8.8.8'), false);
assert.strictEqual(isPrivateAddress('1.1.1.1'), false);
assert.strictEqual(isPrivateAddress('::1'), true);
assert.strictEqual(isPrivateAddress('fd00::1'), true);
assert.strictEqual(isPrivateAddress('fe80::1'), true);
assert.strictEqual(isPrivateAddress('::ffff:127.0.0.1'), true);
assert.strictEqual(isPrivateAddress('::ffff:8.8.8.8'), false);

console.log('All isPrivateAddress tests passed successfully!');
