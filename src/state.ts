/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// This file centralizes the dynamic state of the application.
// Using a single state object helps in managing and tracking state changes.

import type { AspectRatio, PreviewResolution, CharacterProfile, LocationProfile, ElementProfile, WordTimestamp, SavedCustomVoice } from './types';

export const state = {
    isBulkGenerating: false,
    currentScenes: [] as any[],
    characterProfiles: [] as CharacterProfile[],
    locationProfiles: [] as LocationProfile[],
    keyElementProfiles: [] as ElementProfile[],
    characterTimeline: null as any | null,
    confirmCallback: null as (() => void) | null,
    cancelCallback: null as (() => void) | null,
    currentProcessingAbortController: null as AbortController | null,
    cancelProcessingCallback: null as (() => boolean | string | void) | null,
    isCloudRenderActive: false,
    selectedReferenceImage: null as any,
    presentationSlides: [] as any[],
    currentSlideIndex: 0,
    modalImageSrc: null as string | null,
    modalImageMimeType: null as string | null,
    modalImageEngine: null as string | null,
    modalImageShotIndex: 0,
    modalImageSceneIndex: 0,
    apiKey: null as string | null,
    userGeminiApiKey: null as string | null,
    geminiAuthMode: 'builtin' as 'builtin' | 'apiKey' | 'webCookie' | 'adc' | 'openaiGateway',
    geminiProvider: 'vertex' as 'aistudio' | 'vertex',
    vertexAuthMode: 'adc' as 'apiKey' | 'adc',
    vertexProjectId: null as string | null,
    vertexLocation: 'us-central1' as string | null,
    openaiGatewayBaseUrl: null as string | null,
    openaiGatewayApiKey: null as string | null,
    openaiGatewayModel: null as string | null,
    openaiGatewayImageModel: null as string | null,
    geminiPsid: null as string | null,
    geminiPsidts: null as string | null,
    geminiPsidcc: null as string | null,
    geminiCompass: null as string | null,
    geminiSid: null as string | null,
    geminiHsid: null as string | null,
    geminiSsid: null as string | null,
    ai33ApiKey: null as string | null,
    stabilityApiKey: null as string | null,
    elevenlabsApiKey: null as string | null,
    deepgramApiKey: ((typeof localStorage !== 'undefined' && (localStorage.getItem('deepgramApiKey') || localStorage.getItem('deepgram_api_key'))) || null) as string | null,
    freesoundApiKey: null as string | null,
    pexelsApiKey: null as string | null,
    bgAudioPrompt: '',
    bgAudioId: null as string | null,
    bgAudioVolume: 0.3,
    audioDuckingEnabled: true,
    autoNormalizeAudio: true, // Multi-source auto-normalization and brickwall limiter
    bgAudioGain: null as GainNode | null,
    _bgAudioBuffer: undefined as AudioBuffer | undefined,
    _bgAudioObjectURL: undefined as string | undefined,
    gradioTtsApiUrl: null as string | null,
    preferredTranscribeEngine: ((typeof localStorage !== 'undefined' && localStorage.getItem('preferredTranscribeEngine')) || 'deepgram') as string, // 'deepgram' -> 'whisper' -> 'gemini'
    useInstantTimestamps: false, // Default to aligned timestamps
    customVoiceIds: [] as string[],
    savedCustomVoices: [] as SavedCustomVoice[],
    customStyleImageFile: null as File | null,
    customStyleImagePreviewUrl: null as string | null,
    touchStartX: 0,
    touchEndX: 0,
    apiKeySelected: false,
    safeRephraseEnabled: true,
    aspectRatio: '16:9' as AspectRatio,
    previewResolution: ((typeof localStorage !== 'undefined' && localStorage.getItem('cg_preview_resolution') as PreviewResolution) || '520p') as PreviewResolution,
    responsivePreview: typeof localStorage !== 'undefined' && localStorage.getItem('cg_responsive_preview') === '1',
    currentTextModel: null as string | null,
    rightClickEnabled: true, // Enabled by default
    textOverlayEnabled: false,
    motionGraphicsEnabled: true,
    overlayIntensity: 'medium' as 'minimal' | 'medium' | 'aggressive',
    autoOverlaySfxMode: 'none' as 'none' | 'subtle' | 'high-energy',
    graphicsTheme: 'minimal' as string,
    graphicsAccentColor: '#F5C542',
    visualPunctuationEnabled: false,
    enableParallaxEffect: true,
    parallaxMode: 'multi_layer' as 'multi_layer' | 'single_plate',
    parallaxDustParticles: true,
    parallaxDustIntensity: 0.6,
    parallaxDustSize: 0.5,        // optical scale of dust motes (0.1 = tiny micro-motes, 2.0 = large bokeh)
    parallaxDustDensity: 0.5,     // frequency/count of dust motes (0.1 = sparse, 2.0 = dense)
    sparklesSize: 0.5,            // scale of magic sparkles / glints (0.1 to 2.0)
    sparklesCount: 0.5,           // density/count of magic sparkles (0.1 to 2.0)
    rainSize: 0.5,                // length & thickness of rain streaks (0.1 to 2.0)
    rainCount: 0.5,               // density/count of rain streaks (0.1 to 2.0)
    snowSize: 0.5,                // scale of snow flakes (0.1 to 2.0)
    snowCount: 0.5,               // density/count of snowfall flakes (0.1 to 2.0)
    dustMotesSize: 0.5,           // scale of 2D/post dust motes (0.1 to 2.0)
    dustMotesCount: 0.5,          // density/count of 2D/post dust motes (0.1 to 2.0)
    parallaxDepthBlur: false,     // Depth blur / DoF off by default for crisp 3D effect
    parallaxHaze: true,
    parallaxHazeAmount: 0.6,
    parallaxStrength: 1.0,        // 0 = flat, 1 = default, up to 3 = exaggerated
    parallaxOrbit: 0.35,          // virtual-camera sway so pure zooms still show depth (0..1)
    parallaxBlurStrength: 0.0,    // depth-of-field gain (0..2, default 0.0 = off)
    parallaxRackFocus: false,     // animate the focus plane over each clip
    parallaxDepthSource: 'auto' as 'auto' | 'server' | 'browser' | 'procedural',
    enableBackgroundBlur: false,
    cameraMotionIntensity: 1.0,
    cameraShakeHandheld: false,
    cinematicLetterbox: false,
    cinematicVignette: false,
    ruleOfThirdsGuide: false,
    cinematographyPreset: 'balanced' as 'balanced' | 'documentary' | 'trailer' | 'viral' | 'noir',
    isExporting: false, // Flag to prevent concurrent exports
    isGuestExport: false, // Flag indicating active export is a 320p watermarked guest preview
    exportDirectoryPath: null as string | null,
    exportDirectoryHandle: null as any,

    debugMode: false, // Diagnostics for timing and alignment
    subtitles: [] as any[],
    subtitleConfig: {} as Record<string, any>,
    uiTextOverlays: [] as any[],
    activeFilterName: 'none' as string,
    musicMode: false,
    cinematicDroneAudio: false as boolean,
    detectedBpm: null as number | null,
    forceAlignSubtitleCues: null as Array<{start: number, end: number, text: string}> | null,
    bRollTranscript: null as { words: WordTimestamp[] } | null,
    uploadedAudioBuffer: null as AudioBuffer | null,
    uploadIntent: null as 'speech' | 'music' | 'silent' | null,
    // B-roll sources that are NOT storyboard shots (uploaded footage, imports).
    // Session-scoped: object URLs die on reload — persist via assetStorage later.
    bRollSourceRegistry: new Map<string, { imageObjectURL?: string; videoObjectURL?: string; label?: string }>(),
    uploadedAudioAssetId: null as string | null,
    uploadedAudioFileName: null as string | null,
    uploadedVideoAssetId: null as string | null,
    uploadedVideoObjectURL: null as string | null,
    uploadedVideoFileName: null as string | null,
    uploadedVideoElement: null as HTMLVideoElement | null,
    uploadedVideoDuration: 0,
    uploadedVideoWidth: 0,
    uploadedVideoHeight: 0,
    talkingHeadDefaultMode: 'none' as string,
    selectedRhythmTemplateId: 'youtube_essay' as string,
    talkingHeadShape: 'circle' as 'circle' | 'rounded' | 'square',
    talkingHeadSize: 'medium' as 'small' | 'medium' | 'large',
    talkingHeadBorderColor: '#6366f1',
    talkingHeadBorderWidth: 3,
    talkingHeadShadow: true,
    masterAudioTranscript: null as WordTimestamp[] | null,

    // Audio Context Singleton (prevents max context limit errors)
    globalAudioContext: null as AudioContext | null,

    // Video Director State (PROCESS/PLAYBACK state remains here)
    isVideoProductionRunning: false, // Flag to control production loop
    isVideoPlaying: false,
    videoRenderRequestId: null as number | null,
    videoAudioSource: null as AudioBufferSourceNode | null,
    videoMasterGainNode: null as GainNode | null,
    sfxAudioSources: [] as AudioBufferSourceNode[],
    bgAudioSource: null as AudioBufferSourceNode | null,
    videoStartTime: 0,
    videoPauseTime: 0,
    playbackStartTimestamp: 0, // performance.now() when playback started
    playbackStartOffset: 0,    // videoPauseTime when playback started
    lastRenderedTime: 0,       // Last time value passed to drawVideoFrame()
    videoSubtitleColors: {} as Record<string, any>,
    customFonts: [] as { name: string; format?: string; dataUrl?: string }[],
    lastProductionMetrics: null as {
        shotCount: number;
        wordCount: number;
        audioDuration: number;
        productionTime: number;
        usedFastPath: boolean;
        syncIntegrity: number;
    } | null,
    elevenlabsVoices: [] as any[],
    elevenlabsVoicesFetched: false,
    elevenlabsModels: [] as any[],
    elevenlabsModelsFetched: false,
    elevenlabsSelectedModel: 'eleven_multilingual_v2',
    userCredits: null as number | null,
    renderMinutesQuota: 10 as number, // 10 minutes default quota for standard users
    renderMinutesUsed: 0 as number,
    cloudRenderMode: 'local' as 'local' | 'cloud',
    cloudRenderProvider: (typeof localStorage !== 'undefined' && (localStorage.getItem('cg_cloud_render_provider') as 'gcp' | 'aws' | 'headless')) || ('gcp' as 'gcp' | 'aws' | 'headless'),
    privateSystemConfig: null as any | null,
    systemConfig: {
        maintenanceMode: false,
        maintenanceMessage: 'System is undergoing scheduled maintenance. Please check back shortly.',
        get disableDesktopOfflineMode() { return (typeof localStorage !== 'undefined' && localStorage.getItem('cg_disable_desktop_offline_mode') === 'true') || false; },
        set disableDesktopOfflineMode(value: boolean) { if (typeof localStorage !== 'undefined') localStorage.setItem('cg_disable_desktop_offline_mode', value.toString()); },
        disableSystemImageGeneration: false,
        disableSystemVideoGeneration: false,
        disableSystemAudioGeneration: false,
        showAdsAdminButton: false,
        get desktopStudioPasswordHash() { return (typeof localStorage !== 'undefined' && localStorage.getItem('cg_desktop_studio_password_hash')) || ''; },
        set desktopStudioPasswordHash(value: string) { if (typeof localStorage !== 'undefined') localStorage.setItem('cg_desktop_studio_password_hash', value); },
        requireAdminApproval: true,
        enforceGuestRestrictions: true,
        guestExportPolicy: 'watermark_320p' as 'watermark_320p' | 'block_all' | 'unrestricted',
        creditCosts: {
            IMAGE_GENERATION_GEMINI: 50,
            IMAGE_GENERATION_IMAGEN: 300,
            AUDIO_GENERATION_ELEVENLABS_INSTANT: 150,
            AUDIO_GENERATION_ALIGNED: 50,
            AUDIO_CLONING_MINIMAX: 500,
            VIDEO_GENERATION: 2500,
            TEXT_GENERATION_PER_TOKEN: 1 / 100,
        }
    }
};