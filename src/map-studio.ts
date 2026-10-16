/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Map Studio UI Controller
 * Allows creators to generate cinematic map animation visuals either automatically from a script (AI)
 * or manually by fine-tuning waypoints, camera paths, themes, and vehicle icons.
 */

import { state } from './state';
import { showStatus, renderResults } from './ui';
import { updateVideoContext } from './videoController';
import { assetStorage } from './assetStorage';
import { generateContentWithFallback } from './api/core';
import { saveVersion } from './handlers-project';
import { escapeHtml } from './utils';
import { safelyReplaceShotMedia } from './memoryManager';

function notify(message: string, isError = false, duration = 3500, action?: { label: string; onClick: () => void }) {
  showStatus(message, isError, duration, action);
}

import {
  MapWaypoint,
  MapAnimationConfig,
  MapTheme,
  TravelerIcon,
  TrailStyle,
  CameraMode,
  PathMode,
  WORLD_GEO_DB,
  MIN_MAP_DURATION,
  MAX_MAP_DURATION,
  DEFAULT_MAP_DURATION,
  renderMapFrame,
  exportMapVideoDeterministic,
  geoToCanvas,
  canvasToGeo,
  computeCameraTransform,
  solveJourneySegments,
  computeTravelerPosition,
  preloadSatelliteTilesForRoute
} from './map-animator-engine';

export const DEFAULT_MAP_CONFIG: MapAnimationConfig = {
  theme: "tactical-dark",
  travelerIcon: "plane",
  trailStyle: "glowing-solid",
  cameraMode: "follow-traveler",
  pathMode: "great-circle",
  duration: DEFAULT_MAP_DURATION,
  arcCurvature: 0.22,
  showCoordinates: true,
  showGraticule: true,
  showCompass: true,
  showTelemetry: true,
  showDistanceCounter: true,
  title: "TRANSATLANTIC FLIGHT 102",
  subtitle: "New York to Paris Route",
  aspectRatio: "16:9",
  overlayEffect: "none",
  audioConfig: {
    whooshSfx: true,
    pingSfx: true,
    ambientDrone: false,
    droneVolume: 0.15
  },
  waypoints: [
    { id: "wp_1", name: "New York", lat: 40.7128, lng: -74.0060, dateOrSub: "Departure JFK" },
    { id: "wp_2", name: "Reykjavik", lat: 64.1466, lng: -21.9426, dateOrSub: "Waypoint Alpha" },
    { id: "wp_3", name: "London", lat: 51.5074, lng: -0.1278, dateOrSub: "Heathrow Airway" },
    { id: "wp_4", name: "Paris", lat: 48.8566, lng: 2.3522, dateOrSub: "Final Destination" }
  ]
};

// Preset Inspirational Routes (Pure Templates)
export const PRESET_MAP_STORIES: { name: string; icon: string; description: string; config: Partial<MapAnimationConfig> }[] = [
  {
    name: "Satellite Reconnaissance",
    icon: "🛰️",
    description: "Orbital satellite pass over key strategic points with Esri imagery",
    config: {
      title: "ORBITAL RECON // KEYHOLE-9",
      subtitle: "Tactical Satellite Overwatch",
      theme: "real-satellite",
      overlayEffect: "border",
      travelerIcon: "rocket",
      trailStyle: "glowing-solid",
      cameraMode: "follow-traveler",
      duration: 6,
      arcCurvature: 0.28,
      waypoints: [
        { id: "wp_1", name: "Gibraltar", lat: 36.1408, lng: -5.3536, dateOrSub: "Sector Alpha" },
        { id: "wp_2", name: "Alexandria", lat: 31.2001, lng: 29.9187, dateOrSub: "Recon Point 2" },
        { id: "wp_3", name: "Dubai", lat: 25.2048, lng: 55.2708, dateOrSub: "Target Sector" }
      ]
    }
  },
  {
    name: "Transatlantic Air Route",
    icon: "✈️",
    description: "New York to Paris via London and Iceland",
    config: {
      title: "TRANSATLANTIC FLIGHT 102",
      subtitle: "New York to Paris Route",
      theme: "tactical-dark",
      overlayEffect: "none",
      travelerIcon: "plane",
      trailStyle: "glowing-solid",
      cameraMode: "follow-traveler",
      duration: 6,
      arcCurvature: 0.22,
      waypoints: [
        { id: "wp_1", name: "New York", lat: 40.7128, lng: -74.0060, dateOrSub: "Departure JFK" },
        { id: "wp_2", name: "Reykjavik", lat: 64.1466, lng: -21.9426, dateOrSub: "Waypoint Alpha" },
        { id: "wp_3", name: "London", lat: 51.5074, lng: -0.1278, dateOrSub: "Heathrow Airway" },
        { id: "wp_4", name: "Paris", lat: 48.8566, lng: 2.3522, dateOrSub: "Final Destination" }
      ]
    }
  },
  {
    name: "The Ancient Silk Road",
    icon: "🐫",
    description: "Historical trade route through Asia & Europe",
    config: {
      title: "THE SILK ROAD",
      subtitle: "Ancient Eurasian Merchant Route",
      theme: "vintage-parchment",
      overlayEffect: "none",
      travelerIcon: "foot",
      trailStyle: "dashed",
      cameraMode: "pan-waypoints",
      duration: 8,
      arcCurvature: 0.15,
      waypoints: [
        { id: "wp_1", name: "Chang'an", lat: 34.3416, lng: 108.9398, dateOrSub: "Eastern Origin" },
        { id: "wp_2", name: "Dunhuang", lat: 40.1421, lng: 94.6620, dateOrSub: "Hexi Corridor" },
        { id: "wp_3", name: "Samarkand", lat: 39.6270, lng: 66.9750, dateOrSub: "Oasis Hub" },
        { id: "wp_4", name: "Constantinople", lat: 41.0082, lng: 28.9784, dateOrSub: "Gateway to Europe" },
        { id: "wp_5", name: "Rome", lat: 41.9028, lng: 12.4964, dateOrSub: "Mediterranean End" }
      ]
    }
  },
  {
    name: "Magellan's Circumnavigation",
    icon: "🚢",
    description: "First voyage around the world (1519-1522)",
    config: {
      title: "MAGELLAN EXPEDITION",
      subtitle: "First Global Circumnavigation",
      theme: "vintage-parchment",
      overlayEffect: "none",
      travelerIcon: "ship",
      trailStyle: "dashed",
      cameraMode: "overview",
      duration: 10,
      arcCurvature: 0.18,
      waypoints: [
        { id: "wp_1", name: "Seville", lat: 37.3891, lng: -5.9845, dateOrSub: "1519 Departure" },
        { id: "wp_2", name: "Rio de Janeiro", lat: -22.9068, lng: -43.1729, dateOrSub: "South America" },
        { id: "wp_3", name: "Strait of Magellan", lat: -53.4754, lng: -70.7656, dateOrSub: "Cape Passage" },
        { id: "wp_4", name: "Manila", lat: 14.5995, lng: 120.9842, dateOrSub: "Pacific Arrival" },
        { id: "wp_5", name: "Cape Town", lat: -33.9249, lng: 18.4241, dateOrSub: "Cape of Good Hope" },
        { id: "wp_6", name: "Seville", lat: 37.3891, lng: -5.9845, dateOrSub: "1522 Return" }
      ]
    }
  },
  {
    name: "WWII Atlantic Convoy",
    icon: "⚔️",
    description: "Allied supply line during the Battle of the Atlantic",
    config: {
      title: "OPERATION ATLANTIC CONVOY",
      subtitle: "Allied Supply Route 1942",
      theme: "tactical-dark",
      overlayEffect: "arrow",
      travelerIcon: "ship",
      trailStyle: "glowing-solid",
      cameraMode: "follow-traveler",
      duration: 6,
      arcCurvature: 0.25,
      waypoints: [
        { id: "wp_1", name: "New York", lat: 40.7128, lng: -74.0060, dateOrSub: "Convoy Assembly" },
        { id: "wp_2", name: "Reykjavik", lat: 64.1466, lng: -21.9426, dateOrSub: "Escort Station" },
        { id: "wp_3", name: "Liverpool", lat: 53.4084, lng: -2.9916, dateOrSub: "Western Approaches" }
      ]
    }
  },
  {
    name: "Pacific Island Exploration",
    icon: "🌺",
    description: "Tropical journey across Polynesia & Oceania",
    config: {
      title: "PACIFIC ODYSSEY",
      subtitle: "Island Chain Expedition",
      theme: "satellite-earth",
      overlayEffect: "none",
      travelerIcon: "plane",
      trailStyle: "glowing-solid",
      cameraMode: "follow-traveler",
      duration: 7,
      arcCurvature: 0.20,
      waypoints: [
        { id: "wp_1", name: "Honolulu", lat: 21.3069, lng: -157.8583, dateOrSub: "Hawaii Hub" },
        { id: "wp_2", name: "Fiji", lat: -17.7134, lng: 178.0650, dateOrSub: "Coral Coast" },
        { id: "wp_3", name: "Auckland", lat: -36.8485, lng: 174.7633, dateOrSub: "New Zealand" },
        { id: "wp_4", name: "Sydney", lat: -33.8688, lng: 151.2093, dateOrSub: "Opera Port" }
      ]
    }
  }
];

// Active Studio State
let currentConfig: MapAnimationConfig = structuredClone(DEFAULT_MAP_CONFIG);
let previewCanvas: HTMLCanvasElement | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
let isPlaying = false;
let playbackProgress = 0.0;
let lastFrameTimestamp = 0;
let animationFrameId: number | null = null;
let isRecording = false;
let isDropPinMode = false;
let mapStudioInitialized = false;

// Undo snapshot for batch operations
let undoBatchSnapshot: any[] | null = null;

/**
 * Initializes the Map Studio modal, event handlers, and listeners
 */
