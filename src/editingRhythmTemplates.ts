/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type TalkingHeadMode = 'full' | 'pip-br' | 'pip-bl' | 'pip-tr' | 'pip-tl' | 'split' | 'none';

export interface EditingRhythmTemplate {
    id: string;
    name: string;
    icon: string;
    badge: string;
    description: string;
    cadenceText: string;
    generate: (totalShots: number, shots?: any[]) => TalkingHeadMode[];
}

export const EDITING_RHYTHM_TEMPLATES: EditingRhythmTemplate[] = [
    {
        id: 'youtube_essay',
        name: 'YouTube Video Essay',
        icon: '🎓',
        badge: 'Recommended',
        description: 'Starts with full A-Roll hook, transitions to 3 B-Roll shots, split-screen reaction, more B-Roll, PiP detail, and full A-Roll outro.',
        cadenceText: 'Full Hook → 3x B-Roll → Split → 2x B-Roll → PiP → Full Outro',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];
            if (totalShots === 2) return ['full', 'none'];
            if (totalShots === 3) return ['full', 'none', 'full'];

            const pattern: TalkingHeadMode[] = [
                'none', 'none', 'none', 'split', 'none', 'none', 'pip-br', 'none'
            ];

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                const patIdx = (i - 1) % pattern.length;
                result[i] = pattern[patIdx];
            }

            return result;
        }
    },
    {
        id: 'fast_reel',
        name: 'Fast-Paced Reel / TikTok',
        icon: '⚡',
        badge: 'High Energy',
        description: 'Frequent rhythm changes between A-Roll, B-Roll, PiP, and Split screen to maximize viewer retention on short-form feeds.',
        cadenceText: 'A-Roll Hook → B-Roll → PiP → B-Roll → Split → B-Roll → Outro',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];
            if (totalShots === 2) return ['full', 'none'];

            const pattern: TalkingHeadMode[] = [
                'none', 'pip-br', 'none', 'split', 'none', 'pip-tr', 'none'
            ];

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                const patIdx = (i - 1) % pattern.length;
                result[i] = pattern[patIdx];
            }

            return result;
        }
    },
    {
        id: 'docu_deepdive',
        name: 'Documentary Deep-Dive',
        icon: '🏛️',
        badge: 'Cinematic',
        description: 'Deep immersion with extended 4-shot B-roll sequences, punctuated by contextual split screens and authoritative presenter check-ins.',
        cadenceText: 'Presenter Anchor → 4x B-Roll → Split Context → 3x B-Roll',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];
            if (totalShots === 2) return ['full', 'none'];

            const pattern: TalkingHeadMode[] = [
                'none', 'none', 'none', 'none', 'split', 'none', 'none', 'none'
            ];

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                const patIdx = (i - 1) % pattern.length;
                result[i] = pattern[patIdx];
            }

            return result;
        }
    },
    {
        id: 'software_walkthrough',
        name: 'Product / Demo Walkthrough',
        icon: '💻',
        badge: 'Demo / Tutorial',
        description: 'Full presenter introduction, followed by persistent Picture-in-Picture in the bottom-right over all demo B-roll shots, closing with full outro.',
        cadenceText: 'Intro Facecam → Persistent PiP (Bottom-Right) → Outro Facecam',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];
            if (totalShots === 2) return ['full', 'pip-br'];

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                result[i] = 'pip-br';
            }

            return result;
        }
    },
    {
        id: 'dynamic_split',
        name: 'Dynamic Split & Compare',
        icon: '🌓',
        badge: 'Comparison',
        description: 'Alternating split-screen layouts to keep presenter commentary and visual evidence side-by-side.',
        cadenceText: 'Full A-Roll → Split Screen → B-Roll → Split Screen → PiP',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];

            const pattern: TalkingHeadMode[] = [
                'split', 'none', 'split', 'pip-br', 'split', 'none'
            ];

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                const patIdx = (i - 1) % pattern.length;
                result[i] = pattern[patIdx];
            }

            return result;
        }
    },
    {
        id: 'smart_script',
        name: 'Smart Script-Aware Rhythm',
        icon: '🧠',
        badge: 'AI Dynamic',
        description: 'Analyzes narration dialogue: visual keywords trigger B-Roll or Split screen, while greetings and summaries trigger Full A-Roll.',
        cadenceText: 'Dialogue-Driven A-Roll vs B-Roll Cadence',
        generate: (totalShots: number, shots?: any[]): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            if (totalShots === 1) return ['full'];

            const visualKeywordRegex = /\b(look|see|shown|chart|diagram|screen|example|data|notice|visual|graph|watch|step|demonstrate|here|interface|table|image)\b/i;
            const speakingKeywordRegex = /\b(welcome|today|hello|hi|subscribe|comment|follow|share|in conclusion|to summarize|thanks for watching|let me know|what do you think|my opinion)\b/i;

            const result: TalkingHeadMode[] = new Array(totalShots);
            result[0] = 'full';
            result[totalShots - 1] = 'full';

            let consecutiveSame = 0;
            let lastMode: TalkingHeadMode = 'full';

            for (let i = 1; i < totalShots - 1; i++) {
                const shotData = shots?.[i]?.shot || shots?.[i] || {};
                const text = `${shotData.text || ''} ${shotData.prompt || ''} ${shotData.text_reference || ''}`;

                let mode: TalkingHeadMode = 'none';

                if (speakingKeywordRegex.test(text)) {
                    mode = 'full';
                } else if (visualKeywordRegex.test(text)) {
                    mode = (i % 2 === 0) ? 'split' : 'none';
                } else {
                    // Cadence fallback
                    const fallbackIdx = (i - 1) % 5;
                    if (fallbackIdx === 0) mode = 'none';
                    else if (fallbackIdx === 1) mode = 'none';
                    else if (fallbackIdx === 2) mode = 'split';
                    else if (fallbackIdx === 3) mode = 'pip-br';
                    else mode = 'none';
                }

                // Prevent more than 3 consecutive identical modes
                if (mode === lastMode) {
                    consecutiveSame++;
                    if (consecutiveSame >= 3) {
                        mode = mode === 'none' ? 'split' : 'none';
                        consecutiveSame = 1;
                    }
                } else {
                    consecutiveSame = 1;
                }

                lastMode = mode;
                result[i] = mode;
            }

            return result;
        }
    },
    {
        id: 'broll_only',
        name: 'B-Roll Cutaways (VO Focus)',
        icon: '🖼️',
        badge: 'Voiceover',
        description: 'First shot introduces speaker in full A-roll, then 100% cinematic B-roll visuals while speaker voiceover continues.',
        cadenceText: 'Intro Full A-Roll → 100% B-Roll Visuals',
        generate: (totalShots: number): TalkingHeadMode[] => {
            if (totalShots <= 0) return [];
            const result: TalkingHeadMode[] = new Array(totalShots).fill('none');
            result[0] = 'full';
            return result;
        }
    },
    {
        id: 'all_full',
        name: 'Full A-Roll (No B-Roll)',
        icon: '👤',
        badge: 'Pure Speaker',
        description: 'Speaker stays full screen on every shot with zero B-roll cutaways.',
        cadenceText: '100% Full Talking Head',
        generate: (totalShots: number): TalkingHeadMode[] => {
            return new Array(totalShots).fill('full');
        }
    },
    {
        id: 'all_pip',
        name: 'All Picture-in-Picture (PiP)',
        icon: '🎭',
        badge: 'Overlay',
        description: 'Speaker appears in a Picture-in-Picture corner overlay on every shot.',
        cadenceText: '100% PiP Corner Overlay',
        generate: (totalShots: number): TalkingHeadMode[] => {
            return new Array(totalShots).fill('pip-br');
        }
    },
    {
        id: 'all_split',
        name: 'All Split-Screen',
        icon: '🌓',
        badge: 'Split',
        description: 'Speaker and B-roll visual side-by-side in equal split layout on every shot.',
        cadenceText: '100% Split Screen',
        generate: (totalShots: number): TalkingHeadMode[] => {
            return new Array(totalShots).fill('split');
        }
    }
];

