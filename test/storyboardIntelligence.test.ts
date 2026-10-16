import assert from 'node:assert';
import { 
    createIntelligentVisualFallback, 
    isLazyParaphrase, 
    enrichLazyImagePrompt, 
    synthesizeMergedVisualConcept, 
    generateSplitVisualConcept 
} from '../src/handlers-story';

console.log('Testing Storyboard Intelligence Reasoning Engine across domains...');

// Test 1: Lazy Paraphrase Detection
assert.strictEqual(isLazyParaphrase('Cinematic visual depicting a desert', 'In a desert'), true, 'Should flag weak starter "Cinematic visual depicting"');
assert.strictEqual(isLazyParaphrase('A vast Pangaean desert stretches beneath an oppressive sun-baked sky with cracked earth', '234 million years ago, Earth was a baking desert world'), false, 'Should accept vivid non-paraphrased visual prompt');

// Test 2: Domain Test Suite
const testDomains = [
    {
        domain: 'Dinosaur / Science Documentary',
        script: '234 million years ago, Earth was a baking desert world hit by a strange climate shift. Torrential rain fell for two million years.'
    },
    {
        domain: 'Biblical / Historical Story',
        script: 'King Solomon stood within the completed temple of Jerusalem, surrounding walls of polished cedar and gleaming gold illuminated by torchlight.'
    },
    {
        domain: 'Fictional Drama',
        script: 'Sarah gripped the faded envelope, her knuckles white as she stood on the rain-swept train platform watching the night express disappear.'
    },
    {
        domain: 'Horror',
        script: 'The ancient cellar door creaked open, revealing spiral stone steps descending into suffocating pitch darkness where something wet slithered.'
    },
    {
        domain: 'Business',
        script: 'Global supply chains fractured as semiconductor shortages halted assembly lines across three continents.'
    },
    {
        domain: 'Psychology',
        script: 'Cognitive dissonance arises when deeply held beliefs clash with undeniable contradictory evidence, creating intense internal tension.'
    },
    {
        domain: 'Travel',
        script: 'As dawn broke over the mist-shrouded peaks of Machu Picchu, the first rays of sunlight illuminated the ancient granite citadel.'
    }
];

for (const { domain, script } of testDomains) {
    console.log(`\n--- Testing Domain: ${domain} ---`);
    
    // 1. Fallback Generation (Path B: Gemini Fails / Fallback)
    const fallbackShot = createIntelligentVisualFallback(script, 0, 1);
    
    assert.ok(fallbackShot.visual_type, `[${domain}] Missing visual_type`);
    assert.ok(fallbackShot.narrative_function, `[${domain}] Missing narrative_function`);
    assert.ok(fallbackShot.visual_concept, `[${domain}] Missing visual_concept`);
    assert.ok(fallbackShot.environment, `[${domain}] Missing environment`);
    assert.ok(fallbackShot.composition, `[${domain}] Missing composition`);
    assert.ok(fallbackShot.camera, `[${domain}] Missing camera`);
    assert.ok(fallbackShot.mood, `[${domain}] Missing mood`);
    assert.ok(fallbackShot.image_prompt, `[${domain}] Missing image_prompt`);
    assert.ok(!fallbackShot.image_prompt.includes(script.slice(0, 40)), `[${domain}] Path B image_prompt must not simply insert raw narration text`);
    assert.ok(!fallbackShot.image_prompt.startsWith('Cinematic visual depicting'), `[${domain}] image_prompt should not use weak template starter`);

    // 2. Simulated Gemini Output (Path A: Gemini Success)
    const simulatedGeminiShot = {
        visual_type: fallbackShot.visual_type,
        narrative_function: fallbackShot.narrative_function,
        visual_concept: `Visual director concept for ${domain}`,
        subjects: ['Primary Subject', 'Secondary Subject'],
        action: 'Dynamic motion reflecting scene narrative',
        environment: fallbackShot.environment,
        composition: fallbackShot.composition,
        camera: 'Cinematic 35mm prime lens setup',
        mood: fallbackShot.mood,
        continuity_notes: 'Matching lighting with previous scene',
        image_prompt: `${fallbackShot.composition}. Set in ${fallbackShot.environment}. Featuring Primary Subject in dynamic motion.`,
        text_reference: script,
        camera_movement: 'pan'
    };

    const enrichedPathA = enrichLazyImagePrompt(simulatedGeminiShot, script);
    assert.ok(!enrichedPathA.includes(script.slice(0, 30)), `[${domain}] Path A prompt must not contain raw narration copy`);
    assert.ok(!isLazyParaphrase(enrichedPathA, script), `[${domain}] Path A prompt failed anti-paraphrase check`);

    // 3. Merging Test (One Coherent Scene, No Raw Text, No Semicolons)
    const shot2 = createIntelligentVisualFallback('Follow-up beat expanding the story narrative.', 1, 2);
    const merged = synthesizeMergedVisualConcept(fallbackShot, shot2);
    assert.ok(merged.image_prompt && !merged.image_prompt.includes(';'), `[${domain}] Merged prompt should synthesize rather than concatenate with semicolon`);
    assert.ok(!merged.image_prompt.includes('the scene depicts the combined progression'), `[${domain}] Merged prompt should not use lazy template phrasing`);

    // 4. Splitting Test (Independent Visual Concepts for Part 1 & Part 2)
    const splitShot0 = generateSplitVisualConcept(fallbackShot, 'Part 1 of the narrative beat', 0);
    const splitShot1 = generateSplitVisualConcept(fallbackShot, 'Part 2 of the narrative beat', 1);
    assert.ok(splitShot0.composition !== splitShot1.composition, `[${domain}] Split shots should have distinct camera compositions`);
    assert.ok(!splitShot1.image_prompt.includes('(closer complementary perspective)'), `[${domain}] Split shot should generate new visual concept without lazy suffix`);
    assert.ok(!splitShot0.image_prompt.includes('Focusing on: Part 1'), `[${domain}] Split shot 0 should not use "Focusing on: [text]"`);
    assert.ok(!splitShot1.image_prompt.includes('Focusing on: Part 2'), `[${domain}] Split shot 1 should not use "Focusing on: [text]"`);
}

console.log('\nAll Storyboard Intelligence tests passed successfully across all 7 domains!');