export function initMapStudio() {
  if (mapStudioInitialized) return;
  mapStudioInitialized = true;

  const modal = document.getElementById('map-studio-modal') as HTMLDivElement;
  if (!modal) return;

  previewCanvas = document.getElementById('map-preview-canvas') as HTMLCanvasElement;
  if (previewCanvas) {
    previewCtx = previewCanvas.getContext('2d');
  }

  // Open Buttons
  const openBtn = document.getElementById('open-map-studio-btn');
  const openBtnMobile = document.getElementById('open-map-studio-btn-mobile');
  const addMapShotToolbarBtn = document.getElementById('add-map-shot-toolbar-btn');
  const manualOpenBtn = document.getElementById('manual-open-map-studio-btn');

  const handleOpen = () => openMapStudioModal();

  openBtn?.addEventListener('click', handleOpen);
  openBtnMobile?.addEventListener('click', handleOpen);
  addMapShotToolbarBtn?.addEventListener('click', handleOpen);
  manualOpenBtn?.addEventListener('click', handleOpen);

  // Close Button
  const closeBtn = document.getElementById('close-map-studio-modal-btn');
  closeBtn?.addEventListener('click', () => {
    if (isRecording) {
      if (!window.confirm("A video render is currently in progress. Stop rendering and close?")) return;
    }
    closeMapStudioModal();
  });

  // Modal backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      if (isRecording) {
        notify("Rendering is in progress. Please wait or cancel.", true);
        return;
      }
      closeMapStudioModal();
    }
  });

  // Keyboard Escape listener
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      if (isRecording) {
        notify("Rendering is in progress. Click 'Cancel' to abort.", true);
        return;
      }
      closeMapStudioModal();
    }
  });

  // Studio Tabs
  const tabBuilderBtn = document.getElementById('map-tab-builder-btn');
  const tabAiBtn = document.getElementById('map-tab-ai-btn');
  const panelBuilder = document.getElementById('map-panel-builder');
  const panelAi = document.getElementById('map-panel-ai');

  tabBuilderBtn?.addEventListener('click', () => {
    tabBuilderBtn.className = "px-4 py-2 text-sky-400 border-b-2 border-sky-500 font-semibold transition-all flex items-center gap-1.5 cursor-pointer";
    if (tabAiBtn) tabAiBtn.className = "px-4 py-2 text-gray-400 hover:text-gray-200 transition-all flex items-center gap-1.5 cursor-pointer";
    panelBuilder?.classList.remove('hidden');
    panelAi?.classList.add('hidden');
  });

  tabAiBtn?.addEventListener('click', () => {
    tabAiBtn.className = "px-4 py-2 text-sky-400 border-b-2 border-sky-500 font-semibold transition-all flex items-center gap-1.5 cursor-pointer";
    if (tabBuilderBtn) tabBuilderBtn.className = "px-4 py-2 text-gray-400 hover:text-gray-200 transition-all flex items-center gap-1.5 cursor-pointer";
    panelAi?.classList.remove('hidden');
    panelBuilder?.classList.add('hidden');
  });

  // Play / Pause Button
  const playBtn = document.getElementById('map-play-btn');
  playBtn?.addEventListener('click', () => togglePlayPause());

  // Scrubber Slider
  const scrubber = document.getElementById('map-scrubber') as HTMLInputElement;
  scrubber?.addEventListener('input', (e) => {
    pausePlayback();
    playbackProgress = parseFloat((e.target as HTMLInputElement).value) / 100;
    renderCurrentFrame();
    updateScrubberUI();
  });

  // Theme Selector
  const themeSelect = document.getElementById('map-theme-select') as HTMLSelectElement;
  themeSelect?.addEventListener('change', (e) => {
    currentConfig.theme = (e.target as HTMLSelectElement).value as MapTheme;
    if (currentConfig.theme === 'real-satellite') {
      preloadSatelliteTilesForRoute(currentConfig.waypoints);
    }
    renderCurrentFrame();
  });

  // Tactical Overlay Selector
  const overlaySelect = document.getElementById('map-overlay-select') as HTMLSelectElement;
  overlaySelect?.addEventListener('change', (e) => {
    currentConfig.overlayEffect = (e.target as HTMLSelectElement).value as any;
    renderCurrentFrame();
  });

  // Vehicle / Traveler Icon Selector
  const travelerSelect = document.getElementById('map-traveler-select') as HTMLSelectElement;
  travelerSelect?.addEventListener('change', (e) => {
    currentConfig.travelerIcon = (e.target as HTMLSelectElement).value as TravelerIcon;
    renderCurrentFrame();
  });

  // Camera Mode Selector
  const cameraSelect = document.getElementById('map-camera-select') as HTMLSelectElement;
  cameraSelect?.addEventListener('change', (e) => {
    currentConfig.cameraMode = (e.target as HTMLSelectElement).value as CameraMode;
    renderCurrentFrame();
  });

  // Trail Style Selector
  const trailSelect = document.getElementById('map-trail-select') as HTMLSelectElement;
  trailSelect?.addEventListener('change', (e) => {
    currentConfig.trailStyle = (e.target as HTMLSelectElement).value as TrailStyle;
    renderCurrentFrame();
  });

  // Duration Slider
  const durationSlider = document.getElementById('map-duration-slider') as HTMLInputElement;
  const durationBadge = document.getElementById('map-duration-badge');
  durationSlider?.addEventListener('input', (e) => {
    const dur = Math.max(MIN_MAP_DURATION, Math.min(MAX_MAP_DURATION, parseFloat((e.target as HTMLInputElement).value)));
    currentConfig.duration = dur;
    if (durationBadge) durationBadge.textContent = `${dur}s`;
    updateScrubberUI();
  });

  // Aspect Ratio Selector
  const aspectSelect = document.getElementById('map-aspect-select') as HTMLSelectElement;
  aspectSelect?.addEventListener('change', (e) => {
    currentConfig.aspectRatio = (e.target as HTMLSelectElement).value as '16:9' | '9:16' | '1:1';
    resizeCanvasForAspect();
    renderCurrentFrame();
  });

  // Title and Subtitle Inputs
  const titleInput = document.getElementById('map-title-input') as HTMLInputElement;
  titleInput?.addEventListener('input', (e) => {
    currentConfig.title = (e.target as HTMLInputElement).value;
    renderCurrentFrame();
  });

  const subtitleInput = document.getElementById('map-subtitle-input') as HTMLInputElement;
  subtitleInput?.addEventListener('input', (e) => {
    currentConfig.subtitle = (e.target as HTMLInputElement).value;
    renderCurrentFrame();
  });

  // Toggle Overlays (Graticule, Compass, Coordinates, Sound effects)
  const toggleGrid = document.getElementById('map-toggle-grid') as HTMLInputElement;
  toggleGrid?.addEventListener('change', (e) => {
    currentConfig.showGraticule = (e.target as HTMLInputElement).checked;
    renderCurrentFrame();
  });

  const toggleCompass = document.getElementById('map-toggle-compass') as HTMLInputElement;
  toggleCompass?.addEventListener('change', (e) => {
    currentConfig.showCompass = (e.target as HTMLInputElement).checked;
    renderCurrentFrame();
  });

  const toggleCoords = document.getElementById('map-toggle-coords') as HTMLInputElement;
  toggleCoords?.addEventListener('change', (e) => {
    currentConfig.showCoordinates = (e.target as HTMLInputElement).checked;
    renderCurrentFrame();
  });

  const toggleSfx = document.getElementById('map-toggle-sfx') as HTMLInputElement;
  toggleSfx?.addEventListener('change', (e) => {
    if (!currentConfig.audioConfig) currentConfig.audioConfig = {};
    const checked = (e.target as HTMLInputElement).checked;
    currentConfig.audioConfig.whooshSfx = checked;
    currentConfig.audioConfig.pingSfx = checked;
  });

  const toggleDrone = document.getElementById('map-toggle-drone-audio') as HTMLInputElement;
  toggleDrone?.addEventListener('change', (e) => {
    if (!currentConfig.audioConfig) currentConfig.audioConfig = {};
    currentConfig.audioConfig.ambientDrone = (e.target as HTMLInputElement).checked;
  });

  // Drop Pin Mode Toggle Button
  const dropPinBtn = document.getElementById('map-toggle-drop-pin-btn');
  const dropPinLabel = document.getElementById('map-drop-pin-label');
  dropPinBtn?.addEventListener('click', () => {
    isDropPinMode = !isDropPinMode;
    if (dropPinLabel) {
      dropPinLabel.textContent = isDropPinMode ? "Drop Pin Mode: ACTIVE 📍" : "Drop Pin Mode: Off";
    }
    if (dropPinBtn) {
      dropPinBtn.className = isDropPinMode
        ? "bg-sky-600 text-white border border-sky-400 px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition shadow backdrop-blur-xs cursor-pointer animate-pulse"
        : "bg-gray-900/85 hover:bg-sky-950 text-gray-300 hover:text-sky-300 border border-gray-700/80 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 transition shadow backdrop-blur-xs cursor-pointer";
    }
    const hint = document.getElementById('map-canvas-hint');
    if (hint) {
      hint.textContent = isDropPinMode
        ? "📍 Drop Pin Mode active: Click anywhere on the map to accurately place a waypoint."
        : "💡 Turn on 'Drop Pin Mode' to click and place waypoints anywhere on the globe.";
    }
  });

  // Interactive Click-to-add on canvas
  previewCanvas?.addEventListener('click', (e) => {
    handleCanvasClick(e);
  });

  // Autocomplete Geocoding Search
  setupGeocodingAutocomplete();

  // Add Waypoint Button
  const addWpBtn = document.getElementById('map-add-waypoint-btn');
  addWpBtn?.addEventListener('click', () => {
    addNewWaypointInteractive();
  });

  // Preset Story Chips
  renderPresetChips();

  // AI Script-to-Map Handlers
  setupAiScriptToMap();

  // Export Action Handlers
  setupExportActions();

  // Populate Shot selector for replacement
  refreshShotSelector();

  // Initialize UI controls with initial values
  syncUIFromConfig();
}

