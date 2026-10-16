import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueFileToken, resolveFileToken, consumeFileToken } from '../server/_core/export-registry';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-export-registry-test-'));
const file = path.join(temp, 'export.mp4');
fs.writeFileSync(file, Buffer.alloc(2048));

const token = issueFileToken(file, 'metadata-clean', 5_000);
assert.equal(resolveFileToken(token, 'metadata-clean'), path.resolve(file));
assert.equal(resolveFileToken(token, 'download'), null);
assert.equal(consumeFileToken(token, 'metadata-clean'), path.resolve(file));
assert.equal(resolveFileToken(token, 'metadata-clean'), null);

fs.rmSync(temp, { recursive: true, force: true });
console.log('exportRegistry.test.ts passed');
