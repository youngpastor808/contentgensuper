/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CourseChapter {
  time: number; // in seconds
  label: string;
}

export interface StudioPresetPayload {
  title: string;
  scriptText: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  imageStyleValue?: string;
  characters?: Array<{ name: string; description: string; avatarUrl?: string }>;
  musicMode?: boolean;
  suggestedOverlays?: string[];
  soundtrackMood?: string;
}

export interface AcademyLesson {
  id: string;
  moduleId: string;
  moduleTitle: string;
  title: string;
  instructor: string;
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced' | 'Pro Masterclass';
  youtubeId: string; // YouTube Video ID
  customEmbedUrl?: string;
  summary: string;
  keyTakeaways: string[];
  promptFormula?: string;
  chapters: CourseChapter[];
  studioPreset?: StudioPresetPayload;
  downloadableNotes?: string;
}

export interface AcademyModule {
  id: string;
  title: string;
  icon: string;
  description: string;
  lessons: AcademyLesson[];
}

export const DEFAULT_ACADEMY_MODULES: AcademyModule[] = [
  {
    id: 'module-01-scripting',
    title: 'Module 1: Storytelling & High-Retention Scripting',
    icon: '✍️',
    description: 'Master the 3-second hook formula, pacing psychology, and structuring AI prompts for narrative momentum.',
    lessons: [
      {
        id: 'lesson-101',
        moduleId: 'module-01-scripting',
        moduleTitle: 'Module 1: Storytelling & Scripting',
        title: 'The 3-Second Viral Hook & Narrative Arch',
        instructor: 'ContentGen Production Lead',
        duration: '06:45',
        level: 'Beginner',
        youtubeId: 'W6NZfCO5SIk',
        summary: 'Learn how to construct visual and auditory pattern interrupts in your first scene to maximize viewer retention across TikTok, Reels, and YouTube.',
        keyTakeaways: [
          'Place high-contrast visual motion in the first 0.8 seconds',
          'Use sensory verbs and open questions in the opening line',
          'Balance shot durations between 1.8s and 3.2s for optimal pacing'
        ],
        promptFormula: '[Setting/Context] + [High-stakes Conflict] + [Unexpected Physical Object] + [Cinematic Lighting: rim light, volumetric fog, Kodak 500T 35mm grain]',
        chapters: [
          { time: 0, label: 'Introduction: The Retention Curve' },
          { time: 75, label: 'Dissecting Viral Openers' },
          { time: 180, label: 'Pacing Archetypes: Fast Action vs Documentaries' },
          { time: 310, label: 'Writing Voiceover Prompts in Studio' }
        ],
        studioPreset: {
          title: '3-Second Viral Hook Demo',
          scriptText: 'What if everything you were told about deep ocean trenches was completely wrong? In 1960, two explorers plunged seven miles down into the Mariana Trench. What their searchlights revealed in the crushing darkness still baffles marine biologists today.',
          aspectRatio: '9:16',
          imageStyleValue: 'Cinematic documentary photograph, 35mm film grain, moody atmospheric lighting, ultra high resolution',
          musicMode: true,
          suggestedOverlays: ['Lower Third: Challenger Deep', 'Stat Counter: 10,994m', 'Audio Reactive Spectrum']
        }
      },
      {
        id: 'lesson-102',
        moduleId: 'module-01-scripting',
        moduleTitle: 'Module 1: Storytelling & Scripting',
        title: 'Directing Educational & Documentarian Scripts',
        instructor: 'Senior AI Storyboarder',
        duration: '09:20',
        level: 'Intermediate',
        youtubeId: '9bZkp7q19f0',
        summary: 'How to convert complex data, historical archives, or scientific articles into engaging storyboard scenes with structured visual metaphors.',
        keyTakeaways: [
          'Translate abstract numbers into tangible visual comparisons',
          'Utilize Evidence Board and Step Route overlays for procedural reveals',
          'Pace narration silences to give imagery breathing room'
        ],
        promptFormula: 'Editorial data-journalism illustration, split composition with infographic panel and soft cream background, navy and gold accents.',
        chapters: [
          { time: 0, label: 'Documentary Pacing Principles' },
          { time: 140, label: 'Data Translation into Visuals' },
          { time: 340, label: 'Adding Step-by-Step Route Overlays' },
          { time: 480, label: 'Exporting High Bitrate Masters' }
        ],
        studioPreset: {
          title: 'Deep-Dive Documentary Preset',
          scriptText: 'The Silk Road spanned over four thousand miles of treacherous terrain. Merchants did not travel the entire length; instead, goods passed through a chain of bustling oasis cities, multiplying in value at every border crossing.',
          aspectRatio: '16:9',
          imageStyleValue: 'Hand-cut documentary paper collage in motion. Aged newsprint, halftone photo cutouts, print grain.',
          suggestedOverlays: ['Step-by-Step Route Map', 'Split Comparison: Land vs Sea']
        }
      }
    ]
  },
  {
    id: 'module-02-characters',
    title: 'Module 2: Consistent Characters & Art Direction',
    icon: '👤',
    description: 'Techniques for maintaining exact character face, wardrobe, and style consistency across dozens of storyboard shots.',
    lessons: [
      {
        id: 'lesson-201',
        moduleId: 'module-02-characters',
        moduleTitle: 'Module 2: Character Consistency',
        title: 'Mastering Character Seeds & Facial Anchors',
        instructor: 'Lead Visual Artist',
        duration: '11:15',
        level: 'Intermediate',
        youtubeId: 'kJQP7kiw5Fk',
        summary: 'Explore character seed profiling in ContentGen AI: how to define persistent facial features, hair textures, and signature wardrobe across dynamic camera angles.',
        keyTakeaways: [
          'Specify distinctive permanent attributes (e.g. round brass spectacles, emerald green overcoat)',
          'Lock character profiles into the Character Manager before generating shot lists',
          'Reuse character tags in narrative lines to trigger auto-reference injection'
        ],
        promptFormula: '[Character Name], [Age], [Distinctive Facial Details], wearing [Signature Wardrobe], shot on [Lens/Camera], [Consistent Lighting]',
        chapters: [
          { time: 0, label: 'Why Character Consistency Fails & How to Fix It' },
          { time: 150, label: 'Using the Character Manager Panel' },
          { time: 380, label: 'Testing Across Multiple Camera Angles' },
          { time: 590, label: 'Lighting Consistency Across Shots' }
        ],
        studioPreset: {
          title: 'Character Consistency Masterclass',
          scriptText: 'Captain Elena Vance inspected the starship navigation console. Her mechanical prosthetic arm glowed with amber telemetry lines as she adjusted the warp manifold.',
          aspectRatio: '16:9',
          characters: [
            {
              name: 'Elena Vance',
              description: '34-year-old female astronaut with short cropped silver hair, sharp hazel eyes, and a sleek titanium prosthetic left arm with glowing amber circuit inlays.'
            }
          ]
        }
      }
    ]
  },
  {
    id: 'module-03-audio',
    title: 'Module 3: Voice Studio & Audio-First Directing',
    icon: '🎙️',
    description: 'Directing realistic AI narration, custom voice cloning, word-aligned subtitle chunking, and precision SFX drops.',
    lessons: [
      {
        id: 'lesson-301',
        moduleId: 'module-03-audio',
        moduleTitle: 'Module 3: Audio & Voice Studio',
        title: 'Audio-First Workflow & Beat-Locked Editing',
        instructor: 'Master Audio Director',
        duration: '08:30',
        level: 'Pro Masterclass',
        youtubeId: 'kJQP7kiw5Fk',
        summary: 'Learn the professional Audio-First Directing workflow: synthesize voiceovers, detect natural speech silences, and snap video shots to rhythmic musical downbeats.',
        keyTakeaways: [
          'Generate voiceovers first to obtain natural duration and emotional cadence',
          'Use Audio-Locked Timeline Mode to maintain speech sync during shot trimming',
          'Drop contextual sound effects (whoosh, hit, pop) at key semantic timestamps'
        ],
        promptFormula: 'Narration Voice: [Archetype] + Speed [0.95 - 1.05x] + Pitch [Neutral] + Soundscape [Deep Ambient Synth]',
        chapters: [
          { time: 0, label: 'The Power of Audio-First Directing' },
          { time: 110, label: 'Voice Archetypes & Emotion Tuning' },
          { time: 260, label: 'Aligning Subtitle Chunks with Word Timestamps' },
          { time: 420, label: 'Synthesizing Procedural Sound Effects' }
        ],
        studioPreset: {
          title: 'Audio-First Rhythm Demo',
          scriptText: 'In the heart of the silicon foundry, extreme ultraviolet laser pulses strike molten tin droplets fifty thousand times a second, creating invisible circuits smaller than a strand of DNA.',
          aspectRatio: '16:9',
          musicMode: true,
          soundtrackMood: 'Sci-Fi Cyberpunk Pulse'
        }
      }
    ]
  },
  {
    id: 'module-04-motion-graphics',
    title: 'Module 4: Motion Graphics, HyperFrames & Pop-Up PiP',
    icon: '✨',
    description: 'Creating viral broadcast overlays, animated stat counters, evidence boards, and smart picture-in-picture callouts.',
    lessons: [
      {
        id: 'lesson-401',
        moduleId: 'module-04-motion-graphics',
        moduleTitle: 'Module 4: Motion Graphics & Overlays',
        title: 'Adding Kinetic Overlays, HyperFrames & Pop-Up B-Roll',
        instructor: 'Motion Design Specialist',
        duration: '12:40',
        level: 'Advanced',
        youtubeId: 'W6NZfCO5SIk',
        summary: 'Explore the full Motion Graphics engine: create spring-animated lower thirds, audio-reactive spectrum waves, dynamic donut charts, and custom HTML HyperFrames.',
        keyTakeaways: [
          'Use "Auto-Direct Overlays" to scan scripts and place contextual callouts automatically',
          'Pair visual cards with smart whoosh/impact sound effect triggers',
          'Adjust elastic spring bounce timing in the Graphic Inspector drawer'
        ],
        promptFormula: 'HyperFrame Preset: [Launch Hero / Social Metric] + [Accent Color: #38bdf8] + [Audio Reactive Beat Pulse: Active]',
        chapters: [
          { time: 0, label: 'Overlay Architecture & Layer Z-Order' },
          { time: 190, label: 'Configuring Lower Thirds & Title Cards' },
          { time: 390, label: 'Pop-Up Picture-in-Picture (PiP) B-Roll' },
          { time: 580, label: 'Building Custom HyperFrames with HTML/Tailwind' }
        ],
        studioPreset: {
          title: 'Kinetic Motion Graphics Studio',
          scriptText: 'Our quarterly user growth surged past two hundred and forty percent, while cloud processing latency dropped under eighty milliseconds.',
          aspectRatio: '16:9',
          suggestedOverlays: ['Stat Counter: +240%', 'Donut Chart: Latency -80ms', 'HyperFrame: Growth Metric']
        }
      }
    ]
  },
  {
    id: 'module-05-3d-parallax',
    title: 'Module 5: 3D Depth Parallax & Camera Flights',
    icon: '🎥',
    description: 'Transforming 2D stills into immersive 2.5D multi-plane camera pans, drone swoops, and cinematic depth environments.',
    lessons: [
      {
        id: 'lesson-501',
        moduleId: 'module-05-3d-parallax',
        moduleTitle: 'Module 5: 3D Depth & Camera Flights',
        title: 'Creating Cinematic Drone Swoops with WebGL Depth Maps',
        instructor: 'VFX Director',
        duration: '10:10',
        level: 'Pro Masterclass',
        youtubeId: '9bZkp7q19f0',
        summary: 'Learn how AI depth estimation breaks images into foreground, midground, and background layers for realistic 3D camera dollies, zooms, and drone rotations.',
        keyTakeaways: [
          'Higher depth map contrast produces more pronounced parallax displacement',
          'Use Camera Keyframing to guide the viewer focus across the frame',
          'Apply atmospheric film grain and LUT color grades for a cohesive film finish'
        ],
        promptFormula: 'Cinematic drone shot, high angle, slow push-in, volumetric light rays piercing through mountain mist, 8k resolution.',
        chapters: [
          { time: 0, label: 'Understanding 2.5D Parallax Projection' },
          { time: 160, label: 'Generating Depth Maps in VFX Studio' },
          { time: 360, label: 'Keyframing 3D Pan, Tilt & Roll' },
          { time: 510, label: 'Adding Particle Atmospheres & Film Grain' }
        ],
        studioPreset: {
          title: '3D Parallax Drone Flight',
          scriptText: 'High above the ancient temple ruins, morning mist gently parted to reveal towering stone monoliths carved thousands of years ago.',
          aspectRatio: '16:9',
          imageStyleValue: 'Cinematic film still, 35mm lens, golden hour lighting, rich depth of field, high contrast'
        }
      }
    ]
  }
];