/**
 * Autocomplete Geocoder for city search input
 */
function setupGeocodingAutocomplete() {
  const cityInput = document.getElementById('map-new-city-input') as HTMLInputElement;
  const suggestionsContainer = document.getElementById('map-city-suggestions') as HTMLDivElement;
  if (!cityInput || !suggestionsContainer) return;

  let debounceTimer: any = null;

  cityInput.addEventListener('input', () => {
    const q = cityInput.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);

    if (q.length < 2) {
      suggestionsContainer.classList.add('hidden');
      suggestionsContainer.innerHTML = '';
      return;
    }

    debounceTimer = setTimeout(async () => {
      // 1. First check local dictionary for instant results
      const localMatches: Array<{ name: string; country: string; lat: number; lng: number }> = [];
      const lowerQ = q.toLowerCase();

      Object.entries(WORLD_GEO_DB).forEach(([key, data]) => {
        if (key.includes(lowerQ)) {
          localMatches.push({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            country: data.country,
            lat: data.lat,
            lng: data.lng
          });
        }
      });

      // 2. Query geocoding API proxy for global coverage
      let apiMatches: any[] = [];
      try {
        const resp = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (resp.ok) {
          const json = await resp.json();
          if (Array.isArray(json.results)) {
            apiMatches = json.results;
          }
        }
      } catch {}

      // Merge and dedup matches
      const combined = [...localMatches];
      apiMatches.forEach(item => {
        if (!combined.some(c => c.name.toLowerCase() === item.name.toLowerCase())) {
          combined.push({
            name: item.name,
            country: item.country || item.state || '',
            lat: item.lat,
            lng: item.lng
          });
        }
      });

      if (combined.length === 0) {
        suggestionsContainer.innerHTML = `<div class="p-2.5 text-gray-400 text-center">No matching locations found. You can drop a pin on the map.</div>`;
        suggestionsContainer.classList.remove('hidden');
        return;
      }

      suggestionsContainer.innerHTML = '';
      combined.slice(0, 6).forEach(loc => {
        const row = document.createElement('div');
        row.className = "p-2 hover:bg-sky-950/70 hover:text-white text-gray-200 cursor-pointer flex justify-between items-center transition";
        row.innerHTML = `
          <div class="flex items-center gap-1.5">
            <span class="text-sky-400">📍</span>
            <span class="font-medium">${escapeHtml(loc.name)}</span>
            <span class="text-[10px] text-gray-400">(${escapeHtml(loc.country)})</span>
          </div>
          <span class="font-mono text-[10px] text-gray-400">${loc.lat.toFixed(2)}°, ${loc.lng.toFixed(2)}°</span>
        `;
        row.addEventListener('click', () => {
          cityInput.value = loc.name;
          suggestionsContainer.classList.add('hidden');
          addWaypointExplicit(loc.name, loc.lat, loc.lng, loc.country);
        });
        suggestionsContainer.appendChild(row);
      });
      suggestionsContainer.classList.remove('hidden');
    }, 220);
  });

  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!cityInput.contains(e.target as Node) && !suggestionsContainer.contains(e.target as Node)) {
      suggestionsContainer.classList.add('hidden');
    }
  });
}

