import { timelineState } from './state-timeline';
import { state } from './state';
import { assetStorage } from './assetStorage';
import * as utils from './utils';
import * as dom from './dom';
import * as ui from './ui';
import { GraphicEvent, getGraphicBounds } from './graphics-engine';
import { HYPERFRAME_PRESETS, HyperFramesEngine } from './hyperframes-engine';
import { AudioSynthesizer, type ProceduralSfxType } from './audioSynthesizer';
import { drawVideoFrame, getPipOverlayBounds, TimelineClip } from './videoRenderer';
import { handleSplitClip, handleTrimClip, handleTimelineZoomIn, handleTimelineZoomOut, handleTimelineZoomFit, handleVideoPlayPause, handleDeleteClip, handleTrimDeadAir, handleUndoTimeline, handleRedoTimeline, handleResyncTimeline } from './videoController';
import { autoGenerateGraphics } from './videoDirector';
import { syncMotionGraphicsUI } from './handlers-settings';
import { getAllStoryboardShots } from './handlers-inspector';
import { t0, t1 } from './perfMonitor';
import { markInteraction, scheduleFullQualityRedraw } from './interaction';

let currentEditingGraphicId: string | null = null;
let currentCustomImageUrl: string | null = null;
let graphicInteractionOccurred = false;
let clientPointerDownX = 0;
let clientPointerDownY = 0;

let isResizingGraphic = false;
let resizeGraphicId: string | null = null;
let startResizeScale = 1.0;
let centerCanvasX = 0;
let centerCanvasY = 0;
let startPointerDist = 1;

export function handleCanvasClick(e: MouseEvent) {
    if (graphicInteractionOccurred) {
        graphicInteractionOccurred = false;
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    
    // If a graphic is actively being edited, clicking the canvas background should deselect it instead of playing video
    if (currentEditingGraphicId) {
        openGraphicEditor(undefined);
        return;
    }
    
    handleVideoPlayPause();
}

export function updatePositionInputsFromEvent(ev?: GraphicEvent) {
    if (!ev && currentEditingGraphicId) {
        ev = (timelineState.graphics || []).find(g => g.id === currentEditingGraphicId);
    }
    if (!ev) return;

    let posXPercent = 50;
    let posYPercent = 50;

    const isCenterAnchored = ev.type === 'hyperFrame' || ev.type === 'titleCard' || ev.type === 'iconOverlay' || ev.type === 'evidenceBoard' || ev.type === 'revealRoute' || ev.type === 'spotlightFocus';

    if (ev.customX !== undefined && ev.customY !== undefined) {
        posXPercent = Math.round(ev.customX * 100);
        posYPercent = Math.round(ev.customY * 100);
    } else {
        const bounds = getGraphicBounds(ev, 100, 100);
        if (isCenterAnchored) {
            posXPercent = Math.round(bounds.x + bounds.w / 2);
            posYPercent = Math.round(bounds.y + bounds.h / 2);
        } else {
            posXPercent = Math.round(bounds.x);
            posYPercent = Math.round(bounds.y);
        }
    }

    if (dom.gePosX) dom.gePosX.value = posXPercent.toString();
    if (dom.gePosY) dom.gePosY.value = posYPercent.toString();
    if (dom.gePosXVal) dom.gePosXVal.textContent = `${posXPercent}%`;
    if (dom.gePosYVal) dom.gePosYVal.textContent = `${posYPercent}%`;
    if (dom.gePosReadout) dom.gePosReadout.textContent = `X: ${posXPercent}% | Y: ${posYPercent}%`;
}

export function handlePositionSliderChange() {
    const xPercent = parseInt(dom.gePosX?.value || '50', 10);
    const yPercent = parseInt(dom.gePosY?.value || '50', 10);

    if (dom.gePosXVal) dom.gePosXVal.textContent = `${xPercent}%`;
    if (dom.gePosYVal) dom.gePosYVal.textContent = `${yPercent}%`;
    if (dom.gePosReadout) dom.gePosReadout.textContent = `X: ${xPercent}% | Y: ${yPercent}%`;
    if (dom.geIconPosition) dom.geIconPosition.value = 'custom';

    if (currentEditingGraphicId) {
        const events = [...(timelineState.graphics || [])];
        const ev = events.find(g => g.id === currentEditingGraphicId);
        if (ev) {
            ev.customX = xPercent / 100;
            ev.customY = yPercent / 100;
            (ev as any).position = 'custom';
            timelineState.setGraphics(events);
            if (!state.isVideoPlaying) {
                drawVideoFrame(state.lastRenderedTime);
            }
        }
    }
}

export function handleNudgePosition(dx: number | 'center', dy: number | 'center') {
    let curX = parseInt(dom.gePosX?.value || '50', 10);
    let curY = parseInt(dom.gePosY?.value || '50', 10);

    if (dx === 'center') curX = 50;
    else curX = Math.max(0, Math.min(100, curX + dx));

    if (dy === 'center') curY = 50;
    else curY = Math.max(0, Math.min(100, curY + dy));

    if (dom.gePosX) dom.gePosX.value = curX.toString();
    if (dom.gePosY) dom.gePosY.value = curY.toString();

    handlePositionSliderChange();
}

if (typeof window !== 'undefined') {
    window.addEventListener('graphic-image-loaded', () => {
        if (!state.isVideoPlaying) {
            drawVideoFrame(state.lastRenderedTime);
        }
    });
}

export function setCustomImagePreview(url: string | null, name?: string) {
    currentCustomImageUrl = url;
    if (url) {
        if (dom.geCustomImageThumb) dom.geCustomImageThumb.src = url;
        if (dom.geCustomImageName) dom.geCustomImageName.textContent = name || 'Custom graphic uploaded';
        dom.geCustomImagePreview?.classList.remove('hidden');
        dom.geClearImageBtn?.classList.remove('hidden');
    } else {
        if (dom.geCustomImageThumb) dom.geCustomImageThumb.src = '';
        if (dom.geCustomImageName) dom.geCustomImageName.textContent = '';
        dom.geCustomImagePreview?.classList.add('hidden');
        dom.geClearImageBtn?.classList.add('hidden');
        if (dom.geCustomImageFile) dom.geCustomImageFile.value = '';
    }
}

export function handleGraphicCustomImageUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
            if (dom.geIcon) dom.geIcon.value = 'custom';
            setCustomImagePreview(result, file.name);
            ui.showStatus('Custom image/icon loaded for overlay', false, 2500);
        }
    };
    reader.readAsDataURL(file);
}

export function clearCustomImage() {
    setCustomImagePreview(null);
    if (dom.geIcon && dom.geIcon.value === 'custom') {
        dom.geIcon.value = 'arrow-up';
    }
}

export function getGraphicTypeLabel(type: string): string {
    switch (type) {
        case 'lowerThird': return 'Lower Third';
        case 'titleCard': return 'Title Card';
        case 'bulletPanel': return 'Bullet List';
        case 'iconOverlay': return 'Icon / Arrow';
        case 'statCounter': return 'Stat Counter';
        case 'donutChart': return 'Donut Chart';
        case 'socialBadge': return 'Social Badge';
        case 'spotlightFocus': return 'Spotlight Focus';
        case 'versusCard': return 'Versus Card';
        case 'revealRoute': return 'Route Steps';
        case 'spectrum': return 'Audio Spectrum';
        case 'evidenceBoard': return 'Evidence Board';
        case 'hyperFrame': return '🚀 HyperFrame';
        default: return 'Graphic';
    }
}

export function syncPresetChips(selectedType: string) {
    const chips = document.querySelectorAll('.ge-preset-chip');
    chips.forEach(chip => {
        const chipType = chip.getAttribute('data-preset-chip');
        if (chipType === selectedType) {
            if (chipType === 'hyperFrame') {
                chip.className = 'ge-preset-chip shrink-0 px-2.5 py-1 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 text-white font-bold border border-sky-400/60 shadow-md shadow-sky-950/50 transition cursor-pointer';
            } else {
                chip.className = 'ge-preset-chip shrink-0 px-2.5 py-1 rounded-lg bg-teal-600 text-white font-bold border border-teal-400/60 shadow-md transition cursor-pointer';
            }
        } else {
            if (chipType === 'hyperFrame') {
                chip.className = 'ge-preset-chip shrink-0 px-2.5 py-1 rounded-lg bg-sky-950/60 hover:bg-sky-900/60 text-sky-300 border border-sky-500/40 transition cursor-pointer font-semibold';
            } else if (chipType === 'lowerThird') {
                chip.className = 'ge-preset-chip shrink-0 px-2.5 py-1 rounded-lg bg-teal-950/60 hover:bg-teal-900/60 text-teal-300 border border-teal-500/40 transition cursor-pointer font-semibold';
            } else {
                chip.className = 'ge-preset-chip shrink-0 px-2.5 py-1 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition cursor-pointer';
            }
        }
    });
}

