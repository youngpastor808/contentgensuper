/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// This file contains shared TypeScript types and interfaces used across the application.

export type AspectRatio = "16:9" | "9:16" | "4:3" | "3:4" | "1:1";
export type PreviewResolution = "240p" | "320p" | "520p" | "720p";

interface UserRecord {
    uid?: string;
    email?: string;
    displayName?: string;
    role?: 'user' | 'reseller' | 'admin';
    status?: 'pending' | 'approved' | 'restricted' | 'rejected' | 'banned';
    maxApprovedUsers?: number;
    approvedUsersCount?: number;
    assignedBy?: string;
    allowImageGeneration?: boolean;
    allowAudioGeneration?: boolean;
    allowVideoGeneration?: boolean;
    allowCookieAuth?: boolean;
    createdAt?: any;
    updatedAt?: any;
    createdByAdmin?: boolean;
}

interface SystemConfigData {
    systemGeminiApiKey?: string;
    systemGeminiAuthMode?: 'apiKey' | 'webCookie' | 'adc';
    systemGeminiProvider?: 'aistudio' | 'vertex';
    systemVertexAuthMode?: 'apiKey' | 'adc';
    systemVertexProjectId?: string;
    systemVertexLocation?: string;
    systemGeminiPsid?: string;
    systemGeminiPsidts?: string;
    systemGeminiPsidcc?: string;
    systemGeminiCompass?: string;
    systemGeminiSid?: string;
    systemGeminiHsid?: string;
    systemGeminiSsid?: string;
    systemElevenlabsApiKey?: string;
    systemDeepgramApiKey?: string;
    systemStabilityApiKey?: string;
    systemAi33ApiKey?: string;
    systemPexelsApiKey?: string;
    systemFreesoundApiKey?: string;
    systemGradioTtsUrl?: string;
    customFirebaseApiKey?: string;
    desktopStudioPassword?: string;
    desktopStudioPasswordHash?: string;
    maintenanceMode?: boolean;
    maintenanceMessage?: string;
    disableDesktopOfflineMode?: boolean;
    disableSystemImageGeneration?: boolean;
    disableSystemVideoGeneration?: boolean;
    disableSystemAudioGeneration?: boolean;
    showAdsAdminButton?: boolean;
    creditCosts?: {
        IMAGE_GENERATION_GEMINI?: number;
        IMAGE_GENERATION_IMAGEN?: number;
        AUDIO_GENERATION_ELEVENLABS_INSTANT?: number;
        AUDIO_GENERATION_ALIGNED?: number;
        AUDIO_CLONING_MINIMAX?: number;
        VIDEO_GENERATION?: number;
        TEXT_GENERATION_PER_TOKEN?: number;
        [key: string]: number | undefined;
    };
    updatedAt?: any;
    updatedBy?: string;
}

export interface WordTimestamp {
    word: string;
    start: number;
    end: number;
}

export interface ElementRevealEvent {
  id: string;
  type: 'elementReveal';
  imageUrl: string;           // the element PNG from Piece A
  label?: string;
  bbox: { x: number; y: number; w: number; h: number }; // normalized 0-1, position in frame
  enterTime: number;           // seconds from shot start
  animationType?: 'slide-left' | 'slide-up' | 'pop' | 'fade' | 'bounce';
}

export interface CharacterProfile {
    name: string;
    aliases?: string[];            // Alternative names, first names, last names, or nicknames used in the story
    appearance_anchor: string;     // Immutable traits (age, face, race, build)
    role_keywords?: string[];      // Keywords from story used to identify the character
    location_context?: string;     // Geographic/cultural setting that informs appearance
    image?: {
        data: string;
        mimeType: string;
    } | null;
    frequency?: number;
    enforce_consistency?: boolean;
    is_universal?: boolean;
    _nameRegex?: RegExp;
    sheet_prompt?: string;
}

export interface LocationProfile {
    name: string;
    description: string;
    enforce_consistency?: boolean;
    _nameRegex?: RegExp;
}

export interface ElementProfile {
    name: string;
    description: string;
    enforce_consistency?: boolean;
    _nameRegex?: RegExp;
}

export interface CameraKeyframe {
    x: number;          // Normalized horizontal center (0.0 = left, 0.5 = center, 1.0 = right)
    y: number;          // Normalized vertical center (0.0 = top, 0.5 = center, 1.0 = bottom)
    scale: number;      // Zoom scale multiplier (1.0 = full frame, 1.25 = 25% zoom, etc.)
    rotation: number;   // Rotation angle in degrees (-45 to +45 deg)
}

export interface CameraKeyframesConfig {
    start: CameraKeyframe;
    end: CameraKeyframe;
    easing?: 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'whip';
}

export type DeviceTag = 'desktop' | 'camera' | 'smartphone' | 'gopro' | 'screen_recording' | 'other';

export type VisualType =
  | 'ENVIRONMENTAL_ESTABLISHING'
  | 'HISTORICAL_EVENT'
  | 'CHARACTER_ACTION'
  | 'ANIMAL_BEHAVIOR'
  | 'ECOSYSTEM'
  | 'CAUSE_AND_EFFECT'
  | 'BEFORE_AFTER'
  | 'COMPARISON'
  | 'SCALE'
  | 'MAP_OR_GEOGRAPHY'
  | 'SCIENTIFIC_CONCEPT'
  | 'ABSTRACT_CONCEPT'
  | 'NARRATIVE_TRANSITION'
  | 'CORRECTION_OR_MYTH_BUST'
  | 'CONVERSATION'
  | 'EMOTIONAL_MOMENT'
  | 'OBJECT_DETAIL'
  | 'PROCESS'
  | 'DISCOVERY'
  | 'CONFLICT'
  | 'RESOLUTION';