export function extractYouTubeVideoId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  // Standard 11 character ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  // URL matching: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, etc.
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = trimmed.match(regex);
  return match ? match[1] : trimmed;
}

export function parseChaptersText(text: string): CourseChapter[] {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const chapters: CourseChapter[] = [];

  for (const line of lines) {
    // Matches formats like "01:30 - Chapter Name" or "1:30 Chapter Name" or "00:45: Chapter Name"
    const match = line.match(/^(\d{1,2}:(?:\d{2}:)?\d{2})[\s\-:–—]+(.+)$/);
    if (match) {
      const timeStr = match[1];
      const label = match[2].trim();
      const parts = timeStr.split(':').map(p => parseInt(p, 10));
      let seconds = 0;
      if (parts.length === 2) {
        seconds = parts[0] * 60 + parts[1];
      } else if (parts.length === 3) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      chapters.push({ time: seconds, label });
    }
  }
  return chapters;
}

export function formatChaptersToText(chapters?: CourseChapter[]): string {
  if (!chapters || chapters.length === 0) return '';
  return chapters.map(c => {
    const mins = Math.floor(c.time / 60);
    const secs = c.time % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    return `${formatted} - ${c.label}`;
  }).join('\n');
}

const LOCAL_STORAGE_KEY = 'contentgen_academy_modules_v1';