export function getRhythmTemplateById(id: string): EditingRhythmTemplate {
    return EDITING_RHYTHM_TEMPLATES.find(t => t.id === id) || EDITING_RHYTHM_TEMPLATES[0];
}

export function generateRhythmOptionsHtml(selectedId: string = 'youtube_essay'): string {
    return EDITING_RHYTHM_TEMPLATES.map(t => {
        const isSelected = t.id === selectedId ? 'selected' : '';
        return `<option value="${t.id}" ${isSelected}>${t.icon} ${t.name}</option>`;
    }).join('');
}

export function generateCadencePatternPreviewHtml(
    templateId: string, 
    customShotCount?: number, 
    customShots?: any[]
): string {
    const template = getRhythmTemplateById(templateId);
    const hasProjectShots = customShotCount !== undefined && customShotCount > 0;
    const totalShots = hasProjectShots ? Math.min(Math.max(customShotCount, 2), 12) : 8;
    const modes = template.generate(totalShots, customShots);

    let arollCount = 0;
    let brollCount = 0;
    let hybridCount = 0;

    const tilesHtml = modes.map((mode, idx) => {
        let modeLabel = 'B-Roll';
        let subRole = 'Cutaway';
        let bgClass = 'bg-amber-950/40 border-amber-500/40 text-amber-200';
        let wireframeHtml = '';

        if (mode === 'full') {
            arollCount++;
            modeLabel = 'A-Roll';
            subRole = idx === 0 ? 'Hook' : idx === totalShots - 1 ? 'Outro' : 'Speaker';
            bgClass = 'bg-indigo-950/70 border-indigo-500/50 text-indigo-200';
            wireframeHtml = `
                <div class="w-full h-7 sm:h-8 rounded bg-gradient-to-b from-indigo-600/90 to-indigo-800/90 flex flex-col items-center justify-center text-white shadow-xs">
                    <span class="text-[11px]">👤</span>
                    <span class="text-[7px] sm:text-[8px] font-bold tracking-tight uppercase leading-none">Full</span>
                </div>
            `;
        } else if (mode === 'split') {
            hybridCount++;
            modeLabel = 'Split';
            subRole = 'Dual';
            bgClass = 'bg-purple-950/50 border-purple-500/50 text-purple-200';
            wireframeHtml = `
                <div class="w-full h-7 sm:h-8 rounded border border-purple-400/40 overflow-hidden flex shadow-xs">
                    <div class="w-1/2 h-full bg-indigo-700 flex items-center justify-center text-[8px] sm:text-[9px] text-white font-bold border-r border-purple-400/30">👤</div>
                    <div class="w-1/2 h-full bg-amber-700/80 flex items-center justify-center text-[8px] sm:text-[9px] text-white">🖼️</div>
                </div>
            `;
        } else if (mode.startsWith('pip')) {
            hybridCount++;
            modeLabel = 'PiP';
            subRole = 'Overlay';
            bgClass = 'bg-cyan-950/50 border-cyan-500/50 text-cyan-200';
            const cornerClass = mode === 'pip-tl' ? 'top-0.5 left-0.5' :
                                mode === 'pip-tr' ? 'top-0.5 right-0.5' :
                                mode === 'pip-bl' ? 'bottom-0.5 left-0.5' : 'bottom-0.5 right-0.5';
            wireframeHtml = `
                <div class="w-full h-7 sm:h-8 rounded bg-amber-800/60 border border-cyan-400/40 relative flex items-center justify-center shadow-xs">
                    <span class="text-[9px] sm:text-[10px] opacity-70">🖼️</span>
                    <div class="absolute ${cornerClass} w-3 h-3 sm:w-3.5 sm:h-3.5 bg-indigo-600 border border-cyan-300 rounded-full flex items-center justify-center text-[6px] sm:text-[7px] text-white shadow-xs">👤</div>
                </div>
            `;
        } else {
            brollCount++;
            modeLabel = 'B-Roll';
            subRole = 'Visual';
            bgClass = 'bg-amber-950/40 border-amber-500/40 text-amber-200';
            wireframeHtml = `
                <div class="w-full h-7 sm:h-8 rounded bg-gradient-to-b from-amber-700/60 to-amber-900/60 flex flex-col items-center justify-center text-amber-100 shadow-xs">
                    <span class="text-[11px]">🖼️</span>
                    <span class="text-[7px] sm:text-[8px] font-bold tracking-tight uppercase leading-none">B-Roll</span>
                </div>
            `;
        }

        return `
            <div data-shot-idx="${idx + 1}" data-shot-role="${subRole}" data-shot-mode="${modeLabel}" class="flex flex-col items-center gap-0.5 sm:gap-1 p-1 rounded-md border ${bgClass} transition-all hover:scale-105 cursor-pointer shrink-0 min-w-0" title="Shot ${idx + 1}: ${modeLabel} (${subRole}) - Click to inspect">
                <span class="text-[8px] sm:text-[9px] font-mono text-gray-400 font-semibold leading-none">S${idx + 1}</span>
                ${wireframeHtml}
                <span class="text-[7px] sm:text-[8px] font-bold uppercase tracking-wider truncate w-full text-center leading-none">${subRole}</span>
            </div>
        `;
    }).join('');

    const arollPct = Math.round((arollCount / totalShots) * 100);
    const brollPct = Math.round((brollCount / totalShots) * 100);
    const hybridPct = 100 - arollPct - brollPct;

    const sourceHint = hasProjectShots
        ? `Mapped to ${totalShots} Project Shots`
        : `8-Shot Rhythm Sequence Preview`;

    return `
        <div class="flex flex-col gap-1.5 w-full bg-slate-950/70 p-2 rounded-lg border border-indigo-900/40">
            <!-- Header bar of indicator -->
            <div class="flex items-center justify-between gap-1 text-[10px] text-gray-300 flex-wrap">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="font-bold text-indigo-300 flex items-center gap-1">
                        <span>${template.icon}</span>
                        <span class="truncate">${template.name}</span>
                    </span>
                    <span class="text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded-full font-medium shrink-0">
                        ${template.badge}
                    </span>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[9px] text-indigo-300/70 font-mono shrink-0">${sourceHint}</span>
                    <button id="close-cadence-preview-btn" type="button" class="text-gray-400 hover:text-white p-0.5 rounded text-xs transition leading-none cursor-pointer" title="Close pattern preview">✕</button>
                </div>
            </div>

            <!-- Sequence Tiles -->
            <div class="grid grid-cols-4 sm:grid-cols-8 gap-1 w-full bg-black/40 p-1.5 rounded-md border border-white/5">
                ${tilesHtml}
            </div>

            <!-- Distribution Ratio Bar & Legend -->
            <div class="flex flex-col gap-1 pt-0.5">
                <div class="w-full h-1.5 rounded-full overflow-hidden flex bg-gray-800 shadow-inner">
                    <div style="width: ${arollPct}%" class="h-full bg-indigo-500 transition-all duration-300" title="A-Roll: ${arollCount} shots (${arollPct}%)"></div>
                    <div style="width: ${brollPct}%" class="h-full bg-amber-500 transition-all duration-300" title="B-Roll: ${brollCount} shots (${brollPct}%)"></div>
                    ${hybridPct > 0 ? `<div style="width: ${hybridPct}%" class="h-full bg-purple-500 transition-all duration-300" title="Split/PiP: ${hybridCount} shots (${hybridPct}%)"></div>` : ''}
                </div>
                
                <div class="flex items-center justify-between text-[9px] text-gray-400">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="flex items-center gap-1 text-indigo-300 font-medium">
                            <span class="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block"></span> 👤 A-Roll: ${arollCount} (${arollPct}%)
                        </span>
                        <span class="flex items-center gap-1 text-amber-300 font-medium">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span> 🖼️ B-Roll: ${brollCount} (${brollPct}%)
                        </span>
                        ${hybridPct > 0 ? `
                        <span class="flex items-center gap-1 text-purple-300 font-medium">
                            <span class="w-1.5 h-1.5 rounded-full bg-purple-500 inline-block"></span> 🌓 Split/PiP: ${hybridCount} (${hybridPct}%)
                        </span>` : ''}
                    </div>
                    <span class="text-[9px] text-indigo-400 font-semibold cursor-pointer hover:underline" id="master-cadence-quick-apply" title="Click to apply this pattern to your shots">⚡ Apply Pattern</span>
                </div>
            </div>
        </div>
    `;
}
