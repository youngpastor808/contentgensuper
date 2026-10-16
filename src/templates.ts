/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import type { VoiceArchetype } from './types';

export const DESIGN_ARCHETYPES: VoiceArchetype[] = [
  // Narrator
  { id: 'n1', label: 'Deep Narrator', category: 'Narrative', value: 'A mature man with a deep, resonant voice, speaking with gravitas and calm authority.' },
  { id: 'n2', label: 'Warm Storyteller', category: 'Narrative', value: 'A soft-spoken woman with a warm, melodic tone, ideal for cozy bedtime stories.' },
  { id: 'n3', label: 'Mystery Voice', category: 'Narrative', value: 'A gravelly, whispered male voice with intense pacing, perfect for true crime or noir thrillers.' },
  { id: 'n4', label: 'Classic Orator', category: 'Narrative', value: 'A formal, mid-range male voice with perfect elocution and a rhythmic, traditional delivery.' },
  { id: 'n5', label: 'Elderly Sage', category: 'Narrative', value: 'An aged, raspy male voice, slow-paced and filled with weathered wisdom.' },
  { id: 'n6', label: 'Gentle Reader', category: 'Narrative', value: 'A calming, neutral female voice with a steady cadence for long-form non-fiction.' },
  { id: 'n7', label: 'The Explorer', category: 'Narrative', value: 'An enthusiastic, breathy male voice with a wide dynamic range for travel documentaries.' },
  { id: 'n8', label: 'Fairy Tale Queen', category: 'Narrative', value: 'A regal, light female voice with a magical, ethereal quality and high clarity.' },
  { id: 'n9', label: 'History Professor', category: 'Narrative', value: 'An intellectual mid-range voice, slightly dry but engaging and highly articulate.' },
  { id: 'n10', label: 'Epic Voyager', category: 'Narrative', value: 'A booming, cinematic male voice that sounds heroic and legendary.' },

  // Professional
  { id: 'p1', label: 'Corporate Trainer', category: 'Professional', value: 'A professional female voice, clear, confident, and business-like for e-learning modules.' },
  { id: 'p2', label: 'News Anchor', category: 'Professional', value: 'A crisp, authoritative male voice with a fast, urgent, and highly articulate delivery.' },
  { id: 'p3', label: 'The Analyst', category: 'Professional', value: 'A detached, neutral mid-range male voice focused on clarity and data-driven precision.' },
  { id: 'p4', label: 'Medical Expert', category: 'Professional', value: 'A trustworthy, calm, and reassuring female voice with high articulation for complex terms.' },
  { id: 'p5', label: 'The Consultant', category: 'Professional', value: 'A mid-range male voice, persuasive and polished, sounding like a high-level executive.' },
  { id: 'p6', label: 'Tech Support', category: 'Professional', value: 'A friendly, patient, and clear mid-range female voice with a helpful, guiding tone.' },
  { id: 'p7', label: 'Financial Advisor', category: 'Professional', value: 'A serious, steady male voice that conveys stability and deep industry expertise.' },
  { id: 'p8', label: 'Virtual Assistant', category: 'Professional', value: 'A synthetic-but-friendly female voice, polite, efficient, and perfectly clear.' },
  { id: 'p9', label: 'Legal Counsel', category: 'Professional', value: 'A sharp, articulate male voice with an analytical tone and direct phrasing.' },
  { id: 'p10', label: 'Sales Director', category: 'Professional', value: 'A bold, energetic female voice that sounds motivational and results-oriented.' },

  // Character
  { id: 'c1', label: 'Grumpy Wizard', category: 'Character', value: 'A croaky, eccentric male voice, filled with sighs and mystical irritation.' },
  { id: 'c2', label: 'Heroic Knight', category: 'Character', value: 'A bold, chivalrous male voice with a slight metallic resonance and honorable tone.' },
  { id: 'c3', label: 'Evil Overlord', category: 'Character', value: 'A deep, sinister male voice with slow, calculated pacing and a dark, booming reverb.' },
  { id: 'c4', label: 'Squeaky Goblin', category: 'Character', value: 'A high-pitched, scratchy male voice, fast-talking and mischievously frantic.' },
  { id: 'c5', label: 'Helpful Robot', category: 'Character', value: 'A monotone, slightly metallic mid-range voice with precise, robotic timing.' },
  { id: 'c6', label: 'Old Witch', category: 'Character', value: 'A high-pitched, cackling female voice with a raspy, uneven texture.' },
  { id: 'c7', label: 'Giant Ogre', category: 'Character', value: 'An extremely deep, rumbling male voice with slow, slurred, and heavy pronunciation.' },
  { id: 'c8', label: 'Space Captain', category: 'Character', value: 'A gritty, commanding mid-range male voice, sounding like a weary space-faring veteran.' },
  { id: 'c9', label: 'Playful Pixie', category: 'Character', value: 'A tiny, light-hearted female voice, very fast and filled with airy giggles.' },
  { id: 'c10', label: 'Ancient Sensei', category: 'Character', value: 'A very slow, deliberate male voice with a thin, wispy, and contemplative texture.' },
  { id: 'c11', label: 'Cyberpunk Hacker', category: 'Character', value: 'A cool, detached young male voice with a cynical, fast-paced street edge.' },
  { id: 'c12', label: 'Steampunk Pilot', category: 'Character', value: 'An adventurous female voice with a rough, energetic, and slightly eccentric tone.' },

  // Commercial
  { id: 'ad1', label: 'Excited Pitchman', category: 'Commercial', value: 'A high-energy, fast-paced male voice designed to drive sales and excitement.' },
  { id: 'ad2', label: 'Luxury Brand', category: 'Commercial', value: 'A sophisticated, breathy female voice, slow and seductive for high-end fashion.' },
  { id: 'ad3', label: 'Hard Sell', category: 'Commercial', value: 'A gritty, forceful male voice that commands immediate consumer attention.' },
  { id: 'ad4', label: 'Retail Enthusiast', category: 'Commercial', value: 'A bright, friendly female voice with an upbeat and approachable shopping-guide tone.' },
  { id: 'ad5', label: 'The Innovator', category: 'Commercial', value: 'A modern, inspired mid-range male voice for tech product launches.' },
  { id: 'ad6', label: 'Soft Touch', category: 'Commercial', value: 'A gentle, whispering female voice for beauty products and health brands.' },
  { id: 'ad7', label: 'Automotive Power', category: 'Commercial', value: 'A deep, gravelly male voice that sounds rugged and powerful for truck ads.' },
  { id: 'ad8', label: 'Holiday Cheer', category: 'Commercial', value: 'A festive, warm female voice filled with joy and seasonal excitement.' },
  { id: 'ad9', label: 'The Disruptor', category: 'Commercial', value: 'A rebellious, young male voice with a punchy, non-traditional delivery.' },
  { id: 'ad10', label: 'Global Citizen', category: 'Commercial', value: 'A mid-range, worldly female voice that sounds inclusive and compassionate.' },

  // Cinematic
  { id: 'm1', label: 'Trailer Voice', category: 'Cinematic', value: 'The classic "In a world" movie trailer voice—deep, dramatic, and epic.' },
  { id: 'm2', label: 'Action Hero', category: 'Cinematic', value: 'A gritty, determined mid-range male voice, breathy and focused during high-tension.' },
  { id: 'm3', label: 'Noir Detective', category: 'Cinematic', value: 'A dry, cynical male voice, often accompanied by the sound of a mental monologue.' },
  { id: 'm4', label: 'Sci-Fi AI', category: 'Cinematic', value: 'A sophisticated, emotionless female voice with a digital shimmer and vast intellect.' },
  { id: 'm5', label: 'Fallen Legend', category: 'Cinematic', value: 'A weary, deep male voice filled with regret and somber resonance.' },
  { id: 'm6', label: 'The Villainess', category: 'Cinematic', value: 'A cold, elegant female voice with a sharp, dangerous, and superior tone.' },
  { id: 'm7', label: 'War Correspondent', category: 'Cinematic', value: 'A strained, urgent male voice, sounding like it is speaking over background chaos.' },
  { id: 'm8', label: 'Cosmic Entity', category: 'Cinematic', value: 'A vast, echoey male voice that sounds multi-dimensional and infinitely ancient.' },
  { id: 'm9', label: 'Street Rebel', category: 'Cinematic', value: 'A gritty, young female voice with a defiant attitude and fast cadence.' },
  { id: 'm10', label: 'Haunted Soul', category: 'Cinematic', value: 'A thin, trembling female voice that sounds terrified and hollow.' },
  { id: 'm11', label: 'The Commander', category: 'Cinematic', value: 'A stern, military-grade male voice that expects immediate obedience.' },
  { id: 'm12', label: 'Prophetic Seer', category: 'Cinematic', value: 'A rhythmic, chanting female voice that sounds entranced and mystical.' },
  { id: 'm13', label: 'Cyber Ninja', category: 'Cinematic', value: 'A sharp, whispering male voice with digital artifacting and lethal precision.' }
];

export const IMAGE_STYLE_OPTIONS = `
<optgroup label="🎨 Custom Style">
   <option value="Cinematic digital painting with a focus on atmospheric lighting and expressive character performance. Stylized semi-realism inspired by modern high-end animation. Rich textures on fabrics and surfaces, nuanced color palettes with sophisticated grading. Dramatic composition using depth of field and volumetric light. Hand-painted aesthetic with deliberate brushwork and organic details. Avoids generic digital polish in favor of artistic intent." selected>Cinematic Digital Painting (High-End Animation Style)</option>
   <option value="3D cinematic render, semi-realistic animation style, Unreal Engine quality. Smooth textures with plastic-like skin and simplified anatomy, exaggerated expressions for emotion. Lighting is harsh, directional, and dramatic with soft shadows, creating a horror atmosphere with eerie color tones. Post-processing includes mild bloom and ambient occlusion.">3D Semi-Realistic Animation (Unreal Engine)</option>
   <option value="High-end editorial vector illustration, isometric perspective. Sophisticated color palette of deep navy, muted gold, and crisp white. Visual metaphors for financial timeframes and invisible tax mechanisms: a glowing window slowly closing, abstract steps representing income thresholds, and layered translucent blocks representing the tax code. Clean geometry, subtle digital gradients, balanced composition suitable for a premium financial publication like The Economist or Wall Street Journal. Uncluttered, intelligent, highly readable, and authoritative atmosphere. [scene]">High-End Editorial Vector Illustration (Isometric)</option>
   <option value="High-resolution digital illustration, concept art style. Sleek rendering with sharp, clean edges and dramatic perspective. Intense volumetric lighting, high contrast cinematic chiaroscuro effect. Vibrant neon color palette of cyan, magenta, electric blue, and deep purples against dark backgrounds. Intricate details on futuristic technology, complex urban landscapes, or advanced costumes. Clean, polished aesthetic reminiscent of octane rendering, with lens flares and motion blur elements. Capturing action, intensity, and future tech themes. [scene]">Sleek High-Contrast Digital Concept Art (Neon Action)</option>
   <option value="custom_prompt">Custom Prompt (Temporary)</option>
   <option value="custom">-- Copy Style From Image --</option>
</optgroup>
<optgroup label="✂️ Paper & Collage Styles">
    <option value="Stylized contemporary folk art illustration contrasting earthy matte textures with sparkling metallic accents. The aesthetic features flattened perspectives, bold flowing lines, and rich, organic color palettes of deep loam browns and vibrant botanical greens, punctuated by sharp, luminous geometric accents representing the diamond. Hand-painted gouache textures on thick cold-pressed paper, giving a timeless, grounded, and mythological feel to a moral fable. [scene]">Contemporary Folk Art Illustration</option>
    <option value="Tactile stop-motion style combining raw, cracked terracotta clay elements with layered papercraft flowers. Warm, earthy color palette of baked browns, dusty ochres, contrasted with vibrant, blooming greens and floral hues. Soft, directional studio lighting highlighting the physical textures of rough clay and delicate paper edges. A cozy, handcrafted, imperfect aesthetic that emphasizes the beauty of brokenness and natural growth.">Tactile Stop-Motion (Clay & Papercraft)</option>
    <option value="Silhouette Corner Cutout Style, black silhouettes against colored backgrounds, like Lotte Reiniger paper cutout films. [scene]">Silhouette Paper Cutout Style</option>
    <option value="Flat 2D digital cutout puppet animation style with visible paper edges and soft drop shadows, like South Park or modern YouTube storytelling. [scene]">Flat 2D Digital Paper Cutout</option>
    <option value="Macabre Ink & Parchment style. Distressed sketchbook aesthetic, rapid hand-drawn sketching with fountain pen running out of ink, jagged scratchy lines, cross-hatching shading, ink blots and smudges. Vintage desaturated palette, Ink Black, Stained Parchment background, Charcoal Grey mid-tones. Texture of aged dirty cardboard or coffee-stained paper, grain overlay, scratches and splatter. [scene]">Macabre Ink & Parchment (Base)</option>
</optgroup>
<optgroup label="🎬 MASTER VISUAL PROMPT STYLE">
    <option value="Hand-cut documentary paper collage in motion. Aged newsprint and archival surfaces, halftone photo cutouts, torn edges, tape, stamps, red string, typewriter strips. Every element moves as a rigid physical paper piece with visible cutout thickness, print grain, soft layered shadows, and stop-motion cadence. [scene]">Editorial Documentary Paper Collage</option>
    <option value="Moody Cinematic Drama style. Digital Matte Painting, Film Still style. Denis Villeneuve (Blade Runner 2049) and Tarkovsky (Stalker) aesthetic. Soft diffused lighting, medium-low contrast, atmospheric haze and fog. Subtle film grain texture, desaturated blue-grey and teal palette, muted skin tones. Observational, psychological tension atmosphere. Cinematic mood, desaturated palette, soft lighting, atmospheric haze, realistic textures, story-driven composition. [scene]">Moody Cinematic Drama (Villeneuve/Tarkovsky)</option>
    <option value="Tactical Noir style. Digital Ink Illustration, Graphic Novel style. Frank Miller (Sin City) and Darkest Dungeon aesthetic. Chiaroscuro lighting, extreme contrast, pitch-black shadows and stark white highlights. Thick, rough ink outlines, heavy cross-hatching. Monochromatic Black & White palette with a single strategic splash of Blood Red or Deep Gold. Gritty, dangerous, serious, ancient atmosphere. Strategy Manual vibe. comic book style, frank miller aesthetic, thick ink lines, high contrast, deep shadows, black and white with splash of red/gold, noir atmosphere, vector style">Tactical Noir (Sin City / Strategy Manual)</option>
    <option value="A cinematic biblical scene rendered in hyperrealistic detail, filmed in the visual style of “Dune (2021)” and “The Passion of the Christ.” Golden-hour lighting filters through ancient dust and smoke, illuminating cracked stone walls and weathered faces. The atmosphere is sacred, tactile, and heavy with divine purpose. Textures of sand, cloth, and sweat are visible. The setting feels ancient, holy, and real — not fantasy. Use soft ochres, clay browns, and diffused gold light tones. Composition is balanced and symmetrical, evoking reverence. Depth of field focuses on human emotion — tears, prayer, resolve. Camera shot: medium close-up or wide establishing, cinematic lensing, shallow DOF. Environment: ruins, desert winds, worn robes, torches, stone tools. Mood: epic, reverent, timeless — the divine felt through struggle. Aspect ratio 16:9, cinematic lighting, 8K detail, volumetric light, photorealistic textures.">Sacred Dust Cinematic Realism</option>
    <option value="Black and white historical-style photograph, vintage film texture, soft grain and scratches, faded tones. Captures moments from World War I or II — weary soldiers resting, empty streets, destroyed buildings, nurses tending to the wounded, handwritten letters, or silent aftermaths. Moody lighting with strong shadows, low contrast fog or smoke atmosphere. Emotional realism, human vulnerability, and a reflective tone. Feels like a found photo from an old archive — timeless, melancholic, deeply moving.">World War Nostalgia — Black & White Cinematic Style</option>
    <option value="Black and white cinematic image, inspired by early 20th-century photography. Soft film grain, slightly faded tones, high contrast light and shadow. Gentle light leaks and vignette edges. Depicts religious and spiritual moments — prayer, candles flickering, open Bible pages, old wooden church benches, hands clasped in devotion, stained glass light in grayscale. Emotionally profound, timeless, reverent mood. Composition inspired by vintage documentary stills, 35mm film aesthetic, analog feel, subtle blur and imperfections that suggest memory and faith. Nostalgic yet sacred atmosphere.">Black & White Nostalgic Religious B-Roll Style</option>
    <option value="Black and white cinematic horror photograph, 1930s–1950s style, heavy film grain and soft blur. High contrast shadows, faint mist, dim candle or lantern light. Subtle visual decay — cracked walls, peeling paint, fog-covered forest, or empty church pews. Uneasy stillness, ambiguous figures in background, faces half-lit. Texture like old damaged film stock, faint scratches and dust. Emotional tone: eerie, quiet dread, timeless fear. Looks like a lost photograph that shouldn’t exist.">Black & White Horror — Vintage Unease Style</option>
</optgroup>
<optgroup label="🎬 Realism Styles">
    <option value="Cinematic realism, filmed with a 35mm lens, shallow depth of field. The scene captures realistic emotion with natural, color-graded lighting. [scene]">Cinematic Realism</option>
    <option value="Cinematic film still, grounded social realism with a rain-soaked, overcast atmosphere. Diffused natural lighting creating a somber, heavy mood. Muted, desaturated color palette of damp concrete, faded fabric, weathered wood, and cool shadows. Shallow depth of field emphasizing quiet micro-expressions, tired eyes, and the unspoken emotional distance between characters. 35mm-led visual language, subtle film grain, naturalistic, quiet, and profoundly melancholic.">Melancholic Social Realism</option>
    <option value="A documentary photograph showcasing raw realism and candid emotional depth. The scene is captured off-hand with photojournalistic framing, utilizing natural light and muted tones.">Documentary / Investigative Realism</option>
    <option value="The scene is depicted with gritty realism, characterized by noticeable film grain and harsh, directional light. The moody color palette is heavily desaturated, bringing out textured, slightly dirty surfaces for a raw atmosphere.">Gritty Realism (Dark Drama / Revenge)</option>
    <option value="A cinematic neo-noir scene defined by low-key, high-contrast lighting. Rain-slicked surfaces reflect moody night tones and distant neon glows, creating deep shadows and an atmosphere of suspense.">Neo-Noir Realism (Thriller & Secrets)</option>
    <option value="A realistic and deeply emotional scene bathed in soft, golden hour daylight. The subjects convey honest expressions, framed with cinematic softness and a warm, inviting color palette.">Natural Light Emotional Realism</option>
    <option value="A hyperrealistic yet surreal scene loaded with emotional symbolism. Floating dust motes catch a soft, dreamlike glow, highlighting symbolic objects in an atmosphere that transcends ordinary reality.">Surreal Realism (Psychological)</option>
    <option value="A photorealistic image with pristine DSLR-like clarity and true-to-life color accuracy. The scene features natural lighting, sharp focus on the subject, and a cinematic depth of field.">Photorealism (Crystal-Clear)</option>
    <option value="Hyperrealistic rendering with extreme detail and clarity, almost surreal in precision. Every texture, reflection, and material property perfectly captured. Sharp focus throughout, no depth of field blur. Too-real-to-be-true quality that creates an uncanny, heightened reality. Photographic accuracy with enhanced saturation and contrast. Clinical precision with slight surreal edge. [scene]">Hyperrealistic (Surreal Precision)</option>
    <option value="A scene grounded in African folklore realism, radiating a spiritual atmosphere. Cinematic golden lighting emphasizes natural fabric textures and culturally symbolic backdrops.">African Folk Realism</option>
    <option value="A scene of mythic cinematic realism bathed in spiritual light. Sacred architectural elements and natural symbolism are enshrouded in mist and the warm, subtle glow of firelight.">Spiritual / Mythic Realism</option>
    <option value="A seamless blend of modern urban realism and ancestral folklore. Cinematic framing captures a cityscape where ancient symbols and ancestral echoes subtly influence the environment.">Modern Folklore Realism</option>
</optgroup>
<optgroup label="🌿 Nature & Macro">
    <option value="Extreme macro photography of [scene], natural coloration, highly detailed texture, fine details, true-to-life proportions, shallow depth of field, natural outdoor lighting, crisp National Geographic style, 8K.">Macro Nature Photography (Nat Geo Style)</option>
    <option value="Wide angle nature photography of [scene], National Geographic style, golden hour, dramatic lighting, highly detailed, 8k resolution, photorealistic.">Epic Nature / Landscape (Nat Geo)</option>
</optgroup>
<optgroup label="🏆 Viral Hybrid Styles">
    <option value="A blend of cinematic realism and photojournalistic detail, striking a profound emotional chord reminiscent of a powerful documentary film still.">True Story Cinematic (Hybrid)</option>
    <option value="A scene of dark emotional realism, defined by moody, oppressive lighting and deep emotional grit that grounds the image with palpable, realistic depth.">Dark Emotional Realism (Hybrid)</option>
    <option value="Cinematic African folk realism with a rich storytelling atmosphere. The scene is bathed in golden lighting that highlights the intricate, natural textures of the environment.">Cultural Cinematic Realism (Hybrid)</option>
</optgroup>
<optgroup label="✨ General Purpose">
    <option value="high quality pencil sketch illustration of [scene]. Soft graphite linework on a warm cream/off-white paper background. Characters are semi-realistic with gentle, soft facial features. Background elements are lightly sketched and almost transparent. Only key foreground objects and accent details have a single selective color — **warm orange** (if humans are in the scene, their top clothing should be warm orange) — everything else remains in pencil grey tones. Visible sketch strokes and light hatching for shading. No heavy outlines. Warm, gentle, and educational in mood. No text or watermarks.">Pencil Sketch (Warm Orange accent)</option>
    <option value="Traditional watercolor medium illustration with visible brush strokes and paper grain texture, desaturated earthy palette with muted greys and ochres. Organic watercolor washes with natural pigment bleeding and color bleeds. Warm interior light contrasted against cool ambient shadows. Layered translucent washes, fine ink line work, subtle handmade paper texture. Restrained editorial illustration style with hand-painted softly stylized figures, somber atmosphere, and atmospheric perspective.">Documentary Watercolor</option>
    <option value="Traditional oil painting with rich, textured brushwork on canvas. Deep, layered colors with visible brush strokes, impasto technique in highlights. Soft blended edges, classical realism aesthetic. Warm earthy palette of ochres, siennas, and muted blues. Timeless mood capturing heavy emotions, grief, and legacy. Painterly style reminiscent of Old Masters, with subtle glazing and atmospheric depth. [scene]">Oil Painting Realism</option>
    <option value="Soft watercolor illustration with gentle washes and subtle color bleeds. Delicate paper texture visible beneath translucent layers. Muted pastel palette of faded pinks, soft blues, and gentle grays. Loose, expressive brushwork with natural water stains and organic edges. Nostalgic and dreamlike atmosphere evoking fragile memories and tender moments. Light, airy composition with white space. [scene]">Watercolor Storybook</option>
    <option value="Dreamy, ethereal aesthetic with soft diffused lighting and gentle atmosphere. Bright but not overwhelming, with a tender pastel color palette. Soft focus around edges, creating a peaceful, tranquil mood. Light seems to glow from within the scene. Delicate, airy composition with floating elements. Calm, meditative feeling with subtle magical realism. [scene]">Dreamy Ethereal</option>
</optgroup>
<optgroup label="👩‍👧 Family / Emotional Drama">
    <option value="Warm editorial illustration, soft textured brushstrokes, evocative color palettes transitioning from vibrant warm ochres and market colors to soft, quiet indigos. Focus on emotional connection, maternal embrace, and community bonds. Stylized semi-realism with a focus on human warmth and psychological safety, blending cultural motifs with subtle visual metaphors for neurological growth and calm.">Warm Editorial (Emotional/Community)</option>
    <option value="Realistic oil painting in the style of Classical Realism with Baroque-inspired chiaroscuro.">Baroque/Renaissance Oil Style</option>
    <option value="[scene]. Cinematic, hyper-realistic, chiaroscuro effect, dramatic contrast, shallow depth of field, film still style, moody atmosphere, dark tones, volumetric light, 35mm photography aesthetic, Rembrandt lighting.">Cinematic Drama (Netflix-style)</option>
</optgroup>
<optgroup label="🕵️ Crime / Investigation">
    <option value="Documentary still style, raw news photo aesthetic, CCTV frame, leaked evidence shot, adds realism. [scene]">Documentary Still Style</option>
    <option value="CCTV glitch art, broken surveillance cam feeds, edgy, modern investigation style. [scene]">CCTV / Surveillance Cam Look</option>
    <option value="Classic film noir cinematography with dramatic chiaroscuro lighting. Deep black shadows contrasting with stark white highlights. Atmospheric smoke or fog diffusing harsh light sources. High-contrast black and white palette. Venetian blind shadows, silhouettes, and mysterious figures in darkness. Moody, tense atmosphere with cinematic composition. 1940s detective aesthetic. [scene]">Neo-Noir Cinematic</option>
    <option value="Polaroid / Instant Camera Look, slight blur, flash glare, feels personal and clandestine. [scene]">Polaroid / Vintage Flash</option>
</optgroup>
<optgroup label="👻 Horror / Paranormal">
    <option value="Chiaroscuro painting, Caravaggio style, extreme light vs shadow, very haunting. [scene]">Chiaroscuro Painting</option>
    <option value="A gritty digital artwork with dirty, worn textures and heavy film grain. The atmosphere is dark and deeply unsettling. [scene]">Grunge / Distressed Digital Art</option>
    <option value="Analog horror VHS style, distorted VHS tape imagery, static lines, unsettling familiarity. [scene]">Analog Horror VHS Style</option>
    <option value="Surreal horror, Silent Hill–like, twisted everyday objects, uncanny human figures. [scene]">Surreal Horror (Silent Hill vibe)</option>
    <option value="Gothic illustration, stylized medieval horror vibe, dramatic arches, shadows, candlelight. [scene]">Gothic Illustration</option>
    <option value="Macabre Ink & Parchment style. Distressed sketchbook aesthetic, rapid hand-drawn sketching with fountain pen running out of ink, jagged scratchy lines, cross-hatching shading, ink blots and smudges. Vintage desaturated palette, Ink Black, Stained Parchment background, Charcoal Grey mid-tones. Texture of aged dirty cardboard or coffee-stained paper, grain overlay, scratches and splatter. Characters with disproportionately large heads and thin necks, massive circular void black eyes, minimalist expressions. Harsh theatrical lighting, hard sharp shadows, heavy vignetting, claustrophobic atmosphere, melancholic and anxious mood. Depicting: [scene]">Macabre Ink & Parchment (Character Focus)</option>
</optgroup>
<optgroup label="🎨 Animation & Comics">
    <option value="cartoon illustration with clean lines, soft pastel colors, and simple backgrounds. The characters are drawn with expressive but non-detailed faces and smooth, rounded features, creating a friendly and approachable feel.">Friendly Cartoon Illustration</option>
    <option value="A flat 2D cartoon illustration of [scene], in a simple YouTube explainer video style. The characters have round faces, thick black outlines, and flat solid colors with no shading or gradients. The style is minimal and clean, similar to educational animation thumbnails. White or simple plain background. Friendly and warm tone.">YouTube Explainer Style (Clean 2D Cartoon)</option>
    <option value="Japanese anime style illustration with expressive character designs and vibrant colors. Large emotive eyes, stylized hair, and dynamic poses. Clean cel-shaded coloring with subtle gradients. Gentle and appealing aesthetic perfect for emotional storytelling. Soft lighting with warm tones. Modern anime aesthetic with detailed backgrounds. [scene]">Anime</option>
    <option value="high quality chibi webtoon 2D cartoon illustration of [scene]">Chibi Webtoon 2D</option>
    <option value="Black and white manga illustration style with bold ink lines and dynamic compositions. High-contrast with dramatic screen tones and speed lines. Expressive character faces with large eyes and stylized features. Clean linework with varying line weights for depth. Japanese comic book aesthetic with strong visual storytelling. [scene]">Manga</option>
    <option value="Clean 2D vector illustration style, thick uniform black outlines, bold graphic linework, minimalist flat design, muted and desaturated color palette featuring neutral earth tones and cool grays, soft cel shading with subtle internal gradients, crisp digital rendering, smooth professional finish, contemporary webcomic aesthetic, high-contrast character-focused composition, minimalist solid-color background with subtle vignette, clean and uncluttered visual language, professional storyboard illustration style.">Contemporary Webcomic (Thick Outlines)</option>
    <option value="CalArts animation style, modern 2D cartoon, thin clean linework, soft bean-shaped faces, large expressive eyes, noodle limbs, bright pastel flat colors, whimsical and expressive, flat vector art aesthetic. Depicting [scene]">Modern Cartoon (CalArts Style)</option>
    <option value="Studio Ghibli-inspired, hand-drawn anime style, painterly watercolor backgrounds with lush, vibrant nature, whimsical and nostalgic atmosphere, gentle and expressive character designs, soft and warm natural lighting, subtle and organic linework, cinematic composition with depth and perspective, magical yet grounded, richly detailed environments, enchanting mood, cinematic framing, delicate color palette, high-quality illustration, 4k, highly detailed, concept art style.">Studio Ghibli Style</option>
    <option value="clean 2D vector cartoon, adult animated sitcom style, thick outlines, flat colors, simplified proportions, expressive face, Family Guy–inspired illustration,plain white background">Adult Animated Sitcom (Family Guy Style)</option>
    <option value="Modern Comic Book art style, vibrant colors, clean lines, dynamic action poses">Modern Comic Book</option>
    <option value="Vintage Comic Book art style, ben-day dots, muted color palette, retro feel">Vintage Comic Book</option>
    <option value="Stop-motion claymation style with visible fingerprints and sculpting marks in clay. Slightly imperfect handmade quality with textured surfaces. Soft, matte finish with gentle lighting. Charming, tactile aesthetic reminiscent of Wallace and Gromit or Coraline. Three-dimensional depth with miniature set design. [scene]">Claymation</option>
    <option value="Tactile stop-motion style combining raw, cracked terracotta clay elements with layered papercraft flowers. Warm, earthy color palette of baked browns, dusty ochres, contrasted with vibrant, blooming greens and floral hues. Soft, directional studio lighting highlighting the physical textures of rough clay and delicate paper edges. A cozy, handcrafted, imperfect aesthetic that emphasizes the beauty of brokenness and natural growth.">Tactile Stop-Motion (Clay & Paper)</option>
    <option value="Minimalist 2D Minecraft-inspired cartoon style, cube-shaped head character with simplified geometric body proportions, oversized white oval eyes with tiny pupils, thick eyebrows, small expressive mouth, messy stylized hair, bright high-contrast color palette, clean bold outlines, soft shading (not flat), smooth gradients, exaggerated readable facial expressions, simple thin limbs, modern viral animation look. Minimal white or plain background with no clutter, strong focus on character, high visual clarity for mobile viewing, consistent proportions and clean composition, optimized for short-form content, polished yet simple cartoon aesthetic.">Minecraft-Inspired 2D Cartoon</option>
</optgroup>
<optgroup label="Stick Figure Styles">
    <option value="Classic stick figure drawing, simple circle for a head, single lines for body and limbs, hangman style, minimalist, child's scribble on a plain background. A depiction of [scene].">Classic Stick Figure (Hangman Style)</option>
    <option value="Cyanide & Happiness webcomic stick figure style, clean thick black outlines, bold flat colors, oval-shaped heads, simple expressive dots for eyes, curved simple mouths, white or minimal background, dark comedy aesthetic. [scene]">Cyanide & Happiness Style</option>
    <option value="MS Paint stick figure aesthetic like Sam O'Nella or Casually Explained, crude mouse-drawn wiggly lines, minimalist, flat white background, expressive but sloppy faces, simple stick arms, high comedic value, internet culture style. [scene]">MS Paint Internet Comedy (Sam O'Nella Style)</option>
    <option value="MS Paint crude character style like GradeAUnderA, excessively large chins, scribbled bodies, intentionally bad MS Paint drawing aesthetic, MS Paint default colors, white background. [scene]">Crude MS Paint (GradeAUnderA Style)</option>
    <option value="High-contrast minimalist stick figure character in a clean flat 2D vector style. Solid pure black background (#000000). Character drawn with thick smooth white lines and solid white fill, large round head, simple black dot eyes and minimal mouth. Minimalist but expressive through simple facial features and body language. Centered composition, clear silhouette, no clutter. No shading, no gradients, no textures, no additional colors beyond black and white. Scene: [scene].">White Stick Figures on Black (Infographic Style)</option>
    <option value="Minimalist black-and-white pictogram style illustration. Solid pure black background. large round head, simple black dot eyes and minimal mouth. Minimalist but expressive through simple facial features and body language. Clean vector icon style with soft rounded edges. Centered composition, high contrast. [scene]">Pictogram (White on Black)</option>
    <option value="Detailed stick-adjacent cartoon style like Overly Sarcastic Productions (OSP), stylized flat colors, slightly thicker outlines, expressive chibi-like faces on simple bodies, historical or mythological garments on simple figures, solid color backgrounds. [scene]">Stylized History/Mythology (OSP Style)</option>
    <option value="Action-packed scene in the style of Xiao Xiao animations, dynamic martial arts poses, fluid motion, thin black lines, hollow unfilled circles for heads, high-energy combat, minimalist background, trending on Newgrounds. [scene]">Action Stick Figure (Xiao Xiao Style)</option>
    <option value="Modern animator stick figure style like Alan Becker, solid filled heads with no facial features, expressive body language, characters are color-coded, clean slightly thick lines, simple digital background, trending on YouTube. The scene shows [scene].">Modern Animator (Alan Becker Style)</option>
    <option value="Webgame stick figure style like Henry Stickmin, expressive faces with eyes and mouth, thin black limbs with floating white cartoon gloves for hands, simple shoes, comedic situations, clean 2D vector art. The scene is about [scene].">Webgame Stick Figure (Henry Stickmin Style)</option>
    <option value="Ultra-detailed, high resolution, minimalist, clean, professional stick figure drawing of [scene]. Character design: simple stick figures, line bodies, circle heads. On a light colored wrinkled paper background.">Minimalist Professional Stick Figure (Paper)</option>
    <option value="Ultra-detailed, high resolution, minimalist, clean, professional stick figure drawing of [scene], emphasizing a width-visible emotional state. Character design: simple stick figures, line bodies, circle heads. On a light colored wrinkled paper background.">Psychological Stick Figure (Wrinkled Paper)</option>
</optgroup>
<optgroup label="📺 Popular YouTube Styles">
    <option value="Struthless-inspired hand-drawn sketch animation style. Loose, scratchy black ink line art on a cream or white paper background, minimal or no color, expressive rough linework, motivational storytime aesthetic. [scene]">Struthless (Hand-Drawn Ink Sketch)</option>
    <option value="JaidenAnimations-style storytime animation. Thick clean black outlines, flat pastel colors, large expressive round eyes, simplified cartoon proportions, friendly and warm character design, plain or simple background. [scene]">Storytime Vlog Animator (JaidenAnimations Style)</option>
    <option value="Kurzgesagt flat vector animation style, bold saturated flat colors, simple rounded geometric character shapes with no detailed facial features, soft color gradients, clean minimalist educational illustration, playful blob-like characters. [scene]">Kurzgesagt (Flat Vector Educational)</option>
    <option value="TheOdd1sOut style animation. Simple flat-colored characters with oval heads, small dot eyes, thin stick-like arms, deadpan expressions, plain white background, minimalist comedic storytime aesthetic. [scene]">Deadpan Storytime (TheOdd1sOut Style)</option>
    <option value="CGP Grey style flat 2D vector infographic illustration, muted restrained color palette, simple geometric icon-based characters rather than detailed figures, clean educational diagram aesthetic. [scene]">Flat Infographic Explainer (CGP Grey Style)</option>
    <option value="Extra History style illustration. Parchment and chalkboard background aesthetic, hand-drawn chalk-sketch character linework, sepia and muted earth tones, historical educational storytelling feel. [scene]">Chalkboard Historical Sketch (Extra History Style)</option>
    <option value="Chaotic meme-collage commentary video style. Layered cutout photos, bold white impact-font captions, glitchy edits, internet-culture chaotic energy, YouTube commentary aesthetic. [scene]">Meme Collage Commentary (Internet Historian Style)</option>
    <option value="Corporate Memphis flat illustration style, oddly proportioned rounded human figures with no detailed facial features, bold flat colors, geometric simplicity, tech startup explainer video aesthetic. [scene]">Corporate Memphis (Flat Tech Illustration)</option>
</optgroup>
<optgroup label="🎭 Stylized / Abstract">
    <option value="Vox animation style. Handcrafted paper stop-motion sequence. [scene]">Vox Style (Paper Stop-Motion)</option>
    <option value="Minimalist stick figure character animation style, focusing on expression and movement over detail. [scene]">Minimalist Character Animation</option>
    <option value="Whiteboard doodle animation style, black marker on white background. [scene]">Whiteboard Doodle Animation</option>
    <option value="Flat 2D digital cutout puppet animation style, like South Park or modern YouTube storytelling. [scene]">Flat 2D Digital Cutout</option>
    <option value="Papercut collage animation style, layered paper textures, whimsical and dreamy. [scene]">Papercut Collage Style</option>
    <option value="Papercut stop-motion animation style. Characters and environments constructed strictly from textures of money, receipts, credit card statements, and ledger paper. Shallow depth of field, tangible lighting casting realistic shadows on multiple layers of paper. Mark is a weary paper puppet. Metaphorical visuals: a backpack made of concrete texture, water made of shredded blue bills. Concept art, highly detailed, textural storytelling, tactile aesthetic.">Financial Papercut Animation</option>
    <option value="Hand-drawn charcoal sketch on textured paper with rich blacks and dramatic whites. Expressive, loose strokes with smudging and blending. Visible charcoal texture and organic marks. High contrast with deep shadows and bright highlights. Rough, gestural quality capturing form and emotion. Traditional drawing aesthetic. [scene]">Charcoal Sketch</option>
    <option value="Technical blueprint with white lines on deep blue background, like an architect or engineer drawing. Precise geometric linework, dimension markers, and technical annotations. Clean, professional drafting style with measurement scales and section views. Grid background with title block. Mechanical precision and clarity. [scene]">Blueprint</option>
    <option value="Vaporwave aesthetic with retro 80s/90s nostalgia and surreal digital collage. Neon pink, cyan, and purple gradients. Greek or Roman statues, palm trees, and vintage computer graphics. VHS glitch effects, scan lines, and digital artifacts. Dreamy, ironic, internet-culture vibe. Grid floors and sunset backgrounds. [scene]">Vaporwave</option>
    <option value="Low-poly 3D style with geometric faceted surfaces and minimal polygon count. Flat-shaded triangular faces creating angular, abstract forms. Clean, modern aesthetic with solid colors or simple gradients. Minimalist approach emphasizing shape and form over detail. Contemporary digital art style. [scene]">Low Poly</option>
    <option value="Impressionist painting style with loose, visible brushstrokes and emphasis on light effects. Soft edges and color mixing directly on canvas. Vibrant, luminous palette capturing fleeting moments and atmospheric conditions. Dappled light and broken color technique. Reminiscent of Monet, Renoir, or Pissarro. [scene]">Impressionistic</option>
</optgroup>
<optgroup label="💼 Wealth / Power / Revenge">
    <option value="Ultra-modern, minimalist corporate aesthetic, sharp lines, glass and steel, cold color palette (blues, grays), dramatic window lighting, high-end designer furniture, feels powerful and sterile. [scene]">Corporate Sleek & Modern</option>
    <option value="Gilded age opulence, rich mahogany, gold leaf accents, warm ambient lighting from chandeliers, velvet textures, cinematic oil paintings in background, feels like a private members club or a mansion. [scene]">Gilded Age Opulence</option>
    <option value="Dark cinematic thriller style, high contrast, low-key lighting, deep shadows, desaturated colors with a single accent color (e.g., red), sense of paranoia and tension, feels like a David Fincher film. [scene]">High-Stakes Thriller</option>
</optgroup>
    <optgroup label="🌌 Fantasy / Surreal">
    <option value="A painterly digital fantasy illustration with large expressive brushstrokes, glowing magical accents, and dramatic stormy skies. [scene]">Painterly Digital Fantasy Art</option>
    <option value="Surrealism, in the style of Salvador Dalí, dreamlike distortions, metaphors made visual. [scene]">Surrealism (Dalí-inspired)</option>
    <option value="Epic fantasy concept art with rich, saturated colors and dramatic lighting. Mysterious otherworldly atmosphere with magical elements and fantastical architecture. Detailed digital painting style with strong composition and depth. Glowing mystical energy, ethereal mist, and immersive environmental storytelling. Trending on ArtStation aesthetic. Cinematic scope and wonder. [scene]">Dark Fantasy Concept Art</option>
    <option value="Cyberpunk aesthetic with neon-lit dystopian cityscapes and high-tech elements. Rain-slicked streets reflecting pink and cyan neon signs. Dark, gritty atmosphere with cybernetic enhancements and futuristic technology. Low-life meets high-tech. Blade Runner inspired color palette. Heavy atmospheric fog and dramatic lighting. [scene]">Cyberpunk</option>
    <option value="Victorian-era steampunk with brass machinery, exposed gears, and steam-powered technology. Rich brown and copper tones with intricate mechanical details. Gothic industrial architecture with clockwork mechanisms. Vintage goggles, top hats, and period clothing mixed with fantastical inventions. Warm sepia undertones. [scene]">Steampunk</option>
</optgroup>
<optgroup label="📜 Historical / Epic">
    <option value="Traditional pen and ink illustration with watercolor washes. Hand-drawn linework with organic ink pen outlines, visible line weight variation and cross-hatching for shading. Colored with translucent watercolor layers revealing paper texture and grain beneath. Desaturated earthy palette: warm sepia, ochre, sienna, cool slate grays, muted olive greens, dusty blues. Natural lighting rendered with soft watercolor gradients. Visible brush strokes, water stains, and organic pigment bleeds at color edges. Paper texture visible throughout. Historical biblical manuscript illustration aesthetic.">Biblical Ink & Watercolor</option>
    <option value="Sepia-toned photography style, evokes the past, old documents, archives. [scene]">Sepia Photography Style</option>
    <option value="Grand historical oil painting in academic realism style. Noble, monumental composition with dramatic lighting and rich jewel tones. Detailed period costumes, architecture, and settings painted with classical technique. Formal, dignified atmosphere with symbolic elements. Reminiscent of 18th-19th century European masters. Large-scale theatrical presentation. [scene]">Historical Oil Painting</option>
    <option value="Daguerreotype / Early Photography style, monochrome, stiff poses, vintage mood. [scene]">Daguerreotype / Early Photography</option>
</optgroup>
<optgroup label="🔬 Technical & Historical Schematics">
    <option value="Editorial data-journalism infographic illustration. Split composition: a semi-realistic painterly illustration on the left third against a soft cream background (#F5F1E8), paired with 2-4 thin dark-navy bordered rectangular info panels on the right filling the remaining space, each with a bold abstract header in a boxed title bar. Panel contents are chosen to fit the subject — abstract bar/column charts, labeled scientific or anatomical diagrams, simple maps, or icon rows with minimalist graphical captions, whichever best represents the specific data or concept described. Muted editorial palette: cream background, navy headers, mustard-gold and deep teal accents, soft grey chart elements. Clean vector-meets-hand-illustrated hybrid look, generous whitespace, magazine infographic aesthetic. Depicting: [scene]">Editorial Data Infographic (Split Panel)</option>
    <option value="A comprehensive educational scientific infographic about [scene]. On one side, a highly detailed vintage botanical and anatomical textbook illustration with soft shading and natural earthy tones. On the other side, structured dark-lined modular bounding boxes displaying technical data visualizations, bar charts, cross-section diagrams, and chemical molecular structures. Set on an off-white cream parchment background, crisp lines, clean educational diagram aesthetic, high contrast.">Vintage Scientific Infographic</option>
    <option value="3D digital reconstruction, CGI historical simulation style, high-angle isometric perspective, clinical technical visualization, hyper-detailed texture mapping, sharp digital focus, deep depth of field, desaturated earthy color palette, muted ochre and dust-grey tones, harsh midday lighting, high-contrast shadows, architectural rendering aesthetic, clean and informative composition, objective educational atmosphere, realistic material shaders, wide-angle lens, sharp-edged geometry. [scene]">3D Historical Reconstruction</option>
    <option value="Vintage Leonardo da Vinci style engineering sketch, sepia parchment background, intricate ink lines, cross-section diagram of Roman road layers (statumen, rudus, nucleus), handwritten Latin notes, detailed hatching, scientific illustration aesthetic, technical breakdown of stone placement and drainage, antique texture, high resolution, historical analysis vibe.">Da Vinci Engineering Sketch</option>
    <option value="Forensic engineering diagram style. Civil engineering textbook aesthetic meets classified intelligence briefing. Desaturated grayscale with muted stone, concrete, and steel tones, plus a single accent color like Oxide Red or Slate Blue. Features cross-sections, exploded diagrams, and flow arrows. Measured, technical, and analytical look with paper texture and slight grain. Photorealistic materials, not vector or cinematic. Looks like an evidence report.">Forensic Engineering Diagram</option>
    <option value="Ultra-photorealistic macro photography of a physical architectural cross-section model on a lab table. Heavily desaturated palette limited to concrete grey, asphalt black, and mud brown — no vibrant colors. Materials include crumbling asphalt, fractured concrete, rusted rebar, wet compacted soil, and stagnant muddy water with surface film, all showing real-world wear and erosion. Harsh directional overhead lighting like an interrogation room, deep shadows, high contrast, no glow or color grading. Subtle white technical grid lines and minimal DIN labels. Strict documentary realism with extreme material fidelity and shallow macro depth of field; the object feels tangible and physically present. Water must be muddy and stagnant; dirt must be granular and crumbling.">Forensic Infrastructure Diorama</option>
    <option value="A clinical, high-contrast schematic on aged, textured drafting paper. The style merges technical architectural drafting with investigative infographics, utilizing a desaturated palette of charcoal greys and parchment whites. Strategic use of crimson red is applied only to technical callouts and flow arrows to indicate &quot;Economic Intent&quot; and &quot;Liability Shifts&quot;. The composition features split-pane narratives: the left side displays precise, exploded-view technical specs with drafting lines and material cross-sections; the right side maps systemic lifecycles using industrial iconography like factories and currency stacks to visualize &quot;Cost Transfer&quot;. Typography consists of clean, minimal sans-serif labels in a professional, audit-style format. The overall aesthetic is unsentimental and authoritative, stripping away consumer warmth to reveal a cold, engineered industrial reality. [scene]">Forensic Systems Blueprint</option>
    <option value="Vintage technical illustration, architectural diagram, aged paper texture, hand-drawn business infographic, exploded view coffee cup, fine ink lines, cross-hatching, stippling, muted sepia and earthy palette, even diffused lighting, central flowchart composition, instructional sketch style, analytical mood, minimalist shading.">Vintage Technical Illustration</option>
</optgroup>
<optgroup label="📜 Folk & Mythological Styles">
    <option value="A medieval woodcut print with bold black ink lines and high-contrast engraving. Rough, ancient, and textural. [scene]">Woodcut / Engraving (Medieval)</option>
    <option value="Traditional Folk Art Style, inspired by regional art, cultural patterns. [scene]">Traditional Folk Art</option>
    <option value="A gentle hand-painted illustration using soft watercolor washes and pastel tones. Dreamy and delicate with visible brushwork. [scene]">Watercolor / Pastel Illustration</option>
    <option value="Mythic Iconography style (Byzantine, Hindu, Celtic), flat perspective, symbolic colors. [scene]">Mythic Iconography</option>
    <option value="Silhouette Corner Cutout Style, black silhouettes against colored backgrounds, like Lotte Reiniger films. [scene]">Silhouette Cutout Style</option>
    <option value="Traditional, hand-drawn illustration of [scene]. Bold, black outlines, expressive and slightly grotesque features, muted earthy colors (browns, ochres, beiges). Subtle paper texture in background. Shading with hatching and soft gradients to mimic ink and watercolor. Minimal or flat background. Vintage satirical tone, reminiscent of 18th–19th century folk art or illustrated almanacs.">Vintage Folk Art</option>
    <option value="Traditional, hand-drawn illustration of [scene], positioned to one side of a wide canvas to create negative space. Bold, black outlines, expressive and slightly grotesque features. Muted earthy colors (browns, ochres, beiges). Subtle paper texture in the background. Shading with hatching and soft gradients to mimic ink and watercolor. Minimal or flat background. Vintage satirical tone, inspired by 18th–19th century folk art or illustrated almanacs.">Vintage Folk Art (Offset)</option>
</optgroup>
<optgroup label="⚡ Modern Thriller / Urban Drama">
    <option value="A cinematic cyberpunk night scene with neon-lit rain-soaked streets reflecting pink and cyan light. Deep shadows, atmospheric fog, and Blade Runner tension. [scene]">Cyber-Noir (Blade Runner feel)</option>
    <option value="A sterile, over-sharpened photorealistic image with desaturated, clinical precision. Lifelike but cold and emotionless. [scene]">Cold photorealism</option>
</optgroup>
<optgroup label="🌐 Digital & Modern Storytelling">
    <option value="Comic panels with limited animation (mouths, eyes, hands), bold linework. [scene]">Motion Comic / Animatic Style</option>
    <option value="Cutouts of stock images, gifs, memes, emojis — rapidly edited collage. [scene]">Meme Collage / Reaction Edit</option>
    <option value="Torn-paper edges, pasted photos, marker scribbles, zine-style collage. [scene]">Magazine / Zine Cutout Collage</option>
    <option value="Ironic use of generic royalty-free stock video footage. [scene]">Stock Footage Collage (Ironic)</option>
    <option value="Slow pan-and-zoom on still photographs with subtle transitions, documentary style. [scene]">Ken Burns Documentary Style</option>
    <option value="Simulated phone screen, Instagram feed, DMs, chat bubbles. [scene]">Social Media Frame Simulation</option>
    <option value="Rough, imperfect lines, sketchbook paper textures, scribble animation. [scene]">Sketchbook / Scribble Animation</option>
    <option value="Pixel Art, 8-bit retro video game graphics, like NES/SNES games. [scene]">8-bit Retro Game Style</option>
    <option value="AI-generated surreal dreamscapes, uncanny, metaphoric. [scene]">AI-Generated Surrealism</option>
    <option value="Clean vector icons, graphs, animated diagrams, explainer video style. [scene]">Infographic / Explainer Graphics</option>
    <option value="8-bit or 16-bit pixel art with limited color palette and retro gaming aesthetic. Clean pixel placement with careful dithering and anti-aliasing. Nostalgic video game style reminiscent of classic NES, SNES, or Game Boy era. Charming, simplified forms with vibrant colors. Isometric or side-view perspective. [scene]">Pixel Art</option>
</optgroup>
<optgroup label="⚔️ Battle Maps / Gaming">
    <option value="Overhead studio photograph, sharp focus, soft natural lighting, shallow depth of field. Aesthetic of 19th-century military cartography, hand-drawn fine ink lines, watercolor washes, topographic contour shading. Palette of muted pastels, pale yellow, light green, and earthy tones, contrasted with solid red and deep blue accents. Matte paper texture, smooth wooden block elements, precise geometric layouts. Clean, nostalgic, historical, and tactical atmosphere. [scene]">19th-Century Military Cartography</option>
    <option value="Overhead view of a World War II command operations map. Spread across a heavy wooden table under warm, dramatic spotlighting. Terrain depicted in faded olive drabs, sepia, and muted blues. Tactical positions marked with authentic wooden pushpins, carved troop blocks, and tensioned red string outlining frontlines. Matte canvas texture, scattered with authentic period props like a brass compass or calipers. Cinematic, tense, historical strategy. [scene]">WWII Operations Room Map</option>
    <option value="Antique nautical chart aesthetic, Age of Sail naval warfare map. Sepia-toned thick parchment paper, intricate rhumb lines, detailed compass roses, and hand-drawn coastal topography. Naval fleets represented by small, detailed ink drawings of galleons. Faded blue watercolor washes for ocean depths. Historic, authentic, oceanic strategy vibe. [scene]">Age of Sail Naval Chart</option>
    <option value="Retro Cold War era radar screen tactical map. High contrast monochrome CRT aesthetic with glowing bright green phosphorescent vectors on a deep black background. Geometric tactical symbols, sweeping arcs, and minimalist geographic outlines. Scanlines, subtle screen curvature, slight chromatic aberration, and a faint luminescent glow. Tense, technological, defcon-level atmosphere. [scene]">Cold War Tactical Radar</option>
    <option value="Renaissance-era woodcut print map style. Monochromatic black ink on aged beige textured paper. Characterized by thick, deliberate engraving lines, dense cross-hatching, and stylized terrain with repetitive hill and tree motifs. Includes ornate border decorations and classical mythical elements. Highly textured, rustic, classical historical feel. [scene]">Renaissance Woodcut Cartography</option>
    <option value="Traditional East Asian ink wash painting (Sumi-e) combined with modern cinematic composition. Fast, aggressive black ink brushstrokes capturing the motion of galloping cavalry and flying arrows. High contrast between stark white negative space and deep black ink, with strategic splashes of crimson red for blood and impact. The style emphasizes speed, chaos, and the fluidity of the Mongol tactics, grounded in a historical Chinese artistic tradition but with a gritty, modern graphic novel edge. Atmospheric fog masking the massive scale of the unseen armies. [scene]">Sumi-e Cinematic Ink Wash</option>
    <option value="Clean historical tactical battle-map frame, strict top-down perspective, antique parchment battlefield on a dark charcoal border, amber army formations and amber tactical arrows for Mongol forces, deep blue formations and red movement arrows for Jin Dynasty forces, soft translucent amber trap zone only when the phase requires it, faint terrain lines except the Great Wall rendered as a single bold dark line across the northern map edge, spacious uncluttered composition, one clear tactical phase per image, one main battlefield action, highly readable, no text, no labels, no captions, no dense repeated icon detail, no infographic clutter. [scene]">Clean Historical Tactical Battle-Map</option>
    <option value="Stylized CRPG video game asset map, top-down perspective. Vibrant color palettes, distinct textures for mud, water, and stone. Clear walkable areas and obstacles, readable tactical grid layout, bright high-fantasy lighting. [scene]">Stylized CRPG (Video Game Asset)</option>
    <option value="Classic ink and parchment map, hand-drawn traditional OSR tabletop style. Vintage aged paper texture, black ink outlines, cross-hatching shading. Tolkien-esque fantasy cartography. [scene]">Classic Ink &amp; Parchment (Traditional OSR)</option>
    <option value="Isometric hand-painted fantasy map. Pillars of Eternity or Baldur's Gate aesthetic. Pre-rendered 2D painting, soft edges, deep atmospheric perspective. High detail verticality, showing slopes and chasm depth. [scene]">Isometric Hand-Painted</option>
    <option value="Hand-painted fantasy map, MOBA or RTS style. Vibrant color palettes, slightly chunky and exaggerated proportions, soft brush-stroke textures. Painted magical lighting, lively and colorful rather than gritty. [scene]">Hand-Painted Fantasy (MOBA / RTS Style)</option>
    <option value="Dark fantasy grimdark render map, action RPG style like Diablo or Path of Exile. Moody low-key lighting, high-contrast shadows. Gritty textures, thick fog, ancient ruins, dangerous atmosphere. [scene]">Dark Fantasy / Grimdark Render (Action RPG Style)</option>
    <option value="Hyper-realistic VTT map, modern virtual tabletop top-down perspective. Photo-realistic textures like actual mud, cobblestone, water ripples, and foliage. Precise drop-shadows, high-fidelity 3D environment. [scene]">Hyper-Realistic VTT (Modern Virtual Tabletop)</option>
    <option value="Painterly pre-rendered classic CRPG map. Looks like a beautiful expansive digital oil painting. Soft edges, deep atmospheric perspective, focusing on artistic composition and mood. [scene]">Painterly Pre-Rendered (Classic CRPG)</option>
    <option value="Retro 16-bit pixel art map. Top-down JRPG style like Zelda A Link to the Past or Chrono Trigger. Crisp chunky pixel art, clear grid-like structures, highly constrained punchy color palette. [scene]">Retro 16-Bit Pixel Art</option>
</optgroup>
`;