function addWaypointExplicit(name: string, lat: number, lng: number, note?: string) {
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const clampedLng = Math.max(-180, Math.min(180, lng));

  currentConfig.waypoints.push({
    id: `wp_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    name: name || `Stop ${currentConfig.waypoints.length + 1}`,
    lat: clampedLat,
    lng: clampedLng,
    dateOrSub: note || `Stop ${currentConfig.waypoints.length + 1}`
  });

  const cityInput = document.getElementById('map-new-city-input') as HTMLInputElement;
  if (cityInput) cityInput.value = '';

  renderWaypointListUI();
  renderCurrentFrame();
  notify(`Added stop: ${name}`);
}

/**
 * Opens Map Studio modal and starts live preview
 */
export function openMapStudioModal(targetShotId?: string, initialScriptText?: string) {
  const modal = document.getElementById('map-studio-modal') as HTMLDivElement;
  if (!modal) return;

  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');

  if (targetShotId && state.currentScenes) {
    const existingShot = state.currentScenes.find((s: any) => s.id === targetShotId);
    if (existingShot && existingShot.mapConfig) {
      currentConfig = structuredClone(existingShot.mapConfig);
    }
  }

  if (initialScriptText) {
    const aiTextarea = document.getElementById('map-ai-script-input') as HTMLTextAreaElement;
    if (aiTextarea) {
      aiTextarea.value = initialScriptText;
    }
    const tabAiBtn = document.getElementById('map-tab-ai-btn');
    tabAiBtn?.click();
  }

  resizeCanvasForAspect();
  syncUIFromConfig();
  renderWaypointListUI();
  refreshShotSelector();

  if (targetShotId && state.currentScenes) {
    const select = document.getElementById('map-replace-shot-select') as HTMLSelectElement;
    if (select) {
      const idx = state.currentScenes.findIndex((s: any) => s.id === targetShotId);
      if (idx >= 0) select.value = String(idx);
    }
  }

  playbackProgress = 0.0;
  startPlayback();
}

/**
 * Reopens Map Studio for an existing storyboard shot with its persisted mapConfig
 */
export function openMapStudioForShot(shot: any) {
  if (!shot) return;
  if (shot.mapConfig) {
    currentConfig = structuredClone(shot.mapConfig);
  }
  openMapStudioModal(shot.id);
}

/**
 * Closes Map Studio modal and pauses rendering loop
 */
export function closeMapStudioModal() {
  const modal = document.getElementById('map-studio-modal') as HTMLDivElement;
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('overflow-hidden');
  pausePlayback();
}

/**
 * Synchronizes UI inputs from currentConfig
 */
function syncUIFromConfig() {
  const titleInput = document.getElementById('map-title-input') as HTMLInputElement;
  if (titleInput) titleInput.value = currentConfig.title || '';

  const subtitleInput = document.getElementById('map-subtitle-input') as HTMLInputElement;
  if (subtitleInput) subtitleInput.value = currentConfig.subtitle || '';

  const themeSelect = document.getElementById('map-theme-select') as HTMLSelectElement;
  if (themeSelect) themeSelect.value = currentConfig.theme || 'tactical-dark';

  const overlaySelect = document.getElementById('map-overlay-select') as HTMLSelectElement;
  if (overlaySelect) overlaySelect.value = currentConfig.overlayEffect || 'none';

  const travelerSelect = document.getElementById('map-traveler-select') as HTMLSelectElement;
  if (travelerSelect) travelerSelect.value = currentConfig.travelerIcon || 'plane';

  const cameraSelect = document.getElementById('map-camera-select') as HTMLSelectElement;
  if (cameraSelect) cameraSelect.value = currentConfig.cameraMode || 'follow-traveler';

  const trailSelect = document.getElementById('map-trail-select') as HTMLSelectElement;
  if (trailSelect) trailSelect.value = currentConfig.trailStyle || 'glowing-solid';

  const durationSlider = document.getElementById('map-duration-slider') as HTMLInputElement;
  if (durationSlider) durationSlider.value = String(currentConfig.duration || DEFAULT_MAP_DURATION);

  const durationBadge = document.getElementById('map-duration-badge');
  if (durationBadge) durationBadge.textContent = `${currentConfig.duration || DEFAULT_MAP_DURATION}s`;

  const aspectSelect = document.getElementById('map-aspect-select') as HTMLSelectElement;
  if (aspectSelect) aspectSelect.value = currentConfig.aspectRatio || '16:9';

  const toggleGrid = document.getElementById('map-toggle-grid') as HTMLInputElement;
  if (toggleGrid) toggleGrid.checked = currentConfig.showGraticule !== false;

  const toggleCompass = document.getElementById('map-toggle-compass') as HTMLInputElement;
  if (toggleCompass) toggleCompass.checked = currentConfig.showCompass !== false;

  const toggleCoords = document.getElementById('map-toggle-coords') as HTMLInputElement;
  if (toggleCoords) toggleCoords.checked = currentConfig.showCoordinates !== false;

  const toggleSfx = document.getElementById('map-toggle-sfx') as HTMLInputElement;
  if (toggleSfx) toggleSfx.checked = currentConfig.audioConfig?.whooshSfx !== false;

  const toggleDrone = document.getElementById('map-toggle-drone-audio') as HTMLInputElement;
  if (toggleDrone) toggleDrone.checked = Boolean(currentConfig.audioConfig?.ambientDrone);
}

function resizeCanvasForAspect() {
  if (!previewCanvas) return;
  const ratio = currentConfig.aspectRatio || '16:9';
  let w = 1280;
  let h = 720;

  if (ratio === '9:16') {
    w = 720;
    h = 1280;
  } else if (ratio === '1:1') {
    w = 900;
    h = 900;
  }

  if (previewCanvas.width !== w || previewCanvas.height !== h) {
    previewCanvas.width = w;
    previewCanvas.height = h;
  }
}

function renderCurrentFrame() {
  if (!previewCanvas || !previewCtx) return;
  const timeSec = playbackProgress * (currentConfig.duration || DEFAULT_MAP_DURATION);
  renderMapFrame(previewCtx, previewCanvas.width, previewCanvas.height, playbackProgress, currentConfig, timeSec);
}

function startPlayback() {
  if (isPlaying) return;
  isPlaying = true;
  lastFrameTimestamp = performance.now();

  const playBtnIcon = document.getElementById('map-play-btn-icon');
  if (playBtnIcon) playBtnIcon.textContent = "⏸️";

  function loop(now: number) {
    if (!isPlaying) return;
    const delta = (now - lastFrameTimestamp) / 1000;
    lastFrameTimestamp = now;

    const totalSec = Math.max(MIN_MAP_DURATION, currentConfig.duration || DEFAULT_MAP_DURATION);
    playbackProgress += delta / totalSec;

    if (playbackProgress >= 1.0) {
      playbackProgress = 0.0;
    }

    renderCurrentFrame();
    updateScrubberUI();
    animationFrameId = requestAnimationFrame(loop);
  }

  animationFrameId = requestAnimationFrame(loop);
}

function pausePlayback() {
  isPlaying = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  const playBtnIcon = document.getElementById('map-play-btn-icon');
  if (playBtnIcon) playBtnIcon.textContent = "▶️";
}

function togglePlayPause() {
  if (isPlaying) pausePlayback();
  else startPlayback();
}

function updateScrubberUI() {
  const scrubber = document.getElementById('map-scrubber') as HTMLInputElement;
  if (scrubber) {
    scrubber.value = String(Math.round(playbackProgress * 100));
  }
  const timeDisplay = document.getElementById('map-time-display');
  if (timeDisplay) {
    const curTime = (playbackProgress * (currentConfig.duration || DEFAULT_MAP_DURATION)).toFixed(1);
    const totalTime = (currentConfig.duration || DEFAULT_MAP_DURATION).toFixed(1);
    timeDisplay.textContent = `${curTime}s / ${totalTime}s`;
  }
}

/**
 * Renders the interactive Waypoints List with drag/reorder controls
 */
function renderWaypointListUI() {
  const listContainer = document.getElementById('map-waypoints-list');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  currentConfig.waypoints.forEach((wp, index) => {
    const item = document.createElement('div');
    item.className = "flex items-center gap-2 bg-gray-800/95 border border-gray-700/80 p-2.5 rounded-xl text-xs hover:border-sky-500/50 transition-all";

    // Order number badge
    const badge = document.createElement('div');
    badge.className = "flex items-center justify-center w-6 h-6 rounded-full bg-sky-950 text-sky-400 font-bold border border-sky-500/40 text-[11px] shrink-0";
    badge.textContent = String(index + 1);
    item.appendChild(badge);

    // Form inputs container
    const fieldsGrid = document.createElement('div');
    fieldsGrid.className = "flex-grow grid grid-cols-2 sm:grid-cols-3 gap-2";

    // City Name Input
    const nameCol = document.createElement('div');
    const nameLbl = document.createElement('label');
    nameLbl.className = "block text-[10px] text-gray-400 uppercase font-semibold";
    nameLbl.textContent = "City / Landmark";
    const nameInput = document.createElement('input');
    nameInput.type = "text";
    nameInput.value = wp.name;
    nameInput.className = "w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white focus:ring-1 focus:ring-sky-500 outline-none";
    nameInput.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value.trim();
      wp.name = val;
      const matched = WORLD_GEO_DB[val.toLowerCase()];
      if (matched) {
        wp.lat = matched.lat;
        wp.lng = matched.lng;
        renderWaypointListUI();
      }
      renderCurrentFrame();
    });
    nameCol.appendChild(nameLbl);
    nameCol.appendChild(nameInput);
    fieldsGrid.appendChild(nameCol);

    // Subtitle Input
    const subCol = document.createElement('div');
    const subLbl = document.createElement('label');
    subLbl.className = "block text-[10px] text-gray-400 uppercase font-semibold";
    subLbl.textContent = "Subtitle / Note";
    const subInput = document.createElement('input');
    subInput.type = "text";
    subInput.value = wp.dateOrSub || '';
    subInput.placeholder = "e.g. Stop 1: Departure";
    subInput.className = "w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white focus:ring-1 focus:ring-sky-500 outline-none";
    subInput.addEventListener('change', (e) => {
      wp.dateOrSub = (e.target as HTMLInputElement).value;
      renderCurrentFrame();
    });
    subCol.appendChild(subLbl);
    subCol.appendChild(subInput);
    fieldsGrid.appendChild(subCol);

    // Lat / Lng inputs
    const coordsCol = document.createElement('div');
    coordsCol.className = "col-span-2 sm:col-span-1 flex gap-1";

    const latBox = document.createElement('div');
    latBox.className = "w-1/2";
    const latLbl = document.createElement('label');
    latLbl.className = "block text-[10px] text-gray-400 uppercase font-semibold";
    latLbl.textContent = "Lat";
    const latInput = document.createElement('input');
    latInput.type = "number";
    latInput.step = "0.01";
    latInput.value = wp.lat.toFixed(2);
    latInput.className = "w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-white font-mono focus:ring-1 focus:ring-sky-500 outline-none text-[11px]";
    latInput.addEventListener('change', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) {
        wp.lat = Math.max(-85, Math.min(85, v));
        renderCurrentFrame();
      }
    });
    latBox.appendChild(latLbl);
    latBox.appendChild(latInput);

    const lngBox = document.createElement('div');
    lngBox.className = "w-1/2";
    const lngLbl = document.createElement('label');
    lngLbl.className = "block text-[10px] text-gray-400 uppercase font-semibold";
    lngLbl.textContent = "Lng";
    const lngInput = document.createElement('input');
    lngInput.type = "number";
    lngInput.step = "0.01";
    lngInput.value = wp.lng.toFixed(2);
    lngInput.className = "w-full bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-white font-mono focus:ring-1 focus:ring-sky-500 outline-none text-[11px]";
    lngInput.addEventListener('change', (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) {
        wp.lng = Math.max(-180, Math.min(180, v));
        renderCurrentFrame();
      }
    });
    lngBox.appendChild(lngLbl);
    lngBox.appendChild(lngInput);

    coordsCol.appendChild(latBox);
    coordsCol.appendChild(lngBox);
    fieldsGrid.appendChild(coordsCol);

    item.appendChild(fieldsGrid);

    // Action Buttons (Move Up, Move Down, Delete)
    const actions = document.createElement('div');
    actions.className = "flex items-center gap-1 shrink-0";

    if (index > 0) {
      const upBtn = document.createElement('button');
      upBtn.type = "button";
      upBtn.className = "text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition cursor-pointer text-xs";
      upBtn.title = "Move Up";
      upBtn.textContent = "▲";
      upBtn.addEventListener('click', () => {
        const temp = currentConfig.waypoints[index - 1];
        currentConfig.waypoints[index - 1] = currentConfig.waypoints[index];
        currentConfig.waypoints[index] = temp;
        renderWaypointListUI();
        renderCurrentFrame();
      });
      actions.appendChild(upBtn);
    }

    if (index < currentConfig.waypoints.length - 1) {
      const downBtn = document.createElement('button');
      downBtn.type = "button";
      downBtn.className = "text-gray-400 hover:text-white p-1 hover:bg-gray-700 rounded transition cursor-pointer text-xs";
      downBtn.title = "Move Down";
      downBtn.textContent = "▼";
      downBtn.addEventListener('click', () => {
        const temp = currentConfig.waypoints[index + 1];
        currentConfig.waypoints[index + 1] = currentConfig.waypoints[index];
        currentConfig.waypoints[index] = temp;
        renderWaypointListUI();
        renderCurrentFrame();
      });
      actions.appendChild(downBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = "button";
    delBtn.className = "text-red-400 hover:text-red-300 p-1 hover:bg-red-950/40 rounded transition cursor-pointer text-xs";
    delBtn.title = "Delete Stop";
    delBtn.textContent = "✕";
    delBtn.addEventListener('click', () => {
      if (currentConfig.waypoints.length <= 1) {
        notify("At least one waypoint is required.", true);
        return;
      }
      currentConfig.waypoints.splice(index, 1);
      renderWaypointListUI();
      renderCurrentFrame();
    });
    actions.appendChild(delBtn);

    item.appendChild(actions);
    listContainer.appendChild(item);
  });
}

/**
 * Handles adding a new waypoint interactively via text input
 */
async function addNewWaypointInteractive() {
  const cityInput = document.getElementById('map-new-city-input') as HTMLInputElement;
  const cityName = (cityInput?.value || '').trim();

  if (!cityName) {
    notify("Please enter a city or location name to add.", true);
    return;
  }

  // 1. Check local DB
  const found = WORLD_GEO_DB[cityName.toLowerCase()];
  if (found) {
    addWaypointExplicit(cityName.charAt(0).toUpperCase() + cityName.slice(1), found.lat, found.lng, found.country);
    return;
  }

  // 2. Query Geocode API
  try {
    const resp = await fetch(`/api/geocode?q=${encodeURIComponent(cityName)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        const best = data.results[0];
        addWaypointExplicit(best.name, best.lat, best.lng, best.country);
        return;
      }
    }
  } catch {}

  // 3. Never fabricate fake coords
  notify(`Couldn't find "${cityName}". Choose a suggestion or drop a pin on the map.`, true);
}

/**
 * Click on canvas to drop or adjust waypoint through active camera transform
 */
async function handleCanvasClick(e: MouseEvent) {
  if (!previewCanvas) return;
  if (!isDropPinMode) {
    return;
  }

  const rect = previewCanvas.getBoundingClientRect();
  const clickX = ((e.clientX - rect.left) / rect.width) * previewCanvas.width;
  const clickY = ((e.clientY - rect.top) / rect.height) * previewCanvas.height;

  const { segments, totalDistanceKm } = solveJourneySegments(currentConfig.waypoints);
  const camera = computeCameraTransform(playbackProgress, currentConfig, segments, totalDistanceKm, previewCanvas.width, previewCanvas.height);

  // Invert Mercator projection through current camera center & zoom
  const geo = canvasToGeo(clickX, clickY, previewCanvas.width, previewCanvas.height, camera);
  const clampedLat = Math.max(-85, Math.min(85, geo.lat));
  const clampedLng = Math.max(-180, Math.min(180, geo.lng));

  // Reverse geocode or find nearby landmark (tight threshold <= 1.5 degrees)
  let locationName = `Point (${clampedLat.toFixed(2)}°, ${clampedLng.toFixed(2)}°)`;
  let locationNote = `Stop ${currentConfig.waypoints.length + 1}`;

  let minDiff = 1.5;
  Object.entries(WORLD_GEO_DB).forEach(([cName, data]) => {
    const diff = Math.hypot(data.lat - clampedLat, data.lng - clampedLng);
    if (diff < minDiff) {
      minDiff = diff;
      locationName = cName.charAt(0).toUpperCase() + cName.slice(1);
      locationNote = data.country;
    }
  });

  // Query reverse geocoding API in background to refine name
  fetch(`/api/geocode/reverse?lat=${clampedLat}&lng=${clampedLng}`)
    .then(r => r.json())
    .then(data => {
      if (data && data.name && !data.name.startsWith('Location (')) {
        const wp = currentConfig.waypoints.find(w => Math.abs(w.lat - clampedLat) < 0.01 && Math.abs(w.lng - clampedLng) < 0.01);
        if (wp) {
          wp.name = data.name;
          if (data.country) wp.dateOrSub = data.country;
          renderWaypointListUI();
          renderCurrentFrame();
        }
      }
    })
    .catch(() => {});

  addWaypointExplicit(locationName, clampedLat, clampedLng, locationNote);
}

