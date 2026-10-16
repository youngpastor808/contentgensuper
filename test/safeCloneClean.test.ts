import assert from 'node:assert';
import { safeJsonStringify } from '../src/utils-core';

// Test CharacterProfile with image { data, mimeType }
const profile = {
    id: 'char-1',
    name: 'Hero',
    voice: 'alloy',
    image: {
        data: 'base64imagedata==',
        mimeType: 'image/png'
    },
    text: 'A brave adventurer'
};

const serialized = safeJsonStringify(profile);
const parsed = JSON.parse(serialized);

assert.strictEqual(parsed.id, 'char-1');
assert.strictEqual(parsed.name, 'Hero');
assert.strictEqual(parsed.text, 'A brave adventurer');
assert.ok(parsed.image, 'image object should be preserved');
assert.strictEqual(parsed.image.data, 'base64imagedata==');
assert.strictEqual(parsed.image.mimeType, 'image/png');

// Test object with image string
const objWithStringImage = { image: 'https://cdn/x.png', text: 'hi' };
const parsedObj = JSON.parse(safeJsonStringify(objWithStringImage));
assert.strictEqual(parsedObj.image, 'https://cdn/x.png');

// Test object with image null
const objWithNullImage = { image: null, text: 'hi' };
const parsedNull = JSON.parse(safeJsonStringify(objWithNullImage));
assert.strictEqual(parsedNull.image, null);

// Test clip restoration simulation (Object.keys diff restoration)
const mockClip: any = {
    id: 'clip-1',
    start: 0,
    duration: 5,
    overlayImage: { tagName: 'IMG' }, // non-serializable DOM-like object
    customMediaField: { sampleRate: 44100, numberOfChannels: 2, getChannelData: () => {} } // AudioBuffer-like
};
const cloned = JSON.parse(safeJsonStringify(mockClip));
for (const k of Object.keys(mockClip)) {
    if (cloned[k] === undefined && mockClip[k] !== undefined) {
        cloned[k] = mockClip[k];
    }
}
assert.strictEqual(cloned.id, 'clip-1');
assert.strictEqual(cloned.duration, 5);
assert.strictEqual(cloned.overlayImage, mockClip.overlayImage);
assert.strictEqual(cloned.customMediaField, mockClip.customMediaField);

// Test shared/duplicate objects in one payload
const sharedStyle = { color: 'red', fontSize: 16 };
const multiRefObj = { a: sharedStyle, b: sharedStyle };
const parsedMultiRef = JSON.parse(safeJsonStringify(multiRefObj));
assert.deepStrictEqual(parsedMultiRef.a, { color: 'red', fontSize: 16 });
assert.deepStrictEqual(parsedMultiRef.b, { color: 'red', fontSize: 16 });

const elementsArray = { elements: [{ style: sharedStyle }, { style: sharedStyle }] };
const parsedElements = JSON.parse(safeJsonStringify(elementsArray));
assert.deepStrictEqual(parsedElements.elements[0].style, { color: 'red', fontSize: 16 });
assert.deepStrictEqual(parsedElements.elements[1].style, { color: 'red', fontSize: 16 });

// Test genuine circular reference is safely dropped
const circularObj: any = { name: 'cycle' };
circularObj.self = circularObj;
const parsedCircular = JSON.parse(safeJsonStringify(circularObj));
assert.strictEqual(parsedCircular.name, 'cycle');
assert.strictEqual(parsedCircular.self, undefined);

console.log('All safeCloneClean serialization tests passed successfully!');
