import { sanitizeAndParseJson, extractBalancedJsonStructure } from '../src/utils';

function runTests() {
    console.log('Testing sanitizeAndParseJson with conversational wrapper strings...');

    // Case 1: Conversational preamble starting with "I encountered..."
    const case1 = `I encountered your scene list and selected these camera movements:
{
  "movements": [
    {
      "id": "scene-1",
      "movement": "zoom_in_pan_right",
      "focal_x": 0.5,
      "focal_y": 0.5
    }
  ]
}`;
    const res1 = sanitizeAndParseJson(case1);
    if (!res1.movements || res1.movements[0].movement !== 'zoom_in_pan_right') {
        throw new Error('Case 1 failed: ' + JSON.stringify(res1));
    }

    // Case 2: Conversational preamble + markdown fence + postscript
    const case2 = `Here is the requested video director data for your storyboard:
\`\`\`json
{
  "movements": [
    {
      "id": "scene-2",
      "movement": "dolly_in",
      "focal_x": 0.3,
      "focal_y": 0.7
    }
  ]
}
\`\`\`
Let me know if you need any adjustments!`;
    const res2 = sanitizeAndParseJson(case2);
    if (!res2.movements || res2.movements[0].movement !== 'dolly_in') {
        throw new Error('Case 2 failed: ' + JSON.stringify(res2));
    }

    // Case 3: Direct array JSON
    const case3 = `[{"id":"clip-1","displayMode":"pip_overlay"}]`;
    const res3 = sanitizeAndParseJson(case3);
    if (!Array.isArray(res3) || res3[0].displayMode !== 'pip_overlay') {
        throw new Error('Case 3 failed: ' + JSON.stringify(res3));
    }

    // Case 4: Balanced array inside conversational sentence
    const case4 = `I have analyzed the cues: [{"id":"clip-2","displayMode":"fullscreen"}] - all done.`;
    const res4 = sanitizeAndParseJson(case4);
    if (!Array.isArray(res4) || res4[0].id !== 'clip-2') {
        throw new Error('Case 4 failed: ' + JSON.stringify(res4));
    }

    console.log('All sanitizeAndParseJson test cases passed successfully!');
}

runTests();