/**
 * Renders Preset Story Chips with deep cloning to prevent shared mutation
 */
function renderPresetChips() {
  const container = document.getElementById('map-preset-chips');
  if (!container) return;

  container.innerHTML = '';

  PRESET_MAP_STORIES.forEach(preset => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = "flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 hover:text-white px-2.5 py-1.5 rounded-lg border border-gray-700/60 transition text-xs cursor-pointer";
    chip.innerHTML = `<span>${preset.icon}</span><span class="font-medium">${preset.name}</span>`;

    chip.addEventListener('click', () => {
      const p = structuredClone(preset.config);
      currentConfig = {
        ...structuredClone(DEFAULT_MAP_CONFIG),
        ...p
      } as MapAnimationConfig;

      if (currentConfig.theme === 'real-satellite') {
        preloadSatelliteTilesForRoute(currentConfig.waypoints);
      }

      syncUIFromConfig();
      renderWaypointListUI();
      renderCurrentFrame();
      playbackProgress = 0.0;
      notify(`Loaded preset: ${preset.name}`);
    });

    container.appendChild(chip);
  });
}

/**
 * Script templates for documentary and narrative map stories
 */
const MAP_SCRIPT_TEMPLATES: Record<string, { label: string; script: string }> = {
  'silk-road': {
    label: "Silk Road Caravan Expedition",
    script: `Scene 1: The ancient trade caravan departs from Chang'an, loaded with fine silk, jade, and porcelain.
Scene 2: Venturing west into the Taklamakan Desert, the merchants rest and resupply at the oasis city of Dunhuang.
Scene 3: Crossing high mountain passes, the expedition reaches the grand Silk Road hub of Samarkand.
Scene 4: Traversed through ancient Persia to Tabriz, trading precious spices, textiles, and lapis lazuli.
Scene 5: The long journey concludes at the bustling waterfront markets and harbors of Constantinople.`
  },
  'apollo-11': {
    label: "Apollo 11 Moonshot",
    script: `Scene 1: On July 16, 1969, the Saturn V rocket lifts off from Cape Canaveral on a historic voyage.
Scene 2: Mission Control in Houston coordinates the orbital burn as the spacecraft departs Earth orbit.
Scene 3: Trans-lunar injection propels the crew across 240,000 miles of deep space toward the Moon.
Scene 4: The Lunar Module Eagle descends and touches down on the basalt plains of the Sea of Tranquility.
Scene 5: Returning safely to Earth, the crew splashes down in the Pacific Ocean south of Hawaii.`
  },
  'pacific-crossing': {
    label: "Pacific Aviator Crossing",
    script: `Scene 1: The twin-engine aircraft takes off from San Francisco, climbing over the Golden Gate into the morning fog.
Scene 2: After a grueling ten-hour ocean leg, the pilots land for fuel in Honolulu, Hawaii.
Scene 3: Flying southwest over boundless open ocean, the plane navigates stormy squalls to touch down in Suva, Fiji.
Scene 4: Final approach over Moreton Bay as the crew touches down in Brisbane, Australia, completing the trans-Pacific flight.`
  },
  'magellan': {
    label: "Magellan Global Circumnavigation",
    script: `Scene 1: In September 1519, five galleons set sail from Seville, Spain, seeking a western route to the Spice Islands.
Scene 2: Crossing the stormy Atlantic, the fleet replenishes provisions at Guanabara Bay in Rio de Janeiro.
Scene 3: Navigating treacherous freezing winds, the expedition threads the perilous Strait of Magellan into the Pacific Ocean.
Scene 4: Sailing across thousands of miles of unknown waters, the surviving crew arrives in Cebu, Philippines.
Scene 5: After three perilous years around Africa's Cape, the lone ship Victoria returns to Sanlúcar de Barrameda, completing the first circumnavigation.`
  },
  'orient-express': {
    label: "Classic Orient Express Journey",
    script: `Scene 1: Steam billows along the platform as the luxury express train departs Paris Gare de l'Est in the evening mist.
Scene 2: Whistling through central Europe, the train pauses amidst the imperial architecture of Vienna.
Scene 3: Crossing the Danube River, passengers disembark briefly in the illuminated night of Budapest.
Scene 4: Gliding past the dramatic Balkan mountain ranges through Sofia.
Scene 5: The locomotive pulls to a triumphant stop at Sirkeci Station on the Golden Horn in Istanbul.`
  },
  'amazon-expedition': {
    label: "Amazon River Basin Exploration",
    script: `Scene 1: The scientific survey begins in the cloud forests of Cusco near the glacial headwaters of the Andes.
Scene 2: Boarding riverboats, the team navigates through the dense jungle corridors of Iquitos, Peru.
Scene 3: Arriving at Manaus, Brazil, where the dark Rio Negro merges with the sandy Amazon in the famous meeting of waters.
Scene 4: The expedition emerges onto the broad delta and mangrove channels of Belém before emptying into the Atlantic Ocean.`
  }
};

/**
 * Sets up AI Script-to-Map Story Auto-Extractor
 */