export const MODAL_TEMPLATES = `
<!-- Non-Modal Progress Indicator -->
<div id="progress-indicator" class="fixed bottom-0 left-0 right-0 p-4 hidden transition-transform duration-300 translate-y-full pointer-events-none" style="z-index: 9999;">
    <div class="max-w-2xl mx-auto glass-panel rounded-xl shadow-2xl p-4 pointer-events-auto">
        <h3 id="progress-title" class="text-lg font-bold mb-3 text-white tracking-wide text-center">Processing...</h3>
        <div class="relative w-full h-4 bg-gray-700 rounded-full overflow-hidden mb-2 shadow-inner">
            <div id="progress-bar-indicator" class="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300 ease-out" style="width: 0%"></div>
        </div>
        <div class="flex justify-between items-center text-sm font-mono text-gray-400">
            <span id="progress-text">Starting...</span>
            <span id="progress-percent">0%</span>
        </div>
        <div id="progress-cancel-container" class="text-center mt-3 hidden">
            <button id="progress-cancel-btn" class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-4 text-xs rounded-lg transition">Stop Processing</button>
        </div>
    </div>
</div>

<!-- Confirmation Modal -->
<div id="confirmation-modal" class="fixed inset-0 bg-gray-900/90 backdrop-blur-md flex items-center justify-center p-4 z-[9999] hidden">
    <div class="bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 max-w-sm w-full text-center glass-panel border border-white/5">
        <h2 id="confirmation-title" class="text-xl font-bold mb-4 text-white">Confirm Action</h2>
        <p id="confirmation-message" class="text-gray-400 mb-6">Are you sure you want to proceed?</p>
        <div class="flex justify-center gap-4">
            <button id="confirm-cancel-btn" class="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition">Cancel</button>
            <button id="confirm-ok-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition">OK</button>
        </div>
    </div>
</div>

<!-- Help Modal -->
<div id="help-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[85vh]">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 class="text-2xl font-black text-white italic tracking-tighter uppercase">Help & Documentation</h3>
            <button id="close-help-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div class="flex-grow overflow-y-auto p-8 custom-scrollbar help-section">
            <h4>Welcome to ContentGen AI!</h4>
            <p>This guide will help you get started with creating amazing visual stories.</p>
            
            <h4>Workflow Steps</h4>
            <ol class="list-decimal list-inside space-y-2">
                <li><b>Pre-production:</b> Write your story or script in the text area. Use "Spark" for ideas or "Enhance" to flesh out your existing text.</li>
                <li><b>Consistency Profiles:</b> Build profiles for "Characters", "Locations", and "Elements" if you need them. The AI references these throughout image generation to maintain style and continuity.</li>
                <li><b>Finalize Storyboard:</b> Click "Create Storyboard". The AI breaks your script down into scenes and shots, equipped with generation prompts. From here, you can generate the shots individually.</li>
                <li><b>Produce Video:</b> Click "AI Video Director" to open the video production suite, where you can arrange timing, direct camera movements, and finalize your movie.</li>
            </ol>
            
            <h4>AI Video Director Workflows</h4>
            <ul class="list-disc list-inside space-y-2">
                <li><b>Audio-First Auto-Direction:</b> Generates a voice-over, breaks down the transcript into words, and semi-automatically assigns your shots to match the narration pacing perfectly.</li>
                <li><b>Upload Audio:</b> Provide your own voice-over, songs, or generated dialogue track to be used as the spine for timing the visual sequence. Use "Accuracy mode" for highly precise sync.</li>
                <li><b>Transcript Editor:</b> A visual studio allowing you to rapidly assign B-roll clips or images directly to specific words within your narration transcript.</li>
                <li><b>Magic Camera:</b> An automatic directing agent that dynamically sets zooms, pans, and cuts based on the action described in the current shot.</li>
                <li><b>Magic Polish (Director Review):</b> Comprehensive pacing, retention, and flow critique with automated 1-click timeline fixes.</li>
                <li><b>Export Capabilities:</b> Click "Subtitles ⤓" to get <b>.srt</b> files matching the timeline, or export the final compiled <b>.mp4</b> video.</li>
            </ul>

            <h4>Keyboard Shortcuts</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 my-2 text-xs">
                <div class="bg-zinc-800/80 p-2.5 rounded-lg border border-white/5 space-y-1">
                    <p class="font-bold text-indigo-300">Playback & Navigation</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Space</kbd> Play / Pause</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">K</kbd> Pause playback</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">F</kbd> Toggle fullscreen preview</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">←</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">→</kbd> Step ±1 frame</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">J</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">L</kbd> Step ±5 frames</p>
                </div>
                <div class="bg-zinc-800/80 p-2.5 rounded-lg border border-white/5 space-y-1">
                    <p class="font-bold text-indigo-300">Timeline & Editing</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">S</kbd> Split clip at playhead</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Q</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">W</kbd> Trim clip start / end</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">[</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">]</kbd> Set in / out points</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">R</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">T</kbd> Ripple / Slip mode</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Del</kbd> Ripple delete clip</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Ctrl+Z</kbd> / <kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Ctrl+Y</kbd> Undo / Redo</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Ctrl+E</kbd> Export video</p>
                    <p><kbd class="px-1.5 py-0.5 bg-zinc-900 border border-zinc-700 rounded text-[11px] font-mono text-zinc-200">Esc</kbd> Close modal / drawer</p>
                </div>
            </div>

            <h4>API Keys</h4>
            <p>You can add your own API keys in the Settings to access higher capacities or different providers.</p>
            <ul>
                <li><b>Gemini API Key:</b> Powers the core storytelling, storyboarding, and timeline intelligence. Get one from <a href="https://ai.google.dev/" target="_blank">Google AI Studio</a>.</li>
                <li><b>Stability UI / Flux / Gradio:</b> Various options to integrate different image generation APIs securely on the backend.</li>
                <li><b>Deepgram API Key:</b> Required for rapid audio-transcription and word-level timing precision.</li>
                <li><b>ElevenLabs API Key:</b> For premium voice generation, accessible via the Advanced options.</li>
            </ul>
        </div>
    </div>
</div>

<!-- History Modal -->
<div id="history-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[85vh]">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 class="text-2xl font-black text-white italic tracking-tighter uppercase">Project History</h3>
            <div class="flex gap-2">
                 <button id="clear-history-btn" class="bg-red-800/50 hover:bg-red-700 text-red-300 font-bold py-2 px-4 rounded-lg transition text-sm">Clear All Data</button>
                <button id="close-history-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
        </div>
        <div id="history-list-container" class="flex-grow overflow-y-auto p-6 custom-scrollbar">
            <!-- History items will be injected here -->
        </div>
    </div>
</div>

<!-- API Key Selection Modal (for Gemini Pro) -->
<div id="api-key-modal" class="fixed inset-0 bg-gray-900/90 backdrop-blur-md flex items-center justify-center p-4 z-[100] hidden">
    <div class="bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-lg w-full text-center glass-panel border border-white/5">
        <h2 class="text-2xl font-bold mb-3 text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500">Premium Model Access</h2>
        <p class="text-gray-300 mb-6">To use the <b>Gemini 3 Pro</b> image model, you must select an API key from a paid Google Cloud project.</p>
        <button id="select-api-key-btn" class="w-full bg-amber-500 hover:bg-amber-600 text-black font-bold py-3 px-4 rounded-lg transition duration-300 btn-glow shadow-lg shadow-amber-900/20">Select API Key</button>
        <p class="text-xs text-gray-500 mt-4">This ensures access to the highest quality image generation. For more information, see the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" class="text-blue-400 underline">billing documentation</a>.</p>
    </div>
</div>

<!-- Style Suggestion Modal -->
<div id="style-suggestion-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[85vh]">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 class="text-2xl font-black text-white italic tracking-tighter uppercase">AI Art Director Suggestions</h3>
            <button id="close-style-suggestion-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div id="style-suggestion-list" class="flex-grow overflow-y-auto p-6 space-y-4 custom-scrollbar">
            <!-- Style suggestions will be injected here -->
        </div>
    </div>
</div>

<!-- Style Info Modal -->
<div id="style-info-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[100] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-2xl w-full">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 id="style-info-title" class="text-xl font-black text-white italic tracking-tighter uppercase">Style Details</h3>
            <button id="close-style-info-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div id="style-info-content" class="p-6 text-gray-300 text-sm leading-relaxed">
            <!-- Style info will be injected here -->
        </div>
    </div>
</div>

<!-- Reference Library Modal -->
<div id="reference-library-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[85vh]">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 class="text-2xl font-black text-white italic tracking-tighter uppercase">Reference Image Library</h3>
            <div class="flex gap-2">
                 <button id="add-reference-image-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition text-sm">Add New</button>
                 <button id="reference-paste-btn" type="button" class="bg-gray-800 hover:bg-gray-700 text-cyan-300 border border-cyan-500/30 font-bold py-2 px-4 rounded-lg transition text-sm flex items-center gap-1.5" title="Paste image from clipboard (Ctrl+V)">📋 Paste</button>
                 <input type="file" id="add-reference-image-input" class="hidden" accept="image/*" multiple>
                 <button id="clear-library-btn" class="bg-red-800/50 hover:bg-red-700 text-red-300 font-bold py-2 px-4 rounded-lg transition text-sm">Clear Library</button>
                <button id="close-reference-library-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
        </div>
        <div id="reference-library-grid" class="flex-grow grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4 p-6 overflow-y-auto custom-scrollbar">
            <!-- Library items will be injected here -->
        </div>
    </div>
</div>

<!-- Presentation Modal -->
<div id="presentation-modal" class="fixed inset-0 bg-black z-[110] flex flex-col items-center justify-center p-4 hidden">
    <div class="relative w-full h-full flex items-center justify-center">
        <img id="presentation-image" src="" class="max-w-full max-h-full object-contain shadow-2xl">
    </div>
    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-center">
        <p id="presentation-text" class="text-xl md:text-2xl font-semibold text-white max-w-4xl mx-auto"></p>
    </div>
    <div class="absolute top-4 right-4 flex gap-2">
        <span id="presentation-counter" class="text-white bg-black/50 px-3 py-1 rounded-full text-sm font-mono"></span>
        <button id="presentation-close-btn" class="bg-black/50 text-white p-2 rounded-full"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
    </div>
    <button id="presentation-prev-btn" class="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 text-white p-3 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg></button>
    <button id="presentation-next-btn" class="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 text-white p-3 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg></button>
</div>

<!-- B-Roll Editor Workspace -->
<div id="b-roll-editor-workspace" class="fixed inset-0 bg-zinc-900 z-[85] hidden flex flex-col">
    <div class="flex-shrink-0 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-zinc-950">
        <div>
            <h3 class="text-xl font-black text-white uppercase italic tracking-tighter">B-Roll Precision Editor</h3>
            <p class="text-xs text-gray-500">Click an image from the bin, then click a word in the transcript to assign it.</p>
        </div>
        <div class="flex items-center gap-3">
            <button id="b-roll-auto-select-btn" class="bg-indigo-600/10 border border-indigo-500/40 text-indigo-400 font-bold py-2 px-4 rounded-xl text-xs hover:bg-indigo-600/20 transition">🤖 Magic Select</button>
            <button id="b-roll-undo-btn" class="bg-gray-800 text-white font-bold py-2 px-4 rounded-xl text-xs transition" disabled>Undo</button>
            <button id="b-roll-finalize-btn" class="bg-green-600 hover:bg-green-700 text-white font-black py-2 px-6 rounded-xl text-xs transition uppercase tracking-widest">Finalize Video</button>
            <button id="b-roll-close-btn" class="p-2 text-gray-400 hover:text-white">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
    </div>
    
    <div class="flex-grow flex overflow-hidden">
        <div class="flex-grow flex flex-col">
            <div class="flex-shrink-0 p-6 border-b border-white/5">
                <audio id="b-roll-audio-player" controls class="w-full"></audio>
            </div>
            <div id="b-roll-transcript-container" class="flex-grow overflow-y-auto p-12 custom-scrollbar text-3xl font-bold leading-relaxed text-gray-600">
                <!-- Transcript words injected here -->
            </div>
             <div class="flex-shrink-0 p-4 border-t border-white/5 flex justify-between items-center bg-zinc-950 text-xs">
                <span id="b-roll-word-count" class="font-mono text-gray-500">0 words</span>
                 <div class="flex items-center gap-2">
                     <button id="b-roll-export-selections-btn" class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">Export Selections</button>
                     <button id="b-roll-import-selections-btn" class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">Import Selections</button>
                     <input type="file" id="b-roll-import-selections-input" class="hidden" accept=".broll">
                 </div>
             </div>
        </div>
        <div class="w-96 border-l border-white/5 bg-black/40 p-6 flex flex-col">
            <div class="flex justify-between items-center mb-4"><h4 class="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Storyboard Bin</h4><button id="b-roll-import-asset-btn" class="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded">Import</button><input type="file" id="b-roll-import-asset-input" class="hidden" accept="image/*,video/*" multiple></div>
            <div id="b-roll-bin-container" class="flex-grow">
                <!-- Images from storyboard injected here -->
            </div>
        </div>
    </div>
</div>

<!-- AI Video Director Modal -->
<div id="video-director-modal" class="fixed inset-0 bg-black/95 flex items-center justify-center p-0 z-[60] hidden">
    <div id="video-director-main-view" class="relative w-full h-full flex flex-col bg-gray-900">
        <!-- Header -->
        <div class="flex flex-wrap items-center justify-between px-3 sm:px-4 py-2 border-b border-white/10 bg-[#0c0d12] z-20 gap-2 sm:gap-3 select-none">
            <!-- Left: Studio & Workspace Setup -->
            <div class="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                <div class="flex items-center gap-1.5 sm:gap-2 pr-1">
                    <span class="text-base select-none">🎬</span>
                    <div class="flex items-center gap-1.5">
                        <h2 class="text-xs font-bold text-white tracking-wide uppercase whitespace-nowrap">Video Director</h2>
                        <span class="text-[9px] font-mono font-bold px-1.5 py-0.5 text-indigo-400 bg-indigo-950/80 border border-indigo-500/30 rounded">PRO</span>
                    </div>
                </div>
                
                <div class="h-4 w-px bg-white/10 hidden sm:block"></div>
                
                <!-- Studio Tools Dock -->
                <div class="flex items-center bg-zinc-950/80 rounded-lg border border-white/10 p-0.5 gap-0.5 shadow-inner">
                    <!-- Sequence Timeline Drawer Toggle -->
                    <button id="toggle-timeline-btn-modal" class="bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5 border border-white/5 hover:border-white/20 shadow-xs cursor-pointer whitespace-nowrap" title="Toggle Dedicated Sequence Timeline Track">
                        <span>🎞️</span>
                        <span class="hidden lg:inline">Sequence Track</span>
                    </button>

                    <!-- VFX Studio Launcher -->
                    <button id="vfx-studio-video-director-btn" class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-purple-200 bg-purple-950/50 hover:bg-purple-900/70 border border-purple-500/30 hover:border-purple-400/50 transition-colors shadow-xs cursor-pointer whitespace-nowrap" title="Open Visual Effects & Color Grade Studio">
                        <span>✨</span>
                        <span class="hidden lg:inline">FX Studio</span>
                    </button>
                </div>

                <!-- Framing & Preview Resolution Dock -->
                <div class="flex items-center bg-zinc-950/80 rounded-lg border border-white/10 p-0.5 gap-1 shadow-inner">
                    <!-- Aspect Ratio Switcher -->
                    <div class="flex items-center px-1.5 py-0.5 gap-1 hover:text-white transition-colors" title="Switch Video Aspect Ratio Preview & Framing">
                        <span class="text-[10px] text-zinc-400 font-semibold select-none">📐</span>
                        <select id="video-director-aspect-select" class="bg-transparent text-zinc-200 border-none text-xs font-medium outline-none cursor-pointer pr-1">
                            <option value="16:9" class="bg-zinc-900 text-white">16:9 Landscape</option>
                            <option value="9:16" class="bg-zinc-900 text-white">9:16 Vertical (Shorts/Reels)</option>
                            <option value="1:1" class="bg-zinc-900 text-white">1:1 Square</option>
                            <option value="4:3" class="bg-zinc-900 text-white">4:3 Standard</option>
                            <option value="3:4" class="bg-zinc-900 text-white">3:4 Portrait</option>
                        </select>
                    </div>

                    <div class="h-3.5 w-px bg-white/10 hidden md:block"></div>

                    <!-- Preview Resolution Switcher -->
                    <div class="hidden md:flex items-center px-1.5 py-0.5 gap-1 hover:text-white transition-colors" title="Canvas Preview Render Quality">
                        <span class="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider select-none">Quality</span>
                        <select id="video-preview-resolution-select" class="bg-transparent text-zinc-200 border-none text-xs font-medium outline-none cursor-pointer pr-1">
                            <option value="720p" class="bg-zinc-900 text-white">720p HD</option>
                            <option value="520p" selected class="bg-zinc-900 text-white">520p</option>
                            <option value="320p" class="bg-zinc-900 text-white">320p</option>
                            <option value="240p" class="bg-zinc-900 text-white">240p</option>
                        </select>
                    </div>

                    <div class="h-3.5 w-px bg-white/10 hidden md:block"></div>

                    <!-- Responsive Preview Mode Toggle -->
                    <label class="hidden md:flex items-center px-1.5 py-0.5 gap-1.5 cursor-pointer hover:text-white transition-colors" title="Responsive Preview: Smooth real-time scrubbing and dragging by streamlining decorative effects during interaction">
                        <input type="checkbox" id="video-responsive-preview-toggle" class="w-3 h-3 rounded bg-zinc-800 border-white/20 text-indigo-500 focus:ring-0">
                        <span class="text-[10px] text-zinc-300 font-medium select-none">Responsive</span>
                    </label>
                </div>
            </div>

            <!-- Center: Production Workflow Segmented Controls -->
            <div class="flex items-center justify-center flex-wrap sm:flex-nowrap gap-1 order-last xl:order-none w-full xl:w-auto my-1 xl:my-0">
                <div class="flex items-center bg-zinc-950/90 rounded-xl border border-white/10 p-1 gap-1 shadow-inner">
                    <!-- Visual-First Mode -->
                    <div class="flex items-center bg-zinc-900/90 rounded-lg border border-white/5 p-0.5">
                        <button id="direct-video-visual-first-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap" title="Direct video using visuals as primary rhythm">
                            <span>Visual-First</span>
                        </button>
                        
                        <div class="flex items-center gap-1.5 px-2 border-l border-white/10 ml-1">
                            <label class="flex items-center gap-1 cursor-pointer group" title="Automatically generate narration from scene descriptions">
                                <input type="checkbox" id="visual-first-audio-toggle" class="w-3 h-3 rounded bg-zinc-800 border-white/10 text-indigo-500 focus:ring-0">
                                <span class="text-[10px] font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors whitespace-nowrap">Auto-Voice</span>
                            </label>
                            <div class="flex items-center gap-1" title="Target duration (minutes)">
                                <span class="text-[10px] text-zinc-500 font-mono">Min:</span>
                                <input type="number" id="visual-first-duration-override" class="w-11 bg-zinc-800/90 text-white border border-white/10 rounded py-0.5 px-1 text-[10px] font-mono text-center focus:ring-1 focus:ring-indigo-500 focus:outline-none" placeholder="AUTO" min="0.01" step="0.01">
                            </div>
                        </div>
                    </div>

                    <div class="h-4 w-px bg-white/10 mx-0.5 hidden xs:block"></div>

                    <!-- Upload Audio Mode (High Visibility Amber Button) -->
                    <button id="upload-audio-btn" class="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-100 border border-amber-500/40 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer whitespace-nowrap" title="Upload pre-recorded audio track or voiceover (MP3, WAV, M4A, MP4, MOV)">
                        <span class="text-amber-400">📁</span>
                        <span>Upload Audio</span>
                    </button>
                    <input type="file" id="audio-upload-input" class="hidden" accept="audio/*,video/*">
                </div>
            </div>

            <!-- Right: Project Persistence & Delivery -->
            <div class="flex items-center gap-2 sm:gap-2.5 shrink-0">
                <!-- Project Management Group -->
                <div class="flex items-center bg-zinc-950/80 rounded-lg border border-white/10 p-0.5 gap-0.5 shadow-inner">
                    <input type="file" id="import-project-input" class="hidden" accept=".cgproj">
                    <button id="import-project-video-btn" class="p-1.5 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors flex items-center justify-center cursor-pointer" title="Import Project Archive (.cgproj)">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                    </button>
                    <button id="save-project-video-btn" class="px-2.5 py-1.5 rounded-md text-zinc-200 hover:text-emerald-300 hover:bg-emerald-950/50 font-medium text-xs transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap" title="Save Project & Timeline (Storage)">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor"><path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6a1 1 0 10-2 0v5.586L7.707 10.293zM3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"></path></svg>
                        <span class="hidden sm:inline">Save</span>
                    </button>
                    <button id="export-project-archive-video-btn" class="px-2 py-1.5 rounded-md text-zinc-300 hover:text-teal-200 hover:bg-teal-950/40 font-medium text-xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap" title="Export Full Project Archive (.cgproj with assets and timeline)">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-teal-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0L8 4m8 4v12"></path></svg>
                        <span class="hidden xl:inline">Archive</span>
                    </button>
                </div>

                <!-- Primary CTA: Export Video -->
                <button id="video-export-btn" class="bg-gradient-to-r from-indigo-500 via-purple-600 to-indigo-600 hover:from-indigo-400 hover:to-purple-500 text-white font-bold px-3.5 sm:px-4 py-1.5 rounded-lg shadow-lg shadow-indigo-950/50 transition-all flex items-center gap-1.5 text-xs uppercase tracking-wider disabled:opacity-35 disabled:cursor-not-allowed border border-indigo-400/40 cursor-pointer active:scale-95 whitespace-nowrap" disabled title="Render & Export Finished Video (MP4/WebM)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span>Export Video</span>
                </button>

                <div class="h-4 w-px bg-white/10"></div>

                <!-- Close Modal -->
                <button id="close-video-director-modal-btn" class="text-zinc-400 hover:text-white hover:bg-white/10 transition-colors p-1.5 rounded-lg cursor-pointer" title="Close Video Director">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
        </div>

        <!-- Main Workspace -->
        <div class="flex flex-grow overflow-hidden relative">
            <!-- Left: Video Preview & Dedicated Timeline Column -->
            <div class="flex-grow flex flex-col min-w-0 h-full overflow-hidden relative">
                <!-- Video Preview Viewport Container -->
                <div id="video-preview-container-area" class="flex-grow flex items-center justify-center min-w-0 min-h-0 w-full h-full p-2 sm:p-4 relative overflow-hidden bg-zinc-950 select-none">
                    <div id="video-preview-wrapper" class="relative bg-black cursor-pointer group overflow-hidden shadow-2xl rounded-xl flex items-center justify-center border border-white/10 transition-all duration-150">
                        <canvas id="video-canvas" class="w-full h-full hidden"></canvas>
                        <!-- HyperFrames deterministic HTML/CSS motion graphics layer -->
                        <div id="hyperframes-overlay-layer" class="absolute inset-0 pointer-events-none z-15 overflow-hidden w-full h-full select-none"></div>
                        <div id="video-pre-generation-overlay" class="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-black select-none p-4 text-center">
                            <svg class="w-16 h-16 sm:w-20 sm:h-20 mb-3 opacity-25 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.414.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                            <p class="text-sm sm:text-base font-semibold text-gray-300">Ready to Direct</p>
                            <p class="text-xs text-gray-500 mt-1 max-w-xs">Set your production options and click a generation button.</p>
                        </div>
                        <div id="video-post-generation-overlay" class="absolute inset-0 flex items-center justify-center bg-black/30 hidden z-10 transition hover:bg-black/40 pointer-events-none">
                            <div id="big-play-btn" class="bg-slate-950/70 hover:bg-slate-900/90 backdrop-blur-sm rounded-full p-3 transition-all transform hover:scale-105 shadow-md text-white/90 hover:text-white flex items-center justify-center border border-white/20 pointer-events-auto cursor-pointer" title="Play Video (Space)">
                                <svg class="w-5 h-5 text-white fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            </div>
                        </div>
                        <div id="video-controls-container" class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent pt-12 pb-3 px-3 sm:px-6 hidden flex-col gap-2.5 z-20 transition-all duration-300 opacity-100">
                            <div id="video-progress-bar-container" class="video-progress-container w-full h-1.5 bg-white/20 hover:h-2 rounded-full cursor-pointer overflow-hidden group/bar relative transition-all">
                                <div id="video-progress-bar" class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 w-0 transition-all duration-100 ease-linear absolute top-0 left-0"></div>
                                <div class="h-full w-full absolute top-0 left-0 opacity-0 group-hover/bar:opacity-20 bg-white transition-opacity"></div>
                            </div>
                            <div class="flex items-center justify-between gap-3 text-white/90">
                                <!-- Left: Playback & Transport Dock -->
                                <div class="flex items-center bg-zinc-950/85 backdrop-blur-md rounded-full border border-white/10 px-2 py-1 gap-2 sm:gap-2.5 shadow-lg shadow-black/50">
                                    <button id="video-play-pause-btn" class="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-transform transform active:scale-95 shadow-md flex items-center justify-center focus:outline-none cursor-pointer" title="Play / Pause Video (Space)">
                                        <svg id="video-play-icon" class="w-4 h-4 fill-current ml-0.5" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" /></svg>
                                        <svg id="video-pause-icon" class="w-4 h-4 sm:w-5 sm:h-5 hidden fill-current" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                                    </button>
                                    <span class="text-xs font-mono tabular-nums tracking-wider px-1">
                                        <span id="video-current-time">0:00</span> <span class="text-white/30 mx-0.5">/</span> <span id="video-total-time" class="text-white/60">0:00</span>
                                    </span>
                                    
                                    <div class="h-3.5 w-px bg-white/10"></div>

                                    <div class="flex items-center px-1.5 py-0.5 gap-1" title="Preview Playback Quality">
                                        <select id="video-canvas-preview-resolution-select" class="bg-transparent text-indigo-300 hover:text-indigo-200 text-[10px] font-mono font-bold outline-none cursor-pointer">
                                            <option value="720p" class="bg-zinc-900 text-gray-200">720p</option>
                                            <option value="520p" selected class="bg-zinc-900 text-gray-200">520p</option>
                                            <option value="320p" class="bg-zinc-900 text-gray-200">320p</option>
                                            <option value="240p" class="bg-zinc-900 text-gray-200">240p</option>
                                        </select>
                                    </div>

                                    <button id="video-fullscreen-btn" title="Fullscreen preview (F)" class="p-1.5 hover:bg-white/10 text-zinc-300 hover:text-white rounded-full transition cursor-pointer flex items-center justify-center text-xs">⛶</button>
                                </div>

                                <!-- Right: Sync & Motion Graphics Dock -->
                                <div class="flex items-center bg-zinc-950/85 backdrop-blur-md rounded-full border border-white/10 px-2.5 py-1 gap-2.5 shadow-lg shadow-black/50">
                                    <label class="flex items-center gap-1.5 cursor-pointer group px-1" title="Sync storyboard scroll with timeline playhead">
                                        <input type="checkbox" id="timeline-sync-toggle" class="w-3.5 h-3.5 rounded bg-zinc-800 border-white/20 text-indigo-500 focus:ring-0">
                                        <span id="timeline-sync-label" class="text-[10px] uppercase font-semibold text-zinc-400 group-hover:text-zinc-200 transition-colors hidden sm:inline">Sync</span>
                                    </label>

                                    <div class="h-3.5 w-px bg-white/10"></div>

                                    <div class="relative inline-block">
                                        <button id="video-add-graphic-btn" class="bg-teal-600/90 hover:bg-teal-500 text-white text-[11px] px-3 py-1 rounded-full transition-colors font-semibold shadow-sm flex items-center gap-1.5 cursor-pointer" title="Drop Motion Graphic at current playhead">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg> <span id="add-graphic-label">Graphic</span>
                                            <svg class="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </button>
                                        <div id="video-graphic-presets-menu" class="hidden absolute right-0 bottom-full mb-2 w-64 bg-[#12141c]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 z-50 text-white text-xs space-y-1 max-h-80 overflow-y-auto custom-scrollbar">
                                            <div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-white/10 flex items-center justify-between">
                                                <span>Drop at Playhead</span>
                                                <span class="text-teal-400 font-semibold">Presets</span>
                                            </div>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="lowerThird">
                                                <span class="text-sm">🪧</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Lower Third</div><div class="text-[9px] text-gray-400 truncate">Speaker name & credential banner</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="titleCard">
                                                <span class="text-sm">🎬</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Title Card</div><div class="text-[9px] text-gray-400 truncate">Cinematic chapter intro</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="bulletPanel">
                                                <span class="text-sm">📝</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Bullet List</div><div class="text-[9px] text-gray-400 truncate">Staggered animated key points</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="iconOverlay">
                                                <span class="text-sm">🎯</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Icon & Pointer</div><div class="text-[9px] text-gray-400 truncate">Pointers, badges & callouts</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="statCounter">
                                                <span class="text-sm">📈</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Stat Counter</div><div class="text-[9px] text-gray-400 truncate">Live animated KPI metric</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="donutChart">
                                                <span class="text-sm">🍩</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Donut Chart</div><div class="text-[9px] text-gray-400 truncate">Visual ring & progress data</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="socialBadge">
                                                <span class="text-sm">🔔</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Social Badge</div><div class="text-[9px] text-gray-400 truncate">Follow & subscribe callout</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="spotlightFocus">
                                                <span class="text-sm">🔦</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Spotlight Focus</div><div class="text-[9px] text-gray-400 truncate">Darken background highlight</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="versusCard">
                                                <span class="text-sm">⚔️</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Versus Card</div><div class="text-[9px] text-gray-400 truncate">Split comparison A vs B</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="revealRoute">
                                                <span class="text-sm">🗺️</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Route Steps</div><div class="text-[9px] text-gray-400 truncate">Step-by-step roadmap path</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-teal-600/20 hover:text-teal-300 transition flex items-center gap-2.5 cursor-pointer" data-preset-type="spectrum">
                                                <span class="text-sm">📊</span>
                                                <div class="truncate"><div class="font-medium text-white text-[11px]">Audio Spectrum</div><div class="text-[9px] text-gray-400 truncate">Music/narration reactive wave</div></div>
                                            </button>
                                            <button type="button" class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-sky-600/20 hover:text-sky-300 transition flex items-center gap-2.5 cursor-pointer border-t border-white/5 pt-1.5" data-preset-type="hyperFrame">
                                                <span class="text-sm">🚀</span>
                                                <div class="truncate"><div class="font-medium text-sky-300 text-[11px] font-bold">HyperFrame Code</div><div class="text-[9px] text-gray-400 truncate">HTML, music reactive & 60fps motion</div></div>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Dedicated Timeline Drawer (Flex Sibling below Preview) -->
                <div id="timeline-editor-container" class="w-full shrink-0 z-30 bg-[#0d0d12]/95 backdrop-blur-2xl border-t border-indigo-500/30 shadow-[0_-10px_30px_rgba(0,0,0,0.8)] transition-all duration-300 hidden flex-col max-h-[380px]">
                    <div class="flex items-center justify-between bg-[#111218] border-b border-white/10 px-2 sm:px-3 py-1.5 shrink-0 gap-2.5 select-none relative z-40 overflow-x-auto custom-scrollbar no-scrollbar w-full">
                        <!-- ZONE 1: Left - Sequence Info, Prominent ⚡ AI Director Hub & Media Insertion -->
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button id="collapse-timeline-btn" class="px-1.5 py-1 hover:bg-white/10 text-zinc-300 hover:text-amber-400 rounded-md transition-colors text-xs flex items-center gap-1 font-bold cursor-pointer shrink-0" title="Expand/Collapse Timeline Track">
                                <span id="collapse-timeline-icon">▼</span> <span class="hidden sm:inline">Timeline</span>
                            </button>
                            <div class="flex items-center gap-1 font-mono text-[10px] shrink-0">
                                <span id="timeline-duration-badge" class="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full font-bold tabular-nums" title="Total Sequence Length">0.0s</span>
                                <span id="timeline-clips-badge" class="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full tabular-nums" title="Total Sequence Clips">0 Shots</span>
                                <span id="timeline-pacing-badge" class="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full hidden 2xl:inline-block" title="Audio Pacing Status">🎵 Sync</span>
                            </div>

                            <div class="h-4 w-px bg-white/10 mx-0.5 hidden sm:block"></div>

                            <!-- UNIFIED ⚡ AI DIRECTOR HUB (PRIMARY POSITION: ALWAYS VISIBLE WITHOUT SCROLLING) -->
                            <div class="relative inline-block shrink-0" id="timeline-ai-director-container">
                                <button id="timeline-ai-director-menu-btn" type="button" class="bg-gradient-to-r from-amber-600 via-purple-600 to-indigo-600 hover:from-amber-500 hover:to-indigo-500 text-white font-bold text-xs px-2.5 py-1 rounded-md shadow-md shadow-purple-950/40 transition flex items-center gap-1.5 cursor-pointer border border-white/20 active:scale-95 shrink-0 whitespace-nowrap" title="AI Director Automations & Intelligent Editing Tools">
                                    <span class="text-amber-300 text-xs sm:text-sm">⚡</span>
                                    <span class="tracking-wide hidden xs:inline sm:inline">AI Director</span>
                                    <span class="tracking-wide inline xs:hidden sm:hidden">AI</span>
                                    <svg id="timeline-ai-director-arrow" class="w-3 h-3 opacity-80 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>

                                <!-- AI Director Dropdown Menu Panel (Anchored Left, Opens Upward into Preview Area) -->
                                <div id="timeline-ai-director-dropdown" class="hidden absolute left-0 bottom-full mb-2 w-80 max-h-[calc(100vh-260px)] overflow-y-auto custom-scrollbar bg-zinc-950/98 backdrop-blur-2xl border border-zinc-700/90 rounded-2xl shadow-[0_-15px_40px_rgba(0,0,0,0.95)] p-3 space-y-2.5 z-[250] animate-scale-up">
                                    <div class="flex items-center justify-between border-b border-zinc-800 pb-2 px-1">
                                        <span class="text-xs font-bold text-white flex items-center gap-1.5">
                                            <span class="text-amber-400">⚡</span> AI Timeline Director
                                        </span>
                                        <div class="flex items-center gap-2">
                                            <span class="text-[10px] font-mono text-zinc-400">Automations Hub</span>
                                            <button id="close-ai-director-dropdown-btn" type="button" class="text-zinc-400 hover:text-white p-1 rounded-md hover:bg-zinc-800 transition-colors text-xs cursor-pointer" title="Close AI Director Menu">✕</button>
                                        </div>
                                    </div>

                                    <!-- Pattern Interrupt -->
                                    <button id="timeline-pattern-interrupt-btn" type="button" class="w-full text-left p-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-amber-500/20 hover:border-amber-500/50 transition flex items-start gap-2.5 cursor-pointer group">
                                        <div class="p-2 rounded-lg bg-amber-950/60 text-amber-400 border border-amber-500/30 shrink-0 text-xs">⚡</div>
                                        <div class="flex-grow min-w-0">
                                            <div class="text-xs font-bold text-white flex items-center justify-between">
                                                <span>Auto Pattern Interrupt</span>
                                                <span class="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">Pro</span>
                                            </div>
                                            <div class="text-[10px] text-zinc-400 mt-0.5 leading-snug">Detect visual monotony & inject motivated pacing resets and zoom punch-ins.</div>
                                        </div>
                                    </button>

                                    <!-- Magic Polish -->
                                    <button id="timeline-magic-polish-btn" type="button" class="w-full text-left p-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800/90 border border-purple-500/20 hover:border-purple-500/50 transition flex items-start gap-2.5 cursor-pointer group">
                                        <div class="p-2 rounded-lg bg-purple-950/60 text-purple-400 border border-purple-500/30 shrink-0 text-xs">🪄</div>
                                        <div class="flex-grow min-w-0">
                                            <div class="text-xs font-bold text-white">Magic Polish</div>
                                            <div class="text-[10px] text-zinc-400 mt-0.5 leading-snug">Run Director Review Loop & optimize overall timeline flow.</div>
                                        </div>
                                    </button>

                                    <!-- Auto-Direct Overlays, Intensity & SFX -->
                                    <div class="p-2 rounded-xl bg-zinc-900/90 border border-teal-500/20 space-y-2">
                                        <button id="timeline-autodirect-overlays-btn" type="button" class="w-full text-left flex items-start gap-2.5 cursor-pointer">
                                            <div class="p-2 rounded-lg bg-teal-950/60 text-teal-400 border border-teal-500/30 shrink-0 text-xs">✨</div>
                                            <div class="flex-grow min-w-0">
                                                <div class="text-xs font-bold text-white">Auto-Direct Overlays</div>
                                                <div class="text-[10px] text-zinc-400 mt-0.5 leading-snug">Sync motion graphics & lower thirds to narration timestamps.</div>
                                            </div>
                                        </button>
                                        <div class="flex items-center justify-between pt-1 border-t border-zinc-800/80 px-1">
                                            <span class="text-[10px] text-zinc-400 font-medium">Intensity:</span>
                                            <div id="overlay-intensity-toggle" class="flex items-center bg-zinc-950 border border-white/10 rounded-md overflow-hidden text-[10px] font-semibold">
                                                <button type="button" data-overlay-intensity="minimal" class="px-2 py-0.5 bg-zinc-800 text-gray-400 hover:text-white transition-colors cursor-pointer">Minimal</button>
                                                <button type="button" data-overlay-intensity="medium" class="px-2 py-0.5 bg-teal-600 text-white transition-colors cursor-pointer">Medium</button>
                                                <button type="button" data-overlay-intensity="aggressive" class="px-2 py-0.5 bg-zinc-800 text-gray-400 hover:text-white transition-colors cursor-pointer">Aggressive</button>
                                            </div>
                                        </div>
                                        <div class="flex items-center justify-between pt-1 border-t border-zinc-800/80 px-1">
                                            <span class="text-[10px] text-zinc-400 font-medium">Auto SFX:</span>
                                            <div id="overlay-sfx-toggle" class="flex items-center bg-zinc-950 border border-white/10 rounded-md overflow-hidden text-[10px] font-semibold">
                                                <button type="button" data-overlay-sfx="none" class="px-1.5 py-0.5 bg-teal-600 text-white transition-colors cursor-pointer" title="Silent (no sound effects on auto overlays)">Off</button>
                                                <button type="button" data-overlay-sfx="subtle" class="px-1.5 py-0.5 bg-zinc-800 text-gray-400 hover:text-white transition-colors cursor-pointer" title="Subtle & Context-Aware (Smart SFX on stats, hooks, and punchlines; silent on captions)">Subtle</button>
                                                <button type="button" data-overlay-sfx="high-energy" class="px-1.5 py-0.5 bg-zinc-800 text-gray-400 hover:text-white transition-colors cursor-pointer" title="High-Energy (Audible pop/whoosh/impact on every graphic)">Punchy</button>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Picture-in-Picture Tools -->
                                    <div class="p-2 rounded-xl bg-zinc-900/90 border border-indigo-500/20 space-y-2">
                                        <div class="flex items-center justify-between">
                                            <div class="text-xs font-bold text-white flex items-center gap-1.5">
                                                <span>🪟</span> <span>Pop-Up B-Roll (PiP)</span>
                                            </div>
                                            <button id="clear-all-pip-btn" type="button" class="text-[10px] text-zinc-400 hover:text-rose-400 transition cursor-pointer flex items-center gap-1">
                                                <span>🚫</span> <span>Clear</span>
                                            </button>
                                        </div>
                                        <button id="quick-auto-pip-btn" type="button" class="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition shadow flex items-center justify-center gap-1.5 cursor-pointer">
                                            <span>✨</span> <span>Auto-Detect PiP Callouts</span>
                                        </button>
                                    </div>

                                    <!-- A-Roll Rhythm Selector -->
                                    <div class="p-2 rounded-xl bg-zinc-900/90 border border-indigo-500/20 space-y-1.5">
                                        <div class="text-[10px] font-bold text-indigo-300 flex items-center justify-between">
                                            <span>🎭 Editing Rhythm Template</span>
                                        </div>
                                        <div class="flex items-center gap-1.5">
                                            <select id="timeline-aroll-rhythm-select" class="bg-zinc-950 text-white text-xs py-1 px-2 rounded-lg outline-none border border-zinc-700 cursor-pointer flex-grow"></select>
                                            <button id="timeline-aroll-rhythm-apply-btn" type="button" class="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-2.5 py-1 rounded-lg shadow transition cursor-pointer whitespace-nowrap">
                                                Apply
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="h-4 w-px bg-white/10 mx-0.5 hidden sm:block"></div>

                            <!-- Media Add Group -->
                            <div class="flex items-center bg-zinc-950/80 rounded-lg border border-white/10 p-0.5 gap-0.5 shrink-0 shadow-inner">
                                <button id="timeline-build-btn" title="Build timeline from uploaded shots — uses each clip's real duration" class="bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-semibold text-xs px-2.5 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer border border-white/5 shrink-0 whitespace-nowrap">
                                    <span>🎞️</span><span class="hidden md:inline">Build Shots</span>
                                </button>
                                <button id="timeline-add-overlay-btn" title="Add B-Roll Image, Icon, Lower Third, or Title Overlay to Timeline" class="bg-teal-950/40 hover:bg-teal-900/60 text-teal-300 hover:text-white border border-teal-500/30 font-semibold text-xs px-2.5 py-1 rounded-md transition flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap">
                                    <svg class="w-3.5 h-3.5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                                    <span class="hidden md:inline">Overlay</span>
                                </button>
                                <button id="timeline-add-text-btn" title="Add Text at Playhead" class="bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white font-semibold text-xs px-2.5 py-1 rounded-md transition flex items-center gap-1 cursor-pointer border border-white/5 shrink-0 whitespace-nowrap">
                                    <span class="font-bold text-indigo-400">T</span>
                                    <span class="hidden md:inline">Text</span>
                                </button>
                                <div class="relative inline-block" id="timeline-add-sfx-menu-container">
                                    <button id="timeline-add-sfx-btn" type="button" title="Add Sound Effect at Playhead" class="bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 hover:text-white border border-amber-500/30 font-semibold text-xs px-2.5 py-1 rounded-md transition flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap">
                                        <span>🔊</span>
                                        <span class="hidden md:inline">SFX</span>
                                        <svg class="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                                    </button>
                                    <div id="timeline-sfx-dropdown" class="hidden absolute left-0 bottom-full mb-2 w-56 bg-zinc-950/98 backdrop-blur-xl border border-amber-500/40 rounded-xl shadow-[0_-10px_25px_rgba(0,0,0,0.9)] p-2 z-[260] space-y-1">
                                        <div class="flex items-center justify-between border-b border-white/10 pb-1 px-1">
                                            <span class="text-[10px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1">
                                                <span>🔊</span> Drop SFX at Playhead
                                            </span>
                                            <span class="text-[9px] text-zinc-500 font-mono">11 FX</span>
                                        </div>
                                        <div class="grid grid-cols-2 gap-1 text-[11px] pt-1">
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-amber-950/80 text-zinc-200 hover:text-amber-300 border border-white/10 hover:border-amber-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="whoosh" title="Drop Kinetic Whoosh">
                                                <span>💨</span> Whoosh
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-rose-950/80 text-zinc-200 hover:text-rose-300 border border-white/10 hover:border-rose-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="hit" title="Drop Punchy Hit">
                                                <span>🔨</span> Hit
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-emerald-950/80 text-zinc-200 hover:text-emerald-300 border border-white/10 hover:border-emerald-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="ping" title="Drop Crystal Ping">
                                                <span>🔔</span> Ping
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-sky-950/80 text-zinc-200 hover:text-sky-300 border border-white/10 hover:border-sky-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="pop" title="Drop UI Pop">
                                                <span>🫧</span> Pop
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-yellow-950/80 text-zinc-200 hover:text-yellow-300 border border-white/10 hover:border-yellow-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="laser" title="Drop Laser Zap">
                                                <span>⚡</span> Laser
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-purple-950/80 text-zinc-200 hover:text-purple-300 border border-white/10 hover:border-purple-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="riser" title="Drop Tension Riser">
                                                <span>📈</span> Riser
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-cyan-950/80 text-zinc-200 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="glitch" title="Drop Cyber Glitch">
                                                <span>👾</span> Glitch
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-indigo-950/80 text-zinc-200 hover:text-indigo-300 border border-white/10 hover:border-indigo-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="bass_drop" title="Drop Sub Bass Drop">
                                                <span>🔊</span> Bass Drop
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-amber-950/80 text-zinc-200 hover:text-amber-300 border border-white/10 hover:border-amber-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="cyber_chime" title="Drop Cyber Chime">
                                                <span>✨</span> Chime
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-900 hover:bg-red-950/80 text-zinc-200 hover:text-red-300 border border-white/10 hover:border-red-500/40 rounded p-1 text-left transition flex items-center gap-1.5 cursor-pointer truncate" data-sfx="impact" title="Drop Heavy Impact">
                                                <span>💥</span> Impact
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn col-span-2 bg-zinc-900 hover:bg-teal-950/80 text-zinc-200 hover:text-teal-300 border border-white/10 hover:border-teal-500/40 rounded p-1 text-center transition flex items-center justify-center gap-1.5 cursor-pointer truncate" data-sfx="chord" title="Drop Harmonic Chord">
                                                <span>🎹</span> Harmonic Chord
                                            </button>
                                        </div>
                                        <div class="pt-1.5 border-t border-white/10 mt-1 space-y-1">
                                            <button id="upload-custom-sfx-drop-btn" type="button" title="Upload Custom SFX Sound File (MP3, WAV, OGG, M4A)" class="w-full bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 hover:text-white border border-emerald-500/40 rounded p-1.5 text-center text-[11px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs">
                                                <span>📂</span> <span>Upload Custom SFX</span>
                                            </button>
                                            <input type="file" id="custom-sfx-drop-input" class="hidden" accept="audio/*" multiple />
                                            <div id="custom-sfx-drops-list" class="space-y-1 max-h-32 overflow-y-auto custom-scrollbar"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- ZONE 2: Center - Precision Editing & Trimming Toolstrip -->
                        <div class="flex items-center gap-1.5 shrink-0">
                            <!-- Undo / Redo -->
                            <div class="flex items-center bg-zinc-950/80 border border-white/10 rounded-lg p-0.5 shrink-0 shadow-inner">
                                <button id="timeline-action-undo" title="Undo Last Timeline Action (Ctrl+Z / Cmd+Z)" class="p-1 hover:bg-white/10 text-gray-400 hover:text-white rounded-md transition-colors text-xs flex items-center gap-1 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed" disabled>
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h10a5 5 0 0 1 5 5v2M3 10l6-6M3 10l6 6"/></svg>
                                </button>
                                <button id="timeline-action-redo" title="Redo Last Timeline Action (Ctrl+Y / Cmd+Shift+Z)" class="p-1 hover:bg-white/10 text-gray-400 hover:text-white rounded-md transition-colors text-xs flex items-center gap-1 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed" disabled>
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10H11a5 5 0 0 0-5 5v2M21 10l-6-6M21 10l-6 6"/></svg>
                                </button>
                            </div>

                            <!-- Edit Tools Strip -->
                            <div class="flex items-center bg-zinc-950/80 border border-white/10 rounded-lg p-0.5 gap-0.5 shrink-0 shadow-inner">
                                <button id="timeline-action-split" title="Split Clip at Playhead (S)" class="p-1.5 hover:bg-white/10 text-gray-300 hover:text-white rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.47 14.47L20 20M8.12 8.12L12 12M14.47 9.53L20 4M8.12 15.88L4 20M6 12C6 13.1046 5.10457 14 4 14C2.89543 14 2 13.1046 2 12C2 10.8954 2.89543 10 4 10C5.10457 10 6 10.8954 6 12ZM22 12C22 13.1046 21.1046 14 20 14C18.8954 14 18 13.1046 18 12C18 10.8954 18.8954 10 20 10C21.1046 10 22 10.8954 22 12ZM12 12L9.53 14.47M12 12L14.47 14.47M12 12L14.47 9.53M12 12L9.53 9.53"/></svg>
                                </button>
                                <button id="timeline-action-trim-start" title="Trim Start to Playhead (Q)" class="p-1.5 hover:bg-white/10 text-gray-300 hover:text-white rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/></svg>
                                </button>
                                <button id="timeline-action-trim-end" title="Trim End to Playhead (W)" class="p-1.5 hover:bg-white/10 text-gray-300 hover:text-white rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 17l5-5-5-5M6 17l5-5-5-5"/></svg>
                                </button>
                                <button id="timeline-action-ripple-delete" title="Ripple Delete Active Shot AND underlying Master Audio (Shift+Backspace)" class="p-1.5 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                                <button id="timeline-action-trim-silence" title="Auto-Trim Dead Air (Top & Tail)" class="p-1.5 hover:bg-emerald-950/60 text-zinc-400 hover:text-emerald-300 rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                                </button>
                                <button id="timeline-action-resync" title="Resync Timeline: Automatically reconcile master audio buffer & video clips" class="p-1.5 hover:bg-indigo-950/60 text-zinc-400 hover:text-indigo-300 rounded-md transition-colors text-xs cursor-pointer">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                </button>
                            </div>

                            <!-- Snap, Modes & Timeline Pan Slider -->
                            <div class="flex items-center gap-1.5 shrink-0">
                                <button id="timeline-snap-toggle" title="Toggle Magnet Snapping to Playhead, Clip Edges, and Transcript Words" class="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-amber-600/90 hover:bg-amber-500 text-white rounded-md transition-all flex items-center gap-1 cursor-pointer shrink-0 shadow-xs">
                                    <span>🧲</span>
                                    <span class="hidden xl:inline">Snap</span>
                                </button>
                                <div class="flex items-center bg-zinc-950/80 border border-white/10 rounded-md p-0.5 shrink-0 shadow-inner">
                                    <button id="timeline-mode-ripple" title="Ripple Edit Mode" class="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider bg-zinc-800 text-white rounded transition-colors cursor-pointer shrink-0">Ripple</button>
                                    <button id="timeline-mode-slip" title="Slip Edit Mode" class="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 hover:text-white rounded hover:bg-white/5 transition-colors cursor-pointer shrink-0">Slip</button>
                                </div>
                                <!-- Timeline Horizontal Pan Slider -->
                                <div class="hidden md:flex items-center gap-1.5 bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-0.5 shadow-inner shrink-0" title="Slide to pan left/right across timeline sequence">
                                    <span class="text-[9px] text-amber-400 font-bold uppercase tracking-wider shrink-0 flex items-center gap-0.5">↔ Pan</span>
                                    <input id="timeline-scroll-slider" type="range" min="0" max="100" value="0" step="0.1" class="w-16 lg:w-28 h-1.5 bg-zinc-800 accent-amber-500 rounded cursor-pointer opacity-90 hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                        </div>

                        <!-- ZONE 3: Right - View, Transcript & Zoom Controls -->
                        <div class="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-auto py-0.5">
                            <!-- Transcript Group -->
                            <div class="flex items-center bg-zinc-950/80 border border-white/10 rounded-lg p-0.5 gap-0.5 shrink-0 shadow-inner">
                                <button id="open-transcript-editor-btn" title="Open Transcript Editor" disabled class="hover:bg-zinc-800 text-gray-400 hover:text-white font-semibold text-xs px-2 py-1 rounded-md transition flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 whitespace-nowrap">
                                    <span>📝</span><span class="hidden sm:inline">Transcript</span>
                                </button>
                            </div>

                            <!-- Zoom & Guide Controls -->
                            <div class="flex items-center gap-0.5 sm:gap-1 pl-1 border-l border-white/10 shrink-0">
                                <!-- Smooth Timeline Zoom Slider -->
                                <div class="hidden sm:flex items-center gap-1 bg-zinc-950/90 border border-white/10 rounded-lg px-2 py-0.5 shadow-inner shrink-0 mr-0.5" title="Slide to adjust timeline zoom level">
                                    <span class="text-[9px] text-cyan-400 font-bold uppercase tracking-wider shrink-0">🔍 Zoom</span>
                                    <input id="timeline-zoom-slider" type="range" min="0.2" max="5.0" value="1.0" step="0.05" class="w-14 lg:w-20 h-1.5 bg-zinc-800 accent-cyan-400 rounded cursor-pointer opacity-90 hover:opacity-100 transition-opacity" />
                                </div>
                                <button id="timeline-zoom-fit-btn" title="Zoom to Fit Sequence" class="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer shrink-0">Fit</button>
                                <button id="timeline-shortcut-guide-btn" title="Keyboard Shortcuts (?)" class="p-1 hover:bg-white/10 text-gray-400 hover:text-white rounded-md transition-colors cursor-pointer shrink-0">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                                </button>
                                <button id="timeline-zoom-out-btn" title="Zoom Out (-)" class="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-gray-300 hover:text-white border border-white/10 rounded-md transition-colors cursor-pointer shrink-0">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6"/></svg>
                                </button>
                                <button id="timeline-zoom-in-btn" title="Zoom In (+)" class="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-gray-300 hover:text-white border border-white/10 rounded-md transition-colors cursor-pointer shrink-0">
                                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
                                </button>
                                <button id="close-timeline-drawer-btn" title="Close Dedicated Timeline Drawer" class="p-1 text-gray-400 hover:text-white hover:bg-red-900/40 rounded-md transition-colors ml-0.5 cursor-pointer shrink-0">✕</button>
                            </div>
                        </div>
                    </div>
                    <div id="timeline-clips-container" class="flex-grow flex w-full min-h-0 overflow-hidden p-0 bg-black/60 relative"></div>
                    <!-- Dedicated Timeline Navigation & Playhead Scrubber Bar -->
                    <div id="timeline-navigation-bar" class="w-full bg-[#0c0d14] border-t border-white/10 px-3 py-1.5 flex items-center gap-3 text-xs z-30 select-none shrink-0 shadow-lg">
                        <div class="flex items-center gap-1 shrink-0">
                            <span class="text-[9px] uppercase tracking-wider text-cyan-400/90 font-bold">Seek</span>
                            <span class="text-[10px] font-mono text-cyan-300 shrink-0 font-bold bg-zinc-900/90 border border-cyan-500/30 px-2 py-0.5 rounded shadow-xs" id="timeline-nav-current-time">0.0s</span>
                        </div>
                        <div class="flex-grow flex items-center relative group">
                            <input id="timeline-scrub-slider" type="range" min="0" max="100" value="0" step="0.01" class="w-full h-2 bg-zinc-800 accent-cyan-400 rounded-full cursor-pointer hover:bg-zinc-700 transition-all shadow-inner" title="Slide to move playhead across sequence" />
                        </div>
                        <span class="text-[10px] font-mono text-gray-400 shrink-0 font-bold bg-zinc-900/90 border border-white/10 px-2 py-0.5 rounded shadow-xs" id="timeline-nav-total-time">0.0s</span>
                    </div>
                </div>
            </div>

            

            <!-- Right: Director's Tools (Sidebar) -->
            <div class="w-80 bg-[#0f0f0f] border-l border-white/5 flex flex-col flex-shrink-0 overflow-y-auto custom-scrollbar z-10">
                <div class="p-4 overflow-x-hidden">
                    <h3 class="font-semibold text-xs text-gray-300 tracking-wide mb-3">Production Settings</h3>
                    <div class="space-y-3 text-sm">
                        <!-- Narration Card -->
                        <details id="director-accordion-narration" class="director-accordion-purple group border border-white/5 bg-zinc-900/30 rounded-lg transition-all duration-200">
                            <summary class="flex justify-between items-center font-semibold text-xs text-gray-300 tracking-wider uppercase cursor-pointer list-none select-none p-3 hover:bg-white/5 rounded-t-lg transition-colors">
                                <span class="flex items-center gap-2">🎙️ Narration</span>
                                <span class="transition group-open:rotate-180">
                                    <svg fill="none" height="14" width="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                                </span>
                            </summary>
                            <div class="p-3 pt-0 space-y-3">
                            <!-- Primary Generate Narration Audio Action -->
                            <button id="direct-video-audio-first-btn" type="button" class="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white font-bold py-2.5 px-3 rounded-xl transition-all shadow-md shadow-emerald-950/40 border border-emerald-400/30 flex items-center justify-center gap-2 cursor-pointer active:scale-98 text-xs tracking-wide uppercase" title="Generate voiceover narration from script text and synchronize video shots">
                                <span class="text-emerald-300 text-sm">🎙️</span>
                                <span>Generate Narration Audio</span>
                            </button>

                            <div class="grid grid-cols-3 gap-1 bg-zinc-950/80 rounded-lg border border-white/10 p-0.5 mb-2 shadow-inner">
                                <button id="analyze-narration-btn" class="py-1 px-1.5 text-[11px] font-medium text-indigo-300 hover:text-white hover:bg-white/5 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer truncate" title="AI Voice Recommendation">
                                    <span>🎙️ Recommend</span>
                                </button>
                                <button id="toggle-manual-voice-id-btn" class="py-1 px-1.5 text-[11px] font-medium text-zinc-300 hover:text-indigo-200 hover:bg-indigo-950/40 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer truncate" title="Add custom voice ID from ElevenLabs, Edge, Kokoro, Minimax, Vbee, etc.">
                                    <span>➕ Voice ID</span>
                                </button>
                                <button id="open-cloning-modal-btn" class="py-1 px-1.5 text-[11px] font-medium text-amber-300 hover:text-amber-200 hover:bg-amber-950/40 rounded transition-colors flex items-center justify-center gap-1 cursor-pointer truncate" title="Open AI33 Voice Studio & Voice Clone">
                                    <span>🎙️ Studio</span>
                                </button>
                            </div>

                            <!-- Dedicated Upload Audio Button in Narration Sidebar -->
                            <button id="sidebar-upload-audio-btn" type="button" class="w-full bg-gradient-to-r from-amber-950/60 to-zinc-900 hover:from-amber-900/80 hover:to-zinc-800 text-amber-300 hover:text-amber-100 border border-amber-500/40 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-98 mb-2" title="Upload pre-recorded audio or video to auto-transcribe & synchronize scenes">
                                <span class="text-amber-400">📁</span>
                                <span>Upload Audio / Voiceover Track</span>
                            </button>
                            <div id="narration-direction-container" class="mb-2 text-xs text-gray-500 italic h-auto min-h-4 transition-all duration-300 break-words overflow-hidden"></div>
                            
                            <div id="manual-voice-id-panel" class="hidden mb-3 p-3.5 bg-gradient-to-br from-indigo-950/70 via-black/80 to-black border border-indigo-500/40 rounded-2xl space-y-3 shadow-xl">
                                <div class="flex items-center justify-between">
                                    <span class="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                                        <span>🎙️</span> Add Voice ID by Provider
                                    </span>
                                    <button id="close-manual-voice-id-btn" class="text-gray-400 hover:text-white text-xs p-1 cursor-pointer">✕</button>
                                </div>

                                <!-- Provider Pills -->
                                <div>
                                    <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">1. Choose Provider</span>
                                    <div id="manual-provider-pills" class="grid grid-cols-7 gap-1 mb-2">
                                        <button type="button" title="ElevenLabs" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-indigo-600 text-white border-indigo-400 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="elevenlabs">
                                            <span class="shrink-0 text-xs">🎙️</span><span>E</span>
                                        </button>
                                        <button type="button" title="Microsoft Edge" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="edge">
                                            <span class="shrink-0 text-xs">🌐</span><span>E</span>
                                        </button>
                                        <button type="button" title="Kokoro" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="kokoro">
                                            <span class="shrink-0 text-xs">🌸</span><span>K</span>
                                        </button>
                                        <button type="button" title="Minimax" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="minimax">
                                            <span class="shrink-0 text-xs">🎭</span><span>M</span>
                                        </button>
                                        <button type="button" title="Vbee" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="vbee">
                                            <span class="shrink-0 text-xs">🇻🇳</span><span>V</span>
                                        </button>
                                        <button type="button" title="Fish Audio" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="fishaudio">
                                            <span class="shrink-0 text-xs">🐟</span><span>F</span>
                                        </button>
                                        <button type="button" title="Cloned Voice" class="provider-pill-item px-1 py-1.5 rounded-lg text-xs font-bold text-center justify-center transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-0.5 overflow-hidden" data-provider="clone">
                                            <span class="shrink-0 text-xs">👤</span><span>C</span>
                                        </button>
                                    </div>
                                    <select id="manual-voice-provider-select" class="w-full bg-gray-950 border border-indigo-700/50 rounded-lg p-1.5 text-xs text-white focus:outline-none">
                                        <option value="edge" selected>🌐 Microsoft Edge (edge_ · Free)</option>
                                        <option value="kokoro">🌸 Kokoro (kokoro_ · Free)</option>
                                        <option value="elevenlabs">🎙️ ElevenLabs (elevenlabs_)</option>
                                        <option value="minimax">🎭 Minimax (minimax_)</option>
                                        <option value="vbee">🇻🇳 Vbee (vbee_)</option>
                                        <option value="fishaudio">🐟 Fish Audio (fishaudio_)</option>
                                        <option value="clone">👤 Cloned Voice (clone_)</option>
                                    </select>
                                </div>

                                <!-- Voice ID Input -->
                                <div class="space-y-2">
                                    <div>
                                        <label for="manual-voice-id-input" class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">2. Paste Voice ID</label>
                                        <input type="text" id="manual-voice-id-input" class="w-full bg-black border border-indigo-700/60 rounded-lg p-2 text-xs text-white font-mono placeholder:text-gray-600 focus:ring-1 focus:ring-indigo-400 focus:outline-none" placeholder="e.g. edge_en-US-AvaNeural or en-US-BrianNeural">
                                        <div id="manual-voice-id-preview" class="text-[10px] text-indigo-300/90 font-mono mt-1 truncate">
                                            Unified ID: <span class="text-indigo-200 font-bold" id="manual-voice-preview-text">edge_...</span> <span class="text-gray-500 text-[9px]">(Zero API key needed)</span>
                                        </div>
                                    </div>
                                    <div>
                                        <label for="manual-voice-name-input" class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">3. Custom Display Name (Optional)</label>
                                        <input type="text" id="manual-voice-name-input" class="w-full bg-black border border-white/15 rounded-lg p-2 text-xs text-white placeholder:text-gray-600 focus:ring-1 focus:ring-indigo-400 focus:outline-none" placeholder="e.g. Hero Narrator">
                                    </div>
                                </div>

                                <button id="add-manual-voice-id-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl text-xs uppercase tracking-wider transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                                    <span>💾</span> <span>Save & Select Voice</span>
                                </button>
                            </div>

                            <div class="mb-3">
                                <label for="narration-custom-instructions" class="text-xs text-gray-500 uppercase font-bold mb-1 block">Tone / Style Instructions</label>
                                <textarea id="narration-custom-instructions" rows="2" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-gray-300 focus:ring-1 focus:ring-purple-500 focus:outline-none transition resize-none" placeholder="e.g., 'Fast and intense'"></textarea>
                            </div>
                            <div class="flex gap-1 mb-2 min-w-0">
                                <select id="narration-voice-select" class="flex-grow min-w-0 bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white overflow-hidden text-ellipsis">
                                        <option value="__ADD_CUSTOM_VOICE__" class="font-bold text-indigo-400 bg-indigo-950/90">➕ [Choose Provider & Add Voice ID...]</option>
                                        <optgroup label="🆓 Microsoft Edge Neural (Free & No API Key)" id="edge-default-voices-group">
                                            <option value="edge_en-US-AvaNeural" data-provider="edge" selected>⭐ Edge - Ava (Female - Expressive & Natural)</option>
                                            <option value="edge_en-US-BrianNeural" data-provider="edge">⭐ Edge - Brian (Male - Conversational & Clear)</option>
                                            <option value="edge_en-NG-AbeoNeural" data-provider="edge">🇳🇬 Edge - Abeo (Nigeria Male · Natural)</option>
                                            <option value="edge_en-NG-EzinneNeural" data-provider="edge">🇳🇬 Edge - Ezinne (Nigeria Female · Warm)</option>
                                            <option value="edge_en-US-AriaNeural" data-provider="edge">Edge - Aria (Female - Warm Storyteller)</option>
                                            <option value="edge_en-US-GuyNeural" data-provider="edge">Edge - Guy (Male - Casual Everyday)</option>
                                            <option value="edge_en-US-JennyNeural" data-provider="edge">Edge - Jenny (Female - Helpful & Smooth)</option>
                                            <option value="edge_en-GB-SoniaNeural" data-provider="edge">Edge - Sonia (British Female - Polished)</option>
                                            <option value="edge_en-GB-RyanNeural" data-provider="edge">Edge - Ryan (British Male - Documentary)</option>
                                        </optgroup>
                                        <optgroup label="🌸 Kokoro 82M Personas (Free & Instant)" id="kokoro-default-voices-group">
                                            <option value="kokoro_af_heart" data-provider="kokoro">Kokoro - Heart (US Female - Ultra-Expressive)</option>
                                            <option value="kokoro_af_bella" data-provider="kokoro">Kokoro - Bella (US Female - Friendly)</option>
                                            <option value="kokoro_am_adam" data-provider="kokoro">Kokoro - Adam (US Male - Deep Resonant)</option>
                                        </optgroup>
                                        <optgroup label="⭐ Custom & Pinned" id="manual-voices-group">
                                            <option value="s3TPKV1kjDlVtZbl4Ksh" data-provider="elevenlabs">⭐ Adam (Narrator)</option>
                                            <option value="IRHApOXLvnW57QJPQH2P" data-provider="elevenlabs">⭐ Adam Tough (Documentary)</option>
                                            <option value="hbB2qXyS2GMyyZIZyhAH" data-provider="elevenlabs">⭐ Bella (Soft Female)</option>
                                            <option value="ZT9u07TYPVl83ejeLakq" data-provider="elevenlabs">⭐ Rachel (Professional)</option>
                                            <option value="iiidtqDt9FBdT1vfBluA" data-provider="elevenlabs">⭐ Bill (Documentary)</option>
                                        </optgroup>
                                        <optgroup label="⚡ The Power Tier (Authoritative & Deep)">
                                        <option value="Charon" data-provider="gemini">Charon (Male) - Forensic Auditor</option>
                                        <option value="Enceladus" data-provider="gemini">Enceladus (Male) - Commanding</option>
                                        <option value="Schedar" data-provider="gemini">Schedar (Female) - Corporate Exec</option>
                                        <option value="Fenrir" data-provider="gemini">Fenrir (Male) - Cinematic Rough</option>
                                        <option value="Rasalgethi" data-provider="gemini">Rasalgethi (Male) - Voice of God</option>
                                        <option value="Umbriel" data-provider="gemini">Umbriel (Male) - Dark & Mysterious</option>
                                    </optgroup>
                                    <optgroup label="🔍 The Analytical Tier (Professional)">
                                        <option value="Achernar" data-provider="gemini">Achernar (Female) - Intelligence Officer</option>
                                        <option value="Leda" data-provider="gemini">Leda (Female) - Corporate Standard</option>
                                        <option value="Algieba" data-provider="gemini">Algieba (Male) - Precise Technical</option>
                                        <option value="Vindemiatrix" data-provider="gemini">Vindemiatrix (Female) - Clear E-Learning</option>
                                        <option value="Zubenelgenubi" data-provider="gemini">Zubenelgenubi (Male) - Consultant</option>
                                        <option value="Orus" data-provider="gemini">Orus (Male) - Instructional</option>
                                        <option value="Algenib" data-provider="gemini">Algenib (Male) - Reliable Everyman</option>
                                        <option value="Achird" data-provider="gemini">Achird (Male) - Casual & Friendly</option>
                                        <option value="Sulafat" data-provider="gemini">Sulafat (Female) - Natural Conversation</option>
                                    </optgroup>
                                    <optgroup label="📖 The Narrative Tier (Storytelling)">
                                        <option value="Zephyr" data-provider="gemini">Zephyr (Female) - Resonant Storyteller</option>
                                        <option value="Aoede" data-provider="gemini">Aoede (Female) - Melodic Narrator</option>
                                        <option value="Iapetus" data-provider="gemini">Iapetus (Male) - Timeless Classic</option>
                                        <option value="Laomedeia" data-provider="gemini">Laomedeia (Female) - Rhythmic Non-Fiction</option>
                                        <option value="Alnilam" data-provider="gemini">Alnilam (Male) - Grand Cinematic</option>
                                        <option value="Pulcherrima" data-provider="gemini">Pulcherrima (Female) - Sophisticated Brand</option>
                                        <option value="Sadaltager" data-provider="gemini">Sadaltager (Male) - Bold Adventurous</option>
                                    </optgroup>
                                    <optgroup label="🤍 The Empathy Tier (Gentle)">
                                        <option value="Kore" data-provider="gemini">Kore (Female) - Calm & Empathetic</option>
                                        <option value="Callirrhoe" data-provider="gemini">Callirrhoe (Female) - Airy & Soothing</option>
                                        <option value="Erinome" data-provider="gemini">Erinome (Female) - Nurturing & Kind</option>
                                        <option value="Gacrux" data-provider="gemini">Gacrux (Male) - Thoughtful & Quiet</option>
                                        <option value="Sadachbia" data-provider="gemini">Sadachbia (Female) - Soft-spoken & Shy</option>
                                    </optgroup>
                                    <optgroup label="🔥 The Energy Tier (Energetic)">
                                        <option value="Puck" data-provider="gemini">Puck (Male) - Upbeat Youthful</option>
                                        <option value="Autonoe" data-provider="gemini">Autonoe (Female) - Bright Retail</option>
                                    </optgroup>
                                    <optgroup id="gradio-voice-group" label="🎙️ Gradio TTS">
                                        <option value="gradio_design" data-provider="gradio_design">Custom: Voice Design</option>
                                        <option value="gradio_clone" data-provider="gradio_clone">Custom: Voice Clone</option>
                                    </optgroup>
                                </select>
                                <button id="remove-custom-voice-btn" class="hidden flex-shrink-0 bg-red-600/80 hover:bg-red-600 text-white p-1.5 rounded transition shadow-sm cursor-pointer" title="Remove Custom Voice">🗑️</button>
                            </div>
                            <div id="narration-controls-container" class="space-y-2 pt-2 border-t border-gray-700/50">
                                <div data-slider-container="speed">
                                    <div class="flex items-center justify-between">
                                        <label for="narration-speed-slider" class="text-xs text-gray-500">Speed</label>
                                        <span id="narration-speed-value" class="text-xs text-gray-300">1.00x</span>
                                    </div>
                                    <input type="range" id="narration-speed-slider" min="0.5" max="2.0" step="0.01" value="1.0" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                </div>
                                <div data-slider-container="pitch">
                                    <div class="flex items-center justify-between">
                                        <label for="narration-pitch-slider" class="text-xs text-gray-500">Pitch Shift</label>
                                        <span id="narration-pitch-value" class="text-xs text-gray-300">0.0</span>
                                    </div>
                                    <input type="range" id="narration-pitch-slider" min="-20" max="20" step="1" value="0" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                </div>
                                <div data-slider-container="stability">
                                    <div class="flex items-center justify-between">
                                        <label for="narration-stability-slider" class="text-xs text-gray-500">Stability</label>
                                        <span id="narration-stability-value" class="text-xs text-gray-300">0.50</span>
                                    </div>
                                    <input type="range" id="narration-stability-slider" min="0" max="1" step="0.01" value="0.5" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                </div>
                                <div data-slider-container="similarity">
                                    <div class="flex items-center justify-between">
                                        <label for="narration-similarity-slider" class="text-xs text-gray-500">Similarity Boost</label>
                                        <span id="narration-similarity-value" class="text-xs text-gray-300">0.75</span>
                                    </div>
                                    <input type="range" id="narration-similarity-slider" min="0" max="1" step="0.01" value="0.75" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                </div>
                                <div data-slider-container="style">
                                    <div class="flex items-center justify-between">
                                        <label for="narration-style-slider" class="text-xs text-gray-500">Style Exaggeration</label>
                                        <span id="narration-style-value" class="text-xs text-gray-300">0.00</span>
                                    </div>
                                    <input type="range" id="narration-style-slider" min="0" max="1" step="0.01" value="0.0" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                </div>
                            </div>
                            <div id="gradio-tts-controls-container" class="hidden space-y-2 pt-2 border-t border-gray-700/50">
                                <!-- Preset Voice Controls -->
                                <div id="gradio-preset-controls" class="hidden space-y-2">
                                    <label for="gradio-style-instruction" class="text-xs text-gray-500">Style Instruction (Optional)</label>
                                    <textarea id="gradio-style-instruction" rows="2" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white focus:ring-1 focus:ring-yellow-500 focus:outline-none transition resize-none" placeholder="e.g., 'A happy, upbeat delivery'"></textarea>
                                </div>
                            
                                <!-- Voice Design Controls -->
                                <div id="gradio-design-controls" class="hidden space-y-2">
                                    <label for="gradio-voice-archetype-select" class="text-xs text-gray-500">Voice Archetype (Preset)</label>
                                    <select id="gradio-voice-archetype-select" class="w-full bg-gray-900 border border-gray-700 rounded p-1.5 text-xs text-white"></select>
                                    <label for="gradio-voice-description" class="text-xs text-gray-500">Voice Description</label>
                                    <textarea id="gradio-voice-description" rows="3" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white focus:ring-1 focus:ring-yellow-500 focus:outline-none transition resize-y" placeholder="Describe the voice you want..."></textarea>
                                </div>
                            
                                <!-- Voice Clone Controls -->
                                <div id="gradio-clone-controls" class="hidden space-y-3">
                                    <div>
                                        <label for="gradio-reference-audio" class="text-xs text-gray-500 block mb-1">Reference Audio (3+ sec)</label>
                                        <input type="file" id="gradio-reference-audio" class="w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-gray-700 file:text-gray-300 hover:file:bg-gray-600">
                                    </div>
                                    <div>
                                        <label for="gradio-reference-transcript" class="text-xs text-gray-500">Transcript (Optional - improves quality)</label>
                                        <input type="text" id="gradio-reference-transcript" class="w-full bg-gray-950 border border-gray-700 rounded p-1.5 text-xs text-white focus:ring-1 focus:ring-yellow-500 focus:outline-none" placeholder="What is said in the audio?">
                                    </div>
                                    <label class="flex items-center gap-2 cursor-pointer pt-1">
                                        <input type="checkbox" id="gradio-fast-mode" class="rounded bg-gray-700 border-gray-600 text-yellow-600 focus:ring-yellow-500" checked>
                                        <span class="text-xs text-gray-400">Fast Mode (skips transcript)</span>
                                    </label>
                                </div>
                            </div>
                            <button id="b-roll-open-btn" class="w-full mt-3 border border-white/5 bg-zinc-900/50 hover:bg-zinc-800 text-gray-300 py-2 rounded text-xs font-medium transition-colors hidden" title="Adjust your B-Roll mappings">Edit B-Roll Mapping</button>
                        </div>

                        </div></details>
                        
                        <details id="director-accordion-subtitles" class="director-accordion-indigo group border border-white/5 bg-zinc-900/30 rounded-lg transition-all duration-200">
                            <summary class="flex justify-between items-center font-semibold text-xs text-gray-300 tracking-wider uppercase cursor-pointer list-none select-none p-3 hover:bg-white/5 rounded-t-lg transition-colors">
                                <span class="flex items-center gap-2">📝 Captions & Subtitles</span>
                                <span class="transition group-open:rotate-180">
                                    <svg fill="none" height="14" width="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                                </span>
                            </summary>
                            <div class="p-3 pt-0 space-y-3">
                            <div class="space-y-2.5">
                                <div class="flex items-center justify-between gap-2">
                                    <label class="flex items-center gap-1.5 cursor-pointer select-none">
                                        <input type="checkbox" id="video-subtitles-checkbox" class="rounded bg-zinc-800 border-white/10 text-indigo-500 focus:ring-0 cursor-pointer">
                                        <span class="text-xs font-semibold text-gray-300">Subtitles</span>
                                    </label>
                                    <button id="lyrics-video-preset-btn" class="bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white text-[10px] font-bold px-2.5 py-1 rounded cursor-pointer shadow-lg shadow-pink-500/20 transition-all flex items-center gap-1 shrink-0" title="Apply Lyrics Video Preset (Karaoke style, full-screen base)">
                                        <span>🎵</span> Lyrics Preset
                                    </button>
                                </div>

                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <label for="video-subtitle-style-select" class="block text-[10px] uppercase font-mono text-gray-400 mb-1">Style</label>
                                        <select id="video-subtitle-style-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer disabled:opacity-50" disabled title="Subtitle Style">
                                            <option value="kinetic_gold" selected>Kinetic Gold (Doc Highlight)</option>
                                            <option value="anime">Anime</option>
                                            <option value="karaoke">Karaoke</option>
                                            <option value="hormozi">Hormozi Pop</option>
                                            <option value="mrbeast">MrBeast Comic</option>
                                            <option value="tiktok">TikTok</option>
                                            <option value="yellow_box">Yellow Box</option>
                                            <option value="cinematic">Cinematic</option>
                                            <option value="minimal_editorial">Editorial</option>
                                            <option value="neon">Neon Glow</option>
                                            <option value="terminal">Cyber Terminal</option>
                                            <option value="typewriter">Typewriter</option>
                                            <option value="bilingual">Split Bilingual</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="video-subtitle-position-select" class="block text-[10px] uppercase font-mono text-gray-400 mb-1">Position</label>
                                        <select id="video-subtitle-position-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer disabled:opacity-50" disabled title="Subtitle Position">
                                            <option value="bottom" selected>Bottom</option>
                                            <option value="center">Center</option>
                                            <option value="top">Top</option>
                                        </select>
                                    </div>
                                </div>

                                <div class="space-y-1.5">
                                    <div class="flex items-center justify-between">
                                        <label for="video-subtitle-font-select" class="block text-[10px] uppercase font-mono text-gray-400">Typography Font</label>
                                        <span id="custom-font-count-badge" class="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono hidden">Custom</span>
                                    </div>
                                    <div class="flex items-center gap-1.5">
                                        <select id="video-subtitle-font-select" class="flex-1 min-w-0 bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer disabled:opacity-50" disabled title="Subtitle Typography Font">
                                            <optgroup label="Popular Creator Fonts" id="subtitle-font-group-curated">
                                                <option value="Montserrat" selected>Montserrat (Modern Punch)</option>
                                                <option value="Anton">Anton (Bold Viral Headline)</option>
                                                <option value="Bebas Neue">Bebas Neue (High-Impact Condensed)</option>
                                                <option value="Bangers">Bangers (Comic / MrBeast Style)</option>
                                                <option value="Plus Jakarta Sans">Plus Jakarta Sans (Crisp Tech)</option>
                                                <option value="Syne">Syne (Geometric Futuristic)</option>
                                                <option value="Cinzel">Cinzel (Cinematic Epic Roman)</option>
                                                <option value="Oswald">Oswald (Classic Narrow Display)</option>
                                                <option value="JetBrains Mono">JetBrains Mono (Developer / Code)</option>
                                                <option value="Playfair Display">Playfair Display (Editorial Serif)</option>
                                                <option value="Inter">Inter (Clean Neutral UI)</option>
                                            </optgroup>
                                            <optgroup label="Uploaded Custom Fonts" id="subtitle-font-group-custom" class="hidden">
                                            </optgroup>
                                        </select>
                                        <input type="file" id="custom-font-file-input" accept=".ttf,.otf,.woff,.woff2" class="hidden">
                                        <button type="button" id="upload-subtitle-font-btn" class="bg-zinc-800 hover:bg-zinc-700 active:scale-95 border border-white/10 text-gray-200 hover:text-white text-xs px-2.5 py-1.5 rounded transition-all flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" disabled title="Upload custom font (.ttf, .otf, .woff, .woff2)">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                                            <span>Upload</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div id="video-subtitle-colors-container"></div>
                            
                            <div id="video-subtitle-sync-panel" class="mt-2.5 pt-2.5 border-t border-white/5 space-y-2">
                                <div class="flex items-center justify-between">
                                    <div class="flex items-center gap-1.5 min-w-0">
                                        <span id="subtitle-timestamps-icon" class="text-xs shrink-0">⏱️</span>
                                        <span id="subtitle-timestamps-label" class="text-[11px] text-gray-400 truncate">Timestamps: Linear Fallback</span>
                                    </div>
                                    <span id="subtitle-timestamps-badge" class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400 border border-white/10 font-mono shrink-0">No Sync</span>
                                </div>
                                <div class="space-y-1.5">
                                    <select id="subtitle-align-engine-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-[11px] text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Select timestamp transcription engine">
                                        <option value="auto" selected>⚡ Auto (Deepgram → Whisper → Gemini)</option>
                                        <option value="deepgram">🎙️ Deepgram Nova-3</option>
                                        <option value="whisper">🧠 Whisper Server</option>
                                        <option value="gemini">✨ Gemini AI Align</option>
                                    </select>
                                    <div class="grid grid-cols-2 gap-1.5">
                                        <button id="timeline-transcribe-btn" title="Mix down the timeline audio and transcribe to sync timestamps" class="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] px-2 py-1.5 rounded transition flex items-center justify-center gap-1 cursor-pointer shadow-xs truncate">
                                            <span>🎙️ Transcribe Audio</span>
                                        </button>
                                        <button id="sync-subtitles-timestamps-btn" class="bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 border border-indigo-500/30 text-[11px] font-medium px-2 py-1.5 rounded transition flex items-center justify-center gap-1 cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed truncate" title="Generate accurate word timestamps from audio via Deepgram or Whisper">
                                            <span>⚡ Get Timestamps</span>
                                        </button>
                                        <button id="upload-sync-srt-btn" class="col-span-2 bg-zinc-800 hover:bg-zinc-700 active:scale-95 border border-white/10 text-gray-200 hover:text-white text-[11px] font-medium px-2 py-1.5 rounded transition flex items-center justify-center gap-1 shrink-0 cursor-pointer" title="Upload SRT to sync subtitles and align shots">
                                            <span>📄 Upload SRT Captions</span>
                                        </button>
                                        <input type="file" id="srt-upload-input" accept=".srt" class="hidden" />
                                    </div>
                                </div>
                                <div id="subtitle-sync-progress-box" class="hidden flex items-center gap-2 pt-0.5">
                                    <div class="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                        <div id="subtitle-sync-progress-bar" class="bg-indigo-500 h-1.5 rounded-full transition-all duration-150" style="width: 0%"></div>
                                    </div>
                                    <span id="subtitle-sync-progress-text" class="text-[10px] text-indigo-400 font-mono shrink-0">0%</span>
                                </div>
                            </div>
                            
                        </details>
                        
                        <details id="director-accordion-music" class="director-accordion-fuchsia group border border-white/5 bg-zinc-900/30 rounded-lg transition-all duration-200">
                            <summary class="flex justify-between items-center font-semibold text-xs text-gray-300 tracking-wider uppercase cursor-pointer list-none select-none p-3 hover:bg-white/5 rounded-t-lg transition-colors">
                                <span class="flex items-center gap-2">🎵 Background Music & Audio Cues</span>
                                <span class="transition group-open:rotate-180">
                                    <svg fill="none" height="14" width="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                                </span>
                            </summary>
                            <div class="p-3 pt-0 space-y-3">
                            
                            <div class="space-y-2">
                                <label for="bg-audio-prompt-input" class="text-[11px] text-gray-400 font-medium block">AI Music / Ambient Generation</label>
                                <div class="flex gap-2">
                                    <input type="text" id="bg-audio-prompt-input" placeholder="e.g. cinematic synthwave ambient drone" class="flex-1 min-w-0 bg-zinc-800 border border-white/10 rounded px-2.5 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500">
                                    <button id="generate-bg-audio-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1 rounded transition-colors flex items-center justify-center gap-1 shrink-0">
                                        <span>✨</span> Generate
                                    </button>
                                </div>
                            </div>

                            <input type="file" id="bg-audio-file-input" accept="audio/*" class="hidden" />
                            <div class="flex items-center gap-2">
                                <button id="upload-bg-audio-btn" class="flex-grow bg-zinc-800 hover:bg-zinc-700 text-gray-200 hover:text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors border border-white/10 cursor-pointer shadow-xs">Upload Audio</button>
                                <button id="clear-bg-audio-btn" class="hidden bg-rose-950/50 hover:bg-rose-900/70 text-rose-300 py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors border border-rose-500/30 shrink-0 cursor-pointer shadow-xs">Remove</button>
                            </div>
                            <div id="bg-audio-status" class="text-xs text-gray-400 break-words mt-1"></div>
                            
                            <div class="mt-1">
                                <div class="flex items-center justify-between mb-1">
                                    <label for="bg-audio-volume-slider" class="text-xs text-gray-500">Music Volume</label>
                                    <span id="bg-audio-volume-label" class="text-xs text-gray-300">30%</span>
                                </div>
                                <input type="range" id="bg-audio-volume-slider" min="0" max="1" step="0.01" value="0.3" class="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                                <div class="space-y-2 mt-3 pt-2 border-t border-white/5">
                                    <label class="flex items-start gap-2 cursor-pointer">
                                        <input type="checkbox" id="enable-audio-ducking-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0" checked>
                                        <span class="text-[11px] leading-tight text-gray-300">Auto Audio-Ducking (Ducks BGM during speech)</span>
                                    </label>
                                    <label class="flex items-start gap-2 cursor-pointer">
                                        <input type="checkbox" id="enable-audio-normalize-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0" checked>
                                        <span class="text-[11px] leading-tight text-gray-300">Auto-Normalize & Peak Limiter (Prevents Distortion)</span>
                                    </label>
                                </div>
                            </div>

                            <!-- Dedicated Sound Effects & Timeline Cues Dropdown Sub-Panel -->
                            <details id="director-sfx-cues-dropdown" class="group/sfx border border-amber-500/30 bg-zinc-950/70 rounded-lg overflow-hidden transition-all duration-200 mt-2" open>
                                <summary class="flex justify-between items-center p-2.5 bg-amber-950/20 hover:bg-amber-950/40 cursor-pointer list-none select-none transition-colors border-b border-amber-500/20">
                                    <div class="flex items-center gap-1.5">
                                        <span class="text-xs">🔊</span>
                                        <span class="text-[11px] font-bold text-amber-300 uppercase tracking-wider">Sound Effects & Timeline Cues</span>
                                    </div>
                                    <div class="flex items-center gap-1.5">
                                        <span class="text-[9px] bg-amber-500/20 border border-amber-500/40 text-amber-300 px-1.5 py-0.2 rounded font-mono font-semibold">11 SFX</span>
                                        <span class="text-amber-400/80 transition-transform duration-200 group-open/sfx:rotate-180">
                                            <svg fill="none" height="12" width="12" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                                        </span>
                                    </div>
                                </summary>
                                <div class="p-2.5 space-y-3 bg-black/30">
                                    <!-- 11 Standalone Sound Effects Quick Drop Buttons -->
                                    <div>
                                        <div class="flex items-center justify-between mb-1.5">
                                            <span class="text-[10px] uppercase font-mono text-gray-400 font-semibold">Instant SFX Drops (Playhead)</span>
                                            <span class="text-[9px] text-amber-400/70 font-mono">Click to preview & drop</span>
                                        </div>
                                        <div class="grid grid-cols-3 gap-1.5 text-[11px]">
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-amber-950/80 text-gray-200 hover:text-amber-300 border border-white/10 hover:border-amber-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="whoosh" title="Drop Kinetic Whoosh at Playhead">
                                                <span>💨</span> Whoosh
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-rose-950/80 text-gray-200 hover:text-rose-300 border border-white/10 hover:border-rose-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="hit" title="Drop Punchy Hit at Playhead">
                                                <span>🔨</span> Hit
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-emerald-950/80 text-gray-200 hover:text-emerald-300 border border-white/10 hover:border-emerald-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="ping" title="Drop Crystal Ping at Playhead">
                                                <span>🔔</span> Ping
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-sky-950/80 text-gray-200 hover:text-sky-300 border border-white/10 hover:border-sky-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="pop" title="Drop UI Pop at Playhead">
                                                <span>🫧</span> Pop
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-yellow-950/80 text-gray-200 hover:text-yellow-300 border border-white/10 hover:border-yellow-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="laser" title="Drop Laser Zap at Playhead">
                                                <span>⚡</span> Laser
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-purple-950/80 text-gray-200 hover:text-purple-300 border border-white/10 hover:border-purple-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="riser" title="Drop Tension Riser at Playhead">
                                                <span>📈</span> Riser
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-cyan-950/80 text-gray-200 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="glitch" title="Drop Cyber Glitch at Playhead">
                                                <span>👾</span> Glitch
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-indigo-950/80 text-gray-200 hover:text-indigo-300 border border-white/10 hover:border-indigo-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="bass_drop" title="Drop Sub Bass Drop at Playhead">
                                                <span>🔊</span> Bass Drop
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-amber-950/80 text-gray-200 hover:text-amber-300 border border-white/10 hover:border-amber-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="cyber_chime" title="Drop Cyber Chime at Playhead">
                                                <span>✨</span> Chime
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-red-950/80 text-gray-200 hover:text-red-300 border border-white/10 hover:border-red-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="impact" title="Drop Heavy Impact at Playhead">
                                                <span>💥</span> Impact
                                            </button>
                                            <button type="button" class="quick-sfx-drop-btn bg-zinc-800/90 hover:bg-teal-950/80 text-gray-200 hover:text-teal-300 border border-white/10 hover:border-teal-500/50 rounded-md py-1.5 px-1 text-center transition flex items-center justify-center gap-1 cursor-pointer truncate shadow-xs font-medium" data-sfx="chord" title="Drop Harmonic Chord at Playhead">
                                                <span>🎹</span> Chord
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Timeline Cues Actions -->
                                    <div class="pt-2 border-t border-white/5 space-y-1.5">
                                        <div class="flex items-center justify-between">
                                            <span class="text-[10px] uppercase font-mono text-gray-400 font-semibold block">Timeline Cues & Sync Tools</span>
                                            <button type="button" id="vd-clear-sfx-cues-btn" class="text-[10px] text-gray-500 hover:text-rose-400 transition-colors cursor-pointer" title="Remove all sound effect cues from timeline">Clear SFX</button>
                                        </div>
                                        <div class="grid grid-cols-3 gap-1.5">
                                            <button type="button" id="vd-auto-pip-cues-btn" class="bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-indigo-100 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border border-indigo-500/30 flex items-center justify-center gap-1 cursor-pointer shadow-xs text-center truncate" title="Analyze transcript for keyword moments and auto-place Pop-Up B-Roll cues">
                                                <span>🪟</span> Auto PiP
                                            </button>
                                            <button type="button" id="vd-visual-sync-cues-btn" class="bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1 cursor-pointer shadow-xs text-center truncate" title="Align visual shot boundaries with speech & musical beat cues">
                                                <span>🔄</span> Beat Sync
                                            </button>
                                            <button type="button" id="vd-add-marker-cue-btn" class="bg-zinc-800/90 hover:bg-zinc-700 text-amber-300 hover:text-amber-100 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1 cursor-pointer shadow-xs text-center truncate" title="Drop a visual & sound cue marker on timeline at playhead">
                                                <span>📍</span> Marker
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </details>
                        </div>
                    </details>
                        
                        <details id="director-accordion-cinema" class="director-accordion-amber group border border-white/5 bg-zinc-900/30 rounded-lg transition-all duration-200">
                            <summary class="flex justify-between items-center font-semibold text-xs text-gray-300 tracking-wider uppercase cursor-pointer list-none select-none p-3 hover:bg-white/5 rounded-t-lg transition-colors">
                                <span class="flex items-center gap-2">🎥 Cinematography</span>
                                <span class="transition group-open:rotate-180">
                                    <svg fill="none" height="14" width="14" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"></path></svg>
                                </span>
                            </summary>
                            <div class="p-3 pt-0 space-y-4">
                            <!-- Directing Style Presets -->
                            <div>
                                <div class="flex items-center justify-between mb-1">
                                    <label for="cinematography-style-preset-select" class="text-[10px] uppercase font-mono text-gray-400 font-medium">Directing Preset</label>
                                    <span class="text-[9px] text-indigo-400 font-mono">Style & Pacing</span>
                                </div>
                                <select id="cinematography-style-preset-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Directing Style Preset">
                                    <option value="balanced" selected>🎬 Balanced Narrative</option>
                                    <option value="documentary">📽️ Documentary / Prestige</option>
                                    <option value="trailer">⚡ High-Octane / Action Trailer</option>
                                    <option value="viral">📱 Social / Fast-Paced Viral</option>
                                    <option value="noir">🌑 Noir / Moody Cinematic</option>
                                </select>
                            </div>

                            <div class="grid grid-cols-2 gap-1.5">
                                <button id="magic-camera-btn" class="bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate" title="Auto-Direct Camera Movements">
                                    <span>🤖 Magic Camera</span>
                                </button>
                                <button id="cinematography-cam-btn" class="bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 hover:text-amber-100 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-amber-500/30 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate" title="Custom Camera Keyframes (Ctrl+Shift+K)">
                                    <span>📹 Keyframes</span>
                                </button>
                                <div class="flex items-center gap-1">
                                    <button id="auto-pip-cues-btn" class="flex-grow bg-indigo-950/60 hover:bg-indigo-900/80 text-indigo-300 hover:text-indigo-100 px-2 py-2 rounded-lg text-xs font-semibold transition-colors border border-indigo-500/30 flex items-center justify-center gap-1 cursor-pointer shadow-xs text-center truncate" title="Auto-detect keywords and convert relevant B-Roll shots into Pop-Up PiP callouts over A-Roll">
                                        <span>🪟 Auto PiP</span>
                                    </button>
                                    <button id="sidebar-clear-pip-btn" type="button" class="bg-zinc-800/90 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 hover:border-rose-500/30 border border-white/10 px-2 py-2 rounded-lg text-xs transition-colors flex items-center justify-center cursor-pointer shadow-xs" title="Clear all Pop-Up PiP callouts across timeline">
                                        <span>🚫</span>
                                    </button>
                                </div>
                                <button id="manual-visual-sync-btn" class="bg-zinc-800/90 hover:bg-zinc-700 text-indigo-300 hover:text-white px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs text-center truncate" title="Manual Visual Sync between clips and speech">
                                    <span>🔄 Visual Sync</span>
                                </button>
                            </div>

                            <!-- Camera Motion & Optical Dynamics -->
                            <div class="space-y-2 pt-2 border-t border-white/5">
                                <div class="flex items-center justify-between mb-1">
                                    <span class="text-[10px] text-gray-400 uppercase font-mono font-medium block">Camera & Lens</span>
                                    <div class="flex items-center gap-1.5">
                                        <span class="text-[9px] text-gray-500 font-mono">Motion:</span>
                                        <select id="camera-motion-intensity-select" class="bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Camera Motion Intensity">
                                            <option value="0.5">Subtle (0.5x)</option>
                                            <option value="1.0" selected>Standard (1.0x)</option>
                                            <option value="1.5">Dynamic (1.5x)</option>
                                            <option value="2.0">Dramatic (2.0x)</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="space-y-2 bg-zinc-950/40 p-2.5 rounded-lg border border-white/5">
                                    <label class="flex items-start gap-2 cursor-pointer" title="When enabled, still images will be rendered with a 2.5D WebGL depth effect that creates a parallax simulation during camera movements. If disabled, a standard 2D Ken Burns transform will be used instead.">
                                        <input type="checkbox" id="enable-parallax-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0" checked>
                                        <div class="flex-1">
                                            <span class="text-[11px] leading-tight text-gray-300 font-medium block">2.5D Parallax Depth Effect</span>
                                            <span class="text-[9px] text-gray-500 leading-tight block">Multi-plane camera motion & depth cues</span>
                                        </div>
                                    </label>

                                    <!-- Parallax Pipeline Sub-settings -->
                                    <div id="parallax-suboptions-panel" class="pl-5 space-y-2 border-l border-indigo-500/20 ml-1.5 my-1">
                                        <div class="flex items-center justify-between gap-1.5">
                                            <label for="parallax-mode-select" class="text-[10px] text-gray-400 font-mono">Depth Pipeline:</label>
                                            <select id="parallax-mode-select" class="bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Parallax Depth Architecture">
                                                <option value="multi_layer" selected>🌌 3-Layer Multi-Plane</option>
                                                <option value="single_plate">🖼️ Single-Plate Warp</option>
                                            </select>
                                        </div>
                                        <div class="flex items-center justify-between gap-2">
                                            <label class="flex items-center gap-1.5 cursor-pointer" title="Adds subtle floating 3D atmospheric dust motes with depth-dependent scale, velocity, and optical light sparkle.">
                                                <input type="checkbox" id="enable-parallax-dust-checkbox" class="w-3 h-3 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 shrink-0" checked>
                                                <span class="text-[10px] text-gray-300">✨ 3D Atmospheric Dust</span>
                                            </label>
                                            <label class="flex items-center gap-1.5 cursor-pointer" title="Applies soft depth-of-field blur and subtle atmospheric distance haze on background planes.">
                                                <input type="checkbox" id="enable-parallax-dof-checkbox" class="w-3 h-3 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 shrink-0" checked>
                                                <span class="text-[10px] text-gray-300">🔍 Depth Blur & Haze</span>
                                            </label>
                                        </div>
                                        <!-- Advanced Sliders & Depth Tuning -->
                                        <details id="parallax-advanced-details" class="group/adv mt-1 border-t border-white/5 pt-1.5">
                                            <summary class="cursor-pointer text-[10px] font-mono text-indigo-400 hover:text-indigo-300 flex items-center justify-between select-none py-0.5 list-none">
                                                <span class="flex items-center gap-1.5 font-medium">
                                                    <span>⚙️</span>
                                                    <span>Advanced Tuning</span>
                                                </span>
                                                <span class="text-[9px] text-gray-500 group-open/adv:rotate-180 transition-transform">▼</span>
                                            </summary>
                                            <div class="space-y-1 pt-1.5">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Dust particle size
                                                <span id="parallax-dust-size-range-value">0.50</span></label>
                                              <input id="parallax-dust-size-range" type="range" class="w-full accent-indigo-500">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Dust particle count
                                                <span id="parallax-dust-density-range-value">0.50</span></label>
                                              <input id="parallax-dust-density-range" type="range" class="w-full accent-indigo-500">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Depth strength
                                                <span id="parallax-strength-range-value">1.00</span></label>
                                              <input id="parallax-strength-range" type="range" class="w-full accent-indigo-500">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Camera sway
                                                <span id="parallax-orbit-range-value">0.35</span></label>
                                              <input id="parallax-orbit-range" type="range" class="w-full accent-indigo-500">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Depth blur
                                                <span id="parallax-blur-range-value">1.00</span></label>
                                              <input id="parallax-blur-range" type="range" class="w-full accent-indigo-500">
                                              <label class="flex items-center justify-between text-[10px] text-gray-400 font-mono">Haze
                                                <span id="parallax-haze-range-value">0.60</span></label>
                                              <input id="parallax-haze-range" type="range" class="w-full accent-indigo-500">
                                              <div class="flex items-center justify-between gap-2 pt-1">
                                                <label for="parallax-depth-source-select" class="text-[10px] text-gray-400 font-mono">Depth source:</label>
                                                <select id="parallax-depth-source-select" class="bg-zinc-800 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white">
                                                  <option value="auto">Auto (AI → fallback)</option>
                                                  <option value="server">Server AI</option>
                                                  <option value="procedural">Fast heuristic</option>
                                                </select>
                                              </div>
                                              <label class="flex items-center gap-1.5 cursor-pointer pt-1">
                                                <input type="checkbox" id="parallax-rackfocus-checkbox" class="w-3 h-3 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0">
                                                <span class="text-[10px] text-gray-300">Rack focus (pull focus during clip)</span>
                                              </label>
                                            </div>
                                        </details>
                                    </div>

                                    <label class="flex items-start gap-2 cursor-pointer" title="Adds subtle, organic handheld camera breathing and steadicam drift to bring still shots to life with realistic micro-movements.">
                                        <input type="checkbox" id="enable-camera-handheld-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0">
                                        <span class="text-[11px] leading-tight text-gray-300">Handheld Steadicam Drift</span>
                                    </label>
                                    <label class="flex items-start gap-2 cursor-pointer" title="Overlays 2.39:1 Cinemascope widescreen anamorphic matte bars across top and bottom for a theatrical cinema framing.">
                                        <input type="checkbox" id="enable-letterbox-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0">
                                        <span class="text-[11px] leading-tight text-gray-300">Anamorphic Letterbox (2.39:1)</span>
                                    </label>
                                    <label class="flex items-start gap-2 cursor-pointer" title="Applies optical lens edge falloff to softly darken peripheral corners and draw focus to the subject.">
                                        <input type="checkbox" id="enable-cinematic-vignette-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0">
                                        <span class="text-[11px] leading-tight text-gray-300">Cinematic Lens Vignette</span>
                                    </label>
                                    <label class="flex items-start gap-2 cursor-pointer" title="Displays interactive rule-of-thirds grid guides on the preview canvas to assist with precise camera framing and composition.">
                                        <input type="checkbox" id="enable-composition-grid-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0">
                                        <span class="text-[11px] leading-tight text-gray-300">Composition Grid (Rule of Thirds)</span>
                                    </label>
                                    <label class="flex items-start gap-2 cursor-pointer" title="When enabled, letterboxed/pillarboxed media and 2.5D depth elements will feature a soft blurred background effect instead of plain black bars. Uncheck for clean black edges.">
                                        <input type="checkbox" id="enable-bg-blur-checkbox" class="mt-0.5 w-3.5 h-3.5 rounded bg-zinc-900 border-white/20 text-indigo-500 focus:ring-0 focus:ring-offset-0 shrink-0">
                                        <span class="text-[11px] leading-tight text-gray-300">Blurred Background Effect</span>
                                    </label>

                                    <!-- 🏔️ HDR Texture & Clarity Engine (Anti-AI Slop / Directing Optics) -->
                                    <div class="space-y-2 pt-2 border-t border-white/5">
                                        <div class="flex items-center justify-between">
                                            <div class="flex items-center gap-1.5">
                                                <span class="text-xs">🏔️</span>
                                                <span class="text-[10px] text-amber-400 uppercase font-mono font-bold tracking-wide">HDR Texture & Clarity</span>
                                                <span class="text-[8px] px-1 py-0.2 rounded font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">Anti-Flatness</span>
                                            </div>
                                            <div class="flex items-center gap-1.5">
                                                <span id="cinema-hdr-master-val" class="text-[10px] font-mono font-bold text-amber-300">0%</span>
                                            </div>
                                        </div>
                                        
                                        <div class="bg-zinc-950/60 p-2.5 rounded-lg border border-amber-500/20 space-y-2.5 shadow-xs">
                                            <p class="text-[9px] text-zinc-400 leading-tight">
                                                Balances exposure range, punches up mid-tone micro-contrast, enriches botanical greens, and sharpens tactile details.
                                            </p>

                                            <!-- Directing Presets Quick Pills -->
                                            <div class="grid grid-cols-4 gap-1">
                                                <button type="button" id="cinema-hdr-preset-off" class="px-1.5 py-1 text-[9px] font-mono rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-white/5 transition-colors cursor-pointer text-center truncate" title="Disable HDR Texture processing">Off (0%)</button>
                                                <button type="button" id="cinema-hdr-preset-natural" class="px-1.5 py-1 text-[9px] font-mono rounded bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer text-center truncate" title="Natural subtle texture (35%)">Natural 35%</button>
                                                <button type="button" id="cinema-hdr-preset-crisp" class="px-1.5 py-1 text-[9px] font-mono rounded bg-amber-950/50 hover:bg-amber-900/70 text-amber-200 border border-amber-500/40 transition-colors cursor-pointer text-center truncate font-bold" title="Crisp high-definition nature look (50%)">Crisp 50%</button>
                                                <button type="button" id="cinema-hdr-preset-hyper" class="px-1.5 py-1 text-[9px] font-mono rounded bg-purple-950/50 hover:bg-purple-900/70 text-purple-300 border border-purple-500/30 transition-colors cursor-pointer text-center truncate" title="Hyper-real vivid cinematic contrast (75%)">Vivid 75%</button>
                                            </div>

                                            <!-- Master Slider & Tune Toggle -->
                                            <div class="flex items-center gap-2">
                                                <input id="cinema-hdr-master-slider" type="range" min="0" max="100" value="0" step="1" class="w-full accent-amber-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg" title="Master HDR Texture & Clarity slider">
                                                <button type="button" id="cinema-hdr-toggle-drawer-btn" class="shrink-0 px-2 py-1 rounded text-[9px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-white/10 flex items-center gap-1 transition-colors cursor-pointer" title="Fine-tune individual HDR & clarity parameters">
                                                    <span>Tune</span>
                                                    <span id="cinema-hdr-drawer-chevron" class="text-[7px] transition-transform">▼</span>
                                                </button>
                                            </div>

                                            <!-- Expandable Fine-Tuning Breakdown Drawer -->
                                            <div id="cinema-hdr-drawer-container" class="hidden space-y-2 pt-2 border-t border-white/10">
                                                <!-- 1. HDR Tone Balance -->
                                                <div class="space-y-1">
                                                    <div class="flex justify-between text-[9px] font-mono text-zinc-400">
                                                        <span class="flex items-center gap-1"><span>⚖️</span> HDR Tone Balance</span>
                                                        <span id="cinema-hdr-balance-val" class="text-amber-300 font-bold">0%</span>
                                                    </div>
                                                    <input id="cinema-hdr-balance-slider" type="range" min="0" max="100" value="0" step="1" class="w-full accent-amber-500 h-1 bg-zinc-800 rounded-lg cursor-pointer" title="Dynamic highlight compression & shadow lift">
                                                </div>

                                                <!-- 2. Mid-Tone Clarity -->
                                                <div class="space-y-1">
                                                    <div class="flex justify-between text-[9px] font-mono text-zinc-400">
                                                        <span class="flex items-center gap-1"><span>🔍</span> Mid-Tone Clarity</span>
                                                        <span id="cinema-hdr-clarity-val" class="text-amber-300 font-bold">0%</span>
                                                    </div>
                                                    <input id="cinema-hdr-clarity-slider" type="range" min="0" max="100" value="0" step="1" class="w-full accent-amber-500 h-1 bg-zinc-800 rounded-lg cursor-pointer" title="Local micro-contrast on crags, rock, and bark">
                                                </div>

                                                <!-- 3. Botanical Vibrance -->
                                                <div class="space-y-1">
                                                    <div class="flex justify-between text-[9px] font-mono text-zinc-400">
                                                        <span class="flex items-center gap-1"><span>🌿</span> Botanical Vibrance</span>
                                                        <span id="cinema-hdr-vibrance-val" class="text-emerald-400 font-bold">0%</span>
                                                    </div>
                                                    <input id="cinema-hdr-vibrance-slider" type="range" min="0" max="100" value="0" step="1" class="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-lg cursor-pointer" title="Selective chroma boost for moss, foliage, and nature">
                                                </div>

                                                <!-- 4. Texture Edge Sharpening -->
                                                <div class="space-y-1">
                                                    <div class="flex justify-between text-[9px] font-mono text-zinc-400">
                                                        <span class="flex items-center gap-1"><span>🗡️</span> Digital Sharpening</span>
                                                        <span id="cinema-hdr-sharpening-val" class="text-cyan-400 font-bold">0%</span>
                                                    </div>
                                                    <input id="cinema-hdr-sharpening-slider" type="range" min="0" max="100" value="0" step="1" class="w-full accent-cyan-500 h-1 bg-zinc-800 rounded-lg cursor-pointer" title="High-pass crisp definition for leaves and pine needles">
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Atmospheric Weather & Particle Overlays (Dropdown + Size & Quantity Sliders) -->
                                    <div class="space-y-2 pt-2 border-t border-white/5">
                                        <div class="flex items-center justify-between">
                                            <label for="parallax-atmospheric-select" class="text-[10px] uppercase font-mono text-gray-400">✨ Atmosphere & Weather</label>
                                            <span id="parallax-atmospheric-tag" class="text-[9px] font-mono text-indigo-400">None</span>
                                        </div>
                                        <select id="parallax-atmospheric-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer">
                                            <option value="none">None (No Overlay)</option>
                                            <option value="sparkles">✨ Magic Sparkles</option>
                                            <option value="rain">🌧️ Downpour Rain</option>
                                            <option value="snow">❄️ Snowfall Frost</option>
                                            <option value="dust">💨 Dust Motes & Bokeh</option>
                                        </select>
                                        <div id="parallax-atmospheric-controls" class="space-y-2 pt-1 hidden">
                                            <div class="space-y-1">
                                                <div class="flex justify-between text-[10px] text-gray-400 font-mono">
                                                    <span id="parallax-atmospheric-size-label">Particle Size</span>
                                                    <span id="parallax-atmospheric-size-val">0.50</span>
                                                </div>
                                                <input id="parallax-atmospheric-size-range" type="range" min="0.1" max="2.0" step="0.05" value="0.50" class="w-full accent-indigo-500">
                                            </div>
                                            <div class="space-y-1">
                                                <div class="flex justify-between text-[10px] text-gray-400 font-mono">
                                                    <span id="parallax-atmospheric-qty-label">Quantity / Density</span>
                                                    <span id="parallax-atmospheric-qty-val">60%</span>
                                                </div>
                                                <input id="parallax-atmospheric-qty-range" type="range" min="5" max="100" step="1" value="60" class="w-full accent-indigo-500">
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="space-y-2 pt-2 border-t border-white/5">
                                <span class="text-xs text-gray-400 uppercase font-mono font-medium block">Transitions</span>
                                <div class="grid grid-cols-2 gap-2">
                                    <div>
                                        <label for="video-transition-style-select" class="block text-[10px] uppercase font-mono text-gray-400 mb-1">Style</label>
                                        <select id="video-transition-style-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Transition Style">
                                            <option value="narrative_guided">🎬 Narrative Guided</option>
                                            <option value="random_mix">🎲 Random Mix</option>
                                            <option value="ai_directed">🤖 Simple AI</option>
                                            <option value="cut">Hard Cut</option>
                                            <option value="cross_dissolve">Cross Dissolve</option>
                                            <option value="blur_dissolve">Blur Dissolve</option>
                                            <option value="zoom_dissolve">Zoom Dissolve</option>
                                            <option value="flash">⚡ Flash Cut</option>
                                            <option value="glitch">📺 Glitch / RGB</option>
                                            <option value="spin">🔄 Spin / Rotate</option>
                                            <option value="iris">🔘 Iris Wipe</option>
                                            <option value="swipe_left">Swipe Left</option>
                                            <option value="swipe_right">Swipe Right</option>
                                            <option value="swipe_up">Swipe Up</option>
                                            <option value="swipe_down">Swipe Down</option>
                                            <option value="fade_to_black">Fade to Black</option>
                                            <option value="fade_to_white">Fade to White</option>
                                            <option value="wipe">Wipe</option>
                                            <option value="push">Push</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label for="video-transition-speed-select" class="block text-[10px] uppercase font-mono text-gray-400 mb-1">Speed</label>
                                        <select id="video-transition-speed-select" class="w-full bg-zinc-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer" title="Transition Speed">
                                            <option value="ultrafast">⚡ Ultra</option>
                                            <option value="fast">Fast</option>
                                            <option value="medium" selected>Med</option>
                                            <option value="slow">Slow</option>
                                        </select>
                                    </div>
                                </div>
                                <button id="analyze-transitions-btn" class="w-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 hover:text-white px-3 py-2 rounded-lg text-xs font-semibold border border-white/10 transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs" disabled>
                                    <span>✨</span> Analyze Transitions
                                </button>
                            </div>
                            <div class="pt-2 border-t border-white/5">
                                <span class="text-[10px] text-gray-500 uppercase font-semibold block mb-1.5">Final Edit & Pacing Review</span>
                                <button id="director-review-btn" class="w-full bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white py-2.5 px-4 rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-950/40 flex items-center justify-center gap-2 cursor-pointer border border-purple-400/30 active:scale-98">
                                    <span>🪄</span>
                                    <span>Director Review (Magic Polish)</span>
                                </button>
                            </div>
                        </div></details>
                        
                        <!-- Persistent Production Log Card (Always Visible) -->
                        <div class="p-3 overflow-hidden flex flex-col bg-zinc-900/60 rounded-lg border border-white/10 shadow-inner">
                            <div class="flex justify-between items-center mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-xs">📜</span>
                                    <h3 class="font-semibold text-gray-300 text-[11px] uppercase tracking-wider">Production Log</h3>
                                    <div id="video-status-indicator" class="h-2 w-2 rounded-full bg-green-500 animate-pulse hidden" title="Processing active"></div>
                                </div>
                                <button id="clear-video-status-log-btn" class="text-gray-500 hover:text-gray-300 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors" title="Clear log">Clear</button>
                            </div>
                            <div id="video-status-log" class="min-h-[90px] max-h-[160px] overflow-y-auto font-mono text-[11px] text-gray-300 space-y-1.5 custom-scrollbar bg-black/60 p-2.5 rounded border border-white/5 select-text">
                                <p class="text-gray-500 italic">System Ready.</p>
                            </div>
                        </div>
                        
                        
                        
                        
                </div>
            </div>
        </div>
        
            <button id="analyze-narration-overlay-btn" class="absolute top-20 left-1/2 -translate-x-1/2 bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-semibold py-2 px-6 rounded-full shadow-lg backdrop-blur-sm transition z-30 hidden uppercase tracking-wide">
                AI Narration Request
            </button>
    </div>

    <div id="transcript-editor-workspace" class="hidden absolute inset-0 bg-gray-900 z-20 flex flex-col">
        <!-- Header -->
        <div class="px-6 py-3 border-b border-white/10 flex-shrink-0 bg-gray-900/80 backdrop-blur-xl z-20">
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-6">
                    <button id="close-transcript-editor-btn" class="text-gray-500 hover:text-white flex items-center gap-2 transition-colors p-1 group">
                        <svg class="w-5 h-5 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                        <span class="text-xs font-black uppercase tracking-widest">Back</span>
                    </button>
                    <div class="h-6 w-px bg-white/10"></div>
                    <div class="flex flex-col">
                        <h3 class="text-lg font-black tracking-tighter text-fuchsia-500 uppercase italic leading-none">Transcript Editor</h3>
                        <span class="text-[9px] text-gray-500 font-mono uppercase tracking-widest mt-1">B-Roll Sync Studio</span>
                    </div>
                </div>
                <div class="flex items-center gap-2.5">
                    <span class="text-[11px] text-zinc-400 hidden lg:inline mr-2">Select words, then click an image to assign</span>
                    
                    <div class="flex items-center bg-zinc-950/80 p-0.5 rounded-lg border border-white/10 shadow-inner">
                        <button id="undo-transcript-assignment-btn" class="px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/10 rounded-md transition-colors cursor-pointer">Undo</button>
                        <button id="clear-transcript-assignments-btn" class="px-2.5 py-1.5 text-xs font-semibold text-rose-400/80 hover:text-rose-300 hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer">Clear All</button>
                    </div>

                    <button id="auto-assign-transcript-btn" class="bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-md shadow-fuchsia-950/40 flex items-center gap-1.5 cursor-pointer">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5.268l4.268-4.268a1 1 0 111.414 1.414L13.414 8.682l4.268 4.268a1 1 0 11-1.414 1.414L12 10.098V15.5a1 1 0 11-2 0v-5.402L5.732 14.364a1 1 0 11-1.414-1.414l4.268-4.268-4.268-4.268a1 1 0 011.414-1.414L10 6.682V2a1 1 0 011.3-.954zM9 18a1 1 0 112 0v1a1 1 0 11-2 0v-1zm-4.293-2.293a1 1 0 111.414-1.414l1 1a1 1 0 11-1.414 1.414l-1-1zm10.586 0a1 1 0 11-1.414-1.414l-1 1a1 1 0 111.414 1.414l1-1z" clip-rule="evenodd" /></svg>
                        <span>Magic Assign</span>
                    </button>
                    
                    <button id="rebuild-timeline-from-transcript-btn" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-md shadow-emerald-950/40 flex items-center gap-1.5 cursor-pointer">
                        <span>Rebuild Timeline</span>
                    </button>
                </div>
            </div>
        </div>
        <!-- Main Workspace -->
        <div class="flex flex-col md:flex-row flex-grow overflow-hidden min-h-0 relative z-10">
            <!-- Left: Transcript -->
            <div id="transcript-editor-scroll-container" class="flex-1 p-4 sm:p-6 overflow-y-auto min-h-0 custom-scrollbar overscroll-contain relative z-10 bg-gray-900/90 flex flex-col">
                <div class="flex items-center justify-between mb-3 text-xs text-gray-400 font-sans border-b border-gray-800 pb-2 shrink-0 select-none">
                    <span class="flex items-center gap-2 font-bold text-fuchsia-300">
                        <span>📜 Narration Transcript</span>
                        <span class="text-[10px] bg-fuchsia-950/60 text-fuchsia-300 border border-fuchsia-500/30 px-2 py-0.5 rounded-full font-mono">Drag to select range</span>
                    </span>
                    <div class="flex items-center gap-1.5">
                        <button id="transcript-scroll-up-btn" type="button" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition text-[11px] font-medium flex items-center gap-1 cursor-pointer" title="Scroll Up">⬆ Scroll Up</button>
                        <button id="transcript-scroll-down-btn" type="button" class="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded border border-gray-700 transition text-[11px] font-medium flex items-center gap-1 cursor-pointer" title="Scroll Down">⬇ Scroll Down</button>
                    </div>
                </div>
                <div id="transcript-editor-transcript-container" class="text-gray-200 text-base sm:text-lg leading-relaxed max-w-full overflow-x-hidden break-words font-sans flex-1"></div>
            </div>
            <!-- Right: Image Bin -->
            <div class="w-full md:w-80 lg:w-96 bg-black/50 border-t md:border-t-0 md:border-l border-gray-800 p-4 flex flex-col min-h-[240px] md:min-h-0 flex-shrink-0 relative z-20 shadow-2xl">
                <div class="flex items-center justify-between mb-3 border-b border-gray-800 pb-2 shrink-0">
                    <h4 class="font-bold text-gray-300 text-sm flex items-center gap-2">
                        <span>🎬 Media Bin</span>
                    </h4>
                    <span id="transcript-bin-assigned-count" class="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-bold">0 assigned</span>
                </div>
                <div id="transcript-editor-image-bin" class="flex-grow overflow-y-auto custom-scrollbar min-h-0 grid grid-cols-2 gap-3 auto-rows-min content-start pr-1">
                    <!-- Images will be inserted here -->
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Image Modal & Editor -->
<div id="image-modal" class="fixed inset-0 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden max-w-6xl w-full flex flex-col md:flex-row max-h-[90vh]">
        <div class="flex-grow bg-black flex items-center justify-center relative group min-h-[300px]">
            <img id="generated-image" class="max-w-full max-h-full object-contain" src="" alt="Full size preview">
            <div class="absolute bottom-4 left-4 flex gap-2">
                <button id="modal-download-btn" class="bg-black/60 hover:bg-black/80 text-white p-3 rounded-full backdrop-blur-md transition border border-white/10 shadow-xl">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
            </div>
            <button id="close-modal-btn" class="absolute top-4 right-4 bg-black/60 hover:bg-black/80 text-white p-2 rounded-full backdrop-blur-md transition border border-white/10">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
        
        <div id="image-edit-container" class="w-full md:w-80 p-6 flex flex-col border-l border-white/10 bg-zinc-900">
            <h3 class="text-lg font-bold text-white mb-2">Art Director (Quick Edit)</h3>
            <p class="text-xs text-gray-400 mb-6 leading-relaxed">Modify this specific shot using Gemini 2.5. Describe changes like "add a rain effect" or "make it night".</p>
            
            <textarea id="image-edit-input" class="w-full bg-black border border-white/10 rounded-xl p-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none mb-4 flex-grow resize-none" placeholder="Describe your edit..."></textarea>
            
            <div class="relative">
                <button id="image-edit-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition shadow-lg shadow-indigo-900/20">Apply Edit</button>
                <div id="image-edit-loader" class="absolute inset-0 bg-indigo-600 rounded-xl flex items-center justify-center hidden">
                    <div class="loader small-loader !border-white !border-t-transparent"></div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Story Spark Modal -->
<div id="story-spark-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[85vh]">
        <div class="p-8 border-b border-white/10 flex justify-between items-center">
            <div>
                <h3 class="text-3xl font-black text-white italic tracking-tighter uppercase">Creative Spark</h3>
                <p class="text-gray-400 text-sm">Draft a full story from a single idea.</p>
            </div>
            <button id="close-story-spark-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        
        <div class="flex-grow overflow-y-auto p-8 custom-scrollbar">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="space-y-6">
                    <div>
                        <label for="spark-topic-input" class="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-3">Topic or Core Concept</label>
                        <input type="text" id="spark-topic-input" class="w-full bg-black border border-white/10 rounded-xl p-4 text-sm text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none" placeholder="e.g., A lost traveler finds a clockwork forest">
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="spark-genre-select" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Genre</label>
                            <select id="spark-genre-select" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                                <option value="any">Surprise Me</option>
                                <option value="sci-fi">Sci-Fi</option>
                                <option value="fantasy">Fantasy</option>
                                <option value="thriller">Thriller</option>
                                <option value="horror">Horror</option>
                                <option value="mythology">Mythology</option>
                                <option value="true-story">"True Story" (Documentary)</option>
                                <option value="tutorial">Tutorial</option>
                                <option value="mystery">Mystery</option>
                                <option value="product">Product Explainer</option>
                            </select>
                        </div>
                        <div>
                            <label for="spark-style-select" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Narrative Style</label>
                            <select id="spark-style-select" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                                <option value="cinematic">Cinematic Epic</option>
                                <option value="minimalist">Minimalist / Poetic</option>
                                <option value="gritty">Gritty / Raw</option>
                                <option value="fable">Whimsical Fable</option>
                                <option value="custom">-- Custom --</option>
                            </select>
                        </div>
                    </div>

                    <div id="spark-custom-style-container" class="hidden">
                        <label for="spark-custom-style-input" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Custom Style Instruction</label>
                        <textarea id="spark-custom-style-input" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white h-20 resize-none" placeholder="Describe the desired writing style..."></textarea>
                    </div>

                    <div>
                        <label for="spark-length-select" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Target Length</label>
                        <select id="spark-length-select" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="short (150 words)">Short (~1 min video)</option>
                            <option value="medium (350 words)" selected>Medium (~2-3 min video)</option>
                            <option value="long (600 words)">Long (~4-5 min video)</option>
                            <option value="custom">-- Custom --</option>
                        </select>
                    </div>

                    <div id="spark-custom-length-container" class="hidden">
                        <input type="number" id="spark-custom-length-input" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white" placeholder="Target word count" value="350">
                    </div>

                    <button id="generate-sparks-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-xl transition uppercase tracking-widest shadow-lg shadow-indigo-900/20">Write Story</button>
                </div>
                
                <div class="space-y-4">
                    <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Generated Output</span>
                    <div id="spark-results-container" class="h-[450px] bg-black/40 rounded-2xl border border-white/5 p-6 overflow-y-auto custom-scrollbar">
                        <div class="h-full flex flex-col items-center justify-center text-center text-gray-600 p-8">
                            <div class="mb-4"><svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></div>
                            <p class="text-sm">Configure your idea on the left and click "Write Story" to see results here.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Video Prompt Modal -->
<div id="video-prompt-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[100] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-2xl w-full">
        <div class="p-6 border-b border-white/10 flex justify-between items-center">
            <h3 class="text-xl font-black text-white italic tracking-tighter uppercase">Veo Video Prompt</h3>
            <button id="close-video-prompt-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        <div class="p-6">
            <textarea id="video-prompt-result" class="w-full bg-black border border-white/10 rounded-xl p-4 text-sm text-gray-300 h-64 resize-none font-mono focus:ring-0" readonly></textarea>
            <div class="mt-6 flex gap-3">
                <button id="copy-video-prompt-btn" class="flex-grow bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition">Copy to Clipboard</button>
            </div>
        </div>
    </div>
</div>

<!-- Force Align Modal -->
<div id="force-align-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[85vh]">
        <div class="p-8 border-b border-white/10 flex justify-between items-center">
            <div>
                <h3 class="text-3xl font-black text-white italic tracking-tighter uppercase">Precision Audio Aligner</h3>
                <p class="text-gray-400 text-sm">Manually sync any audio file to your script.</p>
            </div>
            <button id="close-force-align-modal-btn" class="p-2 text-gray-500 hover:text-white transition"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
        
        <div class="flex-grow overflow-y-auto p-8 custom-scrollbar">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="space-y-6">
                    <div>
                        <label for="force-align-audio-input" class="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-3">1. Select Audio Source</label>
                        <input type="file" id="force-align-audio-input" class="w-full bg-black border border-white/10 rounded-xl p-4 text-sm text-white" accept="audio/*">
                    </div>
                    
                    <div>
                        <label for="force-align-engine-select" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">2. Alignment Engine</label>
                        <select id="force-align-engine-select" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="deepgram">Deepgram (Blazing Fast API)</option>
                            <option value="local_whisper">Local Whisper (Offline & Free)</option>
                            <option value="gemini">Gemini 3 Flash (Fast & Precision)</option>
                            <option value="ai33">AI33 Proxy (Whisper-based)</option>
                        </select>
                    </div>
                    
                    <div id="local-whisper-options" class="hidden">
                        <label for="force-align-whisper-model-select" class="block text-[10px] font-bold text-gray-400 uppercase mb-2 mt-4">Whisper Model</label>
                        <select id="force-align-whisper-model-select" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="Xenova/whisper-tiny.en">Tiny (Fastest, low quality)</option>
                            <option value="Xenova/whisper-base.en" selected>Base (Fast, decent quality)</option>
                            <option value="Xenova/whisper-small.en">Small (Slower, high quality)</option>
                            <option value="Xenova/whisper-medium.en">Medium (Slowest, best quality)</option>
                        </select>
                    </div>

                    <div class="pt-4">
                        <label for="force-align-subtitle-input" class="block text-[10px] font-bold text-gray-400 uppercase mb-3">Optional: Direct Subtitles (SRT/VTT)</label>
                        <input type="file" id="force-align-subtitle-input" class="w-full bg-black/40 border border-dashed border-white/10 rounded-xl p-4 text-xs text-gray-500" accept=".srt,.vtt">
                        <p id="force-align-subtitle-status" class="text-[10px] mt-1 h-4 text-gray-600"></p>
                    </div>

                    <button id="start-force-align-btn" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-4 rounded-xl transition uppercase tracking-widest shadow-lg shadow-emerald-900/20">Start Alignment</button>
                    
                    <div id="force-align-progress-container" class="hidden space-y-2">
                        <div class="relative w-full h-2 bg-black rounded-full overflow-hidden">
                            <div id="force-align-progress-bar" class="absolute top-0 left-0 h-full bg-emerald-500 transition-all duration-300" style="width: 0%"></div>
                        </div>
                        <p id="force-align-progress-text" class="text-center text-[10px] font-bold text-emerald-400 uppercase tracking-widest"></p>
                    </div>
                </div>
                
                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <label for="force-align-script-textarea" class="block text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Narration Transcript</label>
                        <button id="import-aligned-from-modal-btn" class="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 uppercase underline">Import Existing Aligned Project</button>
                    </div>
                    <textarea id="force-align-script-textarea" class="w-full h-[400px] bg-black/40 rounded-2xl border border-white/5 p-6 text-sm leading-relaxed text-gray-300 focus:ring-1 focus:ring-emerald-500 focus:outline-none custom-scrollbar" placeholder="Paste the script that matches the audio exactly..."></textarea>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Voice Studio & Cloning Modal -->
<div id="voice-cloning-modal" class="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 z-[90] hidden">
    <div class="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl max-w-4xl w-full flex flex-col max-h-[90vh]">
        <div class="p-5 sm:p-6 border-b border-white/10 flex justify-between items-center bg-black/40">
            <div>
                <h3 class="text-xl sm:text-2xl font-black text-white italic tracking-tighter uppercase flex items-center gap-2">
                    <span class="text-amber-400">🎙️</span> <span>Voice Studio & Audio Lab</span>
                </h3>
                <p class="text-gray-400 text-xs mt-0.5">Generate standalone audio, manage provider voice IDs, clone voices, or send directly to Master A-Roll.</p>
            </div>
            <button id="close-cloning-modal-btn" class="p-2 text-gray-400 hover:text-white transition rounded-lg hover:bg-white/10 cursor-pointer"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>

        <!-- Studio Navigation Tabs -->
        <div class="flex border-b border-white/10 bg-black/60 px-6 pt-2.5 gap-2 flex-wrap">
            <button id="voice-studio-tab-generate" class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-xl border-b-2 border-indigo-500 text-white bg-white/10 transition flex items-center gap-2 cursor-pointer">
                <span>🎙️</span> Generate Audio Track
            </button>
            <button id="voice-studio-tab-custom" class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-xl border-b-2 border-transparent text-gray-400 hover:text-white hover:bg-white/5 transition flex items-center gap-2 cursor-pointer">
                <span>🌟</span> Custom Voice IDs
            </button>
            <button id="voice-studio-tab-clone" class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-t-xl border-b-2 border-transparent text-gray-400 hover:text-white hover:bg-white/5 transition flex items-center gap-2 cursor-pointer">
                <span>👤</span> Audio Sample Clone
            </button>
        </div>
        
        <div class="flex-grow overflow-y-auto p-5 sm:p-7 custom-scrollbar space-y-6">
            <!-- Panel 0: Standalone Audio Generation & Send to A-Roll -->
            <div id="voice-studio-panel-generate" class="space-y-5">
                <!-- Top Voice Configuration -->
                <div class="bg-black/50 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                        <span class="text-xs font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
                            <span>⚡</span> Step 1: Voice & Provider Selection
                        </span>
                        <span class="text-[10px] bg-amber-500/10 text-amber-300 font-mono px-2.5 py-0.5 rounded-full border border-amber-500/30">AI33 v3 • ElevenLabs • Edge • Kokoro • Minimax</span>
                    </div>

                    <!-- Provider Selection Pills -->
                    <div>
                        <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Select Provider Filter</span>
                        <div id="studio-gen-provider-pills" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-1.5 mb-2">
                            <button type="button" class="studio-gen-provider-pill active px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-amber-500 text-black border-amber-400 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="edge">
                                <span class="shrink-0">🌐</span> <span class="truncate">Edge (Free)</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="kokoro">
                                <span class="shrink-0">🌸</span> <span class="truncate">Kokoro</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="all">
                                <span class="shrink-0">🌐</span> <span class="truncate">All</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="elevenlabs">
                                <span class="shrink-0">🎙️</span> <span class="truncate">ElevenLabs</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="minimax">
                                <span class="shrink-0">🎭</span> <span class="truncate">Minimax</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="vbee">
                                <span class="shrink-0">🇻🇳</span> <span class="truncate">Vbee</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="fishaudio">
                                <span class="shrink-0">🐟</span> <span class="truncate">Fish Audio</span>
                            </button>
                            <button type="button" class="studio-gen-provider-pill px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1 overflow-hidden" data-provider="clone">
                                <span class="shrink-0">👤</span> <span class="truncate">Clones</span>
                            </button>
                        </div>
                    </div>

                    <!-- Voice Search & Filters Bar -->
                    <div class="bg-black/60 border border-white/10 rounded-xl p-2.5 space-y-2">
                        <div class="flex flex-col sm:flex-row gap-2">
                            <div class="relative flex-grow">
                                <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-500 text-xs">🔍</span>
                                <input type="text" id="studio-voice-search-input" class="w-full bg-zinc-900 border border-white/10 rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder:text-gray-500 focus:outline-none focus:border-amber-400/60" placeholder="Search voices by name, accent, or country (e.g. Ava, British, Spanish, Deep)...">
                                <button id="studio-voice-search-clear-btn" type="button" class="hidden absolute inset-y-0 right-0 pr-2.5 flex items-center text-gray-400 hover:text-white text-xs cursor-pointer">✕</button>
                            </div>
                            <div class="flex flex-wrap gap-2 shrink-0">
                                <select id="studio-voice-quality-filter" class="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400/60 cursor-pointer" title="Filter by naturalness & expressiveness">
                                    <option value="all">✨ All Tiers</option>
                                    <option value="natural">⭐ Ultra-Natural (Ava, Brian, etc.)</option>
                                    <option value="multilingual">🌐 Multilingual Models</option>
                                    <option value="standard">🎙️ Standard / Documentary</option>
                                </select>
                                <select id="studio-voice-lang-filter" class="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400/60 cursor-pointer" title="Filter by language">
                                    <option value="all">🌍 All Languages (80+)</option>
                                    <option value="en">🌐 English (All Accents)</option>
                                    <option value="en-NG">🇳🇬 English (Nigeria)</option>
                                    <option value="en-US">🇺🇸 English (US)</option>
                                    <option value="en-GB">🇬🇧 English (UK)</option>
                                    <option value="en-AU">🇦🇺 English (Australia)</option>
                                    <option value="es">Spanish / Español</option>
                                    <option value="fr">French / Français</option>
                                    <option value="de">German / Deutsch</option>
                                    <option value="ja">Japanese / 日本語</option>
                                    <option value="zh">Chinese / 中文</option>
                                    <option value="it">Italian / Italiano</option>
                                    <option value="pt">Portuguese / Português</option>
                                    <option value="hi">Hindi / हिन्दी</option>
                                    <option value="vi">Vietnamese / Tiếng Việt</option>
                                    <option value="ar">Arabic / العربية</option>
                                    <option value="ko">Korean / 한국어</option>
                                </select>
                                <select id="studio-voice-gender-filter" class="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-400/60 cursor-pointer" title="Filter by gender">
                                    <option value="all">👥 All Genders</option>
                                    <option value="Female">👩 Female</option>
                                    <option value="Male">👨 Male</option>
                                </select>
                            </div>
                        </div>
                        <div class="flex items-center justify-between text-[10px] text-gray-400 px-0.5">
                            <span id="studio-voice-count-badge" class="text-gray-400">Loading voices...</span>
                            <span class="text-amber-400/90 font-mono">Edge Neural & Kokoro · No API Key</span>
                        </div>
                    </div>

                    <div>
                        <div class="flex flex-wrap justify-between items-center gap-1.5 mb-1.5">
                            <div class="flex items-center gap-1.5">
                                <label for="studio-gen-voice-select" class="block text-[10px] font-bold text-gray-400 uppercase">Voice Model</label>
                                <span id="studio-selected-voice-provider-badge" class="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-500/40">Edge Neural</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <button id="studio-audition-voice-btn" type="button" class="text-[10px] text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1 cursor-pointer transition">
                                    <span>▶ Audition Sample</span>
                                </button>
                                <button id="studio-set-as-narration-btn" type="button" class="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition shadow cursor-pointer border border-indigo-400/40" title="Set this voice as the active narration voice in Production Settings">
                                    <span>🎯</span> <span>Set as Active (Production Voice)</span>
                                </button>
                            </div>
                        </div>
                        <select id="studio-gen-voice-select" class="w-full bg-black border border-white/15 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-amber-500 focus:outline-none">
                            <option value="edge_en-US-AvaNeural" selected>⭐ Edge - Ava (Ultra-Natural Expressive · US)</option>
                            <option value="edge_en-US-BrianNeural">⭐ Edge - Brian (Ultra-Natural Conversational · US)</option>
                            <option value="edge_en-NG-AbeoNeural">🇳🇬 Edge - Abeo (Nigerian Natural Male · Free)</option>
                            <option value="edge_en-NG-EzinneNeural">🇳🇬 Edge - Ezinne (Nigerian Warm Female · Free)</option>
                            <option value="edge_en-US-AriaNeural">Edge - Aria (Warm & Clear Female · Free)</option>
                            <option value="kokoro_af_heart">🌸 Kokoro - Heart (Ultra-Expressive Female · Free)</option>
                            <option value="kokoro_af_bella">🌸 Kokoro - Bella (Conversational Female · Free)</option>
                            <option value="Zephyr">⭐ Gemini Flash - Zephyr (Calm & Clear)</option>
                            <option value="Puck">⭐ Gemini Flash - Puck (Engaging & Energetic)</option>
                        </select>
                    </div>

                    <!-- Dynamic Supported Voice Controls Card -->
                    <div id="studio-voice-controls-container" class="mt-3 bg-zinc-950/70 border border-white/10 rounded-xl p-3.5 space-y-3">
                        <div class="flex items-center justify-between border-b border-white/5 pb-2">
                            <div class="flex items-center gap-2">
                                <span class="text-[11px] font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1">
                                    <span>🎛️</span> Supported Voice Controls
                                </span>
                                <span id="studio-supported-controls-badge" class="text-[9px] font-mono px-2 py-0.5 rounded-full bg-blue-950 text-blue-300 border border-blue-500/30">
                                    Speed • Pitch • Volume
                                </span>
                            </div>
                            <button id="studio-reset-controls-btn" type="button" class="text-[10px] text-gray-500 hover:text-amber-300 underline cursor-pointer transition">Reset to Defaults</button>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                            <!-- Speed Control (All) -->
                            <div data-studio-control="speed" class="space-y-1">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-speed-slider" class="font-bold text-gray-400 uppercase">Speaking Speed</label>
                                    <span id="studio-gen-speed-value" class="font-mono text-amber-300 font-bold">1.00x</span>
                                </div>
                                <input type="range" id="studio-gen-speed-slider" min="0.5" max="2.0" step="0.05" value="1.0" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500">
                            </div>

                            <!-- Pitch Control (Edge, Gemini, Minimax) -->
                            <div data-studio-control="pitch" class="space-y-1">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-pitch-slider" class="font-bold text-gray-400 uppercase">Pitch Shift</label>
                                    <span id="studio-gen-pitch-value" class="font-mono text-cyan-300 font-bold">+0Hz</span>
                                </div>
                                <input type="range" id="studio-gen-pitch-slider" min="-50" max="50" step="1" value="0" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500">
                            </div>

                            <!-- Volume / Gain (Edge) -->
                            <div data-studio-control="volume" class="space-y-1">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-volume-slider" class="font-bold text-gray-400 uppercase">Volume / Gain</label>
                                    <span id="studio-gen-volume-value" class="font-mono text-emerald-300 font-bold">+0%</span>
                                </div>
                                <input type="range" id="studio-gen-volume-slider" min="-50" max="50" step="5" value="0" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500">
                            </div>

                            <!-- Stability (ElevenLabs / AI33 / Clone) -->
                            <div data-studio-control="stability" class="space-y-1 hidden">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-stability-slider" class="font-bold text-gray-400 uppercase">Stability</label>
                                    <span id="studio-gen-stability-value" class="font-mono text-emerald-300 font-bold">0.50</span>
                                </div>
                                <input type="range" id="studio-gen-stability-slider" min="0" max="1" step="0.01" value="0.5" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500">
                            </div>

                            <!-- Similarity Boost (ElevenLabs / AI33 / Clone) -->
                            <div data-studio-control="similarity" class="space-y-1 hidden">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-similarity-slider" class="font-bold text-gray-400 uppercase">Similarity Boost</label>
                                    <span id="studio-gen-similarity-value" class="font-mono text-indigo-300 font-bold">0.75</span>
                                </div>
                                <input type="range" id="studio-gen-similarity-slider" min="0" max="1" step="0.01" value="0.75" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500">
                            </div>

                            <!-- Style Exaggeration (ElevenLabs / AI33) -->
                            <div data-studio-control="style" class="space-y-1 hidden">
                                <div class="flex justify-between items-center text-[10px]">
                                    <label for="studio-gen-style-slider" class="font-bold text-gray-400 uppercase">Style Exaggeration</label>
                                    <span id="studio-gen-style-value" class="font-mono text-purple-300 font-bold">0.00</span>
                                </div>
                                <input type="range" id="studio-gen-style-slider" min="0" max="1" step="0.01" value="0.0" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500">
                            </div>
                        </div>

                        <!-- Tone / Style Prompt Instruction (Gemini / Custom) -->
                        <div data-studio-control="instruction" class="space-y-1 pt-1 hidden">
                            <label for="studio-gen-style-instruction" class="block text-[10px] font-bold text-gray-400 uppercase">Tone & Style Prompt</label>
                            <textarea id="studio-gen-style-instruction" rows="2" class="w-full bg-black border border-white/10 rounded-lg p-2 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none" placeholder="e.g. 'Warm and inviting, conversational podcast delivery'"></textarea>
                        </div>
                    </div>
                </div>

                <!-- Script Input Area -->
                <div class="bg-black/50 border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div class="flex flex-wrap justify-between items-center gap-2">
                        <span class="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                            <span>📝</span> Step 2: Script / Narration Text
                        </span>
                        <div class="flex items-center gap-3">
                            <span class="text-[10px] text-gray-400 font-mono">
                                Words: <strong id="studio-script-word-count" class="text-amber-300 font-bold">0</strong>
                            </span>
                            <span class="text-[10px] text-gray-400 font-mono">
                                Est. Dur: <strong id="studio-script-duration-est" class="text-indigo-300 font-bold">0.0s</strong>
                            </span>
                            <button id="studio-script-sample-btn" class="text-[10px] text-amber-400/80 hover:text-amber-300 underline cursor-pointer">Sample Script</button>
                            <button id="studio-script-clear-btn" class="text-[10px] text-gray-500 hover:text-gray-300 underline cursor-pointer">Clear</button>
                        </div>
                    </div>

                    <textarea id="studio-script-input" rows="5" class="w-full bg-black border border-white/15 rounded-xl p-3.5 text-xs sm:text-sm text-white focus:ring-1 focus:ring-amber-500 focus:outline-none resize-y placeholder:text-gray-600 custom-scrollbar leading-relaxed" placeholder="Type or paste the script you want to speak into standalone audio or your Master A-Roll..."></textarea>

                    <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <button id="studio-generate-audio-btn" class="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold px-6 py-3 rounded-xl transition text-xs uppercase tracking-wider shadow-lg shadow-amber-900/30 cursor-pointer flex items-center gap-2">
                            <span>✨</span> <span>Generate Audio Track</span>
                        </button>
                        <div id="studio-audio-status" class="text-xs text-gray-400 italic">Ready to synthesize audio.</div>
                    </div>
                </div>

                <!-- Generated Audio Player & Actions -->
                <div id="studio-player-container" class="bg-gradient-to-br from-zinc-900 to-black border border-amber-500/30 rounded-2xl p-4 sm:p-5 space-y-4 hidden shadow-xl">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                        <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-amber-300 uppercase tracking-widest flex items-center gap-1.5">
                                <span>🎧</span> Generated Audio Preview
                            </span>
                            <span id="studio-audio-dur-badge" class="text-[10px] font-mono bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/30">00:00</span>
                            <span id="studio-transcript-words-badge" class="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-md border border-indigo-500/30">0 words</span>
                        </div>
                        <span class="text-[10px] text-gray-400 font-mono">48kHz / 24kHz Audio • High Precision Subtitles</span>
                    </div>

                    <!-- Custom Player Controls -->
                    <div class="flex items-center gap-4 bg-black/60 rounded-xl p-3 border border-white/5">
                        <button id="studio-play-btn" class="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center font-bold transition shadow cursor-pointer shrink-0">
                            <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                        </button>
                        <div class="flex-grow space-y-1">
                            <input type="range" id="studio-seek-bar" min="0" max="100" value="0" step="0.1" class="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500">
                            <div class="flex justify-between text-[10px] font-mono text-gray-400">
                                <span id="studio-time-display">00:00 / 00:00</span>
                                <span class="text-gray-500">Audio Timeline</span>
                            </div>
                        </div>
                    </div>

                    <!-- Export & Master A-Roll Action Bar -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 pt-2">
                        <!-- Send to Master A-Roll (Primary Highlighted Action) -->
                        <button id="studio-send-to-aroll-btn" class="sm:col-span-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold px-4 py-3 rounded-xl transition text-xs uppercase tracking-wider shadow-lg shadow-emerald-900/30 cursor-pointer flex items-center justify-center gap-2 border border-emerald-400/40" title="Link this audio to the Master Timeline and synchronise script/subtitles">
                            <span>🎬</span> <span>Send to Master A-Roll & Timeline</span>
                        </button>
                        <button id="studio-download-wav-btn" class="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-3 py-3 rounded-xl transition text-xs uppercase tracking-wider border border-white/10 cursor-pointer flex items-center justify-center gap-1.5" title="Download pure audio file">
                            <span>📥</span> <span>Download .WAV</span>
                        </button>
                        <button id="studio-download-srt-btn" class="bg-zinc-800 hover:bg-zinc-700 text-white font-bold px-3 py-3 rounded-xl transition text-xs uppercase tracking-wider border border-white/10 cursor-pointer flex items-center justify-center gap-1.5" title="Download synchronized SRT subtitles">
                            <span>📝</span> <span>Download .SRT</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Panel 1: Custom Voice IDs (By Provider) -->
            <div id="voice-studio-panel-custom" class="space-y-6 hidden">
                <div class="bg-black/50 border border-white/10 rounded-2xl p-4 sm:p-6 space-y-4">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                            <span>🎙️</span> Choose Provider & Enter Voice ID
                        </span>
                        <span class="text-[10px] bg-indigo-500/20 text-indigo-300 font-mono px-2.5 py-0.5 rounded-full border border-indigo-500/30">Auto-Prefix Normalization</span>
                    </div>

                    <!-- Provider Selection Pills -->
                    <div>
                        <span class="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Step 1: Choose Voice Provider</span>
                        <div id="studio-provider-pills" class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                            <button type="button" class="studio-provider-pill active px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-indigo-600 text-white border-indigo-400 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="edge">
                                <span class="shrink-0">🌐</span> <span class="truncate">MS Edge (Free)</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="kokoro">
                                <span class="shrink-0">🌸</span> <span class="truncate">Kokoro (Free)</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="elevenlabs">
                                <span class="shrink-0">🎙️</span> <span class="truncate">ElevenLabs</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="minimax">
                                <span class="shrink-0">🎭</span> <span class="truncate">Minimax</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="vbee">
                                <span class="shrink-0">🇻🇳</span> <span class="truncate">Vbee</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="fishaudio">
                                <span class="shrink-0">🐟</span> <span class="truncate">Fish Audio</span>
                            </button>
                            <button type="button" class="studio-provider-pill px-3 py-2 rounded-xl text-xs font-bold text-left transition border bg-black/60 text-gray-300 border-white/10 hover:border-white/30 cursor-pointer flex items-center gap-1.5 overflow-hidden" data-provider="clone">
                                <span class="shrink-0">👤</span> <span class="truncate">Cloned Voice</span>
                            </button>
                        </div>
                        <select id="studio-voice-provider-select" class="w-full bg-black border border-white/15 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none">
                            <option value="edge" selected>🌐 Microsoft Edge Neural (edge_ · Free)</option>
                            <option value="kokoro">🌸 Kokoro (kokoro_ · Free)</option>
                            <option value="elevenlabs">🎙️ ElevenLabs (elevenlabs_)</option>
                            <option value="minimax">🎭 Minimax (minimax_)</option>
                            <option value="vbee">🇻🇳 Vbee (vbee_)</option>
                            <option value="fishaudio">🐟 Fish Audio (fishaudio_)</option>
                            <option value="clone">👤 Cloned Voice (clone_)</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label for="studio-voice-id-input" class="block text-[10px] font-bold text-gray-400 uppercase mb-1.5">Step 2: Voice ID / Model Code</label>
                            <input type="text" id="studio-voice-id-input" class="w-full bg-black border border-white/15 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none font-mono placeholder:text-gray-600" placeholder="e.g., hpp4J3VqNfWA... or vi-VN-HoaiMyNeural">
                            <div class="text-[10px] text-indigo-300/80 font-mono mt-1 truncate">
                                Unified ID: <span class="text-indigo-200 font-bold" id="studio-voice-preview-text">elevenlabs_...</span> <span class="text-gray-500 text-[9px]">(Prefix auto-handled for direct ElevenLabs & AI33)</span>
                            </div>
                        </div>
                        <div>
                            <label for="studio-voice-name-input" class="block text-[10px] font-bold text-gray-400 uppercase mb-1.5">Step 3: Display Name (Optional)</label>
                            <input type="text" id="studio-voice-name-input" class="w-full bg-black border border-white/15 rounded-xl p-2.5 text-xs text-white focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder:text-gray-600" placeholder="e.g., Documentary Narrator">
                        </div>
                    </div>

                    <button id="studio-save-voice-btn" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition text-xs uppercase tracking-widest shadow-lg shadow-indigo-900/20 cursor-pointer">💾 Save to Voice Library & Use</button>
                </div>

                <!-- Saved Custom Voices Section -->
                <div>
                    <div class="flex items-center justify-between mb-3">
                        <h4 class="text-xs font-bold text-gray-300 uppercase tracking-wider">🌟 Your Saved Custom Voices</h4>
                        <span id="studio-saved-voices-count" class="text-[10px] text-gray-500 font-mono">0 saved</span>
                    </div>
                    <div id="studio-saved-voices-list" class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                        <!-- Populated dynamically -->
                        <div class="text-center py-6 text-gray-600 text-xs border border-dashed border-white/5 rounded-xl">
                            No custom voices saved yet. Add a voice above!
                        </div>
                    </div>
                </div>
            </div>

            <!-- Panel 2: Audio Sample Cloning -->
            <div id="voice-studio-panel-clone" class="space-y-6 hidden">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="cloning-voice-name" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">New Voice Name</label>
                        <input type="text" id="cloning-voice-name" class="w-full bg-black border border-white/10 rounded-xl p-3 text-sm text-white" placeholder="e.g., My Studio Voice">
                    </div>
                    <div>
                        <label for="cloning-provider" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Cloning Provider</label>
                        <select id="cloning-provider" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="minimax">🎭 Minimax (AI33)</option>
                            <option value="elevenlabs">🎙️ ElevenLabs (Requires Direct Key)</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label for="cloning-language" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Primary Language</label>
                        <select id="cloning-language" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="English">English</option>
                            <option value="Chinese">Chinese</option>
                        </select>
                    </div>
                    <div>
                        <label for="cloning-gender" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Gender (Optional)</label>
                        <select id="cloning-gender" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white">
                            <option value="">Auto-detect</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </div>
                </div>

                <div id="cloning-drop-zone" class="relative group h-32 bg-black/40 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500/50 transition-all">
                    <input type="file" id="cloning-file-input" class="hidden" accept="audio/*">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-600 mb-2 group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                    <p id="cloning-file-status" class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Click or drag audio file here</p>
                    <p class="text-[8px] text-gray-600 mt-1">Max 10MB (AI33 v3). Recommended: 10-15s clear isolated speech.</p>
                </div>

                <div>
                    <label for="cloning-preview-text" class="block text-[10px] font-bold text-gray-400 uppercase mb-2">Audio Preview Text</label>
                    <textarea id="cloning-preview-text" class="w-full bg-black border border-white/10 rounded-xl p-3 text-xs text-white h-20 resize-none" placeholder="Hello, this is my new cloned voice..."></textarea>
                </div>

                <div class="flex items-center gap-2">
                    <input type="checkbox" id="cloning-noise-reduction" checked class="w-3 h-3 rounded border-white/20 bg-black text-indigo-600">
                    <label for="cloning-noise-reduction" class="text-[10px] font-bold text-gray-400 uppercase">Apply AI Noise Reduction</label>
                </div>

                <button id="start-cloning-btn" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-xl transition uppercase tracking-widest shadow-lg shadow-indigo-900/20">🚀 Start Voice Cloning</button>
                
                <div id="cloning-status-log" class="hidden h-32 bg-black rounded-xl p-4 text-[10px] font-mono text-amber-400/80 overflow-y-auto custom-scrollbar border border-white/5">
                    <!-- Processing logs injected here -->
                </div>
            </div>
        </div>
    </div>
</div>

<!-- Collapsible Metadata Side-Panel (Shot Inspector Drawer) -->
<aside
  id="shot-inspector-drawer"
  class="vs-inspector-scope fixed top-0 right-0 z-50 h-full w-full max-w-md translate-x-full transition-transform duration-200 hidden flex flex-col border-l"
  aria-label="Shot Details Inspector"
>
  <!-- Top Header: Shot Badge, Prev/Next Navigation, Paste & Close -->
  <div class="panel-head" style="height: 38px; padding: 0 10px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 6px;">
    <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
      <span
        id="inspector-shot-badge"
        style="padding: 2px 7px; border-radius: var(--radius-xs); background: var(--accent-soft); color: var(--accent-text); font-family: var(--font-mono); font-size: 11px; font-weight: 600;"
      >
        Shot 1
      </span>
      <div style="display: inline-flex; gap: 2px;">
        <button type="button" id="inspector-prev-shot-btn" class="icon-btn small" title="Previous Shot">‹</button>
        <button type="button" id="inspector-next-shot-btn" class="icon-btn small" title="Next Shot">›</button>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 4px;">
      <button type="button" id="inspector-paste-btn" class="btn small" title="Paste image from clipboard (Ctrl+V)">
        📋 Paste
      </button>
      <button type="button" id="close-inspector-btn" class="icon-btn small" title="Close Inspector" aria-label="Close">
        ✕
      </button>
    </div>
  </div>

  <!-- Scrollable Inspector Body -->
  <div class="inspector-body" style="flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px;">
    <!-- 1. Media Preview Stage & Narrative Line -->
    <div class="insp-block">
      <div id="inspector-media-container"></div>
      <p
        id="inspector-narrative-text"
        style="margin: 6px 0 0; padding: 6px 8px; border-radius: var(--radius-xs); background: var(--bg-input); border: 1px solid var(--border); font-size: 11.5px; color: var(--text-2); line-height: 1.4;"
      ></p>
    </div>

    <!-- Quick Synthesis Action Bar -->
    <div class="insp-actions" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 10px;">
      <button type="button" id="inspector-generate-img-btn" class="btn small primary">🖼 Regen Image</button>
      <button type="button" id="inspector-animate-btn" class="btn small">🎬 Animate</button>
      <button type="button" id="inspector-map-btn" class="btn small">🗺 Map Shot</button>
    </div>

    <!-- 2. Timing, Duration & Source Video Trim -->
    <section class="prop-section">
      <div class="prop-section-head">
        <span>Timing & Trim</span>
        <div id="inspector-fit-duration-container" class="hidden" style="display: inline-flex; align-items: center; gap: 6px;">
          <span id="inspector-media-duration-text" class="num-readout"></span>
          <button type="button" id="inspector-fit-duration-btn" class="btn small" style="height: 22px; padding: 0 6px; font-size: 10.5px;">
            Fit Media
          </button>
        </div>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-duration-slider">Duration (s)</label>
        <div class="insp-row-control">
          <input type="range" id="inspector-duration-slider" min="0.5" max="30" step="0.1" value="5" />
          <input type="number" id="inspector-duration-input" class="num-input" min="0.5" max="120" step="0.1" value="5" />
        </div>
      </div>

      <!-- Source Video Trim Offset Controls (shown for video clips) -->
      <div id="inspector-video-trim-container" class="hidden" style="border-top: 1px solid var(--border); padding-top: 8px; margin-top: 4px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 11px; color: var(--text-3);">
          <span id="inspector-video-duration-badge">Clip: 0.0s</span>
          <span id="inspector-video-offset-val-text" style="font-family: var(--font-mono); color: var(--text-2);">In: 0.0s</span>
        </div>

        <div class="insp-row">
          <label class="field-label" for="inspector-video-offset-slider">Start Offset</label>
          <div class="insp-row-control">
            <input type="range" id="inspector-video-offset-slider" min="0" max="60" step="0.1" value="0" />
            <input type="number" id="inspector-video-offset-input" class="num-input" min="0" max="600" step="0.1" value="0" />
          </div>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <div id="inspector-video-play-range-info" style="font-size: 11px; color: var(--text-3); font-family: var(--font-mono);"></div>
          <div style="display: inline-flex; gap: 4px;">
            <button type="button" id="inspector-set-offset-from-video-btn" class="btn small" style="height: 22px; font-size: 11px;">Use Current</button>
            <button type="button" id="inspector-reset-offset-btn" class="btn small ghost" style="height: 22px; font-size: 11px;">Reset</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. Cinematography, Camera Motion & Keyframes (Phase 4 Integration) -->
    <section class="prop-section">
      <div class="prop-section-head">
        <span>Cinematography & Motion</span>
        <button
          type="button"
          id="inspector-toggle-keyframes-btn"
          class="btn small"
          style="height: 22px; padding: 0 8px; font-size: 11px;"
        >
          <span id="inspector-keyframes-toggle-icon">▸</span> Keyframes
        </button>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-camera-angle-select">Camera Angle</label>
        <div class="insp-row-control">
          <select id="inspector-camera-angle-select" class="select">
            <option value="eye_level">Eye Level</option>
            <option value="wide_shot">Wide Establishing</option>
            <option value="medium_shot">Medium Shot</option>
            <option value="close_up">Close-Up</option>
            <option value="extreme_close_up">Extreme Close-Up</option>
            <option value="low_angle">Low Hero Angle</option>
            <option value="high_angle">High Angle</option>
            <option value="aerial_drone">Aerial / Drone</option>
            <option value="dutch_angle">Dutch Tilt</option>
            <option value="over_shoulder">Over the Shoulder</option>
            <option value="custom">Custom Angle...</option>
          </select>
        </div>
      </div>

      <div id="inspector-custom-angle-container" class="insp-row hidden">
        <label class="field-label" for="inspector-custom-angle-input">Custom Angle</label>
        <div class="insp-row-control">
          <input type="text" id="inspector-custom-angle-input" class="input" placeholder="e.g., Bird's-eye macro..." />
        </div>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-camera-movement-select">Camera Move</label>
        <div class="insp-row-control">
          <select id="inspector-camera-movement-select" class="select">
            <option value="static">Static</option>
            <option value="slow_zoom_in">Slow Push-In</option>
            <option value="slow_zoom_out">Slow Pull-Out</option>
            <option value="pan_left">Pan Left</option>
            <option value="pan_right">Pan Right</option>
            <option value="tilt_up">Tilt Up</option>
            <option value="tilt_down">Tilt Down</option>
            <option value="handheld">Handheld Documentary</option>
            <option value="drone_flyover">Dynamic Orbit / Drone</option>
          </select>
        </div>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-lighting-preset-select">Lighting</label>
        <div class="insp-row-control">
          <select id="inspector-lighting-preset-select" class="select">
            <option value="">Default Scene Lighting</option>
            <option value="golden_hour">Golden Hour</option>
            <option value="cinematic_noir">High-Contrast Noir</option>
            <option value="neon_cyberpunk">Neon Rim Light</option>
            <option value="soft_studio">Soft Studio Key</option>
            <option value="moonlit">Cold Moonlight</option>
          </select>
        </div>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-lighting-prompt-input">Light Notes</label>
        <div class="insp-row-control">
          <textarea id="inspector-lighting-prompt-input" class="textarea" style="min-height: 44px;" placeholder="Optional lighting overrides..."></textarea>
        </div>
      </div>

      <!-- Collapsible Advanced Start/End Camera Keyframes -->
      <div id="inspector-keyframes-container" class="hidden" style="border-top: 1px solid var(--border); padding-top: 8px; margin-top: 6px;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 8px;">
          <button type="button" id="inspector-preset-to-kf-btn" class="btn small" style="flex: 1; height: 24px; font-size: 11px;">
            Convert Move → Keyframes
          </button>
          <button type="button" id="inspector-reverse-kf-btn" class="btn small" style="height: 24px; font-size: 11px;" title="Swap Start & End">
            ⇄ Reverse
          </button>
        </div>

        <!-- Start Frame -->
        <div style="padding: 6px 8px; border-radius: var(--radius-xs); background: var(--bg-input); border: 1px solid var(--border); margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 6px;">
            <span style="color: var(--accent-text);">Start Keyframe</span>
            <span id="inspector-kf-start-summary" class="num-readout">1.00x · (0.5, 0.5)</span>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-start-scale">Scale</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-start-scale" min="0.5" max="2.5" step="0.01" value="1" />
              <span id="inspector-kf-start-scale-val" class="num-readout">1.00x</span>
            </div>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-start-rot">Rotation</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-start-rot" min="-45" max="45" step="0.5" value="0" />
              <span id="inspector-kf-start-rot-val" class="num-readout">0.0°</span>
            </div>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-start-x">Center X</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-start-x" min="0" max="1" step="0.01" value="0.5" />
              <span id="inspector-kf-start-x-val" class="num-readout">0.50</span>
            </div>
          </div>
          <div class="insp-row" style="margin-bottom: 0;">
            <label class="field-label" for="inspector-kf-start-y">Center Y</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-start-y" min="0" max="1" step="0.01" value="0.5" />
              <span id="inspector-kf-start-y-val" class="num-readout">0.50</span>
            </div>
          </div>
        </div>

        <!-- End Frame -->
        <div style="padding: 6px 8px; border-radius: var(--radius-xs); background: var(--bg-input); border: 1px solid var(--border); margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 6px;">
            <span style="color: var(--warning);">End Keyframe</span>
            <span id="inspector-kf-end-summary" class="num-readout">1.10x · (0.5, 0.5)</span>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-end-scale">Scale</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-end-scale" min="0.5" max="2.5" step="0.01" value="1.1" />
              <span id="inspector-kf-end-scale-val" class="num-readout">1.10x</span>
            </div>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-end-rot">Rotation</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-end-rot" min="-45" max="45" step="0.5" value="0" />
              <span id="inspector-kf-end-rot-val" class="num-readout">0.0°</span>
            </div>
          </div>
          <div class="insp-row">
            <label class="field-label" for="inspector-kf-end-x">Center X</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-end-x" min="0" max="1" step="0.01" value="0.5" />
              <span id="inspector-kf-end-x-val" class="num-readout">0.50</span>
            </div>
          </div>
          <div class="insp-row" style="margin-bottom: 0;">
            <label class="field-label" for="inspector-kf-end-y">Center Y</label>
            <div class="insp-row-control">
              <input type="range" id="inspector-kf-end-y" min="0" max="1" step="0.01" value="0.5" />
              <span id="inspector-kf-end-y-val" class="num-readout">0.50</span>
            </div>
          </div>
        </div>

        <div class="insp-row" style="margin-bottom: 0;">
          <label class="field-label" for="inspector-kf-easing-select">Easing</label>
          <div class="insp-row-control">
            <select id="inspector-kf-easing-select" class="select">
              <option value="easeInOut">Ease In-Out</option>
              <option value="linear">Linear</option>
              <option value="easeIn">Ease In</option>
              <option value="easeOut">Ease Out</option>
              <option value="whip">Editorial Whip</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. Layout, PiP Overlay, Dual Layer & Talking Head -->
    <section class="prop-section">
      <div class="prop-section-head">
        <span>Layout, PiP & Layers</span>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-display-mode-select">Display Mode</label>
        <div class="insp-row-control">
          <select id="inspector-display-mode-select" class="select">
            <option value="fullscreen">Full Frame</option>
            <option value="pip_overlay">PiP B-Roll Card</option>
          </select>
        </div>
      </div>

      <!-- PiP Controls (#inspector-pip-controls) -->
      <div id="inspector-pip-controls" class="hidden" style="padding: 6px 8px; border-radius: var(--radius-xs); background: var(--bg-input); border: 1px solid var(--border); margin-bottom: 8px;">
        <div class="insp-row">
          <label class="field-label" for="inspector-pip-position-select">PiP Corner</label>
          <div class="insp-row-control">
            <select id="inspector-pip-position-select" class="select">
              <option value="top_right">Top Right</option>
              <option value="top_left">Top Left</option>
              <option value="bottom_right">Bottom Right</option>
              <option value="bottom_left">Bottom Left</option>
              <option value="center_right">Center Right</option>
              <option value="center_left">Center Left</option>
              <option value="custom">Custom (Drag on Canvas)</option>
            </select>
          </div>
        </div>
        <div class="insp-row">
          <label class="field-label" for="inspector-pip-animation-select">Entrance</label>
          <div class="insp-row-control">
            <select id="inspector-pip-animation-select" class="select">
              <option value="pop_spring">Spring Pop</option>
              <option value="slide_in">Slide In</option>
              <option value="zoom_fade">Zoom Fade</option>
              <option value="fade">Crossfade</option>
            </select>
          </div>
        </div>
        <div class="insp-row" style="margin-bottom: 0;">
          <label class="field-label" for="inspector-pip-scale-range">Card Size</label>
          <div class="insp-row-control">
            <input type="range" id="inspector-pip-scale-range" min="0.18" max="0.65" step="0.01" value="0.34" />
            <span id="inspector-pip-scale-val" class="num-readout">34%</span>
          </div>
        </div>
      </div>

      <!-- Dual Media Layer Stack (#inspector-dual-media-panel) -->
      <div id="inspector-dual-media-panel" class="hidden" style="padding: 6px 8px; border-radius: var(--radius-xs); background: var(--bg-input); border: 1px solid var(--border); margin-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 11px;">
          <div>
            <span id="inspector-layer1-label" style="font-weight: 600;">Layer 1</span>
            <span id="inspector-layer1-badge" style="color: var(--text-3); margin-left: 4px;">Base</span>
          </div>
          <button type="button" id="inspector-swap-layers-btn" class="btn small" style="height: 22px; font-size: 11px;">⇅ Swap</button>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11px;">
          <div>
            <span id="inspector-layer2-label" style="font-weight: 600;">Layer 2</span>
            <span id="inspector-layer2-badge" style="color: var(--accent-text); margin-left: 4px;">Overlay</span>
          </div>
          <div style="display: inline-flex; gap: 4px;">
            <button type="button" id="inspector-upload-layer2-btn" class="btn small" style="height: 22px; font-size: 11px;">+ Upload</button>
            <button type="button" id="inspector-clear-layer2-btn" class="btn small ghost" style="height: 22px; font-size: 11px;">Clear</button>
          </div>
        </div>
      </div>

      <!-- Talking Head A-Roll Framing -->
      <div class="insp-row">
        <label class="field-label" for="inspector-talking-head-mode-select">Presenter</label>
        <div class="insp-row-control">
          <select id="inspector-talking-head-mode-select" class="select">
            <option value="none">Hidden (B-Roll Only)</option>
            <option value="full">Full Screen A-Roll</option>
            <option value="pip-br">Corner PiP (Bottom Right)</option>
            <option value="pip-bl">Corner PiP (Bottom Left)</option>
            <option value="pip-tr">Corner PiP (Top Right)</option>
            <option value="pip-tl">Corner PiP (Top Left)</option>
            <option value="split">Split Screen</option>
          </select>
        </div>
      </div>
      <div class="insp-row">
        <label class="field-label" for="inspector-talking-head-shape-select">Mask Shape</label>
        <div class="insp-row-control">
          <select id="inspector-talking-head-shape-select" class="select">
            <option value="circle">Circle</option>
            <option value="rounded">Rounded Card</option>
            <option value="square">Sharp Rectangle</option>
          </select>
          <select id="inspector-talking-head-size-select" class="select" style="max-width: 92px;">
            <option value="sm">Small</option>
            <option value="md" selected>Medium</option>
            <option value="lg">Large</option>
          </select>
        </div>
      </div>
      <p id="inspector-talking-head-hint" class="hidden" style="margin: 0 0 6px; font-size: 11px; color: var(--text-3);"></p>

      <div class="insp-row">
        <label class="field-label" for="inspector-clip-device">Device Frame</label>
        <div class="insp-row-control">
          <select id="inspector-clip-device" class="select">
            <option value="none">No Frame</option>
            <option value="laptop">Laptop Mockup</option>
            <option value="phone">Phone Mockup</option>
            <option value="browser">Browser Window</option>
          </select>
          <select id="inspector-clip-rotation" class="select" style="max-width: 82px;" title="Rotation">
            <option value="0">0°</option>
            <option value="90">90°</option>
            <option value="180">180°</option>
            <option value="270">270°</option>
          </select>
        </div>
      </div>

      <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-2); cursor: pointer;">
        <input type="checkbox" id="inspector-preserve-content-toggle" style="accent-color: var(--accent);" />
        <span>Contain full frame (prevent edge cropping)</span>
      </label>
    </section>

    <!-- 5. Clip Audio, Speed (WSOLA) & Fades -->
    <section class="prop-section">
      <div class="prop-section-head">
        <span>Clip Audio & Speed</span>
        <button type="button" id="inspector-extract-audio-btn" class="btn small" style="height: 22px; padding: 0 7px; font-size: 10.5px;">
          🔊 Extract WAV
        </button>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-clip-speed-slider">Speed</label>
        <div class="insp-row-control">
          <input type="range" id="inspector-clip-speed-slider" min="0.25" max="3" step="0.05" value="1" />
          <span id="inspector-clip-speed-label" class="num-readout">1.00x</span>
        </div>
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; font-size: 11.5px; color: var(--text-2);">
        <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="checkbox" id="inspector-use-original-audio" style="accent-color: var(--accent);" />
          <span>Use clip audio</span>
        </label>
        <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="checkbox" id="inspector-clip-solo-audio-checkbox" style="accent-color: var(--accent);" />
          <span>Solo clip (mute VO)</span>
        </label>
        <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="checkbox" id="inspector-clip-ducking-checkbox" style="accent-color: var(--accent);" />
          <span>Auto-duck BGM</span>
        </label>
      </div>

      <div id="inspector-audio-stack-warning" class="insp-note hidden">
        Both voiceover and clip audio are active. Enable Solo Clip if you want to mute narration during this shot.
      </div>

      <div id="inspector-clip-audio-controls">
        <div class="insp-row">
          <label class="field-label" for="inspector-clip-volume-slider">Clip Volume</label>
          <div class="insp-row-control">
            <input type="range" id="inspector-clip-volume-slider" min="0" max="2" step="0.05" value="1" />
            <span id="inspector-clip-volume-label" class="num-readout">100%</span>
          </div>
        </div>
        <div class="insp-row" style="margin-bottom: 0;">
          <label class="field-label" for="inspector-clip-fade-in">Audio Fades</label>
          <div class="insp-row-control">
            <span style="font-size: 11px; color: var(--text-3);">In</span>
            <input type="number" id="inspector-clip-fade-in" class="num-input" min="0" max="5" step="0.1" value="0" />
            <span style="font-size: 11px; color: var(--text-3);">Out</span>
            <input type="number" id="inspector-clip-fade-out" class="num-input" min="0" max="5" step="0.1" value="0" />
          </div>
        </div>
      </div>
    </section>

    <!-- 6. Per-Clip Color Look & Prompts -->
    <section class="prop-section" style="margin-bottom: 0;">
      <div class="prop-section-head">
        <span>Color Look & Prompts</span>
        <span id="inspector-filter-status-badge" style="font-size: 10.5px; color: var(--accent-text);">None</span>
      </div>

      <div class="insp-row">
        <label class="field-label" for="inspector-color-filter-select">Color Grade</label>
        <div class="insp-row-control">
          <select id="inspector-color-filter-select" class="select">
            <option value="none">None (Project Default)</option>
            <option value="cinematic_teal_orange">Teal & Orange</option>
            <option value="kodak_2383">Film Print 2383</option>
            <option value="bleach_bypass">Bleach Bypass</option>
            <option value="vintage_warm">Warm Vintage</option>
            <option value="noir_bw">High-Contrast B&W</option>
            <option value="cyberpunk">Cyberpunk Neon</option>
          </select>
        </div>
      </div>

      <div id="inspector-filter-intensity-container" class="insp-row hidden">
        <label class="field-label" for="inspector-filter-intensity-slider">Intensity</label>
        <div class="insp-row-control">
          <input type="range" id="inspector-filter-intensity-slider" min="0" max="100" step="1" value="100" />
          <span id="inspector-filter-intensity-val" class="num-readout">100%</span>
        </div>
      </div>

      <div class="insp-row" style="align-items: start;">
        <label class="field-label" for="inspector-image-prompt-input" style="padding-top: 6px;">Image Prompt</label>
        <div class="insp-row-control">
          <textarea id="inspector-image-prompt-input" class="textarea" rows="3"></textarea>
        </div>
      </div>

      <div class="insp-row" style="margin-bottom: 0;">
        <label class="field-label" for="inspector-broll-prompt-input">B-Roll Search</label>
        <div class="insp-row-control">
          <input type="text" id="inspector-broll-prompt-input" class="input" placeholder="Pexels keyword or motion prompt..." />
        </div>
      </div>
    </section>
  </div>

  <!-- Sticky Footer: Save / Apply Changes -->
  <div style="padding: 8px 12px; border-top: 1px solid var(--border); background: var(--bg-panel); display: flex; justify-content: flex-end;">
    <button type="button" id="inspector-apply-btn" class="btn primary block">
      Apply Shot Changes
    </button>
  </div>
</aside>

<!-- Dedicated Video Export Settings Modal -->
<div id="export-settings-modal" class="fixed inset-0 z-[120] hidden flex items-center justify-center bg-black/80 backdrop-blur-md p-4 transition-all duration-200">
    <div class="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col text-gray-200 transform transition-all scale-100">
        <!-- Modal Header -->
        <div class="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
            <div class="flex items-center gap-3">
                <div class="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                </div>
                <div>
                    <h3 class="text-sm font-bold text-white tracking-wide">Export Video Settings</h3>
                    <p class="text-xs text-zinc-400">Configure export format, resolution, frame rate and encoding quality</p>
                </div>
            </div>
            <button id="close-export-settings-modal-btn" class="text-zinc-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-zinc-800">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>

        <!-- Modal Body -->
        <div class="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
            <!-- Guest Account Export Restriction Banner -->
            <div id="export-guest-warning" class="hidden rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 space-y-2.5">
                <div class="flex items-start gap-3">
                    <div class="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                            <h4 id="export-guest-warning-title" class="text-xs font-bold text-amber-300 uppercase tracking-wider">Guest Account Preview</h4>
                            <span id="export-guest-warning-badge" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">320p + Watermark</span>
                        </div>
                        <p id="export-guest-warning-desc" class="text-xs text-zinc-300 mt-1 leading-relaxed">
                            Video exports for guest sessions are restricted to <strong class="text-white font-semibold">320p Preview Quality with Watermark</strong>. To export in 1080p, 4K, 60 FPS and watermark-free, sign in or create an account.
                        </p>
                        <div class="pt-2 flex items-center gap-3">
                            <button id="export-guest-signin-btn" type="button" class="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs px-3.5 py-1.5 rounded-lg shadow-sm flex items-center gap-1.5 transition-all cursor-pointer">
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                                <span>Sign In / Create Account</span>
                            </button>
                            <span class="text-[11px] text-zinc-400">Unlock HD & Remove Watermark</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Rendering Engine Selector (Browser Local vs Remotion Cloud Render) -->
            <div class="bg-zinc-950/80 border border-zinc-800 rounded-xl p-3.5 space-y-3">
                <div class="flex items-center justify-between">
                    <span class="block text-xs font-semibold text-zinc-200 uppercase tracking-wider">Rendering Engine</span>
                    <div id="cloud-render-quota-badge" class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                        <span>☁️</span>
                        <span id="cloud-render-quota-text">300m remaining</span>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2.5">
                    <!-- Browser Local Render Option -->
                    <label class="relative flex flex-col p-3 rounded-xl border border-indigo-500 bg-indigo-950/20 cursor-pointer transition-all select-none" id="export-engine-card-local">
                        <input type="radio" name="export-render-engine" value="local" id="export-engine-local" class="sr-only" checked>
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-white flex items-center gap-1.5">
                                <span>💻</span> Local Browser
                            </span>
                            <span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 font-semibold uppercase">Free</span>
                        </div>
                        <p class="text-[10px] text-zinc-400 mt-1 leading-tight">Renders directly in your browser. No cloud minutes consumed.</p>
                    </label>

                    <!-- Cloud Render Cluster Option -->
                    <label class="relative flex flex-col p-3 rounded-xl border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 cursor-pointer transition-all select-none" id="export-engine-card-cloud">
                        <input type="radio" name="export-render-engine" value="cloud" id="export-engine-cloud" class="sr-only">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                                <span>☁️</span> Cloud Render
                                <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">Beta</span>
                            </span>
                            <span id="cloud-render-cost-badge" class="text-[9px] px-1.5 py-0.5 rounded bg-indigo-900/60 text-indigo-300 border border-indigo-700/50 font-mono font-semibold">GCP / AWS / Headless</span>
                        </div>
                        <p class="text-[10px] text-zinc-400 mt-1 leading-tight">Serverless & headless cloud workers. Offloads rendering to cloud.</p>
                    </label>
                </div>

                <!-- Cloud Info & Provider Selector (Hidden by default until Cloud is selected) -->
                <div id="cloud-render-info-box" class="hidden p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/50 text-[11px] text-indigo-200 space-y-2.5">
                    <div class="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] text-amber-200/90 leading-tight">
                        <span class="text-xs shrink-0">⚠️</span>
                        <span><strong>Beta Feature:</strong> Cloud rendering infrastructure is actively in development. If your cloud render experiences queue delays, switch back to <strong>Local Browser</strong> export anytime.</span>
                    </div>

                    <div class="flex items-center justify-between font-semibold pb-2 border-b border-indigo-800/40">
                        <span>Video duration: <span id="cloud-render-duration-est" class="text-amber-300 font-mono">00:00</span></span>
                        <span>Deduction: <span id="cloud-render-deduct-est" class="text-white font-mono">~1 min</span></span>
                    </div>

                    <!-- Cloud Provider Dropdown -->
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between">
                            <label for="cloud-render-provider-select" class="block text-xs font-bold text-zinc-200 uppercase tracking-wider">Cloud Infrastructure</label>
                            <span id="cloud-render-rate-badge" class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 flex items-center gap-1">
                                <span>☁️</span> 1x Standard Rate
                            </span>
                        </div>
                        <select id="cloud-render-provider-select" class="w-full bg-zinc-900 text-zinc-100 text-xs font-medium border border-indigo-700/60 rounded-xl p-2.5 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none cursor-pointer">
                            <option value="gcp" selected>Google Cloud Run (GCP) — 1x Quota Rate</option>
                            <option value="aws">AWS Lambda (Amazon Web Services) — 1x Quota Rate</option>
                            <option value="headless">Headless Server (Chromium + FFmpeg) — 2x Quota Rate (Double Hours)</option>
                        </select>
                        <p id="cloud-render-provider-desc" class="text-[10px] text-indigo-300/80 leading-relaxed">
                            Renders on Google Cloud Run serverless container clusters with high concurrency.
                        </p>
                    </div>

                    <div class="pt-2 flex items-center justify-between border-t border-indigo-800/40 mt-1">
                        <span class="text-[10px] text-indigo-300">Safe to close window during render.</span>
                        <button type="button" id="cloud-render-open-history-btn" class="text-[11px] font-semibold text-white bg-indigo-800/60 hover:bg-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-600/40 transition-colors cursor-pointer flex items-center gap-1">
                            <span>☁️</span> Check Cloud Renders
                        </button>
                    </div>
                </div>
            </div>

            <!-- Live Export Summary Card -->
            <div class="bg-gradient-to-r from-zinc-800/90 to-zinc-900/90 border border-zinc-700/70 rounded-xl p-4 flex items-center justify-between shadow-inner">
                <div class="space-y-1">
                    <div class="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">Output Summary</div>
                    <div id="export-summary-resolution-badge" class="text-sm font-bold text-indigo-300 flex items-center gap-2">
                        1080p Full HD (1920×1080)
                    </div>
                    <div class="text-xs text-zinc-400 flex items-center gap-2 pt-0.5">
                        <span id="export-summary-format-badge" class="font-bold text-white bg-indigo-600/80 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide">MP4</span>
                        <span id="export-summary-fps-badge" class="text-zinc-300 font-medium">30 FPS</span>
                        <span>•</span>
                        <span id="export-summary-quality-badge" class="text-emerald-400 font-medium">Medium Quality</span>
                    </div>
                </div>
                <div class="text-right border-l border-zinc-700/60 pl-4">
                    <div class="text-[10px] uppercase font-semibold text-zinc-500 tracking-wider">Video Duration</div>
                    <div id="export-summary-duration" class="text-base font-mono font-bold text-amber-300">00:00</div>
                </div>
            </div>

            
            <!-- Settings Form -->
            <div class="space-y-4">
            
                <!-- File Name -->
                <div>
                    <label for="video-export-filename" class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">File Name</label>
                    <input type="text" id="video-export-filename" class="w-full bg-zinc-800 text-zinc-100 text-xs font-medium border border-zinc-700 rounded-xl p-2.5 px-3 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none placeholder-zinc-500" placeholder="Auto-generated from script (or enter custom name)" value="">
                </div>
                
                <!-- Save Location -->
                <div>
                    <span class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">Save Location</span>
                    <div class="flex items-center gap-2">
                        <div id="export-save-path" class="flex-1 truncate bg-zinc-800 text-zinc-400 text-xs font-mono border border-zinc-700 rounded-xl p-2.5 px-3">Downloads (Default)</div>
                        <button id="change-export-dir-btn" class="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1.5 shadow-sm">
                            <i class="fas fa-folder-open"></i> Change
                        </button>
                    </div>
                </div>

                <!-- Export Format -->

                <div>
                    <label for="video-export-format" class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">Export Format</label>
                    <select id="video-export-format" class="w-full bg-zinc-800 text-zinc-100 text-xs font-medium border border-zinc-700 rounded-xl p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer">
                        <option value="mp4" selected>MP4 Video (H.264 / AAC - Recommended)</option>
                        <option value="mp4-ffmpeg">MP4 Video (FFmpeg Hardware Export - Beta)</option>
                        <option value="webm">WebM Video (VP9 / Opus - Web Native)</option>
                        <option value="xml">Final Cut Pro XML (Editable NLE Project)</option>
                    </select>
                </div>

                <!-- Resolution -->
                <div>
                    <label for="video-export-resolution" class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">Resolution & Aspect Ratio</label>
                    <select id="video-export-resolution" class="w-full bg-zinc-800 text-zinc-100 text-xs font-medium border border-zinc-700 rounded-xl p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer">
                        <optgroup label="Horizontal (16:9 Landscape)">
                            <option value="1080p" selected>1080p Full HD (1920×1080) - Standard</option>
                            <option value="4k">4K Ultra HD (3840×2160) - High Quality</option>
                            <option value="720p">720p HD (1280×720) - Compact</option>
                        </optgroup>
                        <optgroup label="Vertical (9:16 Shorts / Reels / TikTok)">
                            <option value="9x16-hd">1080p Vertical (1080×1920)</option>
                            <option value="9x16-4k">1440p Vertical (1440×2560)</option>
                            <option value="9x16-sd">720p Vertical (720×1280)</option>
                        </optgroup>
                        <optgroup label="Square (1:1 Social)">
                            <option value="1x1-hd">1080p Square (1080×1080)</option>
                            <option value="1x1-sd">720p Square (720×720)</option>
                        </optgroup>
                        <optgroup label="Standard (4:3 Classic)">
                            <option value="4x3-hd">1080p Classic (1440×1080)</option>
                            <option value="4x3-sd">768p Classic (1024×768)</option>
                        </optgroup>
                        <optgroup label="Portrait (3:4 Social)">
                            <option value="3x4-hd">1440p Portrait (1080×1440)</option>
                            <option value="3x4-sd">1024p Portrait (768×1024)</option>
                        </optgroup>
                        <optgroup label="Guest Preview (320p + Watermark)">
                            <option value="320p">320p Landscape Preview (568×320)</option>
                            <option value="9x16-320p">320p Vertical Preview (320×568)</option>
                            <option value="1x1-320p">320p Square Preview (320×320)</option>
                            <option value="4x3-320p">320p Classic Preview (426×320)</option>
                            <option value="3x4-320p">320p Portrait Preview (320×426)</option>
                        </optgroup>
                    </select>
                </div>

                <!-- FPS & Quality Grid -->
                <div class="grid grid-cols-2 gap-3">
                    <!-- FPS -->
                    <div>
                        <label for="video-export-fps" class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">Frame Rate (FPS)</label>
                        <select id="video-export-fps" class="w-full bg-zinc-800 text-zinc-100 text-xs font-medium border border-zinc-700 rounded-xl p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer">
                            <option value="30" selected>30 FPS (Standard Smooth)</option>
                            <option value="60">60 FPS (High-FPS Cinema)</option>
                        </select>
                    </div>

                    <!-- Quality -->
                    <div>
                        <label for="video-export-quality" class="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">Quality / Bitrate</label>
                        <select id="video-export-quality" class="w-full bg-zinc-800 text-zinc-100 text-xs font-medium border border-zinc-700 rounded-xl p-2.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none cursor-pointer">
                            <option value="low">Low (Smaller File Size)</option>
                            <option value="medium" selected>Medium (Standard Quality)</option>
                            <option value="high">High (ProRes Quality)</option>
                        </select>
                    </div>
                </div>

                <!-- Sidecar Subtitles Option -->
                <div class="pt-2">
                    <label class="flex items-center gap-2.5 cursor-pointer select-none group">
                        <input type="checkbox" id="video-export-subtitles-checkbox" class="w-4 h-4 rounded text-indigo-600 bg-zinc-800 border-zinc-700 focus:ring-indigo-500 focus:ring-offset-zinc-900 cursor-pointer">
                        <span class="text-xs font-medium text-zinc-300 group-hover:text-white transition-colors">Export sidecar subtitle file (.srt) alongside video</span>
                    </label>
                </div>

                <!-- Audio Normalizing & Multi-Bus Mastering -->
                <div class="pt-2 border-t border-zinc-800/80 space-y-2">
                    <label class="flex items-center gap-2.5 cursor-pointer select-none group">
                        <input type="checkbox" id="video-export-normalize-audio-checkbox" class="w-4 h-4 rounded text-indigo-500 bg-zinc-800 border-zinc-700 focus:ring-indigo-500 focus:ring-offset-zinc-900 cursor-pointer" checked>
                        <div>
                            <span class="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">Auto-Normalize & Multi-Source Limiter</span>
                            <p class="text-[10px] text-zinc-400 leading-tight">Prevents clipping distortion when mixing voiceover, clip audio, SFX, and BGM.</p>
                        </div>
                    </label>
                    <label class="flex items-center gap-2.5 cursor-pointer select-none group">
                        <input type="checkbox" id="video-export-audio-ducking-checkbox" class="w-4 h-4 rounded text-indigo-500 bg-zinc-800 border-zinc-700 focus:ring-indigo-500 focus:ring-offset-zinc-900 cursor-pointer" checked>
                        <div>
                            <span class="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">Auto-Duck Background Music & Ambient Sound</span>
                            <p class="text-[10px] text-zinc-400 leading-tight">Smoothly attenuates music and b-roll during active dialogue timestamps.</p>
                        </div>
                    </label>
                </div>

                <!-- Clean Container Metadata & Device Signature (Anti-AI Tagging) -->
                <div class="pt-2 border-t border-zinc-800/80">
                    <div class="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-2.5">
                        <div class="flex items-start justify-between gap-2">
                            <label class="flex items-center gap-2.5 cursor-pointer select-none group">
                                <input type="checkbox" id="video-export-clean-metadata-checkbox" class="w-4 h-4 rounded text-emerald-500 bg-zinc-800 border-zinc-700 focus:ring-emerald-500 focus:ring-offset-zinc-900 cursor-pointer" checked>
                                <div>
                                    <span class="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors flex items-center gap-1.5">
                                        <svg class="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                                        Clean Metadata & Device Profile (Anti-AI Tagging)
                                    </span>
                                    <p class="text-[10px] text-zinc-400 leading-tight mt-0.5">Removes C2PA / AI container markers and injects an authentic device profile based on export format (for example: iPhone for vertical exports, Canon EOS R5 for 16:9 exports).</p>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal Footer -->
        <div class="px-6 py-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3">
            <button id="export-audio-data-btn" class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-white transition-colors border border-zinc-700" title="Download Transcripts">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                <span>Download Subtitles (.srt)</span>
            </button>
            <div class="flex items-center gap-3">
                <button id="cancel-export-settings-modal-btn" class="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800">
                    Cancel
                </button>
                <button id="start-export-process-btn" class="px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span>Render & Export</span>
                </button>
            </div>
        </div>
    </div>
</div>

<!-- Director Review Loop ("Magic Polish") Modal -->
<div id="director-review-modal" class="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[95] hidden">
    <div class="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col animate-scale-up">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
                <div class="p-2 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-400">
                    <span class="text-xl">🪄</span>
                </div>
                <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                        AI Director Review & Critique Pass
                        <span id="director-review-score-badge" class="px-2 py-0.5 text-xs font-extrabold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">92/100</span>
                    </h3>
                    <p class="text-xs text-zinc-400">Holistic edit analysis: pacing metrics, shot rhythm, narration sync, and cinematography.</p>
                </div>
            </div>
            <button id="close-director-review-modal-btn" class="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>

        <!-- Body -->
        <div class="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
            <!-- Executive Summary Card -->
            <div class="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4 relative overflow-hidden">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <span>📊 Executive Critique</span>
                    </span>
                    <span id="director-review-cadence-badge" class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        Dynamic Explainer Cadence
                    </span>
                </div>
                <p id="director-review-summary" class="text-xs text-zinc-300 leading-relaxed italic">
                    Analyzing timeline structure, pacing rhythm, and visual engagement...
                </p>

                <!-- Pacing Metrics Grid -->
                <div id="director-review-metrics-container" class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-3 border-t border-zinc-800/60">
                    <div class="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800 text-center">
                        <span class="text-[10px] text-zinc-400 uppercase tracking-wider block">Avg Shot Length</span>
                        <span id="metric-avg-shot" class="text-sm font-bold text-white">4.2s</span>
                    </div>
                    <div class="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800 text-center">
                        <span class="text-[10px] text-zinc-400 uppercase tracking-wider block">Words / Min</span>
                        <span id="metric-wpm" class="text-sm font-bold text-white">152 WPM</span>
                    </div>
                    <div class="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800 text-center">
                        <span class="text-[10px] text-zinc-400 uppercase tracking-wider block">Shots / Min</span>
                        <span id="metric-spm" class="text-sm font-bold text-white">14.3</span>
                    </div>
                    <div class="bg-zinc-900/80 p-2 rounded-lg border border-zinc-800 text-center">
                        <span class="text-[10px] text-zinc-400 uppercase tracking-wider block">Pacing Variance</span>
                        <span id="metric-variance" class="text-sm font-bold text-emerald-400">Optimal</span>
                    </div>
                </div>
            </div>

            <!-- Suggestions Section -->
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span>🎯 Actionable Improvements</span>
                        <span id="director-review-suggestion-count" class="text-[10px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full font-mono">0</span>
                    </h4>
                    <span class="text-[10px] text-zinc-500">Ranked by retention & narrative impact</span>
                </div>

                <div id="director-review-suggestions-list" class="space-y-2.5">
                    <!-- Dynamic suggestion cards injected here -->
                </div>
            </div>
        </div>

        <!-- Footer Actions -->
        <div class="px-6 py-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between flex-shrink-0">
            <button id="reanalyze-director-review-btn" class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-white rounded-xl transition-colors border border-zinc-700 cursor-pointer">
                <span>🔄</span>
                <span>Re-Analyze Timeline</span>
            </button>
            <div class="flex items-center gap-3">
                <button id="close-director-review-btn" class="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800 cursor-pointer">
                    Done
                </button>
                <button id="apply-all-director-suggestions-btn" class="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 rounded-xl shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer">
                    <span>⚡</span>
                    <span>Apply All Suggestions</span>
                </button>
            </div>
        </div>
    </div>
</div>

<!-- Auto Pattern Interrupt Modal -->
<div id="pattern-interrupt-modal" class="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-[95] hidden">
    <div class="bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl overflow-hidden max-w-4xl w-full max-h-[92vh] flex flex-col animate-scale-up">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-zinc-800 bg-zinc-950/80 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
                <div class="p-2.5 rounded-xl bg-amber-950/60 border border-amber-500/30 text-amber-400">
                    <span class="text-xl">⚡</span>
                </div>
                <div>
                    <h3 class="text-base font-bold text-white flex items-center gap-2">
                        Auto Pattern Interrupt
                        <span id="pi-candidates-count-badge" class="px-2.5 py-0.5 text-xs font-extrabold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Analyzing...</span>
                    </h3>
                    <p class="text-xs text-zinc-400">Timeline Intelligence Layer: detects visual & rhythmic monotony, then introduces motivated resets to maintain viewer attention.</p>
                </div>
            </div>
            <button id="close-pattern-interrupt-modal-btn" class="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>

        <!-- Body -->
        <div class="p-6 overflow-y-auto custom-scrollbar flex-grow space-y-6">
            <!-- Controls & Intelligence Bar -->
            <div class="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4.5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/70 pb-3.5">
                    <!-- Intensity Level Switcher -->
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-zinc-300">Sensitivity:</span>
                        <div class="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
                            <button type="button" data-pi-intensity="low" class="px-3 py-1.5 text-xs font-semibold rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer">Low</button>
                            <button type="button" data-pi-intensity="medium" class="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-600 text-white shadow-sm border border-amber-400/40 cursor-pointer">Medium</button>
                            <button type="button" data-pi-intensity="high" class="px-3 py-1.5 text-xs font-semibold rounded-md text-zinc-400 hover:text-white transition-colors cursor-pointer">High</button>
                        </div>
                    </div>

                    <!-- Interrupt Style Preset -->
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-zinc-300">Style:</span>
                        <select id="pi-style-select" class="bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-1.5 outline-none focus:border-amber-500 cursor-pointer font-medium">
                            <option value="automatic">🤖 Automatic (Adaptive intent)</option>
                            <option value="cinematic">🎬 Cinematic (Subtle push-in & drift)</option>
                            <option value="documentary">📚 Documentary (Context cards & stats)</option>
                            <option value="high_retention">⚡ High Retention (Snappy punch-in & text)</option>
                            <option value="subtle">🧘 Subtle (108% micro punch-ins only)</option>
                        </select>
                    </div>

                    <!-- Pacing Constraint Selectors -->
                    <div class="flex items-center gap-3 flex-wrap">
                        <div class="flex items-center gap-1.5">
                            <span class="text-[11px] text-zinc-400">Max / Min:</span>
                            <select id="pi-max-per-min" class="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1 outline-none cursor-pointer">
                                <option value="1">1 / min</option>
                                <option value="2" selected>2 / min</option>
                                <option value="3">3 / min</option>
                                <option value="4">4 / min</option>
                            </select>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <span class="text-[11px] text-zinc-400">Cooldown:</span>
                            <select id="pi-min-cooldown" class="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2 py-1 outline-none cursor-pointer">
                                <option value="4">4 sec</option>
                                <option value="6" selected>6 sec</option>
                                <option value="8">8 sec</option>
                                <option value="10">10 sec</option>
                            </select>
                        </div>
                        <label class="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                            <input type="checkbox" id="pi-avoid-consecutive" class="w-3.5 h-3.5 rounded text-amber-500 bg-zinc-900 border-zinc-700 cursor-pointer" checked />
                            <span>Avoid consecutive types</span>
                        </label>
                    </div>
                </div>

                <!-- Detection Analysis Tags & Summary -->
                <div class="flex flex-col gap-2">
                    <p id="pi-summary-text" class="text-xs text-zinc-300 leading-relaxed italic">
                        Scanning timeline for visual composition monotony, camera movements, speech emphasis, and overlay gaps...
                    </p>
                    <div class="flex items-center gap-2 flex-wrap text-[10px] text-zinc-400 font-mono">
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Visual monotony</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Speech emphasis</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Scene duration</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Subtitle density</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Camera movement</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Existing overlays</span>
                        <span class="bg-zinc-900 px-2 py-0.5 rounded border border-white/5 text-emerald-400">✓ Narrative importance</span>
                    </div>
                </div>
            </div>

            <!-- Live Pattern Interrupt Simulated Preview Player -->
            <div id="pi-preview-player-container" class="bg-zinc-950/90 border border-amber-500/30 rounded-xl p-4 space-y-3 hidden shadow-lg shadow-amber-950/20">
                <div class="flex items-center justify-between flex-wrap gap-2">
                    <div class="flex items-center gap-2.5">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/20 text-amber-300 text-sm font-bold border border-amber-500/30">⚡</span>
                        <div>
                            <div class="flex items-center gap-2">
                                <h4 id="pi-preview-title" class="text-xs font-bold text-white">Previewing Intervention</h4>
                                <span id="pi-preview-type-badge" class="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">Punch-in Zoom</span>
                            </div>
                            <p id="pi-preview-quote" class="text-[11px] text-zinc-400 italic truncate max-w-md mt-0.5">"..."</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" id="pi-preview-toggle-mode-btn" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 transition flex items-center gap-1.5 cursor-pointer" title="Toggle Before vs After effect simulation">
                            <span>✨</span> <span id="pi-preview-mode-label">Effect: Simulated</span>
                        </button>
                        <button type="button" id="pi-preview-sync-main-btn" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/60 transition flex items-center gap-1 cursor-pointer" title="Sync main timeline playhead to this moment">
                            <span>📍</span> <span>Sync Main Player</span>
                        </button>
                    </div>
                </div>

                <!-- Preview Canvas Wrapper -->
                <div class="relative w-full max-w-xl mx-auto aspect-video rounded-xl bg-black overflow-hidden border border-zinc-800 shadow-2xl flex items-center justify-center group">
                    <canvas id="pi-preview-canvas" width="640" height="360" class="w-full h-full object-contain"></canvas>
                    
                    <!-- Overlay badge for Before vs After & Trigger Flash -->
                    <div id="pi-preview-status-tag" class="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-300 flex items-center gap-1.5 pointer-events-none">
                        <span id="pi-preview-status-dot" class="w-2 h-2 rounded-full bg-amber-400"></span>
                        <span id="pi-preview-status-text">Simulating Reset</span>
                    </div>

                    <!-- Center Play/Pause button on hover/click -->
                    <button type="button" id="pi-preview-play-btn" class="absolute inset-0 m-auto w-12 h-12 rounded-full bg-black/60 hover:bg-amber-600/90 text-white flex items-center justify-center text-lg backdrop-blur-sm border border-white/20 transition-all opacity-0 group-hover:opacity-100 cursor-pointer shadow-lg" title="Play / Pause Simulation">
                        <span id="pi-preview-play-icon">▶</span>
                    </button>
                </div>

                <!-- Playback Scrubber for 3.0s window -->
                <div class="flex items-center gap-3 px-1">
                    <button type="button" id="pi-preview-play-toggle-btn" class="text-xs font-bold text-zinc-200 hover:text-white px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer flex items-center gap-1 shrink-0">
                        <span id="pi-preview-btn-icon">▶</span> <span id="pi-preview-btn-text">Play Loop</span>
                    </button>
                    <div class="relative flex-grow flex items-center h-5 cursor-pointer select-none" id="pi-preview-scrubber-track">
                        <div class="w-full h-2 bg-zinc-800 rounded-full overflow-hidden relative">
                            <div id="pi-preview-progress-bar" class="h-full bg-gradient-to-r from-zinc-500 via-amber-500 to-amber-400 rounded-full transition-all" style="width: 0%"></div>
                        </div>
                        <!-- Marker at 33% (Trigger point) -->
                        <div class="absolute top-1/2 -translate-y-1/2 left-[33.33%] -ml-1.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-black shadow-md shadow-amber-400/50 pointer-events-none" title="Pacing Reset Moment (Trigger)"></div>
                    </div>
                    <span id="pi-preview-time-label" class="text-[11px] font-mono text-zinc-400 w-24 text-right shrink-0">0.0s / 3.0s</span>
                </div>
            </div>

            <!-- Proposed Candidate Interruptions Stream -->
            <div class="space-y-3">
                <div class="flex items-center justify-between">
                    <h4 class="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                        <span>🎯 Monotony Drop Candidates & Interventions</span>
                    </h4>
                    <span class="text-[10px] text-zinc-500">Uncheck items you do not wish to apply, or change the intervention type</span>
                </div>

                <div id="pi-candidates-list" class="space-y-3">
                    <!-- Dynamic candidate cards rendered here -->
                </div>
            </div>
        </div>

        <!-- Footer Actions -->
        <div class="px-6 py-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between flex-shrink-0 flex-wrap gap-3">
            <div class="flex items-center gap-2">
                <button id="reanalyze-pattern-interrupt-btn" class="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-white rounded-xl transition-colors border border-zinc-700 cursor-pointer">
                    <span>🔄</span>
                    <span>Re-Analyze</span>
                </button>
                <button id="undo-pattern-interrupt-btn" class="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-colors border border-zinc-800 cursor-pointer" title="Revert last applied pattern interrupts">
                    <span>↩️</span>
                    <span>Undo Last Interrupts</span>
                </button>
            </div>
            <div class="flex items-center gap-3">
                <button id="cancel-pattern-interrupt-btn" class="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800 cursor-pointer">
                    Cancel
                </button>
                <button id="apply-selected-pattern-interrupt-btn" class="px-4 py-2.5 text-xs font-bold text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-xl transition-all flex items-center gap-2 cursor-pointer">
                    <span>⚡</span>
                    <span>Apply Selected</span>
                </button>
                <button id="apply-all-pattern-interrupt-btn" class="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 rounded-xl shadow-lg shadow-orange-600/30 transition-all flex items-center gap-2 uppercase tracking-wide cursor-pointer">
                    <span>🚀</span>
                    <span>Apply All</span>
                </button>
            </div>
        </div>
    </div>
</div>

<div id="shortcut-guide-modal" class="hidden fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center p-4">

<!-- SFX Waveform Trimmer & Cutter Modal -->
<div id="sfx-trimmer-modal" class="fixed inset-0 z-[130] hidden flex items-center justify-center bg-black/85 backdrop-blur-md p-4 transition-all duration-200">
    <div class="bg-zinc-950 border border-amber-500/40 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl shadow-amber-950/50 overflow-hidden">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/90 flex items-center justify-between flex-shrink-0">
            <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/30 to-amber-700/20 border border-amber-500/50 flex items-center justify-center text-amber-300 text-lg shadow-inner">
                    ✂️
                </div>
                <div>
                    <h3 id="sfx-trimmer-title" class="text-base font-bold text-zinc-100 flex items-center gap-2">
                        SFX Waveform Trimmer & Cutter
                        <span id="sfx-trimmer-badge" class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-amber-950/80 text-amber-300 border border-amber-500/40">CUSTOM DROP</span>
                    </h3>
                    <p class="text-xs text-zinc-400">Drag waveform cut points, split clips, or trim start/end to keep only desired sound.</p>
                </div>
            </div>
            <button id="close-sfx-trimmer-modal-btn" class="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition cursor-pointer" title="Close Trimmer">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>

        <!-- Body -->
        <div class="p-6 flex-1 overflow-y-auto space-y-5 bg-zinc-950">
            <!-- Waveform Canvas Box -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs text-zinc-300">
                    <span class="font-semibold text-amber-300 flex items-center gap-1.5">
                        <span>📊</span> Interactive Waveform Selection
                    </span>
                    <div class="flex items-center gap-4 text-[11px] font-mono text-zinc-400">
                        <span>Original: <strong id="sfx-trimmer-orig-dur" class="text-zinc-200">0.00s</strong></span>
                        <span>Selection: <strong id="sfx-trimmer-selected-dur" class="text-amber-300 font-bold">0.00s</strong></span>
                    </div>
                </div>

                <!-- Canvas Wrapper -->
                <div id="sfx-trimmer-canvas-wrapper" class="relative w-full h-36 bg-zinc-900/90 rounded-xl border border-zinc-800/90 overflow-hidden cursor-crosshair select-none shadow-inner group">
                    <canvas id="sfx-trimmer-canvas" class="w-full h-full block"></canvas>
                    
                    <!-- Selection Mask Left (Trimmed Out) -->
                    <div id="sfx-trimmer-mask-left" class="absolute left-0 top-0 bottom-0 bg-black/70 border-r border-amber-500/80 pointer-events-none transition-all"></div>
                    
                    <!-- Selection Mask Right (Trimmed Out) -->
                    <div id="sfx-trimmer-mask-right" class="absolute right-0 top-0 bottom-0 bg-black/70 border-l border-amber-500/80 pointer-events-none transition-all"></div>

                    <!-- In-Point Handle (Start Cut) -->
                    <div id="sfx-trimmer-handle-start" class="absolute top-0 bottom-0 w-3 -ml-1.5 z-20 cursor-col-resize group-hover:scale-105 transition-transform flex flex-col items-center justify-between" title="Drag to set Start Cut (In-Point)">
                        <div class="w-3 h-5 bg-amber-500 rounded-t-sm shadow-md flex items-center justify-center text-[9px] font-bold text-black select-none">I</div>
                        <div class="w-0.5 flex-1 bg-amber-400 shadow-sm"></div>
                        <div class="w-3 h-3 bg-amber-500 rounded-b-sm shadow-md"></div>
                    </div>

                    <!-- Out-Point Handle (End Cut) -->
                    <div id="sfx-trimmer-handle-end" class="absolute top-0 bottom-0 w-3 -ml-1.5 z-20 cursor-col-resize group-hover:scale-105 transition-transform flex flex-col items-center justify-between" title="Drag to set End Cut (Out-Point)">
                        <div class="w-3 h-5 bg-amber-500 rounded-t-sm shadow-md flex items-center justify-center text-[9px] font-bold text-black select-none">O</div>
                        <div class="w-0.5 flex-1 bg-amber-400 shadow-sm"></div>
                        <div class="w-3 h-3 bg-amber-500 rounded-b-sm shadow-md"></div>
                    </div>

                    <!-- Playhead Indicator -->
                    <div id="sfx-trimmer-playhead" class="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-30 pointer-events-none shadow-lg shadow-rose-500/50 hidden">
                        <div class="w-2.5 h-2.5 -ml-1 -mt-1 bg-rose-500 rotate-45 rounded-xs"></div>
                    </div>
                </div>
            </div>

            <!-- Controls & Inputs Toolbar -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800/80">
                <!-- Time Range Inputs -->
                <div class="space-y-1.5">
                    <label class="block text-[11px] font-semibold text-zinc-300">Start Cut (In-Point)</label>
                    <div class="flex items-center gap-2">
                        <input id="sfx-trimmer-start-input" type="number" step="0.05" min="0" value="0.00" class="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none">
                        <span class="text-xs text-zinc-500">sec</span>
                    </div>
                </div>

                <div class="space-y-1.5">
                    <label class="block text-[11px] font-semibold text-zinc-300">End Cut (Out-Point)</label>
                    <div class="flex items-center gap-2">
                        <input id="sfx-trimmer-end-input" type="number" step="0.05" min="0.1" value="2.50" class="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-amber-200 font-mono focus:border-amber-500 focus:outline-none">
                        <span class="text-xs text-zinc-500">sec</span>
                    </div>
                </div>

                <!-- Preview Controls -->
                <div class="space-y-1.5 flex flex-col justify-end">
                    <label class="block text-[11px] font-semibold text-zinc-300">Preview Cut Sound</label>
                    <div class="flex items-center gap-2">
                        <button id="sfx-trimmer-play-btn" type="button" class="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md cursor-pointer">
                            <span>▶</span> <span>Play Cut Selection</span>
                        </button>
                        <button id="sfx-trimmer-stop-btn" type="button" class="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 py-1.5 px-3 rounded-lg text-xs transition-colors cursor-pointer">
                            <span>⏹</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Action Tools Row -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div class="flex items-center gap-2">
                    <button id="sfx-trimmer-crop-btn" type="button" class="bg-zinc-900 hover:bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-medium py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center gap-1.5 cursor-pointer" title="Permanently slice and crop the audio buffer to the selection">
                        <span>✂️</span> <span>Remain with Selection Only (Crop)</span>
                    </button>
                    <button id="sfx-trimmer-split-btn" type="button" class="bg-zinc-900 hover:bg-amber-950 text-amber-300 border border-amber-500/40 font-medium py-1.5 px-3 rounded-lg text-xs transition-colors flex items-center gap-1.5 cursor-pointer" title="Split clip into two drops at playhead position">
                        <span>🔪</span> <span>Split at Playhead</span>
                    </button>
                </div>
                <button id="sfx-trimmer-reset-btn" type="button" class="text-zinc-400 hover:text-white text-xs underline cursor-pointer">
                    🔄 Reset to Full Waveform
                </button>
            </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-zinc-800 bg-zinc-950/90 flex items-center justify-between flex-shrink-0">
            <span class="text-xs text-zinc-500">Timeline position updates automatically upon save.</span>
            <div class="flex items-center gap-3">
                <button id="cancel-sfx-trimmer-btn" type="button" class="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white transition-colors rounded-xl hover:bg-zinc-800 cursor-pointer">
                    Cancel
                </button>
                <button id="apply-sfx-trimmer-btn" type="button" class="px-5 py-2.5 text-xs font-bold text-zinc-950 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 rounded-xl shadow-lg shadow-amber-500/20 transition-all flex items-center gap-1.5 cursor-pointer">
                    <span>💾</span> <span>Apply Cut to SFX Track</span>
                </button>
            </div>
        </div>
    </div>
</div>
  <div class="bg-slate-950 border border-slate-700 rounded-2xl p-5 w-full max-w-md max-h-[80vh] overflow-y-auto text-slate-200">
    <div class="flex justify-between items-center mb-3">
      <span class="font-semibold text-amber-300">Keyboard Shortcuts</span>
      <button id="shortcut-guide-close" class="px-1.5 rounded hover:bg-slate-800 text-slate-400">✕</button>
    </div>
    <table class="w-full text-xs">
      <tr><td class="py-1 text-slate-400">Space / K</td><td>Play · Pause</td></tr>
      <tr><td class="py-1">← → · J / L</td><td>Frame step · ±5 frames</td></tr>
      <tr><td class="py-1">Ctrl/⌘ Z · Y</td><td>Undo · Redo</td></tr>
      <tr><td class="py-1">Delete</td><td>Ripple-delete clip</td></tr>
      <tr><td class="py-1">[ · ]</td><td>Trim in / out to playhead</td></tr>
      <tr><td class="py-1">Ctrl/⌘ B</td><td>Split clip at playhead</td></tr>
      <tr><td class="py-1">Ctrl/⌘ C · V · D</td><td>Copy · Paste · Duplicate clip</td></tr>
      <tr><td class="py-1">Ctrl/⌘ E</td><td>Export video</td></tr>
      <tr><td class="py-1">Ctrl/⌘ Shift K</td><td>Camera keyframes panel</td></tr>
      <tr><td class="py-1">F</td><td>Fullscreen preview</td></tr>
      <tr><td class="py-1">Ctrl + wheel</td><td>Zoom timeline (anchored to playhead)</td></tr>
      <tr><td class="py-1">?</td><td>This guide</td></tr>
    </table>
  </div>
`;