export type NarrativeFunction =
  | 'INTRODUCTION'
  | 'WORLD_BUILDING'
  | 'CHARACTER_INTRODUCTION'
  | 'SETTING_ESTABLISHMENT'
  | 'HISTORICAL_CONTEXT'
  | 'CAUSE'
  | 'EFFECT'
  | 'TRANSITION'
  | 'ESCALATION'
  | 'CONFLICT'
  | 'REVELATION'
  | 'EXPLANATION'
  | 'COMPARISON'
  | 'CORRECTION'
  | 'MYTH_BUST'
  | 'EMOTIONAL_BEAT'
  | 'ACTION'
  | 'CONSEQUENCE'
  | 'RESOLUTION'
  | 'ENDING';

export interface StoryContext {
  domain: string;
  genre: string;
  era: string;
  location: string;
  time_period?: string;
  world_state?: string;
  visual_style?: string;
  tone?: string;
  visual_evolution?: string[];
}

export interface SharedShotConfig {
    camera_movement: string;
    cameraKeyframes?: CameraKeyframesConfig;
    focalPoint?: { x: number; y: number };
    camera_angle?: string;
    lighting_prompt?: string;
    image_id: string | null;        // IndexedDB Key
    video_id?: string | null;        // IndexedDB Video Key
    _imageObjectURL?: string;       // Ephemeral session URL
    imageMimeType?: string;
    imageEngine?: string;
    _styleUsed?: string;
    prompt_source_text?: string;
    b_roll_prompt?: string;
    characterMetadata?: any;
    // Storyboard Intelligence fields
    visual_type?: VisualType | string;
    narrative_function?: NarrativeFunction | string;
    visual_concept?: string;
    subjects?: string[];
    action?: string;
    environment?: string;
    composition?: string;
    camera?: string;
    mood?: string;
    continuity_notes?: string;
    sfx_prompt?: string;
    speaker_name?: string;
    film_prompt?: string;
    panel_annotation?: { cam: string; move: string; third: string };
    sfx_id?: string | null;
    _sfxObjectURL?: string;
    _sfxBuffer?: AudioBuffer;
    _videoObjectURL?: string;
    videoStartOffset?: number;
    _isAnimating?: boolean;
    _isUploadingVideo?: boolean;
    preserveContent?: boolean;
    secondary_media_type?: 'image' | 'video';
    secondary_image_id?: string | null;
    secondary_video_id?: string | null;
    _secondaryImageObjectURL?: string;
    _secondaryVideoObjectURL?: string;
    talkingHeadRole?: 'primary' | 'secondary';
    talkingHeadMode?: 'full' | 'pip-br' | 'pip-bl' | 'pip-tr' | 'pip-tl' | 'split' | 'none';
    talkingHeadShape?: 'circle' | 'rounded' | 'square';
    talkingHeadSize?: 'small' | 'medium' | 'large';
    useOriginalAudio?: boolean;
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    playbackRate?: number;
    audioDuckingOverride?: boolean;
    rotate?: 0 | 90 | 180 | 270;
    deviceTag?: DeviceTag;
    overlayImageId?: string;
    overlayImageUrl?: string;
    mapConfig?: any;
    hasCornerMapCallout?: boolean;
    cornerCalloutLabel?: string;
    cornerCalloutCoords?: string;
    overlayPosition?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center';
    displayMode?: 'fullscreen' | 'pip_overlay';
    pipPosition?: 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left' | 'center_right' | 'center_left' | 'custom';
    pipX?: number; // 0..1 normalized horizontal center anchor
    pipY?: number; // 0..1 normalized vertical center anchor
    pipAnchorX?: number; // 0..1 horizontal anchor point (defaults to 0.5 center)
    pipAnchorY?: number; // 0..1 vertical anchor point (defaults to 0.5 center)
    pipScale?: number;
    pipAnimation?: 'pop_spring' | 'slide_in' | 'zoom_fade';
    pipBorderColor?: string;
    colorFilter?: string;
    colorFilterIntensity?: number;
    startWordIndex?: number;
    endWordIndex?: number;
    alignmentConfidence?: number;
    textMatchConfidence?: number;
    timingReliability?: number;
    timingProvenance?: 'acoustic_word' | 'acoustic_island_bounded' | 'silence_snapped' | 'synthetic_fallback' | 'manual';
}

export interface CinematicShot extends SharedShotConfig {
    id: string;
    shot_number: number;
    duration_seconds: number;
    image_prompt: string;
    text_reference: string;
    story_section?: 'opening' | 'main';
}

export interface SceneBasedShot extends SharedShotConfig {
    id: string;
    line_text: string;
    image_prompt: string;
    duration_seconds?: number;
}

export interface VoiceArchetype {
    id: string;
    label: string;
    category: string;
    value: string;
}

export interface DirectorSuggestion {
    id: string;
    type: string;
    description: string;
    actionPayload?: any;
    targetShotIndex: number;
    targetClipId?: string;
    title?: string;
    severity?: string;
    applied: boolean;
    confidence?: number;
}

export interface DirectorReviewResult {
    overallScore: number;
    pacingCadence?: string;
    executiveSummary?: string;
    suggestions: DirectorSuggestion[];
    pacingMetrics?: any;
}

export interface Scene {
    scene_number?: number;
    scene_description?: string;
    lines?: SceneBasedShot[];
}

export interface SavedCustomVoice {
    id: string;
    name: string;
    provider: 'elevenlabs' | 'minimax' | 'edge' | 'kokoro' | 'vbee' | 'fishaudio' | 'clone';
    voiceId: string; // Full unified prefixed ID (e.g. elevenlabs_abc, edge_vi-VN-..., etc.)
    rawVoiceId: string; // Raw user input without prefix
    createdAt?: number;
}