function setupAiScriptToMap() {
  const extractBtn = document.getElementById('map-ai-extract-btn');
  const pullScriptBtn = document.getElementById('map-ai-pull-script-btn');
  const scriptInput = document.getElementById('map-ai-script-input') as HTMLTextAreaElement;
  const aiStatus = document.getElementById('map-ai-status');
  const templateSelect = document.getElementById('map-ai-template-select') as HTMLSelectElement;

  const applyTemplate = (key: string) => {
    const template = MAP_SCRIPT_TEMPLATES[key];
    if (template && scriptInput) {
      scriptInput.value = template.script.trim();
      notify(`Loaded "${template.label}" template!`);
      if (templateSelect) templateSelect.value = key;
    }
  };

  templateSelect?.addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value;
    if (key) applyTemplate(key);
  });

  document.querySelectorAll<HTMLButtonElement>('.map-template-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const templateKey = pill.getAttribute('data-template');
      if (templateKey) applyTemplate(templateKey);
    });
  });

  pullScriptBtn?.addEventListener('click', () => {
    if (!state.currentScenes || state.currentScenes.length === 0) {
      notify("No storyboard scenes exist yet in current project.", true);
      return;
    }
    const fullScript = state.currentScenes.map((s, i) => `Scene ${i + 1}: ${s.line_text || s.description || ''}`).join('\n');
    if (scriptInput) {
      scriptInput.value = fullScript;
      if (templateSelect) templateSelect.value = "";
      notify("Pulled storyboard script!");
    }
  });

  // Extract Route using Gemini AI
  extractBtn?.addEventListener('click', async () => {
    const text = (scriptInput?.value || '').trim();
    if (!text) {
      notify("Please enter or paste a story or script excerpt.", true);
      return;
    }

    if (aiStatus) {
      aiStatus.classList.remove('hidden');
      aiStatus.textContent = "⚡ AI analyzing story text and extracting geographic route...";
    }
    extractBtn.setAttribute('disabled', 'true');

    try {
      const prompt = `You are a cinematic map animation director for documentaries (like Vox, Johnny Harris, National Geographic).
Analyze this story/script and extract the geographical journey / route.

SCRIPT:
"""
${text}
"""

Return a valid JSON object matching this schema:
{
  "title": "Short punchy title for map header (max 5 words, e.g. 'THE APOLLO 11 JOURNEY')",
  "subtitle": "Short context or date (e.g. 'July 16-24, 1969')",
  "theme": "one of: tactical-dark, vintage-parchment, satellite-earth, editorial-minimal, cyber-hologram",
  "travelerIcon": "one of: plane, ship, car, train, foot, pin, target, rocket",
  "duration": number (suggested seconds between 5 and 12),
  "waypoints": [
    {
      "name": "City or Location Name",
      "lat": number (accurate latitude),
      "lng": number (accurate longitude),
      "dateOrSub": "Short milestone note or date (e.g. 'Launch Site', 'Stop 1')"
    }
  ]
}

Provide at least 2 to 6 chronological waypoints. Output pure JSON only.`;

      const response = await generateContentWithFallback({
        contents: prompt,
        mimeType: 'application/json'
      });

      let jsonStr = response.text || '';
      jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();

      const extracted = JSON.parse(jsonStr);

      if (extracted && Array.isArray(extracted.waypoints) && extracted.waypoints.length > 0) {
        currentConfig.title = extracted.title || "MAP JOURNEY";
        currentConfig.subtitle = extracted.subtitle || "";

        const validThemes: MapTheme[] = ['tactical-dark', 'vintage-parchment', 'satellite-earth', 'editorial-minimal', 'cyber-hologram', 'real-satellite'];
        currentConfig.theme = validThemes.includes(extracted.theme) ? extracted.theme : "tactical-dark";

        const validIcons: TravelerIcon[] = ['plane', 'ship', 'car', 'train', 'foot', 'pin', 'target', 'rocket'];
        currentConfig.travelerIcon = validIcons.includes(extracted.travelerIcon) ? extracted.travelerIcon : "plane";

        currentConfig.duration = Math.max(MIN_MAP_DURATION, Math.min(MAX_MAP_DURATION, Number(extracted.duration) || DEFAULT_MAP_DURATION));

        currentConfig.waypoints = extracted.waypoints.map((wp: any, i: number) => {
          let lat = Number(wp.lat) || 0;
          let lng = Number(wp.lng) || 0;

          // Cross check against database for coordinate accuracy
          const matched = WORLD_GEO_DB[String(wp.name || '').trim().toLowerCase()];
          if (matched) {
            lat = matched.lat;
            lng = matched.lng;
          }

          return {
            id: `wp_${Date.now()}_${i}`,
            name: wp.name || `Point ${i + 1}`,
            lat: Math.max(-85, Math.min(85, lat)),
            lng: Math.max(-180, Math.min(180, lng)),
            dateOrSub: wp.dateOrSub || ""
          };
        });

        syncUIFromConfig();
        renderWaypointListUI();
        renderCurrentFrame();
        playbackProgress = 0.0;

        document.getElementById('map-tab-builder-btn')?.click();
        notify(`AI extracted ${currentConfig.waypoints.length} route stops!`);
      } else {
        throw new Error("No waypoints extracted");
      }
    } catch (err: any) {
      console.warn("Gemini map extraction failed, using story-order local extraction:", err);

      // Extract dictionary matches sorted by position in script text
      const hits: { idx: number; name: string; d: { lat: number; lng: number; country: string } }[] = [];
      for (const [name, d] of Object.entries(WORLD_GEO_DB)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = new RegExp(`\\b${escaped}\\b`, 'i').exec(text);
        if (m) hits.push({ idx: m.index, name, d });
      }
      hits.sort((a, b) => a.idx - b.idx);

      if (hits.length >= 2) {
        currentConfig.waypoints = hits.slice(0, 6).map((h, i) => ({
          id: `wp_${Date.now()}_${i}`,
          name: h.name.charAt(0).toUpperCase() + h.name.slice(1),
          lat: h.d.lat,
          lng: h.d.lng,
          dateOrSub: h.d.country
        }));
        currentConfig.title = "STORY ROUTE";
        currentConfig.subtitle = "Extracted Journey";
        syncUIFromConfig();
        renderWaypointListUI();
        renderCurrentFrame();
        document.getElementById('map-tab-builder-btn')?.click();
        notify(`Extracted ${hits.length} locations in story order!`);
      } else {
        notify("Could not find locations in script. Please add waypoints manually.", true);
      }
    } finally {
      if (aiStatus) aiStatus.classList.add('hidden');
      extractBtn.removeAttribute('disabled');
    }
  });

  // Batch Multi-Scene Map Storyboard Generator
  const batchAiStoryboardBtn = document.getElementById('map-ai-batch-storyboard-btn');
  batchAiStoryboardBtn?.addEventListener('click', async () => {
    if (isRecording) return;
    const text = (scriptInput?.value || '').trim();
    if (!text && (!state.currentScenes || state.currentScenes.length === 0)) {
      notify("Please enter a story script or click 'Pull Current Project Script' first.", true);
      return;
    }

    const scriptToAnalyze = text || state.currentScenes.map((s, i) => `Scene ${i + 1}: ${s.line_text || s.description || ''}`).join('\n');

    if (aiStatus) {
      aiStatus.classList.remove('hidden');
      aiStatus.textContent = "⚡ AI analyzing scenes and calculating individual route legs...";
    }
    batchAiStoryboardBtn.setAttribute('disabled', 'true');

    try {
      const hasExistingScenes = state.currentScenes && state.currentScenes.length > 0;
      const sceneCount = hasExistingScenes ? state.currentScenes.length : 3;

      const scenesContext = hasExistingScenes
        ? state.currentScenes.map((s, i) => `Scene ${i + 1} (${s.duration_seconds || 6}s): "${s.line_text || s.description || ''}"`).join('\n')
        : scriptToAnalyze;

      const prompt = `You are a documentary map director for Vox / Johnny Harris style videos.
Analyze this script and break down the geographical route across ${sceneCount} storyboard scenes.
Each scene must have its own travel leg (departure and arrival locations with accurate lat/lng coordinates).

SCRIPT / SCENES:
"""
${scenesContext}
"""

Return a valid JSON object matching this schema:
{
  "theme": "one of: tactical-dark, vintage-parchment, satellite-earth, editorial-minimal, cyber-hologram",
  "travelerIcon": "one of: plane, ship, car, train, foot, pin, target, rocket",
  "legs": [
    {
      "sceneIndex": 0,
      "from": { "name": "City A", "lat": 40.71, "lng": -74.00 },
      "to": { "name": "City B", "lat": 51.50, "lng": -0.12 },
      "title": "City A → City B",
      "subtitle": "Short context for this leg (e.g. 'Transatlantic Crossing')"
    }
  ]
}

Provide exactly ${sceneCount} chronological legs. Output pure JSON only.`;

      const response = await generateContentWithFallback({
        contents: prompt,
        mimeType: 'application/json'
      });

      let jsonStr = response.text || '';
      jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
      const extracted = JSON.parse(jsonStr);

      let legsToRender: RouteLeg[] = [];

      if (extracted && Array.isArray(extracted.legs) && extracted.legs.length > 0) {
        if (extracted.theme) currentConfig.theme = extracted.theme as MapTheme;
        if (extracted.travelerIcon) currentConfig.travelerIcon = extracted.travelerIcon as TravelerIcon;
        syncUIFromConfig();

        legsToRender = extracted.legs.map((leg: any, idx: number) => {
          const fromWp: MapWaypoint = {
            id: `ai_wp_from_${idx}`,
            name: leg.from?.name || `Stop ${idx + 1}`,
            lat: Math.max(-85, Math.min(85, Number(leg.from?.lat) || 0)),
            lng: Math.max(-180, Math.min(180, Number(leg.from?.lng) || 0)),
            dateOrSub: `Origin`
          };
          const toWp: MapWaypoint = {
            id: `ai_wp_to_${idx}`,
            name: leg.to?.name || `Stop ${idx + 2}`,
            lat: Math.max(-85, Math.min(85, Number(leg.to?.lat) || 0)),
            lng: Math.max(-180, Math.min(180, Number(leg.to?.lng) || 0)),
            dateOrSub: `Destination`
          };
          return {
            fromWaypoint: fromWp,
            toWaypoint: toWp,
            waypoints: [fromWp, toWp],
            title: leg.title || `${fromWp.name} → ${toWp.name}`,
            subtitle: leg.subtitle || `Leg ${idx + 1}`
          };
        });
      } else {
        throw new Error("No legs parsed from AI");
      }

      await executeBatchMapLegs(legsToRender, {
        isNewStoryboard: !hasExistingScenes,
        onProgress: (msg) => {
          if (aiStatus) aiStatus.textContent = msg;
        }
      });
    } catch (err) {
      console.warn("AI scene legs generation fallback to great-circle partitioning:", err);
      const hasExistingScenes = state.currentScenes && state.currentScenes.length > 0;
      const targetCount = hasExistingScenes ? state.currentScenes.length : Math.max(1, currentConfig.waypoints.length - 1);
      const legs = partitionWaypointsIntoLegs(currentConfig.waypoints, targetCount);
      await executeBatchMapLegs(legs, { isNewStoryboard: !hasExistingScenes });
    } finally {
      if (aiStatus) aiStatus.classList.add('hidden');
      batchAiStoryboardBtn.removeAttribute('disabled');
    }
  });
}

export interface RouteLeg {
  fromWaypoint: MapWaypoint;
  toWaypoint: MapWaypoint;
  waypoints: MapWaypoint[];
  title: string;
  subtitle: string;
}

let cancelBatchRequested = false;

/**
 * Partitions waypoints along true Great-Circle arc path
 */
export function partitionWaypointsIntoLegs(waypoints: MapWaypoint[], targetCount: number): RouteLeg[] {
  if (waypoints.length < 2) {
    const base = waypoints[0] || { name: "Origin", lat: 40.7128, lng: -74.0060, dateOrSub: "Start" };
    waypoints = [
      base,
      { id: 'wp_auto_dest', name: "Destination", lat: base.lat + 8.14, lng: base.lng + 14.5, dateOrSub: "Arrival" }
    ];
  }

  const legs: RouteLeg[] = [];

  // Exact match
  if (targetCount === waypoints.length - 1) {
    for (let i = 0; i < targetCount; i++) {
      const fromWp = waypoints[i];
      const toWp = waypoints[i + 1];
      legs.push({
        fromWaypoint: fromWp,
        toWaypoint: toWp,
        waypoints: [fromWp, toWp],
        title: `${fromWp.name} → ${toWp.name}`,
        subtitle: `Leg ${i + 1} of ${targetCount}`
      });
    }
    return legs;
  }

  // Fewer scenes than waypoints: group slices
  if (targetCount < waypoints.length - 1) {
    for (let i = 0; i < targetCount; i++) {
      const startIdx = Math.floor((i * (waypoints.length - 1)) / targetCount);
      const endIdx = Math.max(startIdx + 1, Math.floor(((i + 1) * (waypoints.length - 1)) / targetCount));
      const slice = waypoints.slice(startIdx, endIdx + 1);
      const fromWp = slice[0];
      const toWp = slice[slice.length - 1];
      legs.push({
        fromWaypoint: fromWp,
        toWaypoint: toWp,
        waypoints: slice,
        title: `${fromWp.name} → ${toWp.name}`,
        subtitle: `Leg ${i + 1} of ${targetCount}${slice.length > 2 ? ` (${slice.length - 2} stops)` : ''}`
      });
    }
    return legs;
  }

  // More scenes than waypoints: interpolate along great circle
  const { segments, totalDistanceKm } = solveJourneySegments(waypoints);
  for (let i = 0; i < targetCount; i++) {
    const fStart = i / targetCount;
    const fEnd = (i + 1) / targetCount;

    const startSeg = computeTravelerPosition(fStart, segments, totalDistanceKm);
    const endSeg = computeTravelerPosition(fEnd, segments, totalDistanceKm);

    const fromWp: MapWaypoint = {
      id: `leg_start_${i}`,
      name: `Leg ${i + 1} Origin`,
      lat: Number(startSeg.lat.toFixed(2)),
      lng: Number(startSeg.lng.toFixed(2)),
      dateOrSub: `Stop ${i + 1}`
    };

    const toWp: MapWaypoint = {
      id: `leg_end_${i}`,
      name: `Leg ${i + 1} Target`,
      lat: Number(endSeg.lat.toFixed(2)),
      lng: Number(endSeg.lng.toFixed(2)),
      dateOrSub: `Stop ${i + 2}`
    };

    legs.push({
      fromWaypoint: fromWp,
      toWaypoint: toWp,
      waypoints: [fromWp, toWp],
      title: `${fromWp.name} → ${toWp.name}`,
      subtitle: `Leg ${i + 1} of ${targetCount}`
    });
  }

  return legs;
}