let currentAcademyModules: AcademyModule[] = loadInitialModules();
const listeners: Array<(modules: AcademyModule[]) => void> = [];

function loadInitialModules(): AcademyModule[] {
  try {
    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Academy] Failed to parse local cached modules:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_ACADEMY_MODULES));
}

export function getAcademyModules(): AcademyModule[] {
  return currentAcademyModules;
}

export function getAllLessons(): AcademyLesson[] {
  const lessons: AcademyLesson[] = [];
  for (const mod of currentAcademyModules) {
    lessons.push(...mod.lessons);
  }
  return lessons;
}

export function findLessonById(lessonId: string): AcademyLesson | undefined {
  return getAllLessons().find(l => l.id === lessonId);
}

export function findModuleById(moduleId: string): AcademyModule | undefined {
  return currentAcademyModules.find(m => m.id === moduleId);
}

export function subscribeToAcademyModules(callback: (modules: AcademyModule[]) => void): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function notifyModuleChange() {
  for (const cb of listeners) {
    try {
      cb(currentAcademyModules);
    } catch (e) {
      console.error('[Academy] Listener error:', e);
    }
  }
}

export async function persistAcademyModules(modules: AcademyModule[]): Promise<void> {
  currentAcademyModules = modules;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(modules));
  } catch (e) {
    console.warn('[Academy] LocalStorage save failed:', e);
  }
  notifyModuleChange();

  // Also persist to Firestore asynchronously using configured db without blocking UI
  (async () => {
    try {
      const { db } = await import('./firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      if (!db) return;
      const docRef = doc(db, 'academy_courses', 'curriculum');
      const syncPromise = setDoc(docRef, {
        modules: JSON.parse(JSON.stringify(modules)),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore sync timeout')), 4000));
      await Promise.race([syncPromise, timeoutPromise]);
      console.log('[Academy] Synced curriculum to Firestore');
    } catch (err: any) {
      console.warn('[Academy] Firestore sync deferred or offline:', err?.message || err);
    }
  })();
}

export async function saveAcademyModule(moduleData: Partial<AcademyModule> & { id?: string; title: string }): Promise<string> {
  const modules = [...currentAcademyModules];
  const moduleId = moduleData.id || `module_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const existingIdx = modules.findIndex(m => m.id === moduleId);

  const fullModule: AcademyModule = {
    id: moduleId,
    title: moduleData.title || 'Untitled Module',
    icon: moduleData.icon || '🎓',
    description: moduleData.description || '',
    lessons: existingIdx >= 0 ? modules[existingIdx].lessons : []
  };

  if (existingIdx >= 0) {
    modules[existingIdx] = { ...modules[existingIdx], ...fullModule };
  } else {
    modules.push(fullModule);
  }

  await persistAcademyModules(modules);
  return moduleId;
}

export async function deleteAcademyModule(moduleId: string): Promise<void> {
  const modules = currentAcademyModules.filter(m => m.id !== moduleId);
  await persistAcademyModules(modules);
}

export async function saveAcademyLesson(moduleId: string, lessonData: Partial<AcademyLesson> & { title: string; youtubeId: string }): Promise<string> {
  const modules = [...currentAcademyModules];
  let targetModule = modules.find(m => m.id === moduleId);
  if (!targetModule) {
    // Create new module if not exists
    const newModuleId = await saveAcademyModule({ id: moduleId, title: lessonData.moduleTitle || 'General Masterclasses' });
    targetModule = modules.find(m => m.id === newModuleId);
  }
  if (!targetModule) throw new Error(`Module ${moduleId} not found`);

  const lessonId = lessonData.id || `lesson_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const cleanYoutubeId = extractYouTubeVideoId(lessonData.youtubeId);

  const fullLesson: AcademyLesson = {
    id: lessonId,
    moduleId: targetModule.id,
    moduleTitle: targetModule.title,
    title: lessonData.title,
    instructor: lessonData.instructor || 'ContentGen Lead',
    duration: lessonData.duration || '10:00',
    level: lessonData.level || 'Beginner',
    youtubeId: cleanYoutubeId,
    summary: lessonData.summary || '',
    keyTakeaways: lessonData.keyTakeaways || [],
    promptFormula: lessonData.promptFormula || '',
    chapters: lessonData.chapters || [],
    studioPreset: lessonData.studioPreset,
    downloadableNotes: lessonData.downloadableNotes
  };

  const existingLessonIdx = targetModule.lessons.findIndex(l => l.id === lessonId);
  if (existingLessonIdx >= 0) {
    targetModule.lessons[existingLessonIdx] = fullLesson;
  } else {
    targetModule.lessons.push(fullLesson);
  }

  await persistAcademyModules(modules);
  return lessonId;
}

export async function deleteAcademyLesson(lessonId: string): Promise<void> {
  const modules = [...currentAcademyModules];
  for (const mod of modules) {
    const idx = mod.lessons.findIndex(l => l.id === lessonId);
    if (idx >= 0) {
      mod.lessons.splice(idx, 1);
      break;
    }
  }
  await persistAcademyModules(modules);
}

export async function resetAcademyModulesToDefault(): Promise<void> {
  await persistAcademyModules(JSON.parse(JSON.stringify(DEFAULT_ACADEMY_MODULES)));
}

let firestoreListenerUnsub: (() => void) | null = null;
export async function initAcademyCoursesRemoteListener(): Promise<void> {
  if (firestoreListenerUnsub) return;
  try {
    const { db } = await import('./firebase');
    const { doc, onSnapshot } = await import('firebase/firestore');
    if (!db) return;
    const docRef = doc(db, 'academy_courses', 'curriculum');
    firestoreListenerUnsub = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data && Array.isArray(data.modules) && data.modules.length > 0) {
          currentAcademyModules = data.modules;
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data.modules));
          } catch (e) {}
          notifyModuleChange();
        }
      }
    }, (err) => {
      console.warn('[Academy] Firestore remote listener notice:', err?.message || err);
    });
  } catch (err) {
    console.warn('[Academy] Remote listener initialization deferred:', err);
  }
}