export function renderGraphicsList() {
    if (!dom.graphicsListContainer) return;
    const isPanelVisible = dom.graphicsListContainer.offsetParent !== null || !!dom.panelGraphics?.classList.contains('active');
    const events = timelineState.graphics || [];

    const countBadge = document.getElementById('graphics-count-badge');
    if (countBadge) {
        countBadge.textContent = events.length.toString();
    }

    const curPlayhead = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? state.lastRenderedTime
        : (state.videoPauseTime || 0);
    const playheadDisplay = document.getElementById('graphics-playhead-display');
    if (playheadDisplay) {
        const m = Math.floor(curPlayhead / 60);
        const s = (curPlayhead % 60).toFixed(1);
        playheadDisplay.textContent = `${m}:${s.padStart(4, '0')}`;
    }
    
    // If the panel is hidden, skip expensive DOM rebuild of all items
    if (!isPanelVisible) return;

    if (events.length === 0) {
        dom.graphicsListContainer.innerHTML = '<div class="text-gray-500 text-center py-6 text-xs bg-gray-950/40 rounded-xl border border-dashed border-gray-800">No motion graphics on timeline yet. Click any preset card above or use \'Auto-Direct Overlays\'.</div>';
        return;
    }
    
    dom.graphicsListContainer.innerHTML = '';
    
    // Do not sort by start time, so we preserve Z-order (array order).
    // Display in reverse order so highest Z (drawn last) is at the top of the list.
    const displayEvents = [...events].reverse();
    
    displayEvents.forEach((ev, displayIdx) => {
        const actualIdx = events.length - 1 - displayIdx;
        const div = document.createElement('div');
        const isActive = currentEditingGraphicId === ev.id;
        div.className = `rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer transition-all ${isActive ? 'bg-teal-950/70 border border-teal-500/80 shadow-md ring-1 ring-teal-500/40' : 'bg-gray-950/70 hover:bg-gray-850/80 border border-gray-800'}`;
        
        const typeLabel = getGraphicTypeLabel(ev.type);
        const isHyperFrame = ev.type === 'hyperFrame';
        const isAudioReactive = (ev as any).audioReactive !== false;
        const animLabel = (ev as any).animationIn || (ev as any).animationType || 'fade';
        const displayTitle = ev.title ? ev.title : (ev.type === 'iconOverlay' ? 'Icon Overlay' : 'Untitled Graphic');
        const duration = Math.max(0.1, ev.end - ev.start).toFixed(1);
        
        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${isHyperFrame ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-teal-500/20 text-teal-300 border border-teal-500/30'}">${typeLabel}</span>
                    <span class="text-xs font-mono text-gray-300 bg-black/40 px-1.5 py-0.5 rounded border border-white/5">${ev.start.toFixed(1)}s — ${ev.end.toFixed(1)}s (${duration}s)</span>
                    <span class="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                        <span>⚡ ${animLabel}</span>
                        ${isAudioReactive ? '<span class="text-teal-400">· 🎵 Audio Sync</span>' : ''}
                    </span>
                </div>
                <div class="text-white text-xs mt-1 font-semibold truncate max-w-full sm:max-w-[340px] md:max-w-[420px] flex items-center gap-1.5">
                    <span>${displayTitle}</span>
                    ${ev.subtitle ? `<span class="text-gray-400 font-normal">(${ev.subtitle})</span>` : ''}
                </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
                <div class="flex gap-0.5 mr-1 bg-black/30 p-0.5 rounded-lg border border-white/5">
                    <button class="up-btn text-gray-400 hover:text-teal-300 p-1 text-xs rounded hover:bg-white/10 transition cursor-pointer" ${actualIdx === events.length - 1 ? 'disabled style="opacity:0.25"' : ''} title="Move Forward in Layer Stack (Higher Z-Order)">▲</button>
                    <button class="down-btn text-gray-400 hover:text-teal-300 p-1 text-xs rounded hover:bg-white/10 transition cursor-pointer" ${actualIdx === 0 ? 'disabled style="opacity:0.25"' : ''} title="Move Backward in Layer Stack (Lower Z-Order)">▼</button>
                </div>
                <button class="snap-btn text-amber-300 hover:text-amber-200 text-xs font-semibold px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 rounded-lg border border-amber-700/50 transition cursor-pointer flex items-center gap-1" title="Snap start time to current video playhead">
                    <span>🎯</span>
                </button>
                <button class="dup-btn text-indigo-300 hover:text-indigo-200 text-xs font-semibold px-2 py-1 bg-indigo-950/40 hover:bg-indigo-900/60 rounded-lg border border-indigo-700/50 transition cursor-pointer flex items-center gap-1" title="Duplicate overlay">
                    <span>📑</span>
                </button>
                <button class="edit-btn text-teal-300 hover:text-teal-200 text-xs font-semibold px-2.5 py-1 bg-teal-950/50 hover:bg-teal-900/70 rounded-lg border border-teal-700/50 transition cursor-pointer">
                    Edit
                </button>
                <button class="delete-btn text-red-400 hover:text-red-300 text-xs font-semibold px-2 py-1 bg-red-950/40 hover:bg-red-900/60 rounded-lg border border-red-800/50 transition cursor-pointer" title="Delete overlay">
                    ✕
                </button>
            </div>
        `;
        
        div.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            openGraphicEditor(ev.id);
        });

        div.querySelector('.edit-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openGraphicEditor(ev.id);
        });

        div.querySelector('.snap-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            snapGraphicToPlayhead(ev.id);
        });

        div.querySelector('.dup-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            duplicateGraphicEvent(ev.id);
        });

        div.querySelector('.delete-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteGraphicEvent(ev.id);
        });

        div.querySelector('.up-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (actualIdx < events.length - 1) {
                timelineState.saveSnapshot();
                const newEvents = [...events];
                const temp = newEvents[actualIdx];
                newEvents[actualIdx] = newEvents[actualIdx + 1];
                newEvents[actualIdx + 1] = temp;
                timelineState.setGraphics(newEvents);
                renderGraphicsList();
                if (!state.isVideoPlaying) drawVideoFrame(state.lastRenderedTime);
            }
        });

        div.querySelector('.down-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (actualIdx > 0) {
                timelineState.saveSnapshot();
                const newEvents = [...events];
                const temp = newEvents[actualIdx];
                newEvents[actualIdx] = newEvents[actualIdx - 1];
                newEvents[actualIdx - 1] = temp;
                timelineState.setGraphics(newEvents);
                renderGraphicsList();
                if (!state.isVideoPlaying) drawVideoFrame(state.lastRenderedTime);
            }
        });
        
        dom.graphicsListContainer.appendChild(div);
    });
}

export function duplicateGraphicEvent(id: string) {
    const list = timelineState.graphics || [];
    const source = list.find(g => g.id === id);
    if (!source) return;

    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? Math.round(state.lastRenderedTime * 10) / 10
        : Math.round((state.videoPauseTime || 0) * 10) / 10;
    
    const duration = Math.max(1, source.end - source.start);
    const start = playheadTime > source.end ? playheadTime : Math.round((source.end + 0.2) * 10) / 10;
    const end = Math.round((start + duration) * 10) / 10;

    const copy = JSON.parse(JSON.stringify(source));
    copy.id = 'graphic_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6);
    copy.title = (copy.title ? `${copy.title} (Copy)` : 'Copy');
    copy.start = start;
    copy.end = end;

    timelineState.saveSnapshot();
    const updated = [...list, copy];
    timelineState.setGraphics(updated);
    renderGraphicsList();
    openGraphicEditor(copy.id);
    if (!state.isVideoPlaying) drawVideoFrame(start);
    ui.showStatus('📑 Duplicated motion graphic overlay', false, 2000);
}

export function snapGraphicToPlayhead(id: string) {
    const list = timelineState.graphics || [];
    const target = list.find(g => g.id === id);
    if (!target) return;

    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? Math.round(state.lastRenderedTime * 10) / 10
        : Math.round((state.videoPauseTime || 0) * 10) / 10;

    const duration = Math.max(0.5, target.end - target.start);
    timelineState.saveSnapshot();
    target.start = playheadTime;
    target.end = Math.round((playheadTime + duration) * 10) / 10;

    timelineState.setGraphics([...list]);
    renderGraphicsList();
    if (currentEditingGraphicId === id) {
        if (dom.geStart) dom.geStart.value = target.start.toFixed(1);
        if (dom.geEnd) dom.geEnd.value = target.end.toFixed(1);
    }
    if (!state.isVideoPlaying) drawVideoFrame(playheadTime);
    ui.showStatus(`🎯 Snapped overlay to playhead (${playheadTime.toFixed(1)}s)`, false, 2000);
}

export function dropGraphicAtPlayhead(presetType: string = 'lowerThird') {
    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? Math.round(state.lastRenderedTime * 10) / 10
        : Math.round((state.videoPauseTime || 0) * 10) / 10;
    
    const duration = 4.0;
    const start = playheadTime;
    const end = Math.round((playheadTime + duration) * 10) / 10;

    let title = '';
    let subtitle: string | undefined = undefined;
    let icon: string | undefined = undefined;

    const isHf = presetType.startsWith('hyperFrame:') || presetType === 'hyperFrame';

    if (isHf) {
        const hfId = presetType.startsWith('hyperFrame:') ? presetType.replace('hyperFrame:', '') : 'launch-hero';
        const hfPreset = HYPERFRAME_PRESETS.find(p => p.id === hfId) || HYPERFRAME_PRESETS[0];
        title = hfPreset.name;
    } else {
        switch (presetType) {
            case 'lowerThird':
                title = 'Speaker Name';
                subtitle = 'Title / Affiliation';
                break;
            case 'titleCard':
                title = 'Chapter Title';
                subtitle = 'Key Takeaways & Insights';
                break;
            case 'bulletPanel':
                title = 'Key Takeaways';
                break;
            case 'iconOverlay':
                icon = 'arrow-up';
                title = 'Key Focus';
                break;
            case 'statCounter':
                title = 'Active Metric';
                break;
            case 'donutChart':
                title = 'Growth Breakdown';
                break;
            case 'socialBadge':
                title = 'Follow Us';
                break;
            case 'spotlightFocus':
                title = 'Subject Highlight';
                break;
            case 'versusCard':
                title = 'Comparison';
                break;
            case 'revealRoute':
                title = 'Route Timeline';
                break;
            case 'spectrum':
                title = 'Audio Spectrum';
                break;
            case 'evidenceBoard':
                title = 'Evidence Board';
                break;
            default:
                title = 'Graphic Overlay';
        }
    }

    const newEv: any = {
        id: 'graphic_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        type: isHf ? 'hyperFrame' : presetType,
        start,
        end,
        title,
        subtitle,
        accentColor: localStorage.getItem('ge_last_color') || '#F5C542',
        theme: localStorage.getItem('ge_last_theme') || 'corporate',
        animationType: localStorage.getItem('ge_last_anim') || (presetType === 'iconOverlay' ? 'pop' : 'slide-left'),
    };

    if (presetType === 'lowerThird') {
        newEv.position = 'left';
    } else if (presetType === 'titleCard') {
        newEv.backdrop = 'scrim';
    } else if (presetType === 'iconOverlay') {
        newEv.icon = icon || 'arrow-up';
        newEv.scale = 1.0;
        newEv.rotation = 0;
        newEv.position = 'center';
    } else if (presetType === 'bulletPanel') {
        newEv.bullets = ['First key takeaway', 'Second crucial step', 'Third essential concept'];
        newEv.bulletStyle = 'check';
        newEv.position = 'left';
        newEv.staggerDelay = 0.45;
    } else if (presetType === 'evidenceBoard') {
        newEv.items = [
            { id: 'eb_item_0', label: 'Primary Evidence' },
            { id: 'eb_item_1', label: 'Witness Statement' },
            { id: 'eb_item_2', label: 'Forensic Match' }
        ];
        newEv.connectionStyle = 'string';
        newEv.staggerDelay = 0.6;
    } else if (presetType === 'revealRoute') {
        newEv.nodes = [
            { id: 'rr_node_0', label: 'Origin', subtitle: 'Day 1' },
            { id: 'rr_node_1', label: 'Checkpoint', subtitle: 'Day 3' },
            { id: 'rr_node_2', label: 'Destination', subtitle: 'Day 7' }
        ];
        newEv.orientation = 'horizontal';
        newEv.lineStyle = 'arrow';
        newEv.staggerDelay = 0.6;
    } else if (presetType === 'statCounter') {
        newEv.targetValue = 100;
        newEv.prefix = '';
        newEv.suffix = '%';
        newEv.trend = 'up';
        newEv.trendLabel = '+24% YoY';
        newEv.countDuration = 1.5;
    } else if (presetType === 'spotlightFocus') {
        newEv.shape = 'circle';
        newEv.dimOpacity = 0.75;
        newEv.calloutPosition = 'auto';
        newEv.focusRadiusX = 0.15;
        newEv.focusRadiusY = 0.15;
    } else if (presetType === 'socialBadge') {
        newEv.platform = 'youtube';
        newEv.handle = '@Channel';
        newEv.showVerified = true;
        newEv.showBellChime = true;
    } else if (presetType === 'versusCard') {
        newEv.leftTitle = 'OPTION A';
        newEv.leftPoints = ['High Performance', 'Low Latency'];
        newEv.rightTitle = 'OPTION B';
        newEv.rightPoints = ['High Complexity', 'Manual Setup'];
        newEv.vsBadgeText = 'VS';
    } else if (presetType === 'donutChart') {
        newEv.chartMode = 'percentage';
        newEv.percentage = 78;
        newEv.holeSize = 0.62;
        newEv.centerLabel = '78%';
        newEv.centerSublabel = 'GROWTH';
        newEv.showLegend = true;
        newEv.animationDuration = 1.2;
    } else if (presetType === 'spectrum') {
        newEv.barCount = 32;
        newEv.style = 'bars';
        newEv.position = 'bottom';
        newEv.color = '#F5C542';
        newEv.width = 0.7;
        newEv.maxHeight = 0.22;
        newEv.glow = true;
    } else if (isHf) {
        const hfId = presetType.startsWith('hyperFrame:') ? presetType.replace('hyperFrame:', '') : 'launch-hero';
        const hfPreset = HYPERFRAME_PRESETS.find(p => p.id === hfId) || HYPERFRAME_PRESETS[0];
        newEv.title = hfPreset.name;
        newEv.templateId = hfPreset.id;
        newEv.html = hfPreset.html.trim();
        newEv.animationIn = hfPreset.animationIn;
        newEv.animationOut = hfPreset.animationOut;
        newEv.position = hfPreset.position;
        newEv.accentColor = hfPreset.accentColor;
        newEv.textColor = hfPreset.textColor;
        newEv.audioReactive = hfPreset.audioReactive ?? true;
        newEv.musicReactiveGlow = hfPreset.musicReactiveGlow ?? true;
        newEv.sfxTrigger = hfPreset.sfxTrigger ?? 'whoosh';
        newEv.beatPulseScale = hfPreset.beatPulseScale ?? 0.08;
    }

    timelineState.saveSnapshot();
    const currentList = [...(timelineState.graphics || [])];
    currentList.push(newEv);
    timelineState.setGraphics(currentList);

    openGraphicEditor(newEv.id);
    renderGraphicsList();
    if (!state.isVideoPlaying) {
        drawVideoFrame(playheadTime);
    }

    ui.showStatus(`✨ Added ${newEv.title || getGraphicTypeLabel(newEv.type)} at ${playheadTime.toFixed(1)}s`, false, 2500);
}

export function dropSfxCueAtPlayhead(sfxType: ProceduralSfxType) {
    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? Math.round(state.lastRenderedTime * 10) / 10
        : Math.round((state.videoPauseTime || 0) * 10) / 10;
    
    const sfxLabels: Record<string, string> = {
        whoosh: '💨 Whoosh',
        hit: '🔨 Hit',
        ping: '🔔 Ping',
        pop: '🫧 Pop',
        laser: '⚡ Laser',
        riser: '📈 Riser',
        glitch: '👾 Glitch',
        bass_drop: '🔊 Sub Drop',
        cyber_chime: '✨ Chime',
        impact: '💥 Impact',
        chord: '🎹 Chord'
    };

    const label = sfxLabels[sfxType] || sfxType;
    const newEv: GraphicEvent = {
        id: 'sfx_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'iconOverlay',
        start: playheadTime,
        end: Math.round((playheadTime + 2.0) * 10) / 10,
        title: label,
        icon: 'volume-2',
        scale: 0.85,
        position: 'top-right',
        accentColor: '#F59E0B',
        textColor: '#FFFFFF',
        animationType: 'pop',
        animationIn: 'spring-bounce',
        animationOut: 'scale-down',
        sfxTrigger: sfxType,
        isSfxOnly: true
    } as any;

    timelineState.saveSnapshot();
    const currentList = [...(timelineState.graphics || [])];
    currentList.push(newEv);
    timelineState.setGraphics(currentList);

    // Play instant sound feedback
    try {
        AudioSynthesizer.getInstance().playSfx(sfxType, 0.6);
    } catch {}

    renderGraphicsList();
    ui.renderTimelineEditor();
    if (!state.isVideoPlaying) {
        drawVideoFrame(playheadTime);
    }

    ui.showStatus(`🔊 Added ${label} to SFX track at ${playheadTime.toFixed(1)}s`, false, 2500);
}

export interface CustomSfxItem {
    id: string;
    name: string;
    assetId: string;
    objectUrl: string;
    buffer?: AudioBuffer;
    duration: number;
}

export const customSfxList: CustomSfxItem[] = [];

export function renderCustomSfxDropsList() {
    if (!dom.customSfxDropsList) return;
    if (customSfxList.length === 0) {
        dom.customSfxDropsList.innerHTML = '';
        return;
    }

    dom.customSfxDropsList.innerHTML = customSfxList.map(item => `
        <div class="custom-sfx-card bg-zinc-900/90 hover:bg-emerald-950/80 border border-emerald-500/30 hover:border-emerald-400 rounded p-1.5 flex items-center justify-between gap-1 transition text-[10px]" data-id="${item.id}">
            <span class="text-emerald-300 font-medium truncate flex items-center gap-1 min-w-0" title="${ui.escapeHtml(item.name)}">
                <span>🎵</span> <span class="truncate">${ui.escapeHtml(item.name)}</span>
            </span>
            <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="preview-custom-sfx-btn px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-emerald-300 rounded font-bold cursor-pointer" data-id="${item.id}" title="Preview Sound">▶</button>
                <button type="button" class="trim-custom-sfx-btn px-1.5 py-0.5 bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-500/40 rounded font-bold cursor-pointer" data-id="${item.id}" title="Cut & Trim Waveform">✂️</button>
                <button type="button" class="drop-custom-sfx-btn px-1.5 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold cursor-pointer" data-id="${item.id}" title="Drop onto SFX Track">+ Add</button>
            </div>
        </div>
    `).join('');
}

export async function handleUploadCustomSfxDropClick() {
    if (dom.customSfxDropInput) {
        dom.customSfxDropInput.click();
    }
}

export async function handleCustomSfxDropSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const files = Array.from(input.files);

    for (const file of files) {
        try {
            const assetId = `custom_sfx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            await assetStorage.storeAsset(file, 'audio', undefined, assetId);
            const objectUrl = URL.createObjectURL(file);

            // Decode audio buffer for instant play & export
            let buffer: AudioBuffer | undefined;
            let duration = 2.5;
            try {
                const ctx = utils.getAudioContext();
                if (ctx.state === 'suspended') await ctx.resume();
                const arrayBuf = await file.arrayBuffer();
                buffer = await ctx.decodeAudioData(arrayBuf);
                if (buffer) {
                    duration = Math.max(0.5, Math.round(buffer.duration * 100) / 100);
                }
            } catch (e) {
                console.warn('Could not decode custom SFX audio buffer:', e);
            }

            const item: CustomSfxItem = {
                id: assetId,
                name: file.name.replace(/\.[^/.]+$/, ""),
                assetId,
                objectUrl,
                buffer,
                duration
            };

            customSfxList.push(item);
            renderCustomSfxDropsList();

            // Instantly drop the uploaded custom SFX onto timeline at playhead
            dropCustomSfxCueAtPlayhead(item);
        } catch (err) {
            console.error('Failed to process custom SFX upload:', err);
            ui.showStatus(`Failed to upload ${file.name}`, true, 3000);
        }
    }

    input.value = '';
    document.getElementById('timeline-sfx-dropdown')?.classList.add('hidden');
}

export function dropCustomSfxCueAtPlayhead(item: CustomSfxItem) {
    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
        ? Math.round(state.lastRenderedTime * 10) / 10
        : Math.round((state.videoPauseTime || 0) * 10) / 10;

    const label = `🎵 ${item.name}`;
    const duration = item.duration || 2.5;

    const newEv: GraphicEvent = {
        id: 'sfx_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'iconOverlay',
        start: playheadTime,
        end: Math.round((playheadTime + duration) * 10) / 10,
        title: label,
        icon: 'volume-2',
        scale: 0.85,
        position: 'top-right',
        accentColor: '#10B981',
        textColor: '#FFFFFF',
        animationType: 'pop',
        animationIn: 'spring-bounce',
        animationOut: 'scale-down',
        sfxTrigger: 'custom' as any,
        customSfxAssetId: item.assetId,
        customSfxUrl: item.objectUrl,
        _sfxObjectURL: item.objectUrl,
        _sfxBuffer: item.buffer,
        isSfxOnly: true
    } as any;

    timelineState.saveSnapshot();
    const currentList = [...(timelineState.graphics || [])];
    currentList.push(newEv);
    timelineState.setGraphics(currentList);

    // Play instant sound feedback
    try {
        if (item.buffer) {
            const ctx = utils.getAudioContext();
            if (ctx.state === 'suspended') ctx.resume();
            const src = ctx.createBufferSource();
            src.buffer = item.buffer;
            src.connect(ctx.destination);
            src.start();
        } else if (item.objectUrl) {
            const audio = new Audio(item.objectUrl);
            audio.volume = 0.85;
            audio.play().catch(() => {});
        }
    } catch {}

    renderGraphicsList();
    ui.renderTimelineEditor();
    if (!state.isVideoPlaying) {
        drawVideoFrame(playheadTime);
    }

    ui.showStatus(`🔊 Dropped custom SFX "${item.name}" onto SFX track at ${playheadTime.toFixed(1)}s`, false, 3000);
}

export function openGraphicEditor(id?: string, defaultStart?: number) {
    currentEditingGraphicId = id || null;
    (window as any)._currentEditingGraphicId = currentEditingGraphicId;
    
    if (id) {
        const ev = timelineState.graphics.find(g => g.id === id);
        if (ev) {
            // Only pure SFX cues should open the SFX trimmer; visual overlays with SFX cues belong in Graphic Editor!
            if ((ev as any).isSfxOnly || (ev.type as string) === 'sfxCue') {
                import('./sfx-trimmer').then(m => m.openSfxTrimmerForGraphic(id));
                return;
            }

            // Jump playhead to graphic if currently outside range
            const evStart = ev.start !== undefined ? ev.start : 0;
            const evEnd = ev.end !== undefined ? ev.end : (evStart + 4);
            if (state.lastRenderedTime < evStart || state.lastRenderedTime >= evEnd) {
                const midTime = (evStart + evEnd) / 2;
                state.videoPauseTime = midTime;
                state.lastRenderedTime = midTime;
            }

            if (dom.geType) dom.geType.value = ev.type || 'lowerThird';
            if (dom.graphicEditorTitle) dom.graphicEditorTitle.textContent = `Edit ${getGraphicTypeLabel(ev.type)}`;
            if (dom.geDeleteCurrBtn) dom.geDeleteCurrBtn.classList.remove('hidden');
            if (dom.geStart) dom.geStart.value = evStart.toFixed(1);
            if (dom.geEnd) dom.geEnd.value = evEnd.toFixed(1);
            if (dom.geTitle) dom.geTitle.value = ev.title || '';
            if (dom.geSubtitle) dom.geSubtitle.value = ev.subtitle || '';
            if (dom.geAccentWords) dom.geAccentWords.value = ev.accentWords ? ev.accentWords.join(', ') : '';
            if (dom.geTextColor) dom.geTextColor.value = ev.textColor || '#FFFFFF';
            if (dom.geColor) dom.geColor.value = ev.accentColor || '#F5C542';
            if (dom.geTheme) dom.geTheme.value = ev.theme || 'corporate';
            if (dom.geAnimation) dom.geAnimation.value = ev.animationType || (ev.type === 'iconOverlay' ? 'pop' : 'slide-left');
            if (dom.geAnimIn) dom.geAnimIn.value = (ev as any).animationIn || 'spring-bounce';
            if (dom.geAnimOut) dom.geAnimOut.value = (ev as any).animationOut || 'scale-down';
            if (dom.geSfxTrigger) dom.geSfxTrigger.value = (ev as any).sfxTrigger || 'whoosh';
            
            if (ev.type === 'lowerThird') {
                (ev as any).position = (ev as any).position || 'left';
                if (dom.gePosition) dom.gePosition.value = (ev as any).position;
                setCustomImagePreview(null);
            } else if (ev.type === 'titleCard') {
                const bd = (ev as any).backdrop || 'scrim';
                (ev as any).backdrop = bd;
                if (dom.geBackdrop) dom.geBackdrop.value = bd;
                if (dom.gePosition) dom.gePosition.value = (ev as any).position || 'center';
                setCustomImagePreview(null);
            } else if (ev.type === 'iconOverlay' || (ev as any).customImageUrl || (ev as any).icon === 'custom') {
                if (dom.geType) dom.geType.value = 'iconOverlay';
                dom.geIcon.value = (ev as any).icon || 'arrow-up';
                dom.geScale.value = ((ev as any).scale || 1.0).toString();
                dom.geRotation.value = ((ev as any).rotation || 0).toString();
                if (dom.geIconPosition) {
                    if (ev.customX !== undefined || ev.customY !== undefined) {
                        dom.geIconPosition.value = 'custom';
                    } else {
                        dom.geIconPosition.value = (ev as any).position || 'center';
                    }
                }
                setCustomImagePreview((ev as any).customImageUrl || null);
            } else if (ev.type === 'bulletPanel') {
                if (dom.geBpBullets) dom.geBpBullets.value = (ev.bullets || []).join('\n');
                if (dom.geBpStyle) dom.geBpStyle.value = ev.bulletStyle || 'check';
                if (dom.geBpPosition) dom.geBpPosition.value = ev.position || 'left';
                if (dom.geBpStagger) dom.geBpStagger.value = (ev.staggerDelay || 0.45).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'evidenceBoard') {
                if (dom.geEbItems) {
                    dom.geEbItems.value = (ev.items || []).map((it: any) => it.imageUrl ? `${it.label} | ${it.imageUrl}` : it.label).join('\n');
                }
                if (dom.geEbConnection) dom.geEbConnection.value = ev.connectionStyle || 'string';
                if (dom.geEbStagger) dom.geEbStagger.value = (ev.staggerDelay || 0.6).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'revealRoute') {
                if (dom.geRrNodes) {
                    dom.geRrNodes.value = (ev.nodes || []).map((n: any) => n.subtitle ? `${n.label} | ${n.subtitle}` : n.label).join('\n');
                }
                if (dom.geRrOrientation) dom.geRrOrientation.value = ev.orientation || 'horizontal';
                if (dom.geRrStyle) dom.geRrStyle.value = ev.lineStyle || 'arrow';
                if (dom.geRrStagger) dom.geRrStagger.value = (ev.staggerDelay || 0.6).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'statCounter') {
                if (dom.geScTarget) dom.geScTarget.value = (ev.targetValue !== undefined ? ev.targetValue : 100).toString();
                if (dom.geScPrefix) dom.geScPrefix.value = ev.prefix || '';
                if (dom.geScSuffix) dom.geScSuffix.value = ev.suffix || '';
                if (dom.geScTrend) dom.geScTrend.value = ev.trend || 'none';
                if (dom.geScTrendLabel) dom.geScTrendLabel.value = ev.trendLabel || '';
                if (dom.geScDuration) dom.geScDuration.value = (ev.countDuration || 1.5).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'spotlightFocus') {
                if (dom.geSfShape) dom.geSfShape.value = ev.shape || 'circle';
                if (dom.geSfOpacity) dom.geSfOpacity.value = (ev.dimOpacity !== undefined ? ev.dimOpacity : 0.75).toString();
                if (dom.geSfCalloutPos) dom.geSfCalloutPos.value = ev.calloutPosition || 'auto';
                if (dom.geSfRadX) dom.geSfRadX.value = (ev.focusRadiusX || 0.15).toString();
                if (dom.geSfRadY) dom.geSfRadY.value = (ev.focusRadiusY || 0.15).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'socialBadge') {
                if (dom.geSbPlatform) dom.geSbPlatform.value = ev.platform || 'youtube';
                if (dom.geSbHandle) dom.geSbHandle.value = ev.handle || '@AIStudio';
                if (dom.geSbVerified) dom.geSbVerified.checked = ev.showVerified !== false;
                if (dom.geSbBell) dom.geSbBell.checked = ev.showBellChime !== false;
                setCustomImagePreview(null);
            } else if (ev.type === 'versusCard') {
                if (dom.geVcLeftTitle) dom.geVcLeftTitle.value = ev.leftTitle || 'OPTION A';
                if (dom.geVcLeftPoints) dom.geVcLeftPoints.value = (ev.leftPoints || []).join('\n');
                if (dom.geVcRightTitle) dom.geVcRightTitle.value = ev.rightTitle || 'OPTION B';
                if (dom.geVcRightPoints) dom.geVcRightPoints.value = (ev.rightPoints || []).join('\n');
                if (dom.geVcBadge) dom.geVcBadge.value = ev.vsBadgeText || 'VS';
                setCustomImagePreview(null);
            } else if (ev.type === 'donutChart') {
                if (dom.geDcMode) dom.geDcMode.value = ev.chartMode || 'percentage';
                if (dom.geDcPercentage) dom.geDcPercentage.value = (ev.percentage !== undefined ? ev.percentage : 78).toString();
                if (dom.geDcHoleSize) dom.geDcHoleSize.value = (ev.holeSize !== undefined ? ev.holeSize : 0.62).toString();
                if (dom.geDcCenterLabel) dom.geDcCenterLabel.value = ev.centerLabel || '';
                if (dom.geDcCenterSublabel) dom.geDcCenterSublabel.value = ev.centerSublabel || '';
                if (dom.geDcSegments) {
                    dom.geDcSegments.value = (ev.segments || []).map((s: any) => s.color ? `${s.label} | ${s.value} | ${s.color}` : `${s.label} | ${s.value}`).join('\n');
                }
                if (dom.geDcShowLegend) dom.geDcShowLegend.checked = ev.showLegend !== false;
                if (dom.geDcDuration) dom.geDcDuration.value = (ev.animationDuration || 1.2).toString();
                setCustomImagePreview(null);
            } else if (ev.type === 'spectrum') {
                const sv = (id: string, val: string) => { const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null; if (el) el.value = val; };
                sv('ge-sp-bars', String((ev as any).barCount || 32));
                sv('ge-sp-style', (ev as any).style || 'bars');
                sv('ge-sp-position', (ev as any).position || 'bottom');
                sv('ge-sp-color', (ev as any).color || '#F5C542');
                sv('ge-sp-size', String((ev as any).width || 0.7));
                const glow = document.getElementById('ge-sp-glow') as HTMLInputElement | null;
                if (glow) glow.checked = !!(ev as any).glow;
                const barsVal = document.getElementById('ge-sp-bars-val');
                if (barsVal) barsVal.textContent = String((ev as any).barCount || 32);
                setCustomImagePreview(null);
            } else if (ev.type === 'hyperFrame') {
                if (dom.geHfPresetSelect) dom.geHfPresetSelect.value = (ev as any).templateId || 'launch-hero';
                if (dom.geHfHtml) dom.geHfHtml.value = (ev as any).html || HYPERFRAME_PRESETS[0].html.trim();
                if (dom.geHfAnimIn) dom.geHfAnimIn.value = (ev as any).animationIn || 'spring-bounce';
                if (dom.geHfAnimOut) dom.geHfAnimOut.value = (ev as any).animationOut || 'scale-down';
                if (dom.geHfPosition) dom.geHfPosition.value = (ev as any).position || 'bottom';
                if (dom.geHfAudioReactive) dom.geHfAudioReactive.checked = !!(ev as any).audioReactive;
                if (dom.geHfMusicGlow) dom.geHfMusicGlow.checked = !!(ev as any).musicReactiveGlow;
                if (dom.geHfSfxTrigger) dom.geHfSfxTrigger.value = (ev as any).sfxTrigger || 'none';
                if (dom.geHfBeatScale) dom.geHfBeatScale.value = String((ev as any).beatPulseScale || 0.08);
                setCustomImagePreview(null);
            }
            
            if (dom.graphicEditorTitle) dom.graphicEditorTitle.textContent = 'Edit Graphic';
            if (dom.geLinkClip) dom.geLinkClip.checked = !!ev.clipId;
            updatePositionInputsFromEvent(ev);
        }
    } else {
        // Defaults for new
        dom.geType.value = 'lowerThird';
        dom.geStart.value = defaultStart !== undefined ? defaultStart.toFixed(1) : '0';
        dom.geEnd.value = defaultStart !== undefined ? (defaultStart + 5).toFixed(1) : '5';
        if (dom.geLinkClip) dom.geLinkClip.checked = false;
        dom.geTitle.value = '';
        dom.geSubtitle.value = '';
        if (dom.geAccentWords) dom.geAccentWords.value = '';
        if (dom.geTextColor) dom.geTextColor.value = localStorage.getItem('ge_last_text_color') || '#FFFFFF';
        dom.geColor.value = localStorage.getItem('ge_last_color') || '#F5C542';
        dom.geTheme.value = localStorage.getItem('ge_last_theme') || 'corporate';
        dom.geAnimation.value = localStorage.getItem('ge_last_anim') || 'slide-left';
        if (dom.geAnimIn) dom.geAnimIn.value = 'spring-bounce';
        if (dom.geAnimOut) dom.geAnimOut.value = 'scale-down';
        if (dom.geSfxTrigger) dom.geSfxTrigger.value = 'whoosh';
        dom.gePosition.value = 'left';
        dom.geBackdrop.value = 'scrim';
        dom.geIcon.value = 'arrow-up';
        if (dom.geIconPosition) dom.geIconPosition.value = 'center';
        dom.geScale.value = '1.0';
        dom.geRotation.value = '0';
        if (dom.geBpBullets) dom.geBpBullets.value = 'First key takeaway\nSecond crucial step\nThird essential concept';
        if (dom.geBpStyle) dom.geBpStyle.value = 'check';
        if (dom.geBpPosition) dom.geBpPosition.value = 'left';
        if (dom.geBpStagger) dom.geBpStagger.value = '0.45';
        if (dom.geEbItems) dom.geEbItems.value = 'Primary Evidence\nSuspect Statement\nForensic Match';
        if (dom.geEbConnection) dom.geEbConnection.value = 'string';
        if (dom.geEbStagger) dom.geEbStagger.value = '0.6';
        if (dom.geRrNodes) dom.geRrNodes.value = 'Origin | Day 1\nCheckpoint | Day 3\nDestination | Day 7';
        if (dom.geRrOrientation) dom.geRrOrientation.value = 'horizontal';
        if (dom.geRrStyle) dom.geRrStyle.value = 'arrow';
        if (dom.geRrStagger) dom.geRrStagger.value = '0.6';
        if (dom.geDcMode) dom.geDcMode.value = 'percentage';
        if (dom.geDcPercentage) dom.geDcPercentage.value = '78';
        if (dom.geDcHoleSize) dom.geDcHoleSize.value = '0.62';
        if (dom.geDcCenterLabel) dom.geDcCenterLabel.value = '78%';
        if (dom.geDcCenterSublabel) dom.geDcCenterSublabel.value = 'GROWTH';
        if (dom.geDcSegments) dom.geDcSegments.value = 'Product A | 45 | #3B82F6\nProduct B | 35 | #10B981\nOther | 20 | #F59E0B';
        if (dom.geDcShowLegend) dom.geDcShowLegend.checked = true;
        if (dom.geDcDuration) dom.geDcDuration.value = '1.2';
        if (dom.geHfPresetSelect) dom.geHfPresetSelect.value = 'launch-hero';
        if (dom.geHfHtml) dom.geHfHtml.value = HYPERFRAME_PRESETS[0].html.trim();
        if (dom.geHfAnimIn) dom.geHfAnimIn.value = 'spring-bounce';
        if (dom.geHfAnimOut) dom.geHfAnimOut.value = 'scale-down';
        if (dom.geHfPosition) dom.geHfPosition.value = 'bottom';
        if (dom.geHfAudioReactive) dom.geHfAudioReactive.checked = true;
        if (dom.geHfMusicGlow) dom.geHfMusicGlow.checked = true;
        if (dom.geHfSfxTrigger) dom.geHfSfxTrigger.value = 'whoosh';
        if (dom.geHfBeatScale) dom.geHfBeatScale.value = '0.08';
        setCustomImagePreview(null);
        if (dom.graphicEditorTitle) dom.graphicEditorTitle.textContent = 'Add Graphic';
        if (dom.geDeleteCurrBtn) dom.geDeleteCurrBtn.classList.add('hidden');
        updatePositionInputsFromEvent();
    }
    
    updateGraphicEditorOptions();
    syncPresetChips(dom.geType.value);
    syncMotionGraphicsUI();
    dom.graphicEditorModal?.classList.remove('hidden');
    renderGraphicsList();
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function updateGraphicFromEditorLive() {
    if (!currentEditingGraphicId) return;
    const events = [...(timelineState.graphics || [])];
    const ev = events.find(g => g.id === currentEditingGraphicId);
    if (!ev) return;

    ev.type = dom.geType.value as any;
    ev.title = dom.geTitle.value.trim();
    ev.subtitle = dom.geSubtitle.value.trim() || undefined;
    const accentWordsStr = dom.geAccentWords?.value.trim() || '';
    ev.accentWords = accentWordsStr ? accentWordsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : undefined;
    if (dom.geTextColor) ev.textColor = dom.geTextColor.value;
    ev.accentColor = dom.geColor.value;
    ev.theme = dom.geTheme.value as any;
    ev.animationType = dom.geAnimation.value as any;
    if (dom.geAnimIn) (ev as any).animationIn = dom.geAnimIn.value;
    if (dom.geAnimOut) (ev as any).animationOut = dom.geAnimOut.value;
    if (dom.geSfxTrigger) (ev as any).sfxTrigger = dom.geSfxTrigger.value;

    if (ev.type === 'lowerThird') {
        (ev as any).position = dom.gePosition.value;
    } else if (ev.type === 'titleCard') {
        (ev as any).backdrop = dom.geBackdrop.value;
    } else if (ev.type === 'iconOverlay') {
        (ev as any).icon = currentCustomImageUrl ? 'custom' : dom.geIcon.value;
        (ev as any).customImageUrl = currentCustomImageUrl || undefined;
        (ev as any).scale = parseFloat(dom.geScale.value) || 1.0;
        (ev as any).rotation = parseInt(dom.geRotation.value, 10) || 0;
        const pos = dom.geIconPosition?.value || 'center';
        (ev as any).position = pos;
        if (pos !== 'custom') {
            delete ev.customX;
            delete ev.customY;
        }
    } else if (ev.type === 'bulletPanel') {
        ev.bullets = (dom.geBpBullets?.value || '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
        ev.bulletStyle = (dom.geBpStyle?.value as any) || 'check';
        ev.position = (dom.geBpPosition?.value as any) || 'left';
        ev.staggerDelay = parseFloat(dom.geBpStagger?.value) || 0.45;
    } else if (ev.type === 'evidenceBoard') {
        const lines = (dom.geEbItems?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        ev.items = lines.map((line, i) => {
            const parts = line.split('|').map(p => p.trim());
            return {
                id: `eb_item_${i}`,
                label: parts[0] || `Clue ${i + 1}`,
                imageUrl: parts[1] || undefined
            };
        });
        ev.connectionStyle = (dom.geEbConnection?.value as any) || 'string';
        ev.staggerDelay = parseFloat(dom.geEbStagger?.value) || 0.6;
    } else if (ev.type === 'revealRoute') {
        const lines = (dom.geRrNodes?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        ev.nodes = lines.map((line, i) => {
            const parts = line.split('|').map(p => p.trim());
            return {
                id: `rr_node_${i}`,
                label: parts[0] || `Stop ${i + 1}`,
                subtitle: parts[1] || undefined
            };
        });
        ev.orientation = (dom.geRrOrientation?.value as any) || 'horizontal';
        ev.lineStyle = (dom.geRrStyle?.value as any) || 'arrow';
        ev.staggerDelay = parseFloat(dom.geRrStagger?.value) || 0.6;
    } else if (ev.type === 'statCounter') {
        ev.targetValue = parseFloat(dom.geScTarget?.value) || 0;
        ev.prefix = dom.geScPrefix?.value || undefined;
        ev.suffix = dom.geScSuffix?.value || undefined;
        ev.trend = (dom.geScTrend?.value as any) || 'none';
        ev.trendLabel = dom.geScTrendLabel?.value || undefined;
        ev.countDuration = parseFloat(dom.geScDuration?.value) || 1.5;
    } else if (ev.type === 'spotlightFocus') {
        ev.shape = (dom.geSfShape?.value as any) || 'circle';
        ev.dimOpacity = parseFloat(dom.geSfOpacity?.value) || 0.75;
        ev.calloutPosition = (dom.geSfCalloutPos?.value as any) || 'auto';
        ev.focusRadiusX = parseFloat(dom.geSfRadX?.value) || 0.15;
        ev.focusRadiusY = parseFloat(dom.geSfRadY?.value) || 0.15;
    } else if (ev.type === 'socialBadge') {
        ev.platform = (dom.geSbPlatform?.value as any) || 'youtube';
        ev.handle = dom.geSbHandle?.value || '@AIStudio';
        ev.showVerified = dom.geSbVerified ? dom.geSbVerified.checked : true;
        ev.showBellChime = dom.geSbBell ? dom.geSbBell.checked : true;
    } else if (ev.type === 'versusCard') {
        ev.leftTitle = dom.geVcLeftTitle?.value || 'OPTION A';
        ev.leftPoints = (dom.geVcLeftPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        ev.rightTitle = dom.geVcRightTitle?.value || 'OPTION B';
        ev.rightPoints = (dom.geVcRightPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        ev.vsBadgeText = dom.geVcBadge?.value || 'VS';
    } else if (ev.type === 'donutChart') {
        ev.chartMode = (dom.geDcMode?.value as any) || 'percentage';
        ev.percentage = parseFloat(dom.geDcPercentage?.value) || 0;
        ev.holeSize = parseFloat(dom.geDcHoleSize?.value) || 0.62;
        ev.centerLabel = dom.geDcCenterLabel?.value || undefined;
        ev.centerSublabel = dom.geDcCenterSublabel?.value || undefined;
        const lines = (dom.geDcSegments?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        ev.segments = lines.map((l: string) => {
            const parts = l.split('|').map((p: string) => p.trim());
            return {
                label: parts[0] || 'Item',
                value: parseFloat(parts[1]) || 0,
                color: parts[2] || undefined
            };
        });
        ev.showLegend = dom.geDcShowLegend ? dom.geDcShowLegend.checked : true;
        ev.animationDuration = parseFloat(dom.geDcDuration?.value) || 1.2;
    } else if (ev.type === 'spectrum') {
        const gv = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value;
        (ev as any).barCount = parseInt(gv('ge-sp-bars') || '32', 10);
        (ev as any).style = gv('ge-sp-style') || 'bars';
        (ev as any).position = gv('ge-sp-position') || 'bottom';
        (ev as any).color = gv('ge-sp-color') || '#F5C542';
        (ev as any).width = parseFloat(gv('ge-sp-size') || '0.7');
        (ev as any).maxHeight = 0.22;
        (ev as any).glow = !!(document.getElementById('ge-sp-glow') as HTMLInputElement | null)?.checked;
        const barsVal = document.getElementById('ge-sp-bars-val');
        if (barsVal) barsVal.textContent = String((ev as any).barCount);
    } else if (ev.type === 'hyperFrame') {
        (ev as any).templateId = dom.geHfPresetSelect?.value || 'launch-hero';
        (ev as any).html = dom.geHfHtml?.value || HYPERFRAME_PRESETS[0].html.trim();
        (ev as any).animationIn = dom.geHfAnimIn?.value || 'spring-bounce';
        (ev as any).animationOut = dom.geHfAnimOut?.value || 'scale-down';
        (ev as any).position = dom.geHfPosition?.value || 'bottom';
        (ev as any).audioReactive = dom.geHfAudioReactive ? dom.geHfAudioReactive.checked : false;
        (ev as any).musicReactiveGlow = dom.geHfMusicGlow ? dom.geHfMusicGlow.checked : false;
        (ev as any).sfxTrigger = dom.geHfSfxTrigger?.value || 'none';
        (ev as any).beatPulseScale = parseFloat(dom.geHfBeatScale?.value) || 0.08;
        if ((ev as any).position !== 'custom') {
            delete ev.customX;
            delete ev.customY;
        }
    }

    updatePositionInputsFromEvent(ev);

    timelineState.setGraphics(events);
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function updateGraphicEditorOptions() {
    const type = dom.geType.value;
    dom.geLtOptions?.classList.toggle('hidden', type !== 'lowerThird');
    dom.geTcOptions?.classList.toggle('hidden', type !== 'titleCard');
    dom.geIoOptions?.classList.toggle('hidden', type !== 'iconOverlay');
    dom.geBpOptions?.classList.toggle('hidden', type !== 'bulletPanel');
    dom.geEbOptions?.classList.toggle('hidden', type !== 'evidenceBoard');
    dom.geRrOptions?.classList.toggle('hidden', type !== 'revealRoute');
    dom.geScOptions?.classList.toggle('hidden', type !== 'statCounter');
    dom.geSfOptions?.classList.toggle('hidden', type !== 'spotlightFocus');
    dom.geSbOptions?.classList.toggle('hidden', type !== 'socialBadge');
    dom.geVcOptions?.classList.toggle('hidden', type !== 'versusCard');
    dom.geDcOptions?.classList.toggle('hidden', type !== 'donutChart');
    dom.geSpOptions?.classList.toggle('hidden', type !== 'spectrum');
    dom.geHfOptions?.classList.toggle('hidden', type !== 'hyperFrame');
    if (type === 'donutChart') {
        const isBreakdown = dom.geDcMode?.value === 'breakdown';
        dom.geDcSegmentsContainer?.classList.toggle('hidden', !isBreakdown);
        dom.geDcPercentageContainer?.classList.toggle('hidden', isBreakdown);
    }
    updateGraphicFromEditorLive();
}

export function closeGraphicEditor() {
    dom.graphicEditorModal?.classList.add('hidden');
    currentEditingGraphicId = null;
    (window as any)._currentEditingGraphicId = null;
    renderGraphicsList();
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function saveGraphicEvent() {
    timelineState.saveSnapshot();
    const type = dom.geType.value as any;
    const start = parseFloat(dom.geStart.value) || 0;
    const end = parseFloat(dom.geEnd.value) || (start + 5);
    let title = dom.geTitle.value.trim();
    const subtitle = dom.geSubtitle.value.trim();
    const accentWordsStr = dom.geAccentWords?.value.trim() || '';
    const accentWords = accentWordsStr ? accentWordsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : undefined;
    const accentColor = dom.geColor.value;
    const textColor = dom.geTextColor?.value || '#FFFFFF';
    const theme = dom.geTheme.value as any;
    const animationType = dom.geAnimation.value as any;
    
    localStorage.setItem('ge_last_color', accentColor);
    localStorage.setItem('ge_last_text_color', textColor);
    localStorage.setItem('ge_last_theme', theme);
    localStorage.setItem('ge_last_anim', animationType);
    
    const linkClip = dom.geLinkClip?.checked;
    let clipId: string | undefined = undefined;
    let offsetInClip: number | undefined = undefined;
    if (linkClip) {
        const c = timelineState.clips.find(x => x.startTime <= start && x.endTime > start);
        if (c) {
            clipId = c.id;
            offsetInClip = start - c.startTime;
        }
    }
    
    if (!title && (type === 'lowerThird' || type === 'titleCard')) {
        ui.showStatus('Title is required for lower thirds and title cards.', true, 3000);
        return;
    }
    
    if (end <= start) {
        ui.showStatus('End time must be after start time.', true, 3000);
        return;
    }

    if (end - start < 1.0) {
        ui.showStatus('Graphic duration is very short and may be hard to read.', false, 4000);
    }
    
    const events = [...(timelineState.graphics || [])];
    
    if (currentEditingGraphicId) {
        const idx = events.findIndex(g => g.id === currentEditingGraphicId);
        if (idx >= 0) {
            const ev = events[idx];
            ev.type = type;
            ev.start = start;
            ev.end = end;
            ev.title = title;
            ev.subtitle = subtitle || undefined;
            ev.accentWords = accentWords;
            ev.textColor = textColor;
            ev.accentColor = accentColor;
            ev.theme = theme;
            ev.animationType = animationType;
            if (dom.geAnimIn) ev.animationIn = dom.geAnimIn.value as any;
            if (dom.geAnimOut) ev.animationOut = dom.geAnimOut.value as any;
            if (dom.geSfxTrigger) ev.sfxTrigger = dom.geSfxTrigger.value as any;
            ev.clipId = clipId;
            ev.offsetInClip = offsetInClip;
            
            if (type === 'lowerThird') {
                (ev as any).position = dom.gePosition.value;
            } else if (type === 'titleCard') {
                (ev as any).backdrop = dom.geBackdrop.value;
            } else if (type === 'iconOverlay') {
                (ev as any).icon = currentCustomImageUrl ? 'custom' : dom.geIcon.value;
                (ev as any).customImageUrl = currentCustomImageUrl || undefined;
                (ev as any).scale = parseFloat(dom.geScale.value) || 1.0;
                (ev as any).rotation = parseInt(dom.geRotation.value, 10) || 0;
                const pos = dom.geIconPosition?.value || 'center';
                (ev as any).position = pos;
                if (pos !== 'custom') {
                    delete ev.customX;
                    delete ev.customY;
                }
            } else if (type === 'bulletPanel') {
                (ev as any).bullets = (dom.geBpBullets?.value || '')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(Boolean);
                (ev as any).bulletStyle = (dom.geBpStyle?.value as any) || 'check';
                (ev as any).position = (dom.geBpPosition?.value as any) || 'left';
                (ev as any).staggerDelay = parseFloat(dom.geBpStagger?.value) || 0.45;
            } else if (type === 'evidenceBoard') {
                const lines = (dom.geEbItems?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
                (ev as any).items = lines.map((line, i) => {
                    const parts = line.split('|').map(p => p.trim());
                    return {
                        id: `eb_item_${i}`,
                        label: parts[0] || `Clue ${i + 1}`,
                        imageUrl: parts[1] || undefined
                    };
                });
                (ev as any).connectionStyle = (dom.geEbConnection?.value as any) || 'string';
                (ev as any).staggerDelay = parseFloat(dom.geEbStagger?.value) || 0.6;
            } else if (type === 'revealRoute') {
                const lines = (dom.geRrNodes?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
                (ev as any).nodes = lines.map((line, i) => {
                    const parts = line.split('|').map(p => p.trim());
                    return {
                        id: `rr_node_${i}`,
                        label: parts[0] || `Stop ${i + 1}`,
                        subtitle: parts[1] || undefined
                    };
                });
                (ev as any).orientation = (dom.geRrOrientation?.value as any) || 'horizontal';
                (ev as any).lineStyle = (dom.geRrStyle?.value as any) || 'arrow';
                (ev as any).staggerDelay = parseFloat(dom.geRrStagger?.value) || 0.6;
            } else if (type === 'statCounter') {
                (ev as any).targetValue = parseFloat(dom.geScTarget?.value) || 0;
                (ev as any).prefix = dom.geScPrefix?.value || undefined;
                (ev as any).suffix = dom.geScSuffix?.value || undefined;
                (ev as any).trend = (dom.geScTrend?.value as any) || 'none';
                (ev as any).trendLabel = dom.geScTrendLabel?.value || undefined;
                (ev as any).countDuration = parseFloat(dom.geScDuration?.value) || 1.5;
            } else if (type === 'spotlightFocus') {
                (ev as any).shape = (dom.geSfShape?.value as any) || 'circle';
                (ev as any).dimOpacity = parseFloat(dom.geSfOpacity?.value) || 0.75;
                (ev as any).calloutPosition = (dom.geSfCalloutPos?.value as any) || 'auto';
                (ev as any).focusRadiusX = parseFloat(dom.geSfRadX?.value) || 0.15;
                (ev as any).focusRadiusY = parseFloat(dom.geSfRadY?.value) || 0.15;
            } else if (type === 'socialBadge') {
                (ev as any).platform = (dom.geSbPlatform?.value as any) || 'youtube';
                (ev as any).handle = dom.geSbHandle?.value || '@AIStudio';
                (ev as any).showVerified = dom.geSbVerified ? dom.geSbVerified.checked : true;
                (ev as any).showBellChime = dom.geSbBell ? dom.geSbBell.checked : true;
            } else if (type === 'versusCard') {
                (ev as any).leftTitle = dom.geVcLeftTitle?.value || 'OPTION A';
                (ev as any).leftPoints = (dom.geVcLeftPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
                (ev as any).rightTitle = dom.geVcRightTitle?.value || 'OPTION B';
                (ev as any).rightPoints = (dom.geVcRightPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
                (ev as any).vsBadgeText = dom.geVcBadge?.value || 'VS';
            } else if (type === 'donutChart') {
                (ev as any).chartMode = (dom.geDcMode?.value as any) || 'percentage';
                (ev as any).percentage = parseFloat(dom.geDcPercentage?.value) || 0;
                (ev as any).holeSize = parseFloat(dom.geDcHoleSize?.value) || 0.62;
                (ev as any).centerLabel = dom.geDcCenterLabel?.value || undefined;
                (ev as any).centerSublabel = dom.geDcCenterSublabel?.value || undefined;
                const lines = (dom.geDcSegments?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
                (ev as any).segments = lines.map((l: string) => {
                    const parts = l.split('|').map((p: string) => p.trim());
                    return {
                        label: parts[0] || 'Item',
                        value: parseFloat(parts[1]) || 0,
                        color: parts[2] || undefined
                    };
                });
                (ev as any).showLegend = dom.geDcShowLegend ? dom.geDcShowLegend.checked : true;
                (ev as any).animationDuration = parseFloat(dom.geDcDuration?.value) || 1.2;
            } else if (type === 'spectrum') {
                const gv = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null)?.value;
                (ev as any).barCount = parseInt(gv('ge-sp-bars') || '32', 10);
                (ev as any).style = gv('ge-sp-style') || 'bars';
                (ev as any).position = gv('ge-sp-position') || 'bottom';
                (ev as any).color = gv('ge-sp-color') || '#F5C542';
                (ev as any).width = parseFloat(gv('ge-sp-size') || '0.7');
                (ev as any).maxHeight = 0.22;
                (ev as any).glow = !!(document.getElementById('ge-sp-glow') as HTMLInputElement | null)?.checked;
                const barsVal = document.getElementById('ge-sp-bars-val');
                if (barsVal) barsVal.textContent = String((ev as any).barCount);
            } else if (type === 'hyperFrame') {
                (ev as any).templateId = dom.geHfPresetSelect?.value || 'launch-hero';
                (ev as any).html = dom.geHfHtml?.value || HYPERFRAME_PRESETS[0].html.trim();
                (ev as any).animationIn = dom.geHfAnimIn?.value || 'spring-bounce';
                (ev as any).animationOut = dom.geHfAnimOut?.value || 'scale-down';
                (ev as any).position = dom.geHfPosition?.value || 'bottom';
                (ev as any).audioReactive = dom.geHfAudioReactive ? dom.geHfAudioReactive.checked : false;
                (ev as any).musicReactiveGlow = dom.geHfMusicGlow ? dom.geHfMusicGlow.checked : false;
                (ev as any).sfxTrigger = dom.geHfSfxTrigger?.value || 'none';
                (ev as any).beatPulseScale = parseFloat(dom.geHfBeatScale?.value) || 0.08;
                if ((ev as any).position !== 'custom') {
                    delete ev.customX;
                    delete ev.customY;
                }
            }
        }
    } else {
        const newEv: any = {
            id: 'manual_' + Date.now().toString(),
            type,
            start,
            end,
            title: title || (type === 'iconOverlay' ? '' : (type === 'bulletPanel' ? 'Key Takeaways' : (type === 'evidenceBoard' ? 'Evidence Board' : (type === 'revealRoute' ? 'Step Route' : (type === 'statCounter' ? 'Active Metric' : (type === 'spotlightFocus' ? 'Focus Target' : (type === 'socialBadge' ? '' : 'Comparison'))))))),
            subtitle: subtitle || undefined,
            accentWords,
            textColor,
            accentColor,
            theme,
            animationType,
            animationIn: dom.geAnimIn?.value || 'spring-bounce',
            animationOut: dom.geAnimOut?.value || 'scale-down',
            sfxTrigger: dom.geSfxTrigger?.value || 'whoosh',
            clipId,
            offsetInClip
        };
        if (type === 'lowerThird') {
            newEv.position = dom.gePosition.value;
        } else if (type === 'titleCard') {
            newEv.backdrop = dom.geBackdrop.value;
        } else if (type === 'iconOverlay') {
            newEv.icon = currentCustomImageUrl ? 'custom' : dom.geIcon.value;
            newEv.customImageUrl = currentCustomImageUrl || undefined;
            newEv.scale = parseFloat(dom.geScale.value) || 1.0;
            newEv.rotation = parseInt(dom.geRotation.value, 10) || 0;
            newEv.position = dom.geIconPosition?.value || 'center';
        } else if (type === 'bulletPanel') {
            newEv.bullets = (dom.geBpBullets?.value || '')
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean);
            newEv.bulletStyle = (dom.geBpStyle?.value as any) || 'check';
            newEv.position = (dom.geBpPosition?.value as any) || 'left';
            newEv.staggerDelay = parseFloat(dom.geBpStagger?.value) || 0.45;
        } else if (type === 'evidenceBoard') {
            const lines = (dom.geEbItems?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
            newEv.items = lines.map((line, i) => {
                const parts = line.split('|').map(p => p.trim());
                return {
                    id: `eb_item_${i}`,
                    label: parts[0] || `Clue ${i + 1}`,
                    imageUrl: parts[1] || undefined
                };
            });
            newEv.connectionStyle = (dom.geEbConnection?.value as any) || 'string';
            newEv.staggerDelay = parseFloat(dom.geEbStagger?.value) || 0.6;
        } else if (type === 'revealRoute') {
            const lines = (dom.geRrNodes?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
            newEv.nodes = lines.map((line, i) => {
                const parts = line.split('|').map(p => p.trim());
                return {
                    id: `rr_node_${i}`,
                    label: parts[0] || `Stop ${i + 1}`,
                    subtitle: parts[1] || undefined
                };
            });
            newEv.orientation = (dom.geRrOrientation?.value as any) || 'horizontal';
            newEv.lineStyle = (dom.geRrStyle?.value as any) || 'arrow';
            newEv.staggerDelay = parseFloat(dom.geRrStagger?.value) || 0.6;
        } else if (type === 'statCounter') {
            newEv.targetValue = parseFloat(dom.geScTarget?.value) || 0;
            newEv.prefix = dom.geScPrefix?.value || undefined;
            newEv.suffix = dom.geScSuffix?.value || undefined;
            newEv.trend = (dom.geScTrend?.value as any) || 'none';
            newEv.trendLabel = dom.geScTrendLabel?.value || undefined;
            newEv.countDuration = parseFloat(dom.geScDuration?.value) || 1.5;
        } else if (type === 'spotlightFocus') {
            newEv.shape = (dom.geSfShape?.value as any) || 'circle';
            newEv.dimOpacity = parseFloat(dom.geSfOpacity?.value) || 0.75;
            newEv.calloutPosition = (dom.geSfCalloutPos?.value as any) || 'auto';
            newEv.focusRadiusX = parseFloat(dom.geSfRadX?.value) || 0.15;
            newEv.focusRadiusY = parseFloat(dom.geSfRadY?.value) || 0.15;
        } else if (type === 'socialBadge') {
            newEv.platform = (dom.geSbPlatform?.value as any) || 'youtube';
            newEv.handle = dom.geSbHandle?.value || '@AIStudio';
            newEv.showVerified = dom.geSbVerified ? dom.geSbVerified.checked : true;
            newEv.showBellChime = dom.geSbBell ? dom.geSbBell.checked : true;
        } else if (type === 'versusCard') {
            newEv.leftTitle = dom.geVcLeftTitle?.value || 'OPTION A';
            newEv.leftPoints = (dom.geVcLeftPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
            newEv.rightTitle = dom.geVcRightTitle?.value || 'OPTION B';
            newEv.rightPoints = (dom.geVcRightPoints?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
            newEv.vsBadgeText = dom.geVcBadge?.value || 'VS';
        } else if (type === 'donutChart') {
            newEv.chartMode = (dom.geDcMode?.value as any) || 'percentage';
            newEv.percentage = parseFloat(dom.geDcPercentage?.value) || 0;
            newEv.holeSize = parseFloat(dom.geDcHoleSize?.value) || 0.62;
            newEv.centerLabel = dom.geDcCenterLabel?.value || undefined;
            newEv.centerSublabel = dom.geDcCenterSublabel?.value || undefined;
            const lines = (dom.geDcSegments?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
            newEv.segments = lines.map((l: string) => {
                const parts = l.split('|').map((p: string) => p.trim());
                return {
                    label: parts[0] || 'Item',
                    value: parseFloat(parts[1]) || 0,
                    color: parts[2] || undefined
                };
            });
            newEv.showLegend = dom.geDcShowLegend ? dom.geDcShowLegend.checked : true;
            newEv.animationDuration = parseFloat(dom.geDcDuration?.value) || 1.2;
        } else if (type === 'spectrum') {
            Object.assign(newEv, {
                title: 'Spectrum', barCount: 32, style: 'bars', position: 'bottom',
                color: '#F5C542', width: 0.7, maxHeight: 0.22, glow: true,
                animationType: 'fade',
            });
        } else if (type === 'hyperFrame') {
            newEv.templateId = dom.geHfPresetSelect?.value || 'launch-hero';
            newEv.html = dom.geHfHtml?.value || HYPERFRAME_PRESETS[0].html.trim();
            newEv.animationIn = dom.geHfAnimIn?.value || 'spring-bounce';
            newEv.animationOut = dom.geHfAnimOut?.value || 'scale-down';
            newEv.position = dom.geHfPosition?.value || 'bottom';
            newEv.audioReactive = dom.geHfAudioReactive ? dom.geHfAudioReactive.checked : false;
            newEv.musicReactiveGlow = dom.geHfMusicGlow ? dom.geHfMusicGlow.checked : false;
            newEv.sfxTrigger = dom.geHfSfxTrigger?.value || 'none';
            newEv.beatPulseScale = parseFloat(dom.geHfBeatScale?.value) || 0.08;
        }
        events.push(newEv);
    }
    
    timelineState.setGraphics(events);
    closeGraphicEditor();
    renderGraphicsList();
    if (!state.isVideoPlaying) {
        drawVideoFrame(state.lastRenderedTime);
    }
}

export function deleteGraphicEvent(id: string) {
    timelineState.saveSnapshot();
    const events = (timelineState.graphics || []).filter(g => g.id !== id);
    timelineState.setGraphics(events);
    ui.renderTimelineEditor();
    if (currentEditingGraphicId === id) {
        closeGraphicEditor();
    } else {
        renderGraphicsList();
        if (!state.isVideoPlaying) {
            drawVideoFrame(state.lastRenderedTime);
        }
    }
    ui.showStatus('🗑️ Overlay deleted', false, 2000);
}

const MG_FAVORITES_KEY = 'cg_mg_favorite_presets_v1';

export function getFavoritePresets(): Set<string> {
  try {
    const raw = localStorage.getItem(MG_FAVORITES_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function toggleFavoritePreset(presetId: string): boolean {
  const favs = getFavoritePresets();
  const isNowFav = !favs.has(presetId);
  if (isNowFav) favs.add(presetId);
  else favs.delete(presetId);
  try {
    localStorage.setItem(MG_FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {}
  return isNowFav;
}

/**
 * Phase 1 & 2 compatible filter:
 * - Supports multi-category cards (e.g. data-mg-category="callouts,lower-thirds")
 * - Supports the new "favorites" category
 * - Syncs both .active and [aria-current="true"] on #mg-category-tabs buttons
 * - Shows a clear empty state when no cards match
 */
export function applyPresetGalleryFilters() {
  const tabsContainer = document.getElementById('mg-category-tabs');
  const searchInput = document.getElementById('mg-preset-search') as HTMLInputElement | null;
  const grid = document.getElementById('mg-preset-grid');
  if (!grid) return;

  const activeBtn = tabsContainer?.querySelector<HTMLElement>(
    '[aria-current="true"], .active, .on, [data-active="true"]'
  ) || (
    document.querySelector<HTMLElement>('.mg-filter-btn.active, .mg-filter-btn.on, .mg-filter-btn[aria-current="true"]')
  ) || (
    tabsContainer?.querySelector<HTMLElement>('.mg-filter-btn') || null
  );
  const selectedCategory = (activeBtn?.getAttribute('data-mg-category') || activeBtn?.getAttribute('data-mg-filter') || 'all').toLowerCase().trim();
  const query = (searchInput?.value || '').toLowerCase().trim();
  const favs = getFavoritePresets();

  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.graphic-preset-card, .mg-card'));
  let visibleCount = 0;

  for (const card of cards) {
    const presetId = card.getAttribute('data-gallery-preset') || '';
    const rawCats = (card.getAttribute('data-mg-category') || '')
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    const searchableText = (card.textContent || '').toLowerCase();

    const matchesCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'favorites' ? favs.has(presetId) : rawCats.includes(selectedCategory));

    const matchesSearch = !query || searchableText.includes(query) || presetId.toLowerCase().includes(query);
    const show = matchesCategory && matchesSearch;

    card.classList.toggle('hidden', !show);
    card.hidden = !show;
    card.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  }

  // Empty / No-Search-Results State
  let emptyEl = document.getElementById('mg-preset-empty-state');
  if (visibleCount === 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.id = 'mg-preset-empty-state';
      emptyEl.className = 'col-span-full py-8 px-4 text-center text-xs text-zinc-400';
      grid.appendChild(emptyEl);
    }
    emptyEl.textContent =
      selectedCategory === 'favorites' && favs.size === 0
        ? 'No favorite graphics yet. Click the ★ icon on any preset to pin it here.'
        : `No graphics match "${searchInput?.value || selectedCategory}".`;
    emptyEl.classList.remove('hidden');
    emptyEl.style.display = '';
  } else if (emptyEl) {
    emptyEl.classList.add('hidden');
    emptyEl.style.display = 'none';
  }
}

/**
 * Enhances existing .graphic-preset-card / .mg-card elements in #mg-preset-grid with
 * video-studio's ★ favorite toggle and + add-at-playhead badge without breaking
 * delegated click handlers on gallery cards.
 */
export function enhanceGraphicsGalleryCards() {
  const grid = document.getElementById('mg-preset-grid');
  const tabs = document.getElementById('mg-category-tabs');
  if (!grid) return;

  // Ensure "Favorites" category button exists in #mg-category-tabs
  if (tabs && !tabs.querySelector('[data-mg-category="favorites"], [data-mg-filter="favorites"]')) {
    const favTab = document.createElement('button');
    favTab.type = 'button';
    favTab.className = 'mg-filter-btn';
    favTab.setAttribute('data-mg-filter', 'favorites');
    favTab.setAttribute('data-mg-category', 'favorites');
    favTab.innerHTML = `★ Favorites`;
    const allTab = tabs.querySelector('[data-mg-category="all"], [data-mg-filter="all"]');
    if (allTab?.nextSibling) tabs.insertBefore(favTab, allTab.nextSibling);
    else tabs.prepend(favTab);
  }

  // Sync aria-current & on/active class on category click
  if (tabs && !tabs.dataset.vsBound) {
    tabs.dataset.vsBound = '1';
    tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mg-category], [data-mg-filter]');
      if (!btn) return;
      tabs.querySelectorAll<HTMLElement>('[data-mg-category], [data-mg-filter]').forEach((b) => {
        const isCurrent = b === btn;
        b.classList.toggle('active', isCurrent);
        b.classList.toggle('on', isCurrent);
        b.setAttribute('aria-current', isCurrent ? 'true' : 'false');
      });
      applyPresetGalleryFilters();
    });
  }

  const favs = getFavoritePresets();
  grid.querySelectorAll<HTMLElement>('.graphic-preset-card, .mg-card').forEach((card) => {
    const presetId = card.getAttribute('data-gallery-preset');
    if (!presetId) return;

    let favBtn = card.querySelector<HTMLElement>('.mg-fav-btn, .tile-fav');
    if (!favBtn && card.dataset.vsEnhanced !== '1') {
      const buttonEl = document.createElement('button');
      buttonEl.type = 'button';
      buttonEl.className = `tile-fav mg-fav-btn ${favs.has(presetId) ? 'on' : ''}`;
      buttonEl.title = 'Toggle favorite';
      buttonEl.setAttribute('aria-label', 'Favorite preset');
      buttonEl.textContent = '★';
      favBtn = buttonEl;
      card.prepend(favBtn);
    }
    card.dataset.vsEnhanced = '1';

    if (favBtn && !favBtn.dataset.vsBound) {
      favBtn.dataset.vsBound = '1';
      favBtn.classList.toggle('on', favs.has(presetId));
      favBtn.addEventListener('click', (ev) => {
        ev.stopPropagation(); // Do not trigger dropGraphicAtPlayhead() when starring
        const on = toggleFavoritePreset(presetId);
        favBtn!.classList.toggle('on', on);
        applyPresetGalleryFilters();
      });
    }
  });

  initGraphicPresetCanvasPreviews();
}

/**
 * Renders a static resting frame for each graphic preset card and animates
 * ONLY the currently hovered card at 60fps.
 */
export function initGraphicPresetCanvasPreviews(): void {
  const grid = document.getElementById('mg-preset-grid');
  if (!grid) return;

  const themeSelect = document.getElementById('graphics-theme-select') as HTMLSelectElement | null;
  const accentInput = (document.getElementById('graphics-accent-color-input') ||
    document.getElementById('graphics-accent-color')) as HTMLInputElement | null;

  const getTheme = () => themeSelect?.value || 'minimal';
  const getAccent = () => accentInput?.value || '#4f8ff7';

  // Redraw all resting cards when theme or accent color changes
  if (themeSelect && !themeSelect.dataset.vsCanvasListening) {
    themeSelect.dataset.vsCanvasListening = '1';
    themeSelect.addEventListener('change', () => initGraphicPresetCanvasPreviews());
  }
  if (accentInput && !accentInput.dataset.vsCanvasListening) {
    accentInput.dataset.vsCanvasListening = '1';
    accentInput.addEventListener('input', () => initGraphicPresetCanvasPreviews());
  }

  // Draw a preview frame for a given preset ID at normalized progress t in [0..1]
  function renderPresetMiniPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    presetId: string,
    t: number
  ) {
    const accent = getAccent();
    const theme = getTheme();
    ctx.clearRect(0, 0, w, h);

    // Subtle dark stage grid background (matches video-studio player stage)
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, w, h);

    // Ease-out cubic curve for entrance preview
    const ease = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

    ctx.save();
    switch (presetId) {
      case 'lowerThird': {
        const slideX = (1 - ease) * -40;
        ctx.translate(slideX, 0);
        ctx.fillStyle = accent;
        ctx.fillRect(14, h - 28, 3, 18);
        ctx.fillStyle = 'rgba(24, 24, 28, 0.88)';
        ctx.fillRect(19, h - 28, w * 0.62 * ease, 18);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.fillText('DR. ELENA VANCE', 24, h - 19);
        ctx.fillStyle = accent;
        ctx.font = '500 7px Inter, sans-serif';
        ctx.fillText('LEAD RESEARCHER', 24, h - 12);
        break;
      }
      case 'titleCard': {
        ctx.globalAlpha = ease;
        const scale = 0.88 + 0.12 * ease;
        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('CHAPTER 01', 0, -2);
        ctx.fillStyle = accent;
        ctx.fillRect(-22, 4, 44 * ease, 2);
        break;
      }
      case 'statCounter': {
        const val = Math.round(1250 * ease).toLocaleString();
        ctx.fillStyle = accent;
        ctx.font = '700 16px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${val}+`, w / 2, h / 2 + 4);
        ctx.fillStyle = '#a9a9b1';
        ctx.font = '500 7.5px Inter, sans-serif';
        ctx.fillText('ACTIVE NODES', w / 2, h / 2 + 15);
        break;
      }
      case 'donutChart': {
        const cx = w / 2;
        const cy = h / 2;
        const r = 16;
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        // Track
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        // Progress arc
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * 0.72 * ease));
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(72 * ease)}%`, cx, cy);
        break;
      }
      case 'bulletPanel': {
        const lines = ['First key takeaway', 'Realtime GPU engine', 'High-res video export'];
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => {
          const lineEase = Math.min(1, Math.max(0, (ease - i * 0.2) / 0.6));
          if (lineEase <= 0) return;
          const y = 20 + i * 16;
          ctx.globalAlpha = lineEase;
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(18, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#e4e4e7';
          ctx.font = '500 8.5px Inter, sans-serif';
          ctx.fillText(line, 26, y);
        });
        break;
      }
      case 'socialBadge': {
        const scale = 0.85 + 0.15 * ease;
        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        ctx.globalAlpha = ease;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(-38, -12, 76, 24, 12);
        } else {
          ctx.rect(-38, -12, 76, 24);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SUBSCRIBE 🔔', 0, 0);
        break;
      }
      default: {
        renderHyperFrameOrGenericPreview(ctx, w, h, presetId, ease, accent);
        break;
      }
    }
    ctx.restore();
  }

  function renderHyperFrameOrGenericPreview(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    presetId: string,
    ease: number,
    accent: string
  ) {
    const cx = w / 2;
    const cy = h / 2;

    switch (presetId) {
      case 'hyperFrame:flash-sale': {
        const scale = 0.85 + 0.15 * ease;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(-42, -14, 84, 28, 6);
        } else {
          ctx.rect(-42, -14, 84, 28);
        }
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = '900 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ 50% OFF', 0, 0);
        break;
      }
      case 'hyperFrame:trust-reviews': {
        ctx.globalAlpha = ease;
        ctx.fillStyle = '#10b981';
        ctx.font = '700 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★★★★★', cx, cy - 6);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 8.5px Inter, sans-serif';
        ctx.fillText('4.9 / 5.0 Rating', cx, cy + 9);
        break;
      }
      case 'hyperFrame:ecommerce-cta': {
        const scale = 0.88 + 0.12 * ease;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#6366f1';
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(-42, -13, 84, 26, 13);
        } else {
          ctx.rect(-42, -13, 84, 26);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SHOP NOW →', 0, 0);
        break;
      }
      case 'hyperFrame:price-slash': {
        ctx.globalAlpha = ease;
        ctx.font = '700 11px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#71717a';
        ctx.fillText('$99', cx - 22, cy);
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 32, cy + 5);
        ctx.lineTo(cx - 12, cy - 5);
        ctx.stroke();

        ctx.fillStyle = '#22c55e';
        ctx.font = '800 15px "Roboto Mono", monospace';
        ctx.fillText('$49', cx + 18, cy);
        break;
      }
      case 'hyperFrame:reels-hook': {
        const scale = 0.9 + 0.1 * ease;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#eab308';
        ctx.fillRect(-45, -12, 90, 24);
        ctx.fillStyle = '#000000';
        ctx.font = '900 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('WAIT FOR IT 🤯', 0, 0);
        break;
      }
      case 'hyperFrame:pattern-wait':
      case 'hyperFrame:pattern-mistake': {
        ctx.globalAlpha = ease;
        ctx.fillStyle = presetId.includes('mistake') ? '#ef4444' : '#f59e0b';
        ctx.font = '800 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(presetId.includes('mistake') ? '❌ STOP THIS!' : '⚠️ WATCH OUT', cx, cy - 4);
        ctx.fillStyle = '#d4d4d8';
        ctx.font = '500 7.5px Inter, sans-serif';
        ctx.fillText('Critical Mistake', cx, cy + 9);
        break;
      }
      case 'hyperFrame:soundwave-ribbon':
      case 'hyperFrame:podcast-speaker': {
        const barCount = 12;
        const barW = 3.5;
        const gap = 3;
        const totalW = barCount * (barW + gap) - gap;
        const startX = cx - totalW / 2;
        ctx.fillStyle = accent;
        for (let i = 0; i < barCount; i++) {
          const wave = Math.sin((i / barCount) * Math.PI * 2 + ease * Math.PI * 2);
          const barH = 6 + Math.abs(wave) * 22 * ease;
          ctx.fillRect(startX + i * (barW + gap), cy - barH / 2, barW, barH);
        }
        break;
      }
      case 'hyperFrame:stat-metric': {
        ctx.globalAlpha = ease;
        ctx.fillStyle = '#10b981';
        ctx.font = '800 15px "Roboto Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${Math.round(284 * ease)}%`, cx, cy - 3);
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '500 7.5px Inter, sans-serif';
        ctx.fillText('ANNUAL GROWTH', cx, cy + 11);
        break;
      }
      case 'hyperFrame:breaking-news': {
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(0, cy - 11, w, 22);
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 8.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔴 BREAKING NEWS', cx, cy);
        break;
      }
      case 'hyperFrame:neon-cyber': {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(16, 12, w - 32, h - 24);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`TARGET LOCKED [${Math.round(100 * ease)}%]`, cx, cy);
        break;
      }
      default: {
        ctx.globalAlpha = ease;
        const scale = 0.85 + 0.15 * ease;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.fillStyle = accent;
        ctx.fillRect(-24, -2, 48 * ease, 3);
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = presetId.replace('hyperFrame:', '').replace(/-/g, ' ').toUpperCase();
        ctx.fillText(label.slice(0, 16), 0, -8);
        break;
      }
    }
  }

  grid.querySelectorAll<HTMLElement>('.graphic-preset-card, .mg-card').forEach((card) => {
    const presetId = card.getAttribute('data-gallery-preset');
    if (!presetId) return;

    let canvas = card.querySelector<HTMLCanvasElement>('canvas.tile-canvas');
    let previewBox = card.querySelector<HTMLElement>('.tile-preview');

    if (!canvas) {
      if (!previewBox) {
        previewBox = document.createElement('div');
        previewBox.className = 'tile-preview mb-2 w-full aspect-video rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 relative';
        const favBtn = card.querySelector('.tile-fav, .mg-fav-btn');
        if (favBtn && favBtn.nextSibling) {
          card.insertBefore(previewBox, favBtn.nextSibling);
        } else {
          card.prepend(previewBox);
        }
      }
      canvas = document.createElement('canvas');
      canvas.className = 'tile-canvas w-full h-full block';
      canvas.width = 160;
      canvas.height = 90;
      previewBox.appendChild(canvas);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw idle frame at progress = 0.65
    renderPresetMiniPreview(ctx, canvas.width, canvas.height, presetId, 0.65);

    if (!card.dataset.vsCanvasBound) {
      card.dataset.vsCanvasBound = '1';
      let animFrameId: number | null = null;
      let startTime = 0;
      const DURATION = 850; // ms for entrance cycle

      const startAnimation = () => {
        startTime = performance.now();
        if (animFrameId) cancelAnimationFrame(animFrameId);
        const tick = (now: number) => {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / DURATION);
          renderPresetMiniPreview(ctx!, canvas!.width, canvas!.height, presetId, progress);
          if (progress < 1) {
            animFrameId = requestAnimationFrame(tick);
          } else {
            animFrameId = null;
          }
        };
        animFrameId = requestAnimationFrame(tick);
      };

      const resetToIdle = () => {
        if (animFrameId) {
          cancelAnimationFrame(animFrameId);
          animFrameId = null;
        }
        renderPresetMiniPreview(ctx!, canvas!.width, canvas!.height, presetId, 0.65);
      };

      card.addEventListener('mouseenter', startAnimation);
      card.addEventListener('mouseleave', resetToIdle);
      card.addEventListener('focus', startAnimation);
      card.addEventListener('blur', resetToIdle);
    }
  });
}

// ----- Canvas Interaction -----
let draggingGraphicId: string | null = null;
let isDraggingGraphic = false;
let startDragX = 0;
let startDragY = 0;

export function setupCanvasInteraction() {
    if (dom.timelineAddOverlayBtn) {
        dom.timelineAddOverlayBtn.addEventListener('click', () => {
            const curTime = state.lastRenderedTime || state.videoPauseTime || 0;
            openGraphicEditor(undefined, curTime);
        });
    }
    
    if (dom.timelineAddTextBtn) {
        dom.timelineAddTextBtn.addEventListener('click', async () => {
            const curTime = state.lastRenderedTime || state.videoPauseTime || 0;
            const utils = await import('./utils');
            const newGraphic = {
                id: `graphic_${utils.generateShortId()}`,
                type: 'titleCard',
                theme: 'minimal',
                animationType: 'fade',
                start: curTime,
                end: curTime + 2.5,
                title: 'New Text',
                subtitle: '',
                position: 'center',
                color: '#FFFFFF',
                accentColor: '#FFFFFF'
            };
            timelineState.setGraphics([...(timelineState.graphics || []), newGraphic as any]);
            openGraphicEditor(newGraphic.id, curTime);
        });
    }

    if (dom.timelineAutodirectOverlaysBtn) {
        dom.timelineAutodirectOverlaysBtn.addEventListener('click', (e) => {
            e.preventDefault();
            autoGenerateGraphics(false, true);
        });
    }

    if (dom.autodirectGraphicsBtn) {
        dom.autodirectGraphicsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            autoGenerateGraphics(false, true);
        });
    }

    // Delegated click handler to ensure dynamically rendered buttons always trigger
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // AI Director Menu Toggle
        const aiDirectorToggle = target.closest('#timeline-ai-director-menu-btn');
        if (aiDirectorToggle) {
            e.preventDefault();
            e.stopPropagation();
            const dd = document.getElementById('timeline-ai-director-dropdown');
            const arrow = document.getElementById('timeline-ai-director-arrow');
            if (dd) {
                const isHidden = dd.classList.toggle('hidden');
                if (!isHidden) {
                    const rect = aiDirectorToggle.getBoundingClientRect();
                    dd.style.position = 'fixed';
                    dd.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 8)}px`;
                    dd.style.left = `${Math.max(10, Math.min(window.innerWidth - 330, rect.left))}px`;
                }
                if (arrow) {
                    arrow.classList.toggle('rotate-180', !isHidden);
                }
            }
            return;
        }

        // Close button inside AI Director dropdown
        const closeAiDirectorBtn = target.closest('#close-ai-director-dropdown-btn');
        if (closeAiDirectorBtn) {
            e.preventDefault();
            document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
            document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            return;
        }

        // Close AI Director Dropdown on outside click
        const aiDirectorDropdown = document.getElementById('timeline-ai-director-dropdown');
        if (aiDirectorDropdown && !aiDirectorDropdown.classList.contains('hidden')) {
            if (!target.closest('#timeline-ai-director-dropdown') && !target.closest('#timeline-ai-director-menu-btn')) {
                aiDirectorDropdown.classList.add('hidden');
                document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            }
        }

        const intensityBtn = target.closest('[data-overlay-intensity]') as HTMLElement | null;
        if (intensityBtn) {
            e.preventDefault();
            const val = intensityBtn.dataset.overlayIntensity as 'minimal' | 'medium' | 'aggressive';
            import('./handlers-settings').then((m) => m.handleOverlayIntensityChange(val));
            return;
        }
        const sfxBtn = target.closest('[data-overlay-sfx]') as HTMLElement | null;
        if (sfxBtn) {
            e.preventDefault();
            const val = sfxBtn.dataset.overlaySfx as 'none' | 'subtle' | 'high-energy';
            import('./handlers-settings').then((m) => m.handleAutoOverlaySfxChange(val));
            return;
        }
        const btn = target.closest('#timeline-autodirect-overlays-btn, #autodirect-graphics-btn, [data-action="autodirect-overlays"]');
        if (btn) {
            e.preventDefault();
            document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
            document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            autoGenerateGraphics(false, true);
            return;
        }

        const polishBtn = target.closest('#timeline-magic-polish-btn, #director-review-btn');
        if (polishBtn) {
            e.preventDefault();
            document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
            document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            import('./videoDirector').then(m => m.handleDirectorReviewLoop());
            return;
        }

        const reanalyzeBtn = target.closest('#reanalyze-director-review-btn');
        if (reanalyzeBtn) {
            e.preventDefault();
            import('./videoDirector').then(m => m.handleDirectorReviewLoop(false));
            return;
        }

        const closeReviewBtn = target.closest('#close-director-review-modal-btn, #close-director-review-btn');
        if (closeReviewBtn) {
            e.preventDefault();
            import('./videoDirector').then(m => m.closeDirectorReviewModal());
            return;
        }

        const applyAllSuggestionsBtn = target.closest('#apply-all-director-suggestions-btn');
        if (applyAllSuggestionsBtn) {
            e.preventDefault();
            import('./videoDirector').then(m => m.applyAllDirectorSuggestions());
            return;
        }

        const pipBtn = target.closest('#quick-auto-pip-btn, #auto-pip-cues-btn, #vd-auto-pip-cues-btn');
        if (pipBtn) {
            e.preventDefault();
            document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
            document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            import('./videoDirector').then(m => m.autoDetectPipOverlayCues());
            return;
        }

        const visualSyncBtn = target.closest('#manual-visual-sync-btn, #vd-visual-sync-cues-btn');
        if (visualSyncBtn) {
            e.preventDefault();
            import('./timelineBuilder').then(m => m.handleManualVisualSync());
            return;
        }

        const markerCueBtn = target.closest('#vd-add-marker-cue-btn');
        if (markerCueBtn) {
            e.preventDefault();
            dropGraphicAtPlayhead('lowerThird');
            ui.showStatus('📍 Dropped Timeline Marker Cue at Playhead', false, 2000);
            return;
        }

        const clearSfxBtn = target.closest('#vd-clear-sfx-cues-btn');
        if (clearSfxBtn) {
            e.preventDefault();
            timelineState.saveSnapshot();
            const filtered = (timelineState.graphics || []).filter(g => !g.sfxTrigger || g.sfxTrigger === 'none');
            timelineState.setGraphics(filtered);
            renderGraphicsList();
            ui.showStatus('🧹 Cleared all SFX sound cues from timeline', false, 2000);
            return;
        }

        const clearPipBtn = target.closest('#clear-all-pip-btn, #inspector-clear-all-pip-btn, #sidebar-clear-pip-btn');
        if (clearPipBtn) {
            e.preventDefault();
            document.getElementById('timeline-ai-director-dropdown')?.classList.add('hidden');
            document.getElementById('timeline-ai-director-arrow')?.classList.remove('rotate-180');
            import('./videoDirector').then(m => m.clearAllPipOverlays());
            return;
        }
    });

    if (dom.addGraphicBtn) {
        dom.addGraphicBtn.addEventListener('click', () => {
            const curTime = state.lastRenderedTime || state.videoPauseTime || 0;
            openGraphicEditor(undefined, curTime);
        });
    }

    if (dom.geSaveBtn) dom.geSaveBtn.addEventListener('click', saveGraphicEvent);
    if (dom.geCancelBtn) dom.geCancelBtn.addEventListener('click', closeGraphicEditor);
    if (dom.geHeaderCloseBtn) dom.geHeaderCloseBtn.addEventListener('click', closeGraphicEditor);
    if (dom.geDeleteCurrBtn) {
        dom.geDeleteCurrBtn.addEventListener('click', () => {
            if (currentEditingGraphicId) {
                deleteGraphicEvent(currentEditingGraphicId);
            }
        });
    }

    if (dom.geSnapPlayheadBtn) {
        dom.geSnapPlayheadBtn.addEventListener('click', () => {
            const curTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
                ? Math.round(state.lastRenderedTime * 10) / 10
                : Math.round((state.videoPauseTime || 0) * 10) / 10;
            const curStart = parseFloat(dom.geStart.value) || 0;
            const curEnd = parseFloat(dom.geEnd.value) || (curStart + 4);
            const curDuration = Math.max(1, curEnd - curStart);
            dom.geStart.value = curTime.toFixed(1);
            dom.geEnd.value = (curTime + curDuration).toFixed(1);
            updateGraphicFromEditorLive();
            ui.showStatus(`🎯 Snapped graphic start to ${curTime.toFixed(1)}s`, false, 2000);
        });
    }

    if (dom.customSfxDropInput) {
        dom.customSfxDropInput.addEventListener('change', handleCustomSfxDropSelect);
    }

    import('./sfx-trimmer').then(m => m.initSfxTrimmerListeners());

    // Delegated click handler for Preset Gallery Cards and SFX Preview/Drop in Panel
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // Upload Custom SFX Drop Button
        const uploadCustomSfxBtn = target.closest('#upload-custom-sfx-drop-btn') as HTMLElement | null;
        if (uploadCustomSfxBtn) {
            e.preventDefault();
            e.stopPropagation();
            if (dom.customSfxDropInput) {
                dom.customSfxDropInput.click();
            }
            return;
        }

        // Preview Custom SFX Button
        const previewCustomBtn = target.closest('.preview-custom-sfx-btn') as HTMLElement | null;
        if (previewCustomBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = previewCustomBtn.getAttribute('data-id');
            const item = customSfxList.find(x => x.id === id);
            if (item) {
                try {
                    if (item.buffer) {
                        const ctx = utils.getAudioContext();
                        if (ctx.state === 'suspended') ctx.resume();
                        const src = ctx.createBufferSource();
                        src.buffer = item.buffer;
                        src.connect(ctx.destination);
                        src.start();
                    } else if (item.objectUrl) {
                        const audio = new Audio(item.objectUrl);
                        audio.volume = 0.85;
                        audio.play().catch(() => {});
                    }
                } catch {}
            }
            return;
        }

        // Trim Custom SFX Button
        const trimCustomBtn = target.closest('.trim-custom-sfx-btn') as HTMLElement | null;
        if (trimCustomBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = trimCustomBtn.getAttribute('data-id');
            const item = customSfxList.find(x => x.id === id);
            if (item) {
                import('./sfx-trimmer').then(m => m.openSfxTrimmerForCustomDrop(item));
            }
            return;
        }

        // Drop Custom SFX Button
        const dropCustomBtn = target.closest('.drop-custom-sfx-btn') as HTMLElement | null;
        if (dropCustomBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = dropCustomBtn.getAttribute('data-id');
            const item = customSfxList.find(x => x.id === id);
            if (item) {
                dropCustomSfxCueAtPlayhead(item);
                document.getElementById('timeline-sfx-dropdown')?.classList.add('hidden');
            }
            return;
        }

        // SFX Preview Button
        const previewBtn = target.closest('.mg-preview-sfx-btn') as HTMLElement | null;
        if (previewBtn) {
            e.preventDefault();
            e.stopPropagation();
            const sfxType = (previewBtn.getAttribute('data-sfx') || 'whoosh') as ProceduralSfxType;
            AudioSynthesizer.getInstance().playSfx(sfxType, 0.6);
            ui.showStatus(`🔊 Playing ${sfxType} preview`, false, 1500);
            return;
        }

        // Quick SFX Drop Button (from Audio Bar, Background Music panel, or Timeline SFX menu)
        const quickSfxBtn = target.closest('.quick-sfx-drop-btn') as HTMLElement | null;
        if (quickSfxBtn) {
            e.preventDefault();
            const sfxType = (quickSfxBtn.getAttribute('data-sfx') || 'whoosh') as ProceduralSfxType;
            AudioSynthesizer.getInstance().playSfx(sfxType, 0.6);
            dropSfxCueAtPlayhead(sfxType);
            document.getElementById('timeline-sfx-dropdown')?.classList.add('hidden');
            return;
        }

        // Timeline Add SFX Toolbar Button
        const addSfxMenuBtn = target.closest('#timeline-add-sfx-btn') as HTMLElement | null;
        if (addSfxMenuBtn) {
            e.preventDefault();
            e.stopPropagation();
            const dropdown = document.getElementById('timeline-sfx-dropdown');
            if (dropdown) {
                const isHidden = dropdown.classList.toggle('hidden');
                if (!isHidden) {
                    const rect = addSfxMenuBtn.getBoundingClientRect();
                    dropdown.style.position = 'fixed';
                    dropdown.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 8)}px`;
                    dropdown.style.left = `${Math.max(10, Math.min(window.innerWidth - 240, rect.left))}px`;
                }
            }
            return;
        }

        // Close timeline SFX dropdown when clicking outside
        if (!target.closest('#timeline-add-sfx-menu-container')) {
            document.getElementById('timeline-sfx-dropdown')?.classList.add('hidden');
        }

        // Standalone SFX Card in Preset Grid
        const sfxCard = target.closest('.graphic-preset-card[data-sfx-type]') as HTMLElement | null;
        if (sfxCard) {
            e.preventDefault();
            const sfxType = (sfxCard.getAttribute('data-sfx-type') || 'whoosh') as ProceduralSfxType;
            AudioSynthesizer.getInstance().playSfx(sfxType, 0.6);
            if (currentEditingGraphicId && dom.geSfxTrigger) {
                dom.geSfxTrigger.value = sfxType;
                updateGraphicFromEditorLive();
                ui.showStatus(`🔊 Attached ${sfxType} sound effect to current overlay`, false, 2000);
            } else {
                dropSfxCueAtPlayhead(sfxType);
            }
            return;
        }

        const presetCard = target.closest('.graphic-preset-card') as HTMLElement | null;
        if (presetCard) {
            e.preventDefault();
            const presetType = presetCard.getAttribute('data-gallery-preset') || 'lowerThird';
            dropGraphicAtPlayhead(presetType);
            return;
        }

        const presetChip = target.closest('.ge-preset-chip') as HTMLElement | null;
        if (presetChip) {
            e.preventDefault();
            const presetType = presetChip.getAttribute('data-preset-chip');
            if (presetType && dom.geType) {
                dom.geType.value = presetType;
                updateGraphicEditorOptions();
                syncPresetChips(presetType);
                updateGraphicFromEditorLive();
            }
            return;
        }
    });

    // Test Sound FX Button in Graphic Inspector
    if (dom.geTestSfxBtn) {
        dom.geTestSfxBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const sfx = (dom.geSfxTrigger?.value || 'whoosh') as ProceduralSfxType;
            if (sfx && sfx !== 'none') {
                AudioSynthesizer.getInstance().playSfx(sfx, 0.65);
                ui.showStatus(`🔊 Playing ${sfx} sound effect`, false, 1500);
            } else {
                ui.showStatus('Select a sound effect to test', false, 1500);
            }
        });
    }

    // Timeline button preset menu
    if (dom.videoAddGraphicBtn && dom.videoGraphicPresetsMenu) {
        dom.videoAddGraphicBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dom.videoGraphicPresetsMenu.classList.toggle('hidden');
        });

        dom.videoGraphicPresetsMenu.querySelectorAll('[data-preset-type]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const preset = btn.getAttribute('data-preset-type') || 'lowerThird';
                dom.videoGraphicPresetsMenu.classList.add('hidden');
                dropGraphicAtPlayhead(preset);
            });
        });

        document.addEventListener('click', (e) => {
            if (dom.videoGraphicPresetsMenu && !dom.videoGraphicPresetsMenu.contains(e.target as Node) && !dom.videoAddGraphicBtn.contains(e.target as Node)) {
                dom.videoGraphicPresetsMenu.classList.add('hidden');
            }
        });
    }

    if (dom.geType) {
        dom.geType.addEventListener('change', () => {
            updateGraphicEditorOptions();
            syncPresetChips(dom.geType.value);
        });
    }
    if (dom.geTheme) dom.geTheme.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geAnimation) dom.geAnimation.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geAnimIn) dom.geAnimIn.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geAnimOut) dom.geAnimOut.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geSfxTrigger) {
        dom.geSfxTrigger.addEventListener('change', () => {
            const sfx = dom.geSfxTrigger.value as any;
            if (sfx && sfx !== 'none') {
                AudioSynthesizer.getInstance().playSfx(sfx, 0.6);
            }
            updateGraphicFromEditorLive();
        });
    }
    if (dom.geColor) dom.geColor.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geTitle) dom.geTitle.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geSubtitle) dom.geSubtitle.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.gePosition) dom.gePosition.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geBackdrop) dom.geBackdrop.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geIcon) dom.geIcon.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geIconPosition) dom.geIconPosition.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geScale) dom.geScale.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geRotation) dom.geRotation.addEventListener('change', updateGraphicFromEditorLive);

    if (dom.geBpBullets) dom.geBpBullets.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geBpStyle) dom.geBpStyle.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geBpPosition) dom.geBpPosition.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geBpStagger) dom.geBpStagger.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geEbItems) dom.geEbItems.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geEbConnection) dom.geEbConnection.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geEbStagger) dom.geEbStagger.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geRrNodes) dom.geRrNodes.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geRrOrientation) dom.geRrOrientation.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geRrStyle) dom.geRrStyle.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geRrStagger) dom.geRrStagger.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geScTarget) dom.geScTarget.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geScPrefix) dom.geScPrefix.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geScSuffix) dom.geScSuffix.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geScTrend) dom.geScTrend.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geScTrendLabel) dom.geScTrendLabel.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geScDuration) dom.geScDuration.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geSfShape) dom.geSfShape.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geSfOpacity) dom.geSfOpacity.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geSfCalloutPos) dom.geSfCalloutPos.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geSfRadX) dom.geSfRadX.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geSfRadY) dom.geSfRadY.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geSbPlatform) dom.geSbPlatform.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geSbHandle) dom.geSbHandle.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geSbVerified) dom.geSbVerified.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geSbBell) dom.geSbBell.addEventListener('change', updateGraphicFromEditorLive);

    if (dom.geVcLeftTitle) dom.geVcLeftTitle.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geVcLeftPoints) dom.geVcLeftPoints.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geVcRightTitle) dom.geVcRightTitle.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geVcRightPoints) dom.geVcRightPoints.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geVcBadge) dom.geVcBadge.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.geDcMode) dom.geDcMode.addEventListener('change', () => {
        const isBreakdown = dom.geDcMode?.value === 'breakdown';
        dom.geDcSegmentsContainer?.classList.toggle('hidden', !isBreakdown);
        dom.geDcPercentageContainer?.classList.toggle('hidden', isBreakdown);
        updateGraphicFromEditorLive();
    });
    if (dom.geDcPercentage) dom.geDcPercentage.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geDcHoleSize) dom.geDcHoleSize.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geDcCenterLabel) dom.geDcCenterLabel.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geDcCenterSublabel) dom.geDcCenterSublabel.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geDcSegments) dom.geDcSegments.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geDcShowLegend) dom.geDcShowLegend.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geDcDuration) dom.geDcDuration.addEventListener('input', updateGraphicFromEditorLive);

    if (dom.gePosX) dom.gePosX.addEventListener('input', handlePositionSliderChange);
    if (dom.gePosY) dom.gePosY.addEventListener('input', handlePositionSliderChange);
    if (dom.geNudgeLeft) dom.geNudgeLeft.addEventListener('click', () => handleNudgePosition(-2, 0));
    if (dom.geNudgeRight) dom.geNudgeRight.addEventListener('click', () => handleNudgePosition(2, 0));
    if (dom.geNudgeUp) dom.geNudgeUp.addEventListener('click', () => handleNudgePosition(0, -2));
    if (dom.geNudgeDown) dom.geNudgeDown.addEventListener('click', () => handleNudgePosition(0, 2));
    if (dom.geNudgeCenter) dom.geNudgeCenter.addEventListener('click', () => handleNudgePosition('center', 'center'));

    if (dom.geUploadImageBtn && dom.geCustomImageFile) {
        dom.geUploadImageBtn.addEventListener('click', () => dom.geCustomImageFile.click());
        dom.geCustomImageFile.addEventListener('change', handleGraphicCustomImageUpload);
    }
    if (dom.geClearImageBtn) {
        dom.geClearImageBtn.addEventListener('click', clearCustomImage);
    }

    // HyperFrames Event Listeners
    if (dom.geHfPresetSelect) {
        dom.geHfPresetSelect.addEventListener('change', () => {
            const selected = dom.geHfPresetSelect.value;
            const preset = HYPERFRAME_PRESETS.find(p => p.id === selected);
            if (preset) {
                if (dom.geHfHtml) dom.geHfHtml.value = preset.html.trim();
                if (dom.geHfAnimIn) dom.geHfAnimIn.value = preset.animationIn;
                if (dom.geHfAnimOut) dom.geHfAnimOut.value = preset.animationOut;
                if (dom.geHfPosition) dom.geHfPosition.value = preset.position;
                if (dom.geColor) dom.geColor.value = preset.accentColor;
                if (dom.geTitle) dom.geTitle.value = preset.name;
                if (dom.geHfAudioReactive) dom.geHfAudioReactive.checked = preset.audioReactive ?? false;
                if (dom.geHfMusicGlow) dom.geHfMusicGlow.checked = preset.musicReactiveGlow ?? false;
                if (dom.geHfSfxTrigger) dom.geHfSfxTrigger.value = preset.sfxTrigger ?? 'none';
                if (dom.geHfBeatScale) dom.geHfBeatScale.value = String(preset.beatPulseScale ?? 0.08);
                updateGraphicFromEditorLive();
            }
        });
    }
    if (dom.geHfResetCodeBtn) {
        dom.geHfResetCodeBtn.addEventListener('click', () => {
            const selected = dom.geHfPresetSelect?.value || 'launch-hero';
            const preset = HYPERFRAME_PRESETS.find(p => p.id === selected) || HYPERFRAME_PRESETS[0];
            if (dom.geHfHtml) dom.geHfHtml.value = preset.html.trim();
            updateGraphicFromEditorLive();
        });
    }
    if (dom.geHfHtml) dom.geHfHtml.addEventListener('input', updateGraphicFromEditorLive);
    if (dom.geHfAnimIn) dom.geHfAnimIn.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfAnimOut) dom.geHfAnimOut.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfPosition) dom.geHfPosition.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfAudioReactive) dom.geHfAudioReactive.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfMusicGlow) dom.geHfMusicGlow.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfSfxTrigger) {
        dom.geHfSfxTrigger.addEventListener('change', () => {
            const sfx = dom.geHfSfxTrigger.value as any;
            if (sfx && sfx !== 'none') {
                HyperFramesEngine.playProceduralSfx(sfx, 0.5);
            }
            updateGraphicFromEditorLive();
        });
    }
    if (dom.geHfBeatScale) dom.geHfBeatScale.addEventListener('change', updateGraphicFromEditorLive);
    if (dom.geHfAiGenerateBtn) {
        dom.geHfAiGenerateBtn.addEventListener('click', async () => {
            const prompt = dom.geHfAiPrompt?.value.trim();
            if (!prompt) {
                ui.showStatus('Please enter a description for the HyperFrame.', true, 2500);
                return;
            }

            const origText = dom.geHfAiGenerateBtn.innerHTML;
            dom.geHfAiGenerateBtn.disabled = true;
            dom.geHfAiGenerateBtn.textContent = '✨ Generating...';

            try {
                let generatedHtml = '';
                try {
                    const { createGoogleGenAIClient } = await import('./api/core');
                    const { PRIMARY_MODEL } = await import('./constants');
                    const ai = createGoogleGenAIClient();
                    const res = await ai.models.generateContent({
                        model: PRIMARY_MODEL,
                        contents: `You are an elite motion graphics engineer. Generate ONLY a clean, single self-contained HTML snippet with Tailwind CSS classes for a modern video overlay card or badge.
Requirements:
1. Wrap everything in a single root <div> with Tailwind classes for padding, dark background with blur (e.g. bg-slate-950/85 backdrop-blur-xl border border-sky-500/30 rounded-2xl shadow-2xl), and text styling.
2. Max-width around max-w-md or max-w-sm.
3. Use high-contrast typography, gradients, badges, and modern icons/emojis.
4. Output RAW HTML ONLY without markdown code fences or explanation.

User Request: "${prompt}"`
                    });
                    const text = (res.text || '').trim();
                    const { stripCodeFence } = await import('./api/core');
                    generatedHtml = stripCodeFence(text);
                } catch (apiErr) {
                    console.warn('[HyperFrames AI] Fallback to smart local template:', apiErr);
                    const lower = prompt.toLowerCase();
                    if (lower.includes('cyber') || lower.includes('hack') || lower.includes('alert') || lower.includes('warn')) {
                        generatedHtml = `<div class="px-5 py-3 rounded-xl bg-black/90 border border-rose-500/60 shadow-[0_0_30px_rgba(244,63,94,0.4)] flex items-center gap-3 text-left max-w-md">
  <span class="text-rose-500 text-2xl animate-pulse">⚠️</span>
  <div>
    <span class="text-[10px] font-mono tracking-widest text-rose-400 uppercase font-bold">SYSTEM ALERT</span>
    <h3 class="text-base font-black text-white uppercase tracking-wider">${prompt.slice(0, 35)}</h3>
  </div>
</div>`;
                    } else if (lower.includes('minimal') || lower.includes('apple') || lower.includes('spec')) {
                        generatedHtml = `<div class="px-5 py-3.5 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-white/20 shadow-2xl flex items-center gap-3 max-w-sm text-left">
  <div class="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-white text-base">✦</div>
  <div>
    <span class="text-[10px] uppercase font-mono text-zinc-400 tracking-wider">FEATURE SPEC</span>
    <h4 class="text-sm font-bold text-white">${prompt.slice(0, 35)}</h4>
  </div>
</div>`;
                    } else {
                        generatedHtml = `<div class="px-5 py-4 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-sky-400/30 shadow-[0_0_30px_rgba(56,189,248,0.25)] flex flex-col gap-1.5 max-w-md text-left">
  <div class="flex items-center gap-2">
    <span class="h-2 w-2 rounded-full bg-sky-400 animate-ping"></span>
    <span class="text-[10px] font-mono font-bold tracking-widest text-sky-400 uppercase">AI SPOTLIGHT</span>
  </div>
  <h3 class="text-lg font-black text-white tracking-tight">${prompt.slice(0, 40)}</h3>
  <p class="text-xs text-slate-300">Generated dynamic motion card with live 60fps seekable sync.</p>
</div>`;
                    }
                }

                if (dom.geHfHtml && generatedHtml) {
                    dom.geHfHtml.value = generatedHtml;
                    dom.geTitle.value = prompt.slice(0, 24);
                    if (dom.geHfPresetSelect) dom.geHfPresetSelect.value = 'custom';
                    updateGraphicFromEditorLive();
                    ui.showStatus('✨ HyperFrame generated successfully!', false, 2500);
                }
            } finally {
                if (dom.geHfAiGenerateBtn) {
                    dom.geHfAiGenerateBtn.disabled = false;
                    dom.geHfAiGenerateBtn.innerHTML = origText;
                }
            }
        });
    }

    // --- Motion Graphics Panel: Category Filter Tabs, Search & AI Prompt ---
    document.querySelectorAll('.mg-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.getAttribute('data-mg-filter') || 'all';
            document.querySelectorAll('.mg-filter-btn').forEach(b => {
                b.classList.remove('bg-gradient-to-r', 'from-sky-600', 'to-indigo-600', 'bg-sky-600', 'bg-teal-600', 'text-white', 'shadow-md', 'shadow-sm', 'font-bold', 'active');
                b.classList.add('text-gray-400', 'hover:text-white', 'hover:bg-gray-800', 'font-medium');
                b.setAttribute('aria-current', 'false');
            });
            btn.classList.remove('text-gray-400', 'hover:text-white', 'hover:bg-gray-800', 'font-medium');
            btn.classList.add('bg-gradient-to-r', 'from-sky-600', 'to-indigo-600', 'text-white', 'shadow-md', 'font-bold', 'active');
            btn.setAttribute('aria-current', 'true');
            btn.setAttribute('data-mg-category', filter);

            applyPresetGalleryFilters();
        });
    });

    const presetSearchInput = document.getElementById('mg-preset-search') as HTMLInputElement | null;
    if (presetSearchInput) {
        presetSearchInput.addEventListener('input', () => {
            applyPresetGalleryFilters();
        });
    }

    enhanceGraphicsGalleryCards();
    initGraphicPresetCanvasPreviews();
    applyPresetGalleryFilters();

    const mgAiPromptInput = document.getElementById('mg-ai-prompt-input') as HTMLInputElement | null;
    const mgAiPromptBtn = document.getElementById('mg-ai-prompt-btn') as HTMLButtonElement | null;
    if (mgAiPromptBtn && mgAiPromptInput) {
        mgAiPromptBtn.addEventListener('click', async () => {
            const prompt = mgAiPromptInput.value.trim();
            if (!prompt) {
                ui.showStatus('Please describe the animated graphic to generate.', true, 2500);
                return;
            }

            const origContent = mgAiPromptBtn.innerHTML;
            mgAiPromptBtn.disabled = true;
            mgAiPromptBtn.innerHTML = '<span>⏳</span> Generating...';

            try {
                let generatedHtml = '';
                try {
                    const { createGoogleGenAIClient } = await import('./api/core');
                    const { PRIMARY_MODEL } = await import('./constants');
                    const ai = createGoogleGenAIClient();
                    const res = await ai.models.generateContent({
                        model: PRIMARY_MODEL,
                        contents: `You are an elite motion graphics engineer. Generate ONLY a clean, single self-contained HTML snippet with Tailwind CSS classes for a modern video overlay card or badge.
Requirements:
1. Wrap everything in a single root <div> with Tailwind classes for padding, dark background with blur (e.g. bg-slate-950/85 backdrop-blur-xl border border-sky-500/30 rounded-2xl shadow-2xl), and text styling.
2. Max-width around max-w-md or max-w-sm.
3. Use high-contrast typography, gradients, badges, and modern icons/emojis.
4. Output RAW HTML ONLY without markdown code fences or explanation.

User Request: "${prompt}"`
                    });
                    const text = (res.text || '').trim();
                    const { stripCodeFence } = await import('./api/core');
                    generatedHtml = stripCodeFence(text);
                } catch (apiErr) {
                    console.warn('[HyperFrames AI] Fallback:', apiErr);
                    generatedHtml = `<div class="px-5 py-4 rounded-2xl bg-slate-950/90 backdrop-blur-xl border border-teal-400/40 shadow-[0_0_30px_rgba(20,184,166,0.3)] flex flex-col gap-1.5 max-w-md text-left">
  <div class="flex items-center gap-2">
    <span class="h-2 w-2 rounded-full bg-teal-400 animate-ping"></span>
    <span class="text-[10px] font-mono font-bold tracking-widest text-teal-400 uppercase">AI KINETIC CARD</span>
  </div>
  <h3 class="text-lg font-black text-white tracking-tight">${prompt.slice(0, 45)}</h3>
  <p class="text-xs text-slate-300 leading-relaxed font-sans">Pixel-perfect deterministic audio-locked sync.</p>
</div>`;
                }

                if (generatedHtml) {
                    const playheadTime = (state.lastRenderedTime !== undefined && state.lastRenderedTime >= 0)
                        ? Math.round(state.lastRenderedTime * 10) / 10
                        : Math.round((state.videoPauseTime || 0) * 10) / 10;
                    
                    const newEv: any = {
                        id: 'graphic_' + Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
                        type: 'hyperFrame',
                        start: playheadTime,
                        end: Math.round((playheadTime + 4.5) * 10) / 10,
                        title: prompt.slice(0, 28),
                        templateId: 'custom',
                        html: generatedHtml.trim(),
                        animationIn: 'spring-bounce',
                        animationOut: 'scale-down',
                        position: 'bottom',
                        accentColor: '#14b8a6',
                        textColor: '#ffffff',
                        audioReactive: true,
                        musicReactiveGlow: true,
                        sfxTrigger: 'whoosh',
                        beatPulseScale: 0.08,
                    };

                    timelineState.saveSnapshot();
                    const currentList = [...(timelineState.graphics || [])];
                    currentList.push(newEv);
                    timelineState.setGraphics(currentList);

                    openGraphicEditor(newEv.id);
                    renderGraphicsList();
                    if (!state.isVideoPlaying) drawVideoFrame(playheadTime);
                    mgAiPromptInput.value = '';
                    ui.showStatus(`✨ Generated and dropped AI HyperFrame at ${playheadTime.toFixed(1)}s`, false, 3000);
                }
            } finally {
                mgAiPromptBtn.disabled = false;
                mgAiPromptBtn.innerHTML = origContent;
            }
        });
    }

    document.querySelectorAll<HTMLElement>('.mg-idea-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const promptText = chip.getAttribute('data-prompt') || chip.innerText;
            if (mgAiPromptInput) {
                mgAiPromptInput.value = promptText;
                mgAiPromptBtn?.click();
            }
        });
    });

    if (dom.timelineActionSplitBtn) {
        dom.timelineActionSplitBtn.addEventListener('click', () => {
            handleSplitClip();
        });
    }
    if (dom.timelineActionTrimStartBtn) {
        dom.timelineActionTrimStartBtn.addEventListener('click', () => {
            handleTrimClip('start');
        });
    }
    if (dom.timelineActionTrimEndBtn) {
        dom.timelineActionTrimEndBtn.addEventListener('click', () => {
            handleTrimClip('end');
        });
    }
    if (dom.timelineActionRippleDeleteBtn) {
        dom.timelineActionRippleDeleteBtn.addEventListener('click', () => {
            handleDeleteClip({ deleteAudio: true });
        });
    }
    if (dom.timelineActionTrimSilenceBtn) {
        dom.timelineActionTrimSilenceBtn.addEventListener('click', () => {
            handleTrimDeadAir();
        });
    }
    if (dom.timelineActionResyncBtn) {
        dom.timelineActionResyncBtn.addEventListener('click', () => {
            handleResyncTimeline();
        });
    }
    if (dom.timelineActionUndoBtn) {
        dom.timelineActionUndoBtn.addEventListener('click', () => {
            handleUndoTimeline();
        });
    }
    if (dom.timelineActionRedoBtn) {
        dom.timelineActionRedoBtn.addEventListener('click', () => {
            handleRedoTimeline();
        });
    }
    if (dom.timelineZoomInBtn) {
        dom.timelineZoomInBtn.addEventListener('click', () => {
            handleTimelineZoomIn();
        });
    }
    if (dom.timelineZoomOutBtn) {
        dom.timelineZoomOutBtn.addEventListener('click', () => {
            handleTimelineZoomOut();
        });
    }
    if (dom.timelineZoomFitBtn) {
        dom.timelineZoomFitBtn.addEventListener('click', () => {
            handleTimelineZoomFit();
        });
    }
    // Document-level event delegation for dynamic timeline sliders
    document.addEventListener('input', (e) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        if (target.id === 'timeline-scrub-slider') {
            const slider = target as HTMLInputElement;
            import('./videoRenderer').then(vr => {
                const totalDur = vr.videoRenderContext?.totalDuration || 10;
                const pct = parseFloat(slider.value) / 100;
                const newTime = pct * totalDur;
                import('./state').then(st => {
                    st.state.videoPauseTime = newTime;
                    import('./ui').then(ui => ui.updateVideoTime(newTime, totalDur));
                    vr.drawVideoFrame(newTime);
                });
            });
        } else if (target.id === 'timeline-scroll-slider') {
            const slider = target as HTMLInputElement;
            const scrollContainer = document.getElementById("timeline-multi-track-scroll");
            if (scrollContainer) {
                const maxScroll = scrollContainer.scrollWidth - scrollContainer.clientWidth;
                if (maxScroll > 0) {
                    const pct = parseFloat(slider.value) / 100;
                    scrollContainer.scrollLeft = pct * maxScroll;
                }
            }
        } else if (target.id === 'timeline-zoom-slider') {
            const slider = target as HTMLInputElement;
            const targetZoom = parseFloat(slider.value);
            if (targetZoom > 0 && Math.abs(timelineState.zoomLevel - targetZoom) > 0.01) {
                timelineState.setZoomLevel(targetZoom);
            }
        }
    });

    if (!dom.videoCanvas) return;
    
    let dragRect: DOMRect | null = null;
    function getPointerPos(e: PointerEvent) {
        const dragging = isDraggingPip || isDraggingGraphic || isResizingGraphic;
        const rect = dragging ? (dragRect ??= dom.videoCanvas.getBoundingClientRect()) : dom.videoCanvas.getBoundingClientRect();
        if (!dragging) dragRect = null;
        const cvW = dom.videoCanvas.width;
        const cvH = dom.videoCanvas.height;
        const scaleX = cvW / rect.width;
        const scaleY = cvH / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
            cvW,
            cvH,
            scaleX,
            scaleY
        };
    }

    window.addEventListener('resize', () => { dragRect = null; });

    function checkCornerHit(ev: GraphicEvent, x: number, y: number, cvW: number, cvH: number, scaleX = 1): boolean {
        const bounds = getGraphicBounds(ev, cvW, cvH);
        const offset = 6 * scaleX;
        const corners = [
            [bounds.x - offset, bounds.y - offset],
            [bounds.x + bounds.w + offset, bounds.y - offset],
            [bounds.x - offset, bounds.y + bounds.h + offset],
            [bounds.x + bounds.w + offset, bounds.y + bounds.h + offset]
        ];
        const hitRadius = 24 * scaleX;
        for (const [cx, cy] of corners) {
            if (Math.hypot(x - cx, y - cy) <= hitRadius) {
                return true;
            }
        }
        return false;
    }

    function findHitGraphic(x: number, y: number, cvW: number, cvH: number, scaleX = 1, scaleY = 1) {
        const activeEvents = (timelineState.graphics || []).filter(ev => {
            if (ev.id === currentEditingGraphicId || ev.id === draggingGraphicId || ev.id === resizeGraphicId) return true;
            return state.lastRenderedTime >= ev.start && state.lastRenderedTime < ev.end;
        });

        for (let i = activeEvents.length - 1; i >= 0; i--) {
            const ev = activeEvents[i];
            const bounds = getGraphicBounds(ev, cvW, cvH);
            const padX = 30 * scaleX; // 30px visual padding on screen
            const padY = 30 * scaleY;
            if (x >= bounds.x - padX && x <= bounds.x + bounds.w + padX && y >= bounds.y - padY && y <= bounds.y + bounds.h + padY) {
                return ev;
            }
        }
        return null;
    }

    function findHitPipClip(x: number, y: number, cvW: number, cvH: number, scaleX: number, scaleY: number): TimelineClip | null {
        const activeClips = (timelineState.clips || []).filter(c => {
            if (c.displayMode !== 'pip_overlay') return false;
            const s = c.startTime || 0;
            const e = typeof c.endTime === 'number' ? c.endTime : s + (c.duration || 3);
            return state.lastRenderedTime >= s && state.lastRenderedTime <= e;
        });

        for (let i = activeClips.length - 1; i >= 0; i--) {
            const c = activeClips[i];
            const bounds = getPipOverlayBounds(c, cvW, cvH, state.lastRenderedTime);
            if (!bounds) continue;
            const padX = 15 * scaleX;
            const padY = 15 * scaleY;
            if (x >= bounds.x - padX && x <= bounds.x + bounds.w + padX && y >= bounds.y - padY && y <= bounds.y + bounds.h + padY) {
                return c;
            }
        }
        return null;
    }

    let isDraggingPip = false;
    let draggingPipClipId: string | null = null;
    let draggingPipClip: any = null;
    let draggingPipShot: any = null;
    let startDragPipOffsetX = 0;
    let startDragPipOffsetY = 0;
    let lastHover = 0;

    dom.videoCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
        clientPointerDownX = e.clientX;
        clientPointerDownY = e.clientY;
        graphicInteractionOccurred = false;

        const { x, y, cvW, cvH, scaleX, scaleY } = getPointerPos(e);
        const hitEv = findHitGraphic(x, y, cvW, cvH, scaleX, scaleY);
        
        if (hitEv) {
            graphicInteractionOccurred = true;
            const bounds = getGraphicBounds(hitEv, cvW, cvH);
            const isCorner = checkCornerHit(hitEv, x, y, cvW, cvH, scaleX);

            if (isCorner) {
                isResizingGraphic = true;
                resizeGraphicId = hitEv.id;
                (window as any)._draggingGraphicId = hitEv.id;
                startResizeScale = hitEv.scale || 1.0;
                centerCanvasX = bounds.x + bounds.w / 2;
                centerCanvasY = bounds.y + bounds.h / 2;
                startPointerDist = Math.max(10, Math.hypot(x - centerCanvasX, y - centerCanvasY));
                dom.videoCanvas.style.cursor = 'nwse-resize';
            } else {
                draggingGraphicId = hitEv.id;
                (window as any)._draggingGraphicId = draggingGraphicId;
                isDraggingGraphic = true;
                startDragX = x;
                startDragY = y;
                dom.videoCanvas.style.cursor = 'grabbing';
            }

            try {
                dom.videoCanvas.setPointerCapture(e.pointerId);
            } catch (err) {
                console.warn("setPointerCapture not supported or failed:", err);
            }
            e.preventDefault();
            return;
        }

        const hitPip = findHitPipClip(x, y, cvW, cvH, scaleX, scaleY);
        if (hitPip) {
            graphicInteractionOccurred = true;
            isDraggingPip = true;
            draggingPipClipId = hitPip.id;
            draggingPipClip = (timelineState.clips || []).find(c => c.id === hitPip.id) || hitPip;
            draggingPipShot = getAllStoryboardShots().find(i => i.shot.id === hitPip.id)?.shot ?? null;

            const bounds = getPipOverlayBounds(hitPip, cvW, cvH, state.lastRenderedTime);
            if (bounds) {
                if (hitPip.pipPosition !== 'custom' || typeof hitPip.pipX !== 'number' || typeof hitPip.pipY !== 'number') {
                    hitPip.pipPosition = 'custom';
                    hitPip.pipX = parseFloat(((bounds.x + bounds.w / 2) / cvW).toFixed(3));
                    hitPip.pipY = parseFloat(((bounds.y + bounds.h / 2) / cvH).toFixed(3));
                    hitPip.pipAnchorX = 0.5;
                    hitPip.pipAnchorY = 0.5;
                }
                startDragPipOffsetX = (hitPip.pipX ?? 0.5) - (x / cvW);
                startDragPipOffsetY = (hitPip.pipY ?? 0.5) - (y / cvH);
            }

            dom.videoCanvas.style.cursor = 'grabbing';
            try {
                dom.videoCanvas.setPointerCapture(e.pointerId);
            } catch (err) {
                console.warn("setPointerCapture for PiP failed:", err);
            }
            e.preventDefault();
        }
    });

    let canvasMoveRafId: number | null = null;
    let pendingCanvasPointerEvent: PointerEvent | null = null;

    const handleCanvasPointerMove = (e: PointerEvent) => {
        const sMove = t0();
        try {
            markInteraction();
            const { x, y, cvW, cvH, scaleX, scaleY } = getPointerPos(e);

            if (isDraggingPip && draggingPipClip) {
                graphicInteractionOccurred = true;
                dom.videoCanvas.style.cursor = 'grabbing';

                const tx = Math.max(0.05, Math.min(0.95, (x / cvW) + startDragPipOffsetX));
                const ty = Math.max(0.05, Math.min(0.95, (y / cvH) + startDragPipOffsetY));
                const px = parseFloat(tx.toFixed(3));
                const py = parseFloat(ty.toFixed(3));

                for (const t of [draggingPipClip, draggingPipShot]) {
                    if (!t) continue;
                    t.pipPosition = 'custom';
                    t.pipX = px;
                    t.pipY = py;
                    t.pipAnchorX = 0.5;
                    t.pipAnchorY = 0.5;
                }

                if (dom.inspectorPipPositionSelect && (window as any)._activeInspectorShotId === draggingPipClip.id
                    && dom.inspectorPipPositionSelect.value !== 'custom') {
                    dom.inspectorPipPositionSelect.value = 'custom';
                }

                if (!state.isVideoPlaying) {
                    drawVideoFrame(state.lastRenderedTime);
                }
                return;
            }

            if (isResizingGraphic && resizeGraphicId) {
                graphicInteractionOccurred = true;
                dom.videoCanvas.style.cursor = 'nwse-resize';
                const currDist = Math.hypot(x - centerCanvasX, y - centerCanvasY);
                const scaleFactor = currDist / startPointerDist;
                const newScale = Math.max(0.15, Math.min(4.0, parseFloat((startResizeScale * scaleFactor).toFixed(2))));

                const events = timelineState.graphics || [];
                const ev = events.find(g => g.id === resizeGraphicId);
                if (ev) {
                    ev.scale = newScale;
                    if (dom.geScale && currentEditingGraphicId === ev.id) {
                        dom.geScale.value = newScale.toString();
                    }
                    timelineState.setGraphicsSilent(events);
                    if (!state.isVideoPlaying) {
                        drawVideoFrame(state.lastRenderedTime);
                    }
                }
                return;
            }

            if (!isDraggingGraphic || !draggingGraphicId) {
                const nowH = performance.now();
                if (nowH - lastHover < 50) return;
                lastHover = nowH;

                const hoverEv = findHitGraphic(x, y, cvW, cvH, scaleX, scaleY);
                if (hoverEv && checkCornerHit(hoverEv, x, y, cvW, cvH, scaleX)) {
                    dom.videoCanvas.style.cursor = 'nwse-resize';
                } else if (hoverEv) {
                    dom.videoCanvas.style.cursor = 'grab';
                } else {
                    const hoverPip = findHitPipClip(x, y, cvW, cvH, scaleX, scaleY);
                    if (hoverPip) {
                        dom.videoCanvas.style.cursor = 'grab';
                    } else {
                        dom.videoCanvas.style.cursor = 'default';
                    }
                }
                return;
            }

            graphicInteractionOccurred = true;
            dom.videoCanvas.style.cursor = 'grabbing';
            const dx = x - startDragX;
            const dy = y - startDragY;

            const events = timelineState.graphics || [];
            const ev = events.find(g => g.id === draggingGraphicId);

            if (ev) {
                const isCenterAnchored = ev.type === 'hyperFrame' || ev.type === 'titleCard' || ev.type === 'iconOverlay' || ev.type === 'evidenceBoard' || ev.type === 'revealRoute' || ev.type === 'spotlightFocus';

                if (ev.customX === undefined || ev.customY === undefined) {
                    const bounds = getGraphicBounds(ev, cvW, cvH);
                    if (isCenterAnchored) {
                        ev.customX = (bounds.x + bounds.w / 2) / cvW;
                        ev.customY = (bounds.y + bounds.h / 2) / cvH;
                    } else {
                        ev.customX = bounds.x / cvW;
                        ev.customY = bounds.y / cvH;
                    }
                }

                const dxPercent = dx / cvW;
                const dyPercent = dy / cvH;

                ev.customX = Math.max(0.01, Math.min(0.99, ev.customX + dxPercent));
                ev.customY = Math.max(0.01, Math.min(0.99, ev.customY + dyPercent));
                (ev as any).position = 'custom';

                if (ev.type === 'spotlightFocus') {
                    (ev as any).focusX = ev.customX;
                    (ev as any).focusY = ev.customY;
                }

                if (dom.geIconPosition && currentEditingGraphicId === ev.id) {
                    dom.geIconPosition.value = 'custom';
                }

                if (currentEditingGraphicId === ev.id) {
                    updatePositionInputsFromEvent(ev);
                }

                timelineState.setGraphicsSilent(events);
                if (!state.isVideoPlaying) {
                    drawVideoFrame(state.lastRenderedTime);
                }
            }

            startDragX = x;
            startDragY = y;
        } finally {
            t1('drag.canvasMove', sMove);
        }
    };

    dom.videoCanvas.addEventListener('pointermove', (e: PointerEvent) => {
        pendingCanvasPointerEvent = e;
        if (canvasMoveRafId !== null) return;
        canvasMoveRafId = requestAnimationFrame(() => {
            canvasMoveRafId = null;
            if (pendingCanvasPointerEvent) {
                handleCanvasPointerMove(pendingCanvasPointerEvent);
                pendingCanvasPointerEvent = null;
            }
        });
    });

    const stopDragging = (e: PointerEvent) => {
        dragRect = null;
        draggingPipClip = null;
        draggingPipShot = null;

        if (canvasMoveRafId !== null) {
            cancelAnimationFrame(canvasMoveRafId);
            canvasMoveRafId = null;
        }
        if (pendingCanvasPointerEvent) {
            handleCanvasPointerMove(pendingCanvasPointerEvent);
            pendingCanvasPointerEvent = null;
        }

        const dist = Math.hypot(e.clientX - clientPointerDownX, e.clientY - clientPointerDownY);
        const targetId = draggingGraphicId || resizeGraphicId;

        if (dist > 5) {
            graphicInteractionOccurred = true;
        } else if (targetId) {
            graphicInteractionOccurred = true;
            openGraphicEditor(targetId);
        }

        if (isDraggingPip) {
            timelineState.setClips(timelineState.clips);
            timelineState.saveSnapshot();
            isDraggingPip = false;
            draggingPipClipId = null;
            dom.videoCanvas.style.cursor = 'default';
            try {
                if (e.pointerId !== undefined) {
                    dom.videoCanvas.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                console.warn("releasePointerCapture for PiP failed:", err);
            }
            if (!state.isVideoPlaying) {
                drawVideoFrame(state.lastRenderedTime);
            }
        }

        if (isResizingGraphic) {
            timelineState.setGraphics(timelineState.graphics);
            timelineState.saveSnapshot();
            isResizingGraphic = false;
            resizeGraphicId = null;
            (window as any)._draggingGraphicId = null;
            dom.videoCanvas.style.cursor = 'default';
            try {
                if (e.pointerId !== undefined) {
                    dom.videoCanvas.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                console.warn("releasePointerCapture failed:", err);
            }
            if (!state.isVideoPlaying) {
                drawVideoFrame(state.lastRenderedTime);
            }
        }

        if (isDraggingGraphic) {
            timelineState.setGraphics(timelineState.graphics);
            timelineState.saveSnapshot();
            isDraggingGraphic = false;
            draggingGraphicId = null;
            (window as any)._draggingGraphicId = null;
            dom.videoCanvas.style.cursor = 'default';
            try {
                if (e.pointerId !== undefined) {
                    dom.videoCanvas.releasePointerCapture(e.pointerId);
                }
            } catch (err) {
                console.warn("releasePointerCapture failed:", err);
            }
            if (!state.isVideoPlaying) {
                drawVideoFrame(state.lastRenderedTime);
            }
        }
        scheduleFullQualityRedraw();
    };

    dom.videoCanvas.addEventListener('pointerup', stopDragging);
    dom.videoCanvas.addEventListener('pointercancel', stopDragging);

    // Mouse wheel resizing for motion graphics and PiP overlays on preview
    dom.videoCanvas.addEventListener('wheel', (e: WheelEvent) => {
        const rect = dom.videoCanvas.getBoundingClientRect();
        const cvW = dom.videoCanvas.width;
        const cvH = dom.videoCanvas.height;
        const scaleX = cvW / rect.width;
        const scaleY = cvH / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        const hitEv = findHitGraphic(x, y, cvW, cvH, scaleX, scaleY);
        if (hitEv) {
            e.preventDefault();
            graphicInteractionOccurred = true;
            const events = [...(timelineState.graphics || [])];
            const ev = events.find(g => g.id === hitEv.id);
            if (ev) {
                const curScale = ev.scale || 1.0;
                const delta = e.deltaY < 0 ? 0.05 : -0.05;
                const newScale = Math.max(0.15, Math.min(4.0, parseFloat((curScale + delta).toFixed(2))));
                ev.scale = newScale;

                if (currentEditingGraphicId === ev.id && dom.geScale) {
                    dom.geScale.value = newScale.toString();
                }

                timelineState.setGraphics(events);
                if (!state.isVideoPlaying) {
                    drawVideoFrame(state.lastRenderedTime);
                }
            }
            return;
        }

        const hitPip = findHitPipClip(x, y, cvW, cvH, scaleX, scaleY);
        if (hitPip) {
            e.preventDefault();
            graphicInteractionOccurred = true;
            const clips = [...(timelineState.clips || [])];
            const clip = clips.find(c => c.id === hitPip.id);
            if (clip) {
                const curScale = clip.pipScale || 0.36;
                const delta = e.deltaY < 0 ? 0.02 : -0.02;
                const newScale = Math.max(0.15, Math.min(0.75, parseFloat((curScale + delta).toFixed(2))));
                clip.pipScale = newScale;

                // Sync storyboard shot
                const allShots = getAllStoryboardShots();
                const targetShotItem = allShots.find(item => item.shot.id === clip.id);
                if (targetShotItem) {
                    targetShotItem.shot.pipScale = newScale;
                }

                if (dom.inspectorPipScaleRange && dom.inspectorPipScaleVal && (window as any)._activeInspectorShotId === clip.id) {
                    const pct = Math.round(newScale * 100);
                    dom.inspectorPipScaleRange.value = String(pct);
                    dom.inspectorPipScaleVal.textContent = `${pct}%`;
                }

                timelineState.setClips(clips);
                if (!state.isVideoPlaying) {
                    drawVideoFrame(state.lastRenderedTime);
                }
            }
        }
    }, { passive: false });
}

/**
 * Spawns lowerThird graphics from shots that carry a text_overlay field
 * (emitted by the scene-breakdown LLM when "Include Dialogue/Text Overlays"
 * is enabled). Matches shots to timeline clips by id or verbatim text —
 * the same strategy resyncTimelineVisualsFromStoryboard uses — so no
 * clip-building call site needs to change.
 *
 * Idempotent: skips shots that already have an overlay graphic. Auto-spawned
 * graphics are re-timed on re-production; user-edited ones are left alone.
 */
export function spawnTextOverlayGraphics(dryRun: boolean = false): number {
    const allShots = (state.currentScenes || []).flatMap((s: any) => s.lines || [s]);
    const clips = timelineState.clips || [];
    if (!allShots.length || !clips.length) return 0;

    // Map the current visual style to a graphics theme (no new imports — read the select)
    const styleText = (dom.imageStyleSelect?.options?.[dom.imageStyleSelect.selectedIndex]?.text || '').toLowerCase();
    const theme: any =
        /noir|horror|cyber|neon|vhs|retro/.test(styleText) ? 'neon' :
        /3d|toon|anime|paint|animated/.test(styleText) ? 'gradient-glass' :
        /documentary|news|journal/.test(styleText) ? 'corporate' : 'minimal';

    const graphics = [...(timelineState.graphics || [])];
    let spawned = 0;

    for (const shot of allShots) {
        const raw = (shot as any).text_overlay;
        const overlayText = typeof raw === 'string' ? raw.trim() : '';
        if (!overlayText) continue;

        // Find the clip this shot became (b-roll finalize suffixes ids with _N)
        const clip = clips.find((c: any) =>
            c.id === shot.id ||
            (typeof c.id === 'string' && c.id.startsWith(shot.id + '_')) ||
            (c.text && c.text === ((shot as any).text_reference || (shot as any).line_text))
        );
        if (!clip) continue;

        const existing = graphics.find((g: any) => g.sourceShotId === shot.id);

        // Reading-time duration, clamped inside the clip with small pads
        const pad = 0.25;
        const words = overlayText.split(/\s+/).filter(Boolean).length;
        const want = Math.max(1.8, words * 0.45);
        const start = clip.startTime + pad;
        const end = Math.min(clip.endTime - pad, start + want);
        if (end - start < 1.2) continue; // clip too short to host a readable overlay

        if (existing) {
            if (!dryRun && (existing as any).autoSpawned) {
                // Re-time auto-spawned overlays when the timeline shifts
                existing.start = start;
                existing.end = end;
            }
            continue; // user-edited overlay → never touch
        }

        if (dryRun) {
            spawned++;
            continue;
        }

        const sfxMode = (state as any).autoOverlaySfxMode || 'none';
        let sfxTrigger: any = undefined;
        if (sfxMode === 'high-energy') {
            sfxTrigger = 'whoosh';
        } else if (sfxMode === 'subtle') {
            // Subtle & Context-Aware: only trigger on emphatic numbers, questions, warnings, or keys
            if (/[\d%$#€£!?]|\b(key|secret|alert|warning|step|rule|tip|fact|hack|note|remember|caution)\b/i.test(overlayText)) {
                sfxTrigger = 'pop';
            }
        }

        graphics.push({
            id: `txt_${shot.id}`,
            type: 'lowerThird',
            start,
            end,
            title: overlayText,
            position: 'center',
            accentColor: '#F5C542',
            animationType: 'slide-up',
            theme,
            scale: 1.0,
            sfxTrigger: sfxTrigger || undefined,
            sourceShotId: shot.id,
            autoSpawned: true,
        } as any);
        spawned++;
    }

    if (spawned > 0 || graphics.some((g: any) => g.autoSpawned)) {
        timelineState.saveSnapshot();       // undoable (pairs with the P0 undo fix)
        timelineState.setGraphics(graphics);
    }
    if (spawned > 0) ui.showStatus(`✍️ ${spawned} text overlay(s) added to the timeline.`, false, 2500);
    return spawned;
}