/**
 * Sequentially renders each route leg and applies the animated map video to each storyboard scene
 */
async function executeBatchMapLegs(
  legs: RouteLeg[],
  options?: { isNewStoryboard?: boolean; onProgress?: (msg: string) => void }
) {
  if (isRecording) return;

  // Snapshot existing scenes for Undo support
  undoBatchSnapshot = state.currentScenes ? structuredClone(state.currentScenes) : [];

  isRecording = true;
  cancelBatchRequested = false;
  pausePlayback();

  const progressBadge = document.getElementById('map-render-progress-badge');
  const cancelBtn = document.getElementById('map-batch-cancel-btn');
  const undoBtn = document.getElementById('map-undo-batch-btn');
  const formatSelect = document.getElementById('map-export-format-select') as HTMLSelectElement;
  const exportFormat = (formatSelect?.value === 'webm' ? 'webm' : 'mp4') as 'mp4' | 'webm';

  setControlsDisabled(true);

  if (progressBadge) {
    progressBadge.classList.remove('hidden');
    progressBadge.textContent = `🎬 Initializing deterministic render of ${legs.length} map scenes...`;
  }
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  const isNew = options?.isNewStoryboard || !state.currentScenes || state.currentScenes.length === 0;
  if (isNew && !state.currentScenes) {
    state.currentScenes = [];
  }

  let completedCount = 0;

  try {
    for (let i = 0; i < legs.length; i++) {
      if (cancelBatchRequested) {
        notify(`Batch generation stopped. Rendered ${completedCount} of ${legs.length} scenes.`);
        break;
      }

      const leg = legs[i];
      const targetShot = !isNew && state.currentScenes && state.currentScenes[i] ? state.currentScenes[i] : null;
      const legDuration = targetShot?.duration_seconds || currentConfig.duration || DEFAULT_MAP_DURATION;

      const legConfig: MapAnimationConfig = {
        ...currentConfig,
        title: leg.title,
        subtitle: leg.subtitle,
        duration: legDuration,
        waypoints: leg.waypoints
      };

      const updateProgress = (shotPct: number) => {
        const overall = Math.round(((i + shotPct / 100) / legs.length) * 100);
        const msg = `Scene ${i + 1}/${legs.length}: ${leg.title} (${shotPct}% | Total ${overall}%)`;
        if (progressBadge) progressBadge.textContent = `🎬 ${msg}`;
        if (options?.onProgress) options.onProgress(msg);
      };

      updateProgress(0);

      const result = await exportMapVideoDeterministic(legConfig, {
        format: exportFormat,
        onProgress: updateProgress
      });

      // Revoke old object URL if replacing
      if (targetShot && targetShot._videoObjectURL) {
        try { URL.revokeObjectURL(targetShot._videoObjectURL); } catch {}
      }

      // Store in IndexedDB
      const videoAssetId = await assetStorage.storeAsset(result.blob, 'video', 'current_project');
      const posterBlob = await (await fetch(result.posterDataUrl)).blob();
      const posterAssetId = await assetStorage.storeAsset(posterBlob, 'image', 'current_project');

      if (targetShot) {
        // Cleanup superseded assets
        if (targetShot.video_id) try { await assetStorage.deleteAsset(targetShot.video_id); } catch {}
        if (targetShot.image_id) try { await assetStorage.deleteAsset(targetShot.image_id); } catch {}

        safelyReplaceShotMedia(targetShot, result.blob, 'video');
        safelyReplaceShotMedia(targetShot, posterBlob, 'image');
        targetShot.video_id = videoAssetId;
        targetShot.image_id = posterAssetId;
        targetShot.duration_seconds = legDuration;
        targetShot.videoDuration = legDuration;
        targetShot.videoStartOffset = 0;
        targetShot.mapConfig = structuredClone(legConfig);
      } else {
        const newShotId = `shot_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`;
        const newShot: any = {
          id: newShotId,
          shot_number: (state.currentScenes?.length || 0) + 1,
          duration_seconds: legDuration,
          line_text: `${leg.title}: ${leg.subtitle}`,
          text_reference: `${leg.title}: ${leg.subtitle}`,
          description: `Animated map journey: ${leg.fromWaypoint.name} → ${leg.toWaypoint.name}`,
          camera_movement: 'static',
          video_id: videoAssetId,
          image_id: posterAssetId,
          _videoObjectURL: result.objectUrl,
          _imageObjectURL: result.posterDataUrl,
          videoDuration: legDuration,
          videoStartOffset: 0,
          mapConfig: structuredClone(legConfig)
        };
        state.currentScenes.push(newShot);
      }

      completedCount++;
    }

    if (state.currentScenes && state.currentScenes.length > 0) {
      renderResults(state.currentScenes);
      updateVideoContext();
      await saveVersion(false);

      if (undoBtn) undoBtn.classList.remove('hidden');

      notify(`🎉 Applied animated map legs to ${completedCount} storyboard scenes!`, false, 6000, {
        label: "↩️ Undo Map Batch",
        onClick: () => handleUndoBatch()
      });
      closeMapStudioModal();
    }
  } catch (err: any) {
    console.error("Batch map rendering failed:", err);
    notify(`Failed during batch map render: ${err.message}`, true);
  } finally {
    isRecording = false;
    cancelBatchRequested = false;
    setControlsDisabled(false);
    if (progressBadge) progressBadge.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }
}

function handleUndoBatch() {
  if (!undoBatchSnapshot) {
    notify("No batch operation to undo.", true);
    return;
  }
  state.currentScenes = structuredClone(undoBatchSnapshot);
  undoBatchSnapshot = null;
  renderResults(state.currentScenes);
  updateVideoContext();
  saveVersion(false);
  const undoBtn = document.getElementById('map-undo-batch-btn');
  if (undoBtn) undoBtn.classList.add('hidden');
  notify("Restored storyboard scenes from before map batch.");
}

function setControlsDisabled(disabled: boolean) {
  const inputs = document.querySelectorAll('#map-studio-modal input, #map-studio-modal select, #map-studio-modal button:not(#map-batch-cancel-btn)');
  inputs.forEach(el => {
    if (disabled) el.setAttribute('disabled', 'true');
    else el.removeAttribute('disabled');
  });
}

/**
 * Sets up Export and Storyboard Integration Actions
 */
function setupExportActions() {
  const addShotBtn = document.getElementById('map-action-add-shot');
  const replaceShotBtn = document.getElementById('map-action-replace-shot');
  const batchAllShotsBtn = document.getElementById('map-action-batch-all-shots');
  const cancelBtn = document.getElementById('map-batch-cancel-btn');
  const undoBtn = document.getElementById('map-undo-batch-btn');
  const downloadVideoBtn = document.getElementById('map-action-download-video');
  const downloadSnapshotBtn = document.getElementById('map-action-download-snapshot');
  const attachCalloutBtn = document.getElementById('map-action-attach-callout');
  const progressBadge = document.getElementById('map-render-progress-badge');
  const formatSelect = document.getElementById('map-export-format-select') as HTMLSelectElement;

  cancelBtn?.addEventListener('click', () => {
    cancelBatchRequested = true;
    notify("Stopping batch generation after current scene...");
  });

  undoBtn?.addEventListener('click', () => {
    handleUndoBatch();
  });

  // 1. Batch Apply Route Legs to All Scenes
  batchAllShotsBtn?.addEventListener('click', async () => {
    if (isRecording) return;
    if (!currentConfig.waypoints || currentConfig.waypoints.length < 2) {
      notify("Please ensure at least 2 waypoints exist in the route to create legs.", true);
      return;
    }

    const hasExistingScenes = state.currentScenes && state.currentScenes.length > 0;
    const targetCount = hasExistingScenes ? state.currentScenes.length : Math.max(1, currentConfig.waypoints.length - 1);

    if (hasExistingScenes) {
      const confirmed = window.confirm(
        `Apply route legs across all ${state.currentScenes.length} scenes in your storyboard?\nEach scene will receive its respective animated journey leg matching its duration.`
      );
      if (!confirmed) return;
    }

    const legs = partitionWaypointsIntoLegs(currentConfig.waypoints, targetCount);
    await executeBatchMapLegs(legs, { isNewStoryboard: !hasExistingScenes });
  });

  // 2. Add as 1 Single New Scene Shot to Storyboard
  addShotBtn?.addEventListener('click', async () => {
    if (isRecording) return;
    isRecording = true;
    pausePlayback();
    setControlsDisabled(true);

    if (progressBadge) {
      progressBadge.classList.remove('hidden');
      progressBadge.textContent = "🎬 Encoding map video 0%...";
    }

    try {
      const exportFormat = (formatSelect?.value === 'webm' ? 'webm' : 'mp4') as 'mp4' | 'webm';

      const result = await exportMapVideoDeterministic(currentConfig, {
        format: exportFormat,
        onProgress: (pct) => {
          if (progressBadge) progressBadge.textContent = `🎬 Encoding map video ${pct}%...`;
        }
      });

      const videoAssetId = await assetStorage.storeAsset(result.blob, 'video', 'current_project');
      const posterBlob = await (await fetch(result.posterDataUrl)).blob();
      const posterAssetId = await assetStorage.storeAsset(posterBlob, 'image', 'current_project');

      const newShotId = `shot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const shotTitle = currentConfig.title || "Map Animation";
      const shotSubtitle = currentConfig.subtitle ? ` — ${currentConfig.subtitle}` : "";

      const newShot: any = {
        id: newShotId,
        shot_number: (state.currentScenes?.length || 0) + 1,
        duration_seconds: currentConfig.duration || DEFAULT_MAP_DURATION,
        line_text: `${shotTitle}${shotSubtitle}`,
        text_reference: `${shotTitle}${shotSubtitle}`,
        description: `Animated map journey: ${currentConfig.waypoints.map(w => w.name).join(' → ')}`,
        camera_movement: 'static',
        video_id: videoAssetId,
        image_id: posterAssetId,
        _videoObjectURL: result.objectUrl,
        _imageObjectURL: result.posterDataUrl,
        videoDuration: currentConfig.duration || DEFAULT_MAP_DURATION,
        videoStartOffset: 0,
        mapConfig: structuredClone(currentConfig)
      };

      if (!state.currentScenes) state.currentScenes = [];
      state.currentScenes.push(newShot);

      renderResults(state.currentScenes);
      updateVideoContext();
      await saveVersion(false);

      notify("🗺️ Map story shot added to storyboard!");
      closeMapStudioModal();
    } catch (err: any) {
      console.error("Failed to export and add map shot:", err);
      notify("Failed to record map animation: " + err.message, true);
    } finally {
      isRecording = false;
      setControlsDisabled(false);
      if (progressBadge) progressBadge.classList.add('hidden');
    }
  });

  // 3. Replace Selected Shot (Retaining Scene Duration)
  replaceShotBtn?.addEventListener('click', async () => {
    if (isRecording) return;
    const shotSelect = document.getElementById('map-replace-shot-select') as HTMLSelectElement;
    const targetShotIndex = parseInt(shotSelect?.value || '-1', 10);

    if (isNaN(targetShotIndex) || targetShotIndex < 0 || !state.currentScenes || !state.currentScenes[targetShotIndex]) {
      notify("Please select a target shot to replace from the dropdown.", true);
      return;
    }

    const targetShot = state.currentScenes[targetShotIndex];
    const targetDuration = targetShot.duration_seconds || currentConfig.duration || DEFAULT_MAP_DURATION;

    isRecording = true;
    pausePlayback();
    setControlsDisabled(true);

    if (progressBadge) {
      progressBadge.classList.remove('hidden');
      progressBadge.textContent = "🔄 Rendering replacement map video 0%...";
    }

    try {
      const exportFormat = (formatSelect?.value === 'webm' ? 'webm' : 'mp4') as 'mp4' | 'webm';

      const adaptedConfig: MapAnimationConfig = {
        ...currentConfig,
        duration: targetDuration
      };

      const result = await exportMapVideoDeterministic(adaptedConfig, {
        format: exportFormat,
        onProgress: (pct) => {
          if (progressBadge) progressBadge.textContent = `🔄 Rendering replacement map video ${pct}%...`;
        }
      });

      // Cleanup old object URL and superseded assets
      if (targetShot._videoObjectURL) try { URL.revokeObjectURL(targetShot._videoObjectURL); } catch {}
      if (targetShot.video_id) try { await assetStorage.deleteAsset(targetShot.video_id); } catch {}
      if (targetShot.image_id) try { await assetStorage.deleteAsset(targetShot.image_id); } catch {}

      const videoAssetId = await assetStorage.storeAsset(result.blob, 'video', 'current_project');
      const posterBlob = await (await fetch(result.posterDataUrl)).blob();
      const posterAssetId = await assetStorage.storeAsset(posterBlob, 'image', 'current_project');

      safelyReplaceShotMedia(targetShot, result.blob, 'video');
      safelyReplaceShotMedia(targetShot, posterBlob, 'image');
      targetShot.video_id = videoAssetId;
      targetShot.image_id = posterAssetId;
      targetShot.duration_seconds = targetDuration;
      targetShot.videoDuration = targetDuration;
      targetShot.videoStartOffset = 0;
      targetShot.mapConfig = structuredClone(adaptedConfig);

      renderResults(state.currentScenes);
      updateVideoContext();
      await saveVersion(false);

      notify(`Replaced Shot #${targetShotIndex + 1} with animated map!`);
      closeMapStudioModal();
    } catch (err: any) {
      console.error("Failed to replace shot:", err);
      notify("Failed to replace shot: " + err.message, true);
    } finally {
      isRecording = false;
      setControlsDisabled(false);
      if (progressBadge) progressBadge.classList.add('hidden');
    }
  });

  // 4. Download Video (MP4 or WebM)
  downloadVideoBtn?.addEventListener('click', async () => {
    if (isRecording) return;
    isRecording = true;
    pausePlayback();
    setControlsDisabled(true);

    const exportFormat = (formatSelect?.value === 'webm' ? 'webm' : 'mp4') as 'mp4' | 'webm';

    if (progressBadge) {
      progressBadge.classList.remove('hidden');
      progressBadge.textContent = `💾 Rendering ${exportFormat.toUpperCase()} video 0%...`;
    }

    try {
      const result = await exportMapVideoDeterministic(currentConfig, {
        format: exportFormat,
        onProgress: (pct) => {
          if (progressBadge) progressBadge.textContent = `💾 Rendering ${exportFormat.toUpperCase()} video ${pct}%...`;
        }
      });

      const a = document.createElement('a');
      a.href = result.objectUrl;
      const safeTitle = (currentConfig.title || 'map_animation').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      a.download = `${safeTitle}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      notify(`Map animation downloaded as ${exportFormat.toUpperCase()}!`);
    } catch (err: any) {
      console.error("Failed to download map video:", err);
      notify("Failed to export video: " + err.message, true);
    } finally {
      isRecording = false;
      setControlsDisabled(false);
      if (progressBadge) progressBadge.classList.add('hidden');
    }
  });

  // 5. Download High-Res PNG Snapshot (True 1920x1080 / 1080x1920)
  downloadSnapshotBtn?.addEventListener('click', () => {
    const isVertical = currentConfig.aspectRatio === '9:16';
    const isSquare = currentConfig.aspectRatio === '1:1';
    const hiW = isVertical ? 1080 : isSquare ? 1080 : 1920;
    const hiH = isVertical ? 1920 : isSquare ? 1080 : 1080;

    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = hiW;
    hiCanvas.height = hiH;
    const hiCtx = hiCanvas.getContext('2d')!;

    const timeSec = playbackProgress * (currentConfig.duration || DEFAULT_MAP_DURATION);
    renderMapFrame(hiCtx, hiW, hiH, playbackProgress, currentConfig, timeSec, { isExport: true });

    const dataUrl = hiCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const safeTitle = (currentConfig.title || 'map_snapshot_1080p').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    a.download = `${safeTitle}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    notify("High-Resolution 1080p snapshot downloaded!");
  });

  // 6. Attach Picture-in-Picture Mini-Map Callout to Selected Shot
  attachCalloutBtn?.addEventListener('click', async () => {
    const shotSelect = document.getElementById('map-replace-shot-select') as HTMLSelectElement;
    const targetShotIndex = parseInt(shotSelect?.value || '-1', 10);

    if (isNaN(targetShotIndex) || targetShotIndex < 0 || !state.currentScenes || !state.currentScenes[targetShotIndex]) {
      notify("Please select a target shot from the dropdown to attach the corner callout to.", true);
      return;
    }

    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = 640;
    hiCanvas.height = 360;
    const hiCtx = hiCanvas.getContext('2d')!;
    const timeSec = playbackProgress * (currentConfig.duration || DEFAULT_MAP_DURATION);
    renderMapFrame(hiCtx, 640, 360, playbackProgress, currentConfig, timeSec);

    const blob = await new Promise<Blob>((resolve, reject) => {
      hiCanvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to create callout blob.'));
      }, 'image/png');
    });

    const overlayAssetId = await assetStorage.storeAsset(blob, 'image', 'current_project');
    const overlayObjectUrl = URL.createObjectURL(blob);

    const targetShot = state.currentScenes[targetShotIndex];
    targetShot.overlayImageId = overlayAssetId;
    targetShot.overlayImageUrl = overlayObjectUrl;
    targetShot.hasCornerMapCallout = true;
    targetShot.cornerCalloutLabel = (currentConfig.title || currentConfig.waypoints[0]?.name || "TACTICAL RECON").toUpperCase();

    const firstWp = currentConfig.waypoints[0];
    if (firstWp) {
      const latDir = firstWp.lat >= 0 ? 'N' : 'S';
      const lngDir = firstWp.lng >= 0 ? 'E' : 'W';
      targetShot.cornerCalloutCoords = `${Math.abs(firstWp.lat).toFixed(2)}° ${latDir}, ${Math.abs(firstWp.lng).toFixed(2)}° ${lngDir}`;
    }

    renderResults(state.currentScenes);
    updateVideoContext();
    await saveVersion(false);

    notify(`📌 Attached documentary map callout to Shot #${targetShotIndex + 1}!`);
    closeMapStudioModal();
  });
}

/**
 * Refreshes dropdown of shots for replacement
 */
function refreshShotSelector() {
  const shotSelect = document.getElementById('map-replace-shot-select') as HTMLSelectElement;
  if (!shotSelect) return;

  shotSelect.innerHTML = '<option value="">Select Shot to Replace...</option>';
  if (!state.currentScenes || state.currentScenes.length === 0) return;

  state.currentScenes.forEach((shot, index) => {
    const opt = document.createElement('option');
    opt.value = String(index);
    const label = shot.line_text ? shot.line_text.slice(0, 32) : `Scene ${index + 1}`;
    opt.textContent = `#${index + 1}: ${label}`;
    shotSelect.appendChild(opt);
  });
}
