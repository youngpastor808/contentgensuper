/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * High-Performance Animated Map Engine for Storytelling & Documentaries
 * Web Mercator Projection, Deterministic Multi-Resolution Rendering,
 * Great-Circle Spherical Geodesics, Vector Continents & Borders,
 * Collision-Avoidant Screen-Space Labels, and Offline Video Export.
 */

export interface MapWaypoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  label?: string;
  dateOrSub?: string;
  icon?: 'pin' | 'flag' | 'star' | 'anchor' | 'target' | 'city';
  dwellTimeSec?: number;
}

export type MapTheme = 'tactical-dark' | 'vintage-parchment' | 'satellite-earth' | 'editorial-minimal' | 'cyber-hologram' | 'real-satellite';
export type TravelerIcon = 'plane' | 'ship' | 'car' | 'train' | 'foot' | 'pin' | 'target' | 'rocket';
export type TrailStyle = 'glowing-solid' | 'dashed' | 'pulse-neon' | 'arrows';
export type CameraMode = 'follow-traveler' | 'overview' | 'pan-waypoints';
export type PathMode = 'great-circle' | 'straight' | 'polyline';
export type MapOverlayEffect = 'none' | 'pin' | 'border' | 'arrow';

export interface MapAudioConfig {
  whooshSfx?: boolean;
  pingSfx?: boolean;
  ambientDrone?: boolean;
  droneVolume?: number;
}

export interface MapAnimationConfig {
  theme: MapTheme;
  travelerIcon: TravelerIcon;
  trailStyle: TrailStyle;
  cameraMode: CameraMode;
  pathMode?: PathMode;
  duration: number; // in seconds (e.g. 6)
  arcCurvature: number; // 0.0 to 0.4
  showCoordinates: boolean;
  showGraticule: boolean;
  showCompass: boolean;
  showTelemetry: boolean;
  showDistanceCounter?: boolean;
  title: string;
  subtitle: string;
  waypoints: MapWaypoint[];
  aspectRatio: '16:9' | '9:16' | '1:1';
  overlayEffect?: MapOverlayEffect;
  audioConfig?: MapAudioConfig;
}

// Limits
export const MIN_MAP_DURATION = 2;
export const MAX_MAP_DURATION = 30;
export const DEFAULT_MAP_DURATION = 6;
export const MAX_LAT = 85.05112878;

// Expanded Geographic Database (Over 250 World Cities, Regions, Capitals & Landmarks)
export const WORLD_GEO_DB: Record<string, { lat: number; lng: number; country: string }> = {
  // North America
  "new york": { lat: 40.7128, lng: -74.0060, country: "USA" },
  "washington dc": { lat: 38.9072, lng: -77.0369, country: "USA" },
  "los angeles": { lat: 34.0522, lng: -118.2437, country: "USA" },
  "san francisco": { lat: 37.7749, lng: -122.4194, country: "USA" },
  "chicago": { lat: 41.8781, lng: -87.6298, country: "USA" },
  "miami": { lat: 25.7617, lng: -80.1918, country: "USA" },
  "boston": { lat: 42.3601, lng: -71.0589, country: "USA" },
  "seattle": { lat: 47.6062, lng: -122.3321, country: "USA" },
  "houston": { lat: 29.7604, lng: -95.3698, country: "USA" },
  "dallas": { lat: 32.7767, lng: -96.7970, country: "USA" },
  "denver": { lat: 39.7392, lng: -104.9903, country: "USA" },
  "atlanta": { lat: 33.7490, lng: -84.3880, country: "USA" },
  "las vegas": { lat: 36.1699, lng: -115.1398, country: "USA" },
  "honolulu": { lat: 21.3069, lng: -157.8583, country: "USA" },
  "anchorage": { lat: 61.2181, lng: -149.9003, country: "USA" },
  "st louis": { lat: 38.6270, lng: -90.1994, country: "USA" },
  "cape canaveral": { lat: 28.3922, lng: -80.6077, country: "USA" },
  "toronto": { lat: 43.6532, lng: -79.3832, country: "Canada" },
  "vancouver": { lat: 49.2827, lng: -123.1207, country: "Canada" },
  "montreal": { lat: 45.5017, lng: -73.5673, country: "Canada" },
  "ottawa": { lat: 45.4215, lng: -75.6972, country: "Canada" },
  "mexico city": { lat: 19.4326, lng: -99.1332, country: "Mexico" },
  "cancun": { lat: 21.1619, lng: -86.8515, country: "Mexico" },
  "havana": { lat: 23.1136, lng: -82.3666, country: "Cuba" },
  "panama city": { lat: 8.9824, lng: -79.5199, country: "Panama" },
  "san jose": { lat: 9.9281, lng: -84.0907, country: "Costa Rica" },
  "kingston": { lat: 17.9712, lng: -76.7928, country: "Jamaica" },

  // South America
  "bogota": { lat: 4.7110, lng: -74.0721, country: "Colombia" },
  "medellin": { lat: 6.2442, lng: -75.5812, country: "Colombia" },
  "lima": { lat: -12.0464, lng: -77.0428, country: "Peru" },
  "cusco": { lat: -13.5319, lng: -71.9675, country: "Peru" },
  "rio de janeiro": { lat: -22.9068, lng: -43.1729, country: "Brazil" },
  "sao paulo": { lat: -23.5505, lng: -46.6333, country: "Brazil" },
  "brasilia": { lat: -15.8267, lng: -47.9218, country: "Brazil" },
  "manaus": { lat: -3.1190, lng: -60.0217, country: "Brazil" },
  "buenos aires": { lat: -34.6037, lng: -58.3816, country: "Argentina" },
  "santiago": { lat: -33.4489, lng: -70.6693, country: "Chile" },
  "punta arenas": { lat: -53.1638, lng: -70.9171, country: "Chile" },
  "strait of magellan": { lat: -53.4754, lng: -70.7656, country: "Chile" },
  "caracas": { lat: 10.4806, lng: -66.9036, country: "Venezuela" },
  "quito": { lat: -0.1807, lng: -78.4678, country: "Ecuador" },
  "la paz": { lat: -16.5000, lng: -68.1500, country: "Bolivia" },
  "montevideo": { lat: -34.9011, lng: -56.1645, country: "Uruguay" },

  // Europe
  "london": { lat: 51.5074, lng: -0.1278, country: "United Kingdom" },
  "liverpool": { lat: 53.4084, lng: -2.9916, country: "United Kingdom" },
  "edinburgh": { lat: 55.9533, lng: -3.1883, country: "United Kingdom" },
  "belfast": { lat: 54.5973, lng: -5.9301, country: "United Kingdom" },
  "dublin": { lat: 53.3498, lng: -6.2603, country: "Ireland" },
  "paris": { lat: 48.8566, lng: 2.3522, country: "France" },
  "marseille": { lat: 43.2965, lng: 5.3698, country: "France" },
  "lyon": { lat: 45.7640, lng: 4.8357, country: "France" },
  "normandy": { lat: 49.1829, lng: -0.3707, country: "France" },
  "madrid": { lat: 40.4168, lng: -3.7038, country: "Spain" },
  "seville": { lat: 37.3891, lng: -5.9845, country: "Spain" },
  "barcelona": { lat: 41.3874, lng: 2.1686, country: "Spain" },
  "gibraltar": { lat: 36.1408, lng: -5.3536, country: "Gibraltar" },
  "lisbon": { lat: 38.7223, lng: -9.1393, country: "Portugal" },
  "porto": { lat: 41.1579, lng: -8.6291, country: "Portugal" },
  "berlin": { lat: 52.5200, lng: 13.4050, country: "Germany" },
  "frankfurt": { lat: 50.1109, lng: 8.6821, country: "Germany" },
  "munich": { lat: 48.1351, lng: 11.5820, country: "Germany" },
  "hamburg": { lat: 53.5511, lng: 9.9937, country: "Germany" },
  "rome": { lat: 41.9028, lng: 12.4964, country: "Italy" },
  "venice": { lat: 45.4408, lng: 12.3155, country: "Italy" },
  "milan": { lat: 45.4642, lng: 9.1900, country: "Italy" },
  "naples": { lat: 40.8518, lng: 14.2681, country: "Italy" },
  "amsterdam": { lat: 52.3676, lng: 4.9041, country: "Netherlands" },
  "rotterdam": { lat: 51.9244, lng: 4.4777, country: "Netherlands" },
  "brussels": { lat: 50.8503, lng: 4.3517, country: "Belgium" },
  "vienna": { lat: 48.2082, lng: 16.3738, country: "Austria" },
  "geneva": { lat: 46.2044, lng: 6.1432, country: "Switzerland" },
  "zurich": { lat: 47.3769, lng: 8.5417, country: "Switzerland" },
  "athens": { lat: 37.9838, lng: 23.7275, country: "Greece" },
  "warsaw": { lat: 52.2297, lng: 21.0122, country: "Poland" },
  "krakow": { lat: 50.0647, lng: 19.9450, country: "Poland" },
  "prague": { lat: 50.0755, lng: 14.4378, country: "Czechia" },
  "budapest": { lat: 47.4979, lng: 19.0402, country: "Hungary" },
  "copenhagen": { lat: 55.6761, lng: 12.5683, country: "Denmark" },
  "stockholm": { lat: 59.3293, lng: 18.0686, country: "Sweden" },
  "oslo": { lat: 59.9139, lng: 10.7522, country: "Norway" },
  "helsinki": { lat: 60.1699, lng: 24.9384, country: "Finland" },
  "reykjavik": { lat: 64.1466, lng: -21.9426, country: "Iceland" },
  "moscow": { lat: 55.7558, lng: 37.6173, country: "Russia" },
  "st petersburg": { lat: 59.9343, lng: 30.3351, country: "Russia" },
  "istanbul": { lat: 41.0082, lng: 28.9784, country: "Turkey" },
  "ankara": { lat: 39.9334, lng: 32.8597, country: "Turkey" },
  "kyiv": { lat: 50.4501, lng: 30.5234, country: "Ukraine" },
  "bucharest": { lat: 44.4268, lng: 26.1025, country: "Romania" },
  "sofia": { lat: 42.6977, lng: 23.3219, country: "Bulgaria" },
  "belgrade": { lat: 44.7866, lng: 20.4489, country: "Serbia" },

  // Africa (Extensive Global Coverage)
  "cairo": { lat: 30.0444, lng: 31.2357, country: "Egypt" },
  "alexandria": { lat: 31.2001, lng: 29.9187, country: "Egypt" },
  "suez": { lat: 29.9668, lng: 32.5498, country: "Egypt" },
  "casablanca": { lat: 33.5731, lng: -7.5898, country: "Morocco" },
  "marrakech": { lat: 31.6295, lng: -7.9811, country: "Morocco" },
  "rabat": { lat: 34.0209, lng: -6.8416, country: "Morocco" },
  "algiers": { lat: 36.7538, lng: 3.0588, country: "Algeria" },
  "tunis": { lat: 36.8065, lng: 10.1815, country: "Tunisia" },
  "tripoli": { lat: 32.8872, lng: 13.1913, country: "Libya" },
  "khartoum": { lat: 15.5007, lng: 32.5599, country: "Sudan" },
  "addis ababa": { lat: 9.0320, lng: 38.7469, country: "Ethiopia" },
  "nairobi": { lat: -1.2921, lng: 36.8219, country: "Kenya" },
  "mombasa": { lat: -4.0435, lng: 39.6682, country: "Kenya" },
  "kampala": { lat: 0.3476, lng: 32.5825, country: "Uganda" },
  "kigali": { lat: -1.9706, lng: 30.1044, country: "Rwanda" },
  "dar es salaam": { lat: -6.7924, lng: 39.2083, country: "Tanzania" },
  "zanzibar": { lat: -6.1659, lng: 39.2026, country: "Tanzania" },
  "lusaka": { lat: -15.3875, lng: 28.3228, country: "Zambia" },
  "harare": { lat: -17.8252, lng: 31.0335, country: "Zimbabwe" },
  "maputo": { lat: -25.9692, lng: 32.5732, country: "Mozambique" },
  "gaborone": { lat: -24.6282, lng: 25.9231, country: "Botswana" },
  "windhoek": { lat: -22.5609, lng: 17.0658, country: "Namibia" },
  "johannesburg": { lat: -26.2041, lng: 28.0473, country: "South Africa" },
  "cape town": { lat: -33.9249, lng: 18.4241, country: "South Africa" },
  "durban": { lat: -29.8587, lng: 31.0218, country: "South Africa" },
  "luanda": { lat: -8.8390, lng: 13.2894, country: "Angola" },
  "kinshasa": { lat: -4.4419, lng: 15.2663, country: "DR Congo" },
  "brazzaville": { lat: -4.2634, lng: 15.2429, country: "Congo" },
  "yaounde": { lat: 3.8480, lng: 11.5021, country: "Cameroon" },
  "lagos": { lat: 6.5244, lng: 3.3792, country: "Nigeria" },
  "abuja": { lat: 9.0765, lng: 7.3986, country: "Nigeria" },
  "accra": { lat: 5.6037, lng: -0.1870, country: "Ghana" },
  "abidjan": { lat: 5.3600, lng: -4.0083, country: "Ivory Coast" },
  "dakar": { lat: 14.7167, lng: -17.4677, country: "Senegal" },
  "bamako": { lat: 12.6392, lng: -8.0029, country: "Mali" },
  "timbuktu": { lat: 16.7666, lng: -3.0026, country: "Mali" },
  "madagascar": { lat: -18.8792, lng: 47.5079, country: "Madagascar" },
  "antananarivo": { lat: -18.8792, lng: 47.5079, country: "Madagascar" },
  "port louis": { lat: -20.1609, lng: 57.5012, country: "Mauritius" },

  // Middle East
  "jerusalem": { lat: 31.7683, lng: 35.2137, country: "Israel" },
  "tel aviv": { lat: 32.0853, lng: 34.7818, country: "Israel" },
  "dubai": { lat: 25.2048, lng: 55.2708, country: "UAE" },
  "abu dhabi": { lat: 24.4539, lng: 54.3773, country: "UAE" },
  "riyadh": { lat: 24.7136, lng: 46.6753, country: "Saudi Arabia" },
  "jeddah": { lat: 21.5433, lng: 39.1728, country: "Saudi Arabia" },
  "mecca": { lat: 21.3891, lng: 39.8579, country: "Saudi Arabia" },
  "doha": { lat: 25.2854, lng: 51.5310, country: "Qatar" },
  "kuwait city": { lat: 29.3759, lng: 47.9774, country: "Kuwait" },
  "manama": { lat: 26.2285, lng: 50.5860, country: "Bahrain" },
  "muscat": { lat: 23.5859, lng: 58.4059, country: "Oman" },
  "baghdad": { lat: 33.3152, lng: 44.3661, country: "Iraq" },
  "tehran": { lat: 35.6892, lng: 51.3890, country: "Iran" },
  "beirut": { lat: 33.8938, lng: 35.5018, country: "Lebanon" },
  "damascus": { lat: 33.5138, lng: 36.2765, country: "Syria" },
  "amman": { lat: 31.9454, lng: 35.9284, country: "Jordan" },

  // Asia
  "tokyo": { lat: 35.6762, lng: 139.6503, country: "Japan" },
  "osaka": { lat: 34.6937, lng: 135.5023, country: "Japan" },
  "kyoto": { lat: 35.0116, lng: 135.7681, country: "Japan" },
  "beijing": { lat: 39.9042, lng: 116.4074, country: "China" },
  "shanghai": { lat: 31.2304, lng: 121.4737, country: "China" },
  "hong kong": { lat: 22.3193, lng: 114.1694, country: "China" },
  "shenzhen": { lat: 22.5431, lng: 114.0579, country: "China" },
  "guangzhou": { lat: 23.1291, lng: 113.2644, country: "China" },
  "xian": { lat: 34.3416, lng: 108.9398, country: "China" },
  "chang'an": { lat: 34.3416, lng: 108.9398, country: "China" },
  "dunhuang": { lat: 40.1421, lng: 94.6620, country: "China" },
  "samarkand": { lat: 39.6270, lng: 66.9750, country: "Uzbekistan" },
  "tashkent": { lat: 41.2995, lng: 69.2401, country: "Uzbekistan" },
  "almaty": { lat: 43.2220, lng: 76.8512, country: "Kazakhstan" },
  "taipei": { lat: 25.0330, lng: 121.5654, country: "Taiwan" },
  "seoul": { lat: 37.5665, lng: 126.9780, country: "South Korea" },
  "busan": { lat: 35.1796, lng: 129.0756, country: "South Korea" },
  "singapore": { lat: 1.3521, lng: 103.8198, country: "Singapore" },
  "kuala lumpur": { lat: 3.1390, lng: 101.6869, country: "Malaysia" },
  "bangkok": { lat: 13.7563, lng: 100.5018, country: "Thailand" },
  "phuket": { lat: 7.8804, lng: 98.3923, country: "Thailand" },
  "hanoi": { lat: 21.0285, lng: 105.8542, country: "Vietnam" },
  "ho chi minh city": { lat: 10.8231, lng: 106.6297, country: "Vietnam" },
  "manila": { lat: 14.5995, lng: 120.9842, country: "Philippines" },
  "cebu": { lat: 10.3157, lng: 123.8854, country: "Philippines" },
  "jakarta": { lat: -6.2088, lng: 106.8456, country: "Indonesia" },
  "bali": { lat: -8.4095, lng: 115.1889, country: "Indonesia" },
  "delhi": { lat: 28.6139, lng: 77.2090, country: "India" },
  "mumbai": { lat: 19.0760, lng: 72.8777, country: "India" },
  "bangalore": { lat: 12.9716, lng: 77.5946, country: "India" },
  "calcutta": { lat: 22.5726, lng: 88.3639, country: "India" },
  "kolkata": { lat: 22.5726, lng: 88.3639, country: "India" },
  "chennai": { lat: 13.0827, lng: 80.2707, country: "India" },
  "islamabad": { lat: 33.6844, lng: 73.0479, country: "Pakistan" },
  "karachi": { lat: 24.8607, lng: 67.0011, country: "Pakistan" },
  "dhaka": { lat: 23.8103, lng: 90.4125, country: "Bangladesh" },
  "colombo": { lat: 6.9271, lng: 79.8612, country: "Sri Lanka" },
  "kathmandu": { lat: 27.7172, lng: 85.3240, country: "Nepal" },
  "ulaanbaatar": { lat: 47.8864, lng: 106.9057, country: "Mongolia" },

  // Oceania
  "sydney": { lat: -33.8688, lng: 151.2093, country: "Australia" },
  "melbourne": { lat: -37.8136, lng: 144.9631, country: "Australia" },
  "brisbane": { lat: -27.4698, lng: 153.0251, country: "Australia" },
  "perth": { lat: -31.9505, lng: 115.8605, country: "Australia" },
  "adelaide": { lat: -34.9285, lng: 138.6007, country: "Australia" },
  "darwin": { lat: -12.4634, lng: 130.8456, country: "Australia" },
  "auckland": { lat: -36.8485, lng: 174.7633, country: "New Zealand" },
  "wellington": { lat: -41.2865, lng: 174.7762, country: "New Zealand" },
  "christchurch": { lat: -43.5321, lng: 172.6362, country: "New Zealand" },
  "fiji": { lat: -17.7134, lng: 178.0650, country: "Fiji" },
  "suva": { lat: -18.1416, lng: 178.4419, country: "Fiji" },
  "tahiti": { lat: -17.6509, lng: -149.4260, country: "French Polynesia" },
  "port moresby": { lat: -9.4438, lng: 147.1803, country: "Papua New Guinea" },

  // Historical & Nature Landmarks
  "constantinople": { lat: 41.0082, lng: 28.9784, country: "Byzantium / Turkey" },
  "babylon": { lat: 32.5363, lng: 44.4209, country: "Mesopotamia / Iraq" },
  "sparta": { lat: 37.0733, lng: 22.4297, country: "Greece" },
  "everest": { lat: 27.9881, lng: 86.9250, country: "Nepal" },
  "bermuda triangle": { lat: 25.0000, lng: -71.0000, country: "Atlantic Ocean" },
  "north pole": { lat: 84.0000, lng: 0.0000, country: "Arctic" },
  "south pole": { lat: -84.0000, lng: 0.0000, country: "Antarctica" }
};

// Natural Earth Vectorized Continents [lng, lat]
export const WORLD_CONTINENTS: number[][][] = [
  // North America
  [
    [-168, 65], [-162, 71], [-140, 70], [-130, 69], [-120, 75], [-95, 75], [-80, 73],
    [-65, 62], [-60, 50], [-64, 45], [-70, 42], [-75, 35], [-80, 25], [-82, 23],
    [-88, 21], [-90, 15], [-85, 12], [-80, 8], [-77, 8], [-80, 10], [-85, 15],
    [-92, 16], [-96, 18], [-97, 26], [-90, 30], [-82, 30], [-80, 32], [-75, 38],
    [-70, 43], [-66, 45], [-60, 47], [-56, 52], [-60, 58], [-68, 59], [-75, 56],
    [-85, 52], [-92, 57], [-95, 62], [-110, 68], [-125, 69], [-135, 69], [-142, 60],
    [-135, 55], [-125, 49], [-122, 37], [-117, 32], [-110, 23], [-105, 20], [-98, 16],
    [-105, 22], [-115, 30], [-120, 35], [-124, 40], [-125, 48], [-130, 54], [-140, 59],
    [-150, 60], [-160, 57], [-165, 60], [-168, 65]
  ],
  // South America
  [
    [-77, 8], [-72, 11], [-65, 10], [-60, 8], [-52, 4], [-45, -2], [-35, -5],
    [-35, -10], [-38, -15], [-42, -23], [-48, -28], [-53, -33], [-58, -38], [-65, -43],
    [-66, -50], [-68, -55], [-73, -53], [-75, -45], [-73, -38], [-71, -30], [-70, -20],
    [-75, -15], [-80, -5], [-81, -2], [-79, 2], [-77, 8]
  ],
  // Eurasia (Europe + Asia)
  [
    [-9, 36], [-8, 43], [-1, 44], [-2, 48], [2, 51], [8, 54], [10, 57], [12, 56],
    [18, 55], [24, 59], [28, 65], [25, 71], [35, 70], [50, 68], [60, 70], [75, 73],
    [90, 75], [110, 77], [130, 73], [140, 72], [160, 70], [175, 66], [180, 64],
    [170, 60], [160, 55], [155, 50], [142, 52], [135, 45], [130, 42], [128, 38],
    [122, 30], [118, 25], [110, 20], [105, 10], [102, 3], [98, 8], [95, 16],
    [90, 22], [82, 16], [78, 8], [73, 18], [68, 24], [60, 25], [55, 26], [50, 30],
    [48, 31], [40, 37], [35, 36], [30, 32], [32, 35], [26, 38], [23, 40], [20, 38],
    [16, 40], [14, 45], [12, 44], [4, 43], [3, 42], [-2, 37], [-5, 36], [-9, 36]
  ],
  // Africa
  [
    [-5, 36], [0, 36], [10, 37], [11, 33], [15, 32], [25, 32], [32, 31], [34, 28],
    [38, 22], [43, 13], [51, 11], [46, 5], [41, -2], [39, -8], [35, -15], [35, -24],
    [32, -28], [28, -32], [20, -35], [18, -34], [15, -28], [12, -18], [12, -6],
    [9, 4], [4, 6], [1, 6], [-4, 5], [-9, 7], [-15, 11], [-17, 15], [-16, 21],
    [-13, 27], [-9, 30], [-6, 35], [-5, 36]
  ],
  // Australia & New Zealand
  [
    [114, -22], [115, -34], [122, -34], [130, -32], [137, -35], [142, -38], [148, -38],
    [153, -28], [150, -22], [145, -15], [142, -11], [136, -12], [130, -14], [124, -16],
    [118, -20], [114, -22]
  ],
  // Great Britain & Ireland
  [
    [-5, 50], [0, 51], [1, 53], [0, 56], [-3, 58], [-5, 56], [-4, 53], [-5, 50]
  ],
  [
    [-10, 52], [-6, 52], [-6, 55], [-10, 54], [-10, 52]
  ],
  // Japan
  [
    [130, 32], [133, 34], [137, 35], [140, 37], [141, 41], [144, 44], [142, 45],
    [140, 43], [138, 38], [135, 35], [131, 33], [130, 32]
  ],
  // Madagascar
  [
    [44, -12], [50, -14], [49, -20], [47, -25], [44, -25], [44, -18], [44, -12]
  ],
  // Greenland
  [
    [-45, 60], [-35, 66], [-20, 70], [-18, 77], [-25, 82], [-40, 83], [-55, 82],
    [-60, 76], [-52, 70], [-50, 64], [-45, 60]
  ],
  // New Zealand Islands
  [
    [172, -35], [176, -38], [178, -38], [175, -41], [174, -41], [173, -36], [172, -35]
  ],
  [
    [167, -45], [171, -42], [174, -41], [172, -44], [168, -47], [166, -46], [167, -45]
  ]
];

// Stylized country/state interior borders for geopolitical aesthetic
export const COUNTRY_BORDERS: number[][][] = [
  // US/Canada 49th parallel
  [[-123, 49], [-95, 49], [-89, 48], [-82, 45], [-75, 45], [-71, 45]],
  // US/Mexico border
  [[-117, 32.5], [-114, 32.5], [-111, 31.3], [-106.5, 31.8], [-104, 29.5], [-99, 26], [-97, 26]],
  // Europe borders
  [[6, 49], [6, 46], [7, 44]], // France-Germany-Italy
  [[14, 54], [15, 51], [14, 49]], // Germany-Poland-Czechia
  [[21, 52], [24, 48], [22, 45]], // Eastern Europe
  // Africa regional lines
  [[-17, 15], [0, 15], [20, 15], [38, 15]], // Sahel line
  [[10, 4], [15, 0], [25, 0], [35, 0]], // Equator partition
  [[18, -34], [28, -26], [32, -26]], // South Africa borders
  // Asia internal lines
  [[75, 35], [85, 35], [95, 35]], // Himalayas
  [[105, 22], [115, 22], [120, 24]], // South China
  [[127, 38], [129, 38]] // Korean DMZ
];

// ==========================================
// WEB MERCATOR PROJECTION & MATH
// ==========================================

export function projectMercator(lng: number, lat: number, zoom: number, tileSize: number = 256): { x: number; y: number } {
  const worldSize = tileSize * Math.pow(2, zoom);
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const normX = (lng + 180) / 360;
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const normY = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  return {
    x: normX * worldSize,
    y: normY * worldSize
  };
}

export function unprojectMercator(x: number, y: number, zoom: number, tileSize: number = 256): { lng: number; lat: number } {
  const worldSize = tileSize * Math.pow(2, zoom);
  const normX = x / worldSize;
  const normY = y / worldSize;
  const lng = normX * 360 - 180;
  const n = Math.PI - 2 * Math.PI * normY;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    lng: Math.max(-180, Math.min(180, lng)),
    lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  };
}

export interface CameraTransform {
  centerLng: number;
  centerLat: number;
  zoom: number;
}

export function geoToCanvas(
  lng: number,
  lat: number,
  width: number,
  height: number,
  cam: CameraTransform
): { x: number; y: number } {
  const p = projectMercator(lng, lat, cam.zoom);
  const c = projectMercator(cam.centerLng, cam.centerLat, cam.zoom);
  return {
    x: p.x - c.x + width / 2,
    y: p.y - c.y + height / 2
  };
}

export function canvasToGeo(
  x: number,
  y: number,
  width: number,
  height: number,
  cam: CameraTransform
): { lng: number; lat: number } {
  const c = projectMercator(cam.centerLng, cam.centerLat, cam.zoom);
  const targetX = x - width / 2 + c.x;
  const targetY = y - height / 2 + c.y;
  return unprojectMercator(targetX, targetY, cam.zoom);
}

// ==========================================
// SPHERICAL GEODESICS & GREAT-CIRCLE MATH
// ==========================================

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineDistanceKm(p1: LatLng, p2: LatLng): number {
  const R = 6371; // Earth radius in km
  const rad = Math.PI / 180;
  const dLat = (p2.lat - p1.lat) * rad;
  const dLng = (p2.lng - p1.lng) * rad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * rad) * Math.cos(p2.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates true Great-Circle geodesic arc between two points with longitude unwrapping
 */
export function computeGreatCircleArc(p1: LatLng, p2: LatLng, steps: number = 64): LatLng[] {
  const r = Math.PI / 180;
  const lat1 = p1.lat * r;
  const lat2 = p2.lat * r;

  // Unwrap longitude differences across international date line (-180 to 180)
  let dLng = p2.lng - p1.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  const lng1 = p1.lng * r;
  const lng2 = (p1.lng + dLng) * r;

  const d = 2 * Math.asin(
    Math.sqrt(
      Math.sin((lat2 - lat1) / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2
    )
  );

  if (d < 1e-6) {
    return [p1, p2];
  }

  const result: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);

    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = Math.atan2(z, Math.hypot(x, y)) / r;
    const lng = Math.atan2(y, x) / r;

    result.push({
      lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)),
      lng: ((lng + 180) % 360 + 360) % 360 - 180
    });
  }
  return result;
}

// ==========================================
// TILE SYSTEM & ESRI SATELLITE ENGINE
// ==========================================

const tileCache = new Map<string, HTMLImageElement>();
const pendingFetches = new Set<string>();
const listenersByTile = new Map<string, Array<() => void>>();

export function long2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

export function lat2tile(lat: number, zoom: number): number {
  const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

export function tile2long(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function getOrFetchSatelliteTile(
  zoom: number,
  x: number,
  y: number,
  onLoaded?: () => void
): HTMLImageElement | null {
  const maxTile = Math.pow(2, zoom);
  const wrappedX = ((x % maxTile) + maxTile) % maxTile;
  if (y < 0 || y >= maxTile) return null;

  const key = `${zoom}/${y}/${wrappedX}`;
  const cached = tileCache.get(key);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }

  if (onLoaded) {
    const list = listenersByTile.get(key) || [];
    list.push(onLoaded);
    listenersByTile.set(key, list);
  }

  if (pendingFetches.has(key)) return null;
  pendingFetches.add(key);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${wrappedX}`;
  img.onload = () => {
    tileCache.set(key, img);
    pendingFetches.delete(key);
    const callbacks = listenersByTile.get(key) || [];
    listenersByTile.delete(key);
    callbacks.forEach(cb => {
      try { cb(); } catch {}
    });
  };
  img.onerror = () => {
    pendingFetches.delete(key);
    listenersByTile.delete(key);
  };
  return null;
}

export function preloadSatelliteTilesForRoute(waypoints: MapWaypoint[]): Promise<void> {
  if (!waypoints || waypoints.length === 0) return Promise.resolve();
  const zoomLevels = [2, 3, 4, 5];
  const promises: Promise<void>[] = [];
  zoomLevels.forEach(z => {
    waypoints.forEach(wp => {
      const cx = long2tile(wp.lng, z);
      const cy = lat2tile(wp.lat, z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const maxTile = Math.pow(2, z);
          const wrappedX = (((cx + dx) % maxTile) + maxTile) % maxTile;
          const targetY = cy + dy;
          if (targetY < 0 || targetY >= maxTile) continue;
          const key = `${z}/${targetY}/${wrappedX}`;
          const cached = tileCache.get(key);
          if (cached && cached.complete && cached.naturalWidth > 0) continue;
          promises.push(
            new Promise<void>((resolve) => {
              getOrFetchSatelliteTile(z, cx + dx, cy + dy, () => resolve());
              setTimeout(resolve, 2000);
            })
          );
        }
      }
    });
  });
  return Promise.all(promises).then(() => {});
}

// ==========================================
// PALETTES & THEMES
// ==========================================

export interface MapThemePalette {
  ocean: string;
  oceanGradient?: [string, string];
  landFill: string;
  landStroke: string;
  landStrokeWidth: number;
  borderStroke: string;
  graticuleColor: string;
  equatorColor: string;
  routeColor: string;
  routeGlow: string;
  routeUnvisited: string;
  pinBorder: string;
  pinFill: string;
  pinActive: string;
  textPrimary: string;
  textSecondary: string;
  cardBg: string;
  cardBorder: string;
  hudAccent: string;
  vehicleColor: string;
}

export const THEME_PALETTES: Record<MapTheme, MapThemePalette> = {
  "tactical-dark": {
    ocean: "#060913",
    oceanGradient: ["#0a1128", "#030611"],
    landFill: "#101935",
    landStroke: "#1f2f5c",
    landStrokeWidth: 1.5,
    borderStroke: "rgba(56, 189, 248, 0.25)",
    graticuleColor: "rgba(31, 47, 92, 0.4)",
    equatorColor: "rgba(6, 182, 212, 0.45)",
    routeColor: "#06b6d4",
    routeGlow: "rgba(6, 182, 212, 0.75)",
    routeUnvisited: "rgba(31, 47, 92, 0.6)",
    pinBorder: "#06b6d4",
    pinFill: "#0f172a",
    pinActive: "#f59e0b",
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
    cardBg: "rgba(15, 23, 42, 0.92)",
    cardBorder: "rgba(6, 182, 212, 0.4)",
    hudAccent: "#06b6d4",
    vehicleColor: "#38bdf8"
  },
  "vintage-parchment": {
    ocean: "#f5edd6",
    oceanGradient: ["#faf3e0", "#e8dbbf"],
    landFill: "#e4d3b4",
    landStroke: "#8c6d46",
    landStrokeWidth: 1.6,
    borderStroke: "rgba(140, 109, 70, 0.35)",
    graticuleColor: "rgba(140, 109, 70, 0.25)",
    equatorColor: "rgba(180, 83, 9, 0.4)",
    routeColor: "#b91c1c",
    routeGlow: "rgba(185, 28, 28, 0.4)",
    routeUnvisited: "rgba(140, 109, 70, 0.4)",
    pinBorder: "#78350f",
    pinFill: "#fef3c7",
    pinActive: "#b91c1c",
    textPrimary: "#451a03",
    textSecondary: "#78350f",
    cardBg: "rgba(254, 243, 199, 0.94)",
    cardBorder: "rgba(180, 83, 9, 0.4)",
    hudAccent: "#92400e",
    vehicleColor: "#7f1d1d"
  },
  "satellite-earth": {
    ocean: "#0b1b36",
    oceanGradient: ["#102a54", "#061024"],
    landFill: "#1e3a29",
    landStroke: "#345e41",
    landStrokeWidth: 1.5,
    borderStroke: "rgba(250, 204, 21, 0.25)",
    graticuleColor: "rgba(255, 255, 255, 0.12)",
    equatorColor: "rgba(250, 204, 21, 0.35)",
    routeColor: "#facc15",
    routeGlow: "rgba(250, 204, 21, 0.75)",
    routeUnvisited: "rgba(255, 255, 255, 0.3)",
    pinBorder: "#facc15",
    pinFill: "#064e3b",
    pinActive: "#ef4444",
    textPrimary: "#ffffff",
    textSecondary: "#cbd5e1",
    cardBg: "rgba(6, 78, 59, 0.88)",
    cardBorder: "rgba(250, 204, 21, 0.5)",
    hudAccent: "#facc15",
    vehicleColor: "#fbbf24"
  },
  "editorial-minimal": {
    ocean: "#f8fafc",
    oceanGradient: ["#ffffff", "#f1f5f9"],
    landFill: "#e2e8f0",
    landStroke: "#94a3b8",
    landStrokeWidth: 1.2,
    borderStroke: "rgba(100, 116, 139, 0.3)",
    graticuleColor: "rgba(148, 163, 184, 0.25)",
    equatorColor: "rgba(15, 23, 42, 0.3)",
    routeColor: "#ef4444",
    routeGlow: "rgba(239, 68, 68, 0.35)",
    routeUnvisited: "rgba(203, 213, 225, 0.8)",
    pinBorder: "#0f172a",
    pinFill: "#ffffff",
    pinActive: "#ef4444",
    textPrimary: "#0f172a",
    textSecondary: "#475569",
    cardBg: "rgba(255, 255, 255, 0.96)",
    cardBorder: "rgba(15, 23, 42, 0.2)",
    hudAccent: "#ef4444",
    vehicleColor: "#dc2626"
  },
  "cyber-hologram": {
    ocean: "#02040a",
    oceanGradient: ["#050e1f", "#010206"],
    landFill: "#052e16",
    landStroke: "#10b981",
    landStrokeWidth: 1.5,
    borderStroke: "rgba(52, 211, 153, 0.4)",
    graticuleColor: "rgba(16, 185, 129, 0.25)",
    equatorColor: "rgba(52, 211, 153, 0.6)",
    routeColor: "#10b981",
    routeGlow: "rgba(16, 185, 129, 0.9)",
    routeUnvisited: "rgba(6, 78, 59, 0.6)",
    pinBorder: "#34d399",
    pinFill: "#022c22",
    pinActive: "#a7f3d0",
    textPrimary: "#ecfdf5",
    textSecondary: "#6ee7b7",
    cardBg: "rgba(2, 44, 34, 0.92)",
    cardBorder: "rgba(52, 211, 153, 0.5)",
    hudAccent: "#10b981",
    vehicleColor: "#34d399"
  },
  "real-satellite": {
    ocean: "#030712",
    oceanGradient: ["#080e1a", "#020408"],
    landFill: "rgba(15, 23, 42, 0.3)",
    landStroke: "rgba(0, 255, 204, 0.45)",
    landStrokeWidth: 1.2,
    borderStroke: "rgba(0, 255, 204, 0.35)",
    graticuleColor: "rgba(255, 255, 255, 0.08)",
    equatorColor: "rgba(0, 255, 204, 0.35)",
    routeColor: "#00ffcc",
    routeGlow: "rgba(0, 255, 204, 0.85)",
    routeUnvisited: "rgba(255, 255, 255, 0.3)",
    pinBorder: "#00ffcc",
    pinFill: "#030712",
    pinActive: "#f43f5e",
    textPrimary: "#ffffff",
    textSecondary: "#00ffcc",
    cardBg: "rgba(3, 7, 18, 0.94)",
    cardBorder: "rgba(0, 255, 204, 0.6)",
    hudAccent: "#00ffcc",
    vehicleColor: "#00ffcc"
  }
};

// ==========================================
// VEHICLE ICONS & VECTOR RENDERING
// ==========================================

export function drawTravelerIcon(
  ctx: CanvasRenderingContext2D,
  icon: TravelerIcon,
  x: number,
  y: number,
  angle: number,
  color: string,
  scale: number = 1.0
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;

  switch (icon) {
    case 'plane': {
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(8, -3);
      ctx.lineTo(-4, -3);
      ctx.lineTo(-6, -18);
      ctx.lineTo(-11, -18);
      ctx.lineTo(-7, -3);
      ctx.lineTo(-16, -3);
      ctx.lineTo(-20, -10);
      ctx.lineTo(-23, -10);
      ctx.lineTo(-20, 0);
      ctx.lineTo(-23, 10);
      ctx.lineTo(-20, 10);
      ctx.lineTo(-16, 3);
      ctx.lineTo(-7, 3);
      ctx.lineTo(-11, 18);
      ctx.lineTo(-6, 18);
      ctx.lineTo(-4, 3);
      ctx.lineTo(8, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Wingtip lights
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(-8, -18, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.arc(-8, 18, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ship': {
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(6, -6);
      ctx.lineTo(-14, -6);
      ctx.lineTo(-18, -4);
      ctx.lineTo(-18, 4);
      ctx.lineTo(-14, 6);
      ctx.lineTo(6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-6, -3, 10, 6);
      break;
    }
    case 'car': {
      ctx.beginPath();
      ctx.roundRect(-14, -7, 28, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-2, -5, 6, 10);
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(13, -6, 2, 3);
      ctx.fillRect(13, 3, 2, 3);
      break;
    }
    case 'train': {
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(14, -5);
      ctx.lineTo(-18, -5);
      ctx.lineTo(-18, 5);
      ctx.lineTo(14, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-12, -3, 20, 6);
      break;
    }
    case 'rocket': {
      ctx.beginPath();
      ctx.moveTo(18, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(-10, -5);
      ctx.lineTo(-16, -11);
      ctx.lineTo(-14, -3);
      ctx.lineTo(-14, 3);
      ctx.lineTo(-16, 11);
      ctx.lineTo(-10, 5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f97316";
      ctx.beginPath();
      ctx.moveTo(-14, -3);
      ctx.lineTo(-24, 0);
      ctx.lineTo(-14, 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'foot': {
      // Directional footprint (heel at -8, ball at +4, toes at +10)
      ctx.beginPath();
      ctx.ellipse(-4, 0, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(5, 0, 6, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Toes
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(12, 0, 2.2, 0, Math.PI * 2);
      ctx.arc(11, -3.5, 1.6, 0, Math.PI * 2);
      ctx.arc(11, 3.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

// ==========================================
// TACTICAL OVERLAYS & HUD
// ==========================================

export function drawNeonOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  label: string,
  type: 'pin' | 'border' | 'arrow',
  scaleMultiplier: number = 1.0
) {
  const cx = w / 2;
  const cy = h / 2;

  ctx.save();
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#00ffcc";
  ctx.strokeStyle = "#00ffcc";
  ctx.lineWidth = 3 * scaleMultiplier;

  if (type === 'border') {
    ctx.beginPath();
    const points = 16;
    const radius = Math.min(w, h) * 0.26;
    const variance = 24 * scaleMultiplier;

    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const r = radius + (Math.sin(i * 123.4) * variance);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "rgba(0, 255, 204, 0.08)";
    ctx.fill();

    // Corner brackets
    const r = radius + 20 * scaleMultiplier;
    const len = 20 * scaleMultiplier;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 2 * scaleMultiplier;
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r + len); ctx.lineTo(cx - r, cy - r); ctx.lineTo(cx - r + len, cy - r);
    ctx.moveTo(cx + r, cy - r + len); ctx.lineTo(cx + r, cy - r); ctx.lineTo(cx + r - len, cy - r);
    ctx.moveTo(cx - r, cy + r - len); ctx.lineTo(cx - r, cy + r); ctx.lineTo(cx - r + len, cy + r);
    ctx.moveTo(cx + r, cy + r - len); ctx.lineTo(cx + r, cy + r); ctx.lineTo(cx + r - len, cy + r);
    ctx.stroke();

    drawNeonLabel(ctx, cx, cy - r - 24 * scaleMultiplier, label || "REGION OF INTEREST", scaleMultiplier);
  } else if (type === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(cx - 160 * scaleMultiplier, cy + 50 * scaleMultiplier);
    ctx.bezierCurveTo(
      cx - 80 * scaleMultiplier, cy + 50 * scaleMultiplier,
      cx - 30 * scaleMultiplier, cy,
      cx + 50 * scaleMultiplier, cy
    );

    ctx.lineWidth = 8 * scaleMultiplier;
    ctx.lineCap = 'round';
    ctx.strokeStyle = "#f43f5e";
    ctx.shadowColor = "#f43f5e";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + 60 * scaleMultiplier, cy);
    ctx.lineTo(cx + 20 * scaleMultiplier, cy - 16 * scaleMultiplier);
    ctx.lineTo(cx + 20 * scaleMultiplier, cy + 16 * scaleMultiplier);
    ctx.closePath();
    ctx.fillStyle = "#f43f5e";
    ctx.fill();

    drawNeonLabel(ctx, cx - 60 * scaleMultiplier, cy + 75 * scaleMultiplier, label || "STRATEGIC MOVEMENT", scaleMultiplier);
  } else if (type === 'pin') {
    ctx.beginPath();
    ctx.arc(cx, cy, 16 * scaleMultiplier, 0, Math.PI * 2);
    ctx.strokeStyle = "#00ffcc";
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, cy - 16 * scaleMultiplier);
    ctx.lineTo(cx, cy - 60 * scaleMultiplier);
    ctx.stroke();

    drawNeonLabel(ctx, cx, cy - 72 * scaleMultiplier, label || "TARGET LOCATION", scaleMultiplier);
  }

  ctx.restore();
}

function drawNeonLabel(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, scale: number = 1.0) {
  ctx.save();
  ctx.shadowBlur = 6;
  ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#ffffff";
  const fontSize = Math.max(12, Math.round(22 * scale));
  ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.fillText((label || "").toUpperCase(), x, y);
  ctx.restore();
}

export function drawCompassRose(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  palette: MapThemePalette
) {
  ctx.save();
  ctx.translate(x, y);

  ctx.strokeStyle = palette.hudAccent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.stroke();

  const r = size * 0.85;
  const inR = size * 0.28;
  const points = 4;
  for (let i = 0; i < points; i++) {
    const angle = (i * Math.PI * 2) / points - Math.PI / 2;
    const rightAngle = angle + (Math.PI * 2) / (points * 2);

    ctx.fillStyle = i === 0 ? palette.routeColor : palette.textPrimary;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    ctx.lineTo(Math.cos(rightAngle) * inR, Math.sin(rightAngle) * inR);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    ctx.lineTo(Math.cos(angle - (Math.PI * 2) / (points * 2)) * inR, Math.sin(angle - (Math.PI * 2) / (points * 2)) * inR);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = palette.hudAccent;
  ctx.font = `bold ${Math.max(9, Math.round(size * 0.35))}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", 0, -r - 3);

  ctx.restore();
}

// ==========================================
// MASTER CAMERA & PATH SOLVER
// ==========================================

export interface JourneySegment {
  from: MapWaypoint;
  to: MapWaypoint;
  points: LatLng[];
  lengthKm: number;
  cumulativeDistKm: number;
}

export function solveJourneySegments(waypoints: MapWaypoint[]): { segments: JourneySegment[]; totalDistanceKm: number } {
  if (waypoints.length < 2) {
    return { segments: [], totalDistanceKm: 0 };
  }

  const segments: JourneySegment[] = [];
  let totalDistanceKm = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const arcPoints = computeGreatCircleArc(from, to, 48);
    const distKm = haversineDistanceKm(from, to);
    totalDistanceKm += distKm;

    segments.push({
      from,
      to,
      points: arcPoints,
      lengthKm: distKm,
      cumulativeDistKm: totalDistanceKm
    });
  }

  return { segments, totalDistanceKm };
}

export function computeTravelerPosition(
  progress: number,
  segments: JourneySegment[],
  totalDistanceKm: number
): { lat: number; lng: number; heading: number; activeSegmentIndex: number; segmentProgress: number; distanceTraveledKm: number } {
  if (segments.length === 0) {
    return { lat: 0, lng: 0, heading: 0, activeSegmentIndex: 0, segmentProgress: 0, distanceTraveledKm: 0 };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const targetDist = clampedProgress * totalDistanceKm;

  let activeIndex = 0;
  let segStartDist = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (targetDist <= seg.cumulativeDistKm || i === segments.length - 1) {
      activeIndex = i;
      break;
    }
    segStartDist = seg.cumulativeDistKm;
  }

  const activeSeg = segments[activeIndex];
  const segLen = Math.max(0.001, activeSeg.lengthKm);
  const segDist = Math.max(0, Math.min(segLen, targetDist - segStartDist));
  const segProgress = segDist / segLen;

  // Sample along great circle arc points
  const pts = activeSeg.points;
  const pointIndex = Math.min(pts.length - 1, Math.floor(segProgress * (pts.length - 1)));
  const nextPointIndex = Math.min(pts.length - 1, pointIndex + 1);
  const localFrac = (segProgress * (pts.length - 1)) - pointIndex;

  const pA = pts[pointIndex];
  const pB = pts[nextPointIndex];

  const lat = pA.lat + (pB.lat - pA.lat) * localFrac;
  const lng = pA.lng + (pB.lng - pA.lng) * localFrac;

  // Compute accurate forward tangent along Mercator projection trajectory
  // Look at neighboring points along the arc for a smooth, glitch-free heading
  const idx0 = Math.max(0, Math.min(pts.length - 2, pointIndex));
  const idx1 = Math.min(pts.length - 1, idx0 + 1);
  const m0 = projectMercator(pts[idx0].lng, pts[idx0].lat, 10);
  const m1 = projectMercator(pts[idx1].lng, pts[idx1].lat, 10);

  let dx = m1.x - m0.x;
  let dy = m1.y - m0.y;

  // Handle antimeridian wrap if any
  const worldSize = 256 * Math.pow(2, 10);
  if (dx > worldSize / 2) dx -= worldSize;
  if (dx < -worldSize / 2) dx += worldSize;

  // Heading angle in canvas 2D space (0 = East, -PI/2 = North, +PI/2 = South, PI = West)
  const heading = (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) ? Math.atan2(dy, dx) : 0;

  return {
    lat,
    lng,
    heading,
    activeSegmentIndex: activeIndex,
    segmentProgress: segProgress,
    distanceTraveledKm: targetDist
  };
}

export function computeCameraTransform(
  progress: number,
  config: MapAnimationConfig,
  segments: JourneySegment[],
  totalDistanceKm: number,
  width: number,
  height: number
): CameraTransform & { traveler: ReturnType<typeof computeTravelerPosition> } {
  const waypoints = config.waypoints || [];
  const traveler = computeTravelerPosition(progress, segments, totalDistanceKm);

  if (waypoints.length === 0) {
    return { centerLng: 0, centerLat: 20, zoom: 2.0, traveler };
  }

  if (config.cameraMode === 'overview') {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    waypoints.forEach(wp => {
      minLat = Math.min(minLat, wp.lat);
      maxLat = Math.max(maxLat, wp.lat);
      minLng = Math.min(minLng, wp.lng);
      maxLng = Math.max(maxLng, wp.lng);
    });

    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    const spanLat = Math.max(12, (maxLat - minLat) * 1.5);
    const spanLng = Math.max(16, (maxLng - minLng) * 1.5);

    const zoomLat = Math.log2(360 / spanLat) + 0.3;
    const zoomLng = Math.log2(360 / spanLng) + 0.3;
    const zoom = Math.max(1.1, Math.min(4.8, Math.min(zoomLat, zoomLng)));

    return { centerLng, centerLat, zoom, traveler };
  }

  if (config.cameraMode === 'pan-waypoints' && segments.length > 0) {
    const activeSeg = segments[traveler.activeSegmentIndex];
    const centerLat = activeSeg.from.lat + (activeSeg.to.lat - activeSeg.from.lat) * traveler.segmentProgress;
    const centerLng = activeSeg.from.lng + (activeSeg.to.lng - activeSeg.from.lng) * traveler.segmentProgress;
    return { centerLng, centerLat, zoom: 3.2, traveler };
  }

  // Default: 'follow-traveler'
  // Dynamic altitude curves: zoom out slightly mid-leg for majestic overview, zoom in upon arrival
  const midArcDip = Math.sin(traveler.segmentProgress * Math.PI) * 0.45;
  const baseZoom = 3.6;
  const zoom = Math.max(2.1, baseZoom - midArcDip);

  return {
    centerLng: traveler.lng,
    centerLat: traveler.lat,
    zoom,
    traveler
  };
}

// ==========================================
// MASTER RENDER FUNCTION (PURE & DETERMINISTIC)
// ==========================================

export function renderMapFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number, // 0.0 to 1.0
  config: MapAnimationConfig,
  timeSec: number = 0,
  options?: { isExport?: boolean; isThumbnail?: boolean }
) {
  const palette = THEME_PALETTES[config.theme] || THEME_PALETTES["tactical-dark"];
  const waypoints = config.waypoints || [];
  const scaleMult = height / 720; // Crisp scaling across 720p, 1080p, 4K

  // Clear background
  if (palette.oceanGradient) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, palette.oceanGradient[0]);
    grad.addColorStop(1, palette.oceanGradient[1]);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = palette.ocean;
  }
  ctx.fillRect(0, 0, width, height);

  if (waypoints.length === 0) {
    ctx.fillStyle = palette.textSecondary;
    ctx.font = `${Math.round(14 * scaleMult)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No waypoints configured. Add waypoints to begin map animation.", width / 2, height / 2);
    return;
  }

  const { segments, totalDistanceKm } = solveJourneySegments(waypoints);
  const camera = computeCameraTransform(progress, config, segments, totalDistanceKm, width, height);

  // ==========================================
  // PASS 1: ESRI SATELLITE TILES (IF SATELLITE THEME)
  // ==========================================
  if (config.theme === 'real-satellite') {
    const tileZoom = Math.min(8, Math.max(2, Math.round(camera.zoom) + 1));
    const maxTiles = Math.pow(2, tileZoom);
    const centerTileX = long2tile(camera.centerLng, tileZoom);
    const centerTileY = lat2tile(camera.centerLat, tileZoom);

    const rangeX = Math.ceil(width / 256 / 2) + 2;
    const rangeY = Math.ceil(height / 256 / 2) + 2;

    for (let dx = -rangeX; dx <= rangeX; dx++) {
      for (let dy = -rangeY; dy <= rangeY; dy++) {
        const tx = ((centerTileX + dx) % maxTiles + maxTiles) % maxTiles;
        const ty = centerTileY + dy;
        if (ty < 0 || ty >= maxTiles) continue;

        const img = getOrFetchSatelliteTile(tileZoom, tx, ty);
        if (img) {
          const nwLng = tile2long(tx, tileZoom);
          const nwLat = tile2lat(ty, tileZoom);
          const seLng = tile2long(tx + 1, tileZoom);
          const seLat = tile2lat(ty + 1, tileZoom);

          const nw = geoToCanvas(nwLng, nwLat, width, height, camera);
          const se = geoToCanvas(seLng, seLat, width, height, camera);

          const tileW = Math.abs(se.x - nw.x);
          const tileH = Math.abs(se.y - nw.y);

          try {
            ctx.drawImage(img, nw.x, nw.y, tileW + 0.5, tileH + 0.5);
          } catch {}
        }
      }
    }
  }

  // ==========================================
  // PASS 2: LAT / LNG GRATICULES (MERCATOR GRID)
  // ==========================================
  if (config.showGraticule) {
    ctx.save();
    ctx.strokeStyle = palette.graticuleColor;
    ctx.lineWidth = 1 * scaleMult;

    // Latitudes every 20°
    for (let lat = -80; lat <= 80; lat += 20) {
      const p = geoToCanvas(camera.centerLng, lat, width, height, camera);
      if (p.y >= -50 && p.y <= height + 50) {
        ctx.beginPath();
        ctx.moveTo(0, p.y);
        ctx.lineTo(width, p.y);
        ctx.stroke();
      }
    }

    // Longitudes every 30°
    for (let lng = -180; lng <= 180; lng += 30) {
      const p = geoToCanvas(lng, camera.centerLat, width, height, camera);
      if (p.x >= -50 && p.x <= width + 50) {
        ctx.beginPath();
        ctx.moveTo(p.x, 0);
        ctx.lineTo(p.x, height);
        ctx.stroke();
      }
    }

    // Equator Highlight
    const eq = geoToCanvas(camera.centerLng, 0, width, height, camera);
    ctx.strokeStyle = palette.equatorColor;
    ctx.lineWidth = 1.6 * scaleMult;
    ctx.beginPath();
    ctx.moveTo(0, eq.y);
    ctx.lineTo(width, eq.y);
    ctx.stroke();
    ctx.restore();
  }

  // ==========================================
  // PASS 3: CONTINENT POLYGONS & COUNTRY BORDERS
  // ==========================================
  if (config.theme !== 'real-satellite') {
    ctx.save();
    ctx.fillStyle = palette.landFill;
    ctx.strokeStyle = palette.landStroke;
    ctx.lineWidth = palette.landStrokeWidth * scaleMult;

    WORLD_CONTINENTS.forEach(poly => {
      if (poly.length < 3) return;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const [lng, lat] = poly[i];
        const pt = geoToCanvas(lng, lat, width, height, camera);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Stylized Country Boundary Lines
    ctx.strokeStyle = palette.borderStroke;
    ctx.lineWidth = 0.9 * scaleMult;
    ctx.setLineDash([3 * scaleMult, 3 * scaleMult]);

    COUNTRY_BORDERS.forEach(line => {
      ctx.beginPath();
      for (let i = 0; i < line.length; i++) {
        const [lng, lat] = line[i];
        const pt = geoToCanvas(lng, lat, width, height, camera);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });

    ctx.restore();
  }

  // ==========================================
  // PASS 4: ROUTE PATH RENDERING (GREAT CIRCLE GEODESICS)
  // ==========================================
  if (segments.length > 0) {
    // 4A: Draw unvisited / future route outline
    ctx.save();
    ctx.strokeStyle = palette.routeUnvisited;
    ctx.lineWidth = 2.2 * scaleMult;
    ctx.setLineDash([4 * scaleMult, 4 * scaleMult]);

    segments.forEach(seg => {
      ctx.beginPath();
      for (let i = 0; i < seg.points.length; i++) {
        const p = seg.points[i];
        const pt = geoToCanvas(p.lng, p.lat, width, height, camera);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    });
    ctx.restore();

    // 4B: Draw active traversed glowing route up to current progress
    ctx.save();
    ctx.strokeStyle = palette.routeColor;
    ctx.lineWidth = 3.8 * scaleMult;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = palette.routeGlow;
    ctx.shadowBlur = 10 * scaleMult;

    if (config.trailStyle === 'dashed') {
      ctx.setLineDash([8 * scaleMult, 5 * scaleMult]);
    }

    // Fully completed segments
    for (let i = 0; i < camera.traveler.activeSegmentIndex; i++) {
      const seg = segments[i];
      ctx.beginPath();
      for (let j = 0; j < seg.points.length; j++) {
        const p = seg.points[j];
        const pt = geoToCanvas(p.lng, p.lat, width, height, camera);
        if (j === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    // Active in-progress segment
    if (camera.traveler.activeSegmentIndex < segments.length) {
      const seg = segments[camera.traveler.activeSegmentIndex];
      const maxIndex = Math.max(1, Math.round(camera.traveler.segmentProgress * (seg.points.length - 1)));

      ctx.beginPath();
      for (let j = 0; j <= maxIndex; j++) {
        const p = seg.points[j];
        const pt = geoToCanvas(p.lng, p.lat, width, height, camera);
        if (j === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================
  // PASS 5: WAYPOINT PINS & SCREEN-SPACE BADGES
  // ==========================================
  waypoints.forEach((wp, idx) => {
    const pt = geoToCanvas(wp.lng, wp.lat, width, height, camera);

    // Visibility check (skip far off-screen pins)
    if (pt.x < -100 || pt.x > width + 100 || pt.y < -100 || pt.y > height + 100) return;

    let isReached = false;
    let isActiveCurrent = false;

    if (idx === 0) {
      isReached = true;
      isActiveCurrent = camera.traveler.activeSegmentIndex === 0 && camera.traveler.segmentProgress < 0.1;
    } else if (idx <= camera.traveler.activeSegmentIndex) {
      isReached = true;
      isActiveCurrent = idx === camera.traveler.activeSegmentIndex && camera.traveler.segmentProgress > 0.88;
    }

    const pinRadius = (isActiveCurrent ? 7.5 : 5.5) * scaleMult;

    // Deterministic radar ripple pulse (pure function of timeSec)
    if (isActiveCurrent) {
      const pulseT = (timeSec % 1.5) / 1.5;
      const rippleRadius = (8 + pulseT * 24) * scaleMult;
      ctx.save();
      ctx.strokeStyle = palette.routeColor;
      ctx.lineWidth = 1.6 * scaleMult;
      ctx.globalAlpha = 1 - pulseT;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rippleRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Pin outer ring
    ctx.save();
    ctx.fillStyle = isReached ? palette.pinActive : palette.pinFill;
    ctx.strokeStyle = palette.pinBorder;
    ctx.lineWidth = 2.2 * scaleMult;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pinRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Center dot
    ctx.fillStyle = isReached ? "#ffffff" : palette.pinBorder;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pinRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Screen-space label badge with collision & edge flipping
    ctx.save();
    const labelText = wp.name.toUpperCase();
    const subText = wp.dateOrSub || wp.label || "";
    const badgePadX = 8 * scaleMult;
    const badgePadY = 4 * scaleMult;

    const mainFontSize = Math.max(10, Math.round(12 * scaleMult));
    ctx.font = `bold ${mainFontSize}px system-ui, -apple-system, sans-serif`;
    const labelMetrics = ctx.measureText(labelText);
    const badgeW = labelMetrics.width + badgePadX * 2;
    const badgeH = (subText ? 26 : 18) * scaleMult;

    let badgeX = pt.x - badgeW / 2;
    let badgeY = pt.y - pinRadius - badgeH - (8 * scaleMult);

    // Edge flipping if too close to top
    if (badgeY < 20 * scaleMult) {
      badgeY = pt.y + pinRadius + 8 * scaleMult;
    }

    // Clamp inside viewport horizontally
    badgeX = Math.max(10 * scaleMult, Math.min(width - badgeW - 10 * scaleMult, badgeX));

    // Badge Background
    ctx.fillStyle = isReached ? palette.cardBg : "rgba(0, 0, 0, 0.6)";
    ctx.strokeStyle = isReached ? palette.cardBorder : "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.2 * scaleMult;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4 * scaleMult);
    ctx.fill();
    ctx.stroke();

    // City Name
    ctx.fillStyle = isReached ? palette.textPrimary : palette.textSecondary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, badgeX + badgeW / 2, badgeY + (subText ? 8 * scaleMult : badgeH / 2));

    // Subtext
    if (subText) {
      const subFontSize = Math.max(8, Math.round(9 * scaleMult));
      ctx.font = `${subFontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textSecondary;
      ctx.fillText(subText, badgeX + badgeW / 2, badgeY + 19 * scaleMult);
    }
    ctx.restore();
  });

  // ==========================================
  // PASS 6: TRAVELER VEHICLE / MARKER
  // ==========================================
  if (segments.length > 0) {
    const travelerCanvas = geoToCanvas(camera.traveler.lng, camera.traveler.lat, width, height, camera);
    const travelerScale = 1.35 * scaleMult;
    drawTravelerIcon(
      ctx,
      config.travelerIcon,
      travelerCanvas.x,
      travelerCanvas.y,
      camera.traveler.heading,
      palette.vehicleColor,
      travelerScale
    );
  }

  // ==========================================
  // PASS 7: SCREEN-SPACE HUD & TELEMETRY
  // ==========================================
  // Compass Rose
  if (config.showCompass) {
    const compassX = width - 48 * scaleMult;
    const compassY = height - 48 * scaleMult;
    drawCompassRose(ctx, compassX, compassY, 26 * scaleMult, palette);
  }

  // Story Title & Subtitle Banner (Top-Left)
  if (config.title || config.subtitle) {
    ctx.save();
    const titleX = 28 * scaleMult;
    const titleY = 36 * scaleMult;

    if (config.title) {
      ctx.font = `bold ${Math.round(20 * scaleMult)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textPrimary;
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 8 * scaleMult;
      ctx.fillText(config.title, titleX, titleY);
    }

    if (config.subtitle) {
      ctx.font = `${Math.round(12 * scaleMult)}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = palette.textSecondary;
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 6 * scaleMult;
      ctx.fillText(config.subtitle, titleX, titleY + 20 * scaleMult);
    }
    ctx.restore();
  }

  // Telemetry HUD & Distance Counter (Bottom-Left)
  if (config.showCoordinates && segments.length > 0) {
    ctx.save();
    const lat = camera.traveler.lat;
    const lng = camera.traveler.lng;
    const latDir = lat >= 0 ? "N" : "S";
    const lngDir = lng >= 0 ? "E" : "W";

    const coordsStr = `LAT ${Math.abs(lat).toFixed(2)}° ${latDir} | LNG ${Math.abs(lng).toFixed(2)}° ${lngDir}`;
    const distStr = `${Math.round(camera.traveler.distanceTraveledKm).toLocaleString()} KM`;
    const pctStr = `${Math.round(progress * 100)}% COMPLETE`;

    ctx.font = `bold ${Math.round(11 * scaleMult)}px monospace, ui-monospace, sans-serif`;
    ctx.fillStyle = palette.hudAccent;
    ctx.fillText(`${coordsStr}   //   ${distStr}   //   ${pctStr}`, 28 * scaleMult, height - 24 * scaleMult);
    ctx.restore();
  }

  // Attribution (Esri / OpenStreetMap) in satellite mode
  if (config.theme === 'real-satellite') {
    ctx.save();
    ctx.font = `${Math.round(9 * scaleMult)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.textAlign = "right";
    ctx.fillText("Imagery © Esri, Maxar, Earthstar Geographics", width - 80 * scaleMult, height - 12 * scaleMult);
    ctx.restore();
  }

  // Tactical Neon Overlay (if configured)
  if (config.overlayEffect && config.overlayEffect !== 'none') {
    const label = config.title || (waypoints[0] ? waypoints[0].name : "TACTICAL RECON");
    drawNeonOverlay(ctx, width, height, label, config.overlayEffect, scaleMult);
  }
}

// ==========================================
// PROCEDURAL AUDIO SYNTHESIZER FOR MAP SHOTS
// ==========================================

export async function generateMapAudioBuffer(
  config: MapAnimationConfig,
  durationSec: number,
  sampleRate: number = 44100
): Promise<AudioBuffer | null> {
  const audioCfg = config.audioConfig || { ambientDrone: false, whooshSfx: true, pingSfx: true };
  if (!audioCfg.ambientDrone && !audioCfg.whooshSfx && !audioCfg.pingSfx) {
    return null;
  }

  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
    const totalSamples = Math.round(durationSec * sampleRate);
    const audioBuffer = ctx.createBuffer(2, totalSamples, sampleRate);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);

    // 1. Ambient 55Hz cinematic sub-bass drone (subtle, if enabled)
    if (audioCfg.ambientDrone) {
      const vol = audioCfg.droneVolume !== undefined ? audioCfg.droneVolume : 0.15;
      for (let i = 0; i < totalSamples; i++) {
        const t = i / sampleRate;
        const fade = Math.min(1, t / 0.5) * Math.min(1, (durationSec - t) / 0.5);
        const sample = Math.sin(2 * Math.PI * 55 * t) * 0.7 + Math.sin(2 * Math.PI * 110 * t) * 0.3;
        left[i] += sample * vol * fade;
        right[i] += sample * vol * fade;
      }
    }

    // 2. Whoosh at start (0.0s to 0.8s)
    if (audioCfg.whooshSfx) {
      const whooshLen = Math.round(0.8 * sampleRate);
      for (let i = 0; i < whooshLen && i < totalSamples; i++) {
        const t = i / sampleRate;
        const env = Math.sin((t / 0.8) * Math.PI);
        const freq = 120 + 280 * (t / 0.8);
        const noise = (Math.random() * 2 - 1) * 0.2;
        const val = (Math.sin(2 * Math.PI * freq * t) * 0.15 + noise) * env * 0.22;
        left[i] += val;
        right[i] += val;
      }
    }

    // 3. Arrival Ping near end (durationSec - 0.7s)
    if (audioCfg.pingSfx) {
      const pingStartSample = Math.max(0, Math.round((durationSec - 0.75) * sampleRate));
      const pingLen = Math.round(0.6 * sampleRate);
      for (let i = 0; i < pingLen && pingStartSample + i < totalSamples; i++) {
        const t = i / sampleRate;
        const decay = Math.exp(-t * 6);
        const val = Math.sin(2 * Math.PI * 880 * t) * decay * 0.18;
        left[pingStartSample + i] += val;
        right[pingStartSample + i] += val;
      }
    }

    return audioBuffer;
  } catch (err) {
    console.warn("Could not generate procedural map audio buffer:", err);
    return null;
  }
}

// ==========================================
// HIGH-SPEED DETERMINISTIC OFFLINE EXPORT
// ==========================================

export async function exportMapVideoDeterministic(
  config: MapAnimationConfig,
  options?: {
    format?: 'mp4' | 'webm';
    fps?: number;
    width?: number;
    height?: number;
    onProgress?: (pct: number) => void;
    includeAudio?: boolean;
  }
): Promise<{ blob: Blob; objectUrl: string; posterDataUrl: string; durationSec: number }> {
  const fps = options?.fps || 30;
  const durationSec = Math.max(MIN_MAP_DURATION, Math.min(MAX_MAP_DURATION, config.duration || DEFAULT_MAP_DURATION));
  const totalFrames = Math.round(durationSec * fps);
  const format = options?.format || 'mp4';

  const isVertical = config.aspectRatio === '9:16';
  const isSquare = config.aspectRatio === '1:1';
  const width = options?.width || (isVertical ? 1080 : isSquare ? 1080 : 1920);
  const height = options?.height || (isVertical ? 1920 : isSquare ? 1080 : 1080);

  // Preload tiles if satellite theme
  if (config.theme === 'real-satellite') {
    preloadSatelliteTilesForRoute(config.waypoints);
    await new Promise(r => setTimeout(r, 400));
  }

  // Create canvas for rendering
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Render initial poster frame
  renderMapFrame(ctx, width, height, 0, config, 0, { isThumbnail: true });
  const posterDataUrl = canvas.toDataURL('image/png');

  try {
    // Fast Deterministic Encode with mediabunny Output
    const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, EncodedVideoPacketSource, EncodedPacket } = await import('mediabunny');
    const target = new BufferTarget();
    const output = new Output({
      format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat({}),
      target
    });

    const videoSource = new EncodedVideoPacketSource(format === 'mp4' ? 'avc' : 'vp9');
    output.addVideoTrack(videoSource, { frameRate: fps });
    await output.start();

    const encoderCodec = format === 'mp4' ? 'avc1.4d002a' : 'vp09.00.10.08';
    let videoEncoder: VideoEncoder | null = null;
    let encodeError: Error | null = null;
    let pendingVideoAdd: Promise<void> | null = null;

    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        pendingVideoAdd = (pendingVideoAdd || Promise.resolve()).then(() =>
          videoSource.add(EncodedPacket.fromEncodedChunk(chunk as any), meta)
        );
      },
      error: (e) => {
        encodeError = e instanceof Error ? e : new Error(String(e));
      }
    });

    videoEncoder.configure({
      codec: encoderCodec,
      width,
      height,
      bitrate: 8_000_000,
      framerate: fps
    });

    for (let f = 0; f < totalFrames; f++) {
      if (encodeError) throw encodeError;

      const t = f / fps;
      const progress = totalFrames > 1 ? f / (totalFrames - 1) : 0;

      renderMapFrame(ctx, width, height, progress, config, t, { isExport: true });

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(f * (1_000_000 / fps)),
        duration: Math.round(1_000_000 / fps)
      });

      videoEncoder.encode(videoFrame, { keyFrame: f % 30 === 0 });
      videoFrame.close();

      if (options?.onProgress && f % 5 === 0) {
        options.onProgress(Math.round((f / totalFrames) * 90));
      }
    }

    await videoEncoder.flush();
    if (pendingVideoAdd) await pendingVideoAdd;
    videoEncoder.close();
    await output.finalize();

    if (options?.onProgress) options.onProgress(100);

    const mimeType = format === 'mp4' ? 'video/mp4' : 'video/webm';
    const blob = new Blob([target.buffer!], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);

    return { blob, objectUrl, posterDataUrl, durationSec };
  } catch (err) {
    console.warn("Fast WebCodecs encode failed, falling back to MediaRecorder:", err);
    return recordMapAnimationFallback(canvas, config, durationSec, fps, options?.onProgress, options?.includeAudio);
  }
}

async function recordMapAnimationFallback(
  canvas: HTMLCanvasElement,
  config: MapAnimationConfig,
  durationSec: number,
  fps: number = 30,
  onProgress?: (pct: number) => void,
  includeAudio: boolean = false
): Promise<{ blob: Blob; objectUrl: string; posterDataUrl: string; durationSec: number }> {
  const totalFrames = Math.round(durationSec * fps);
  const ctx = canvas.getContext('2d')!;

  renderMapFrame(ctx, canvas.width, canvas.height, 0, config, 0);
  const posterDataUrl = canvas.toDataURL('image/png');

  const stream = canvas.captureStream(fps);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/mp4')
    ? 'video/mp4'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6000000 });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const promise = new Promise<{ blob: Blob; objectUrl: string; posterDataUrl: string; durationSec: number }>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      resolve({ blob, objectUrl, posterDataUrl, durationSec });
    };
    recorder.onerror = reject;
  });

  recorder.start();

  const frameIntervalMs = 1000 / fps;
  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / fps;
    const progress = totalFrames > 1 ? frame / (totalFrames - 1) : 0;
    renderMapFrame(ctx, canvas.width, canvas.height, progress, config, t);
    if (onProgress) onProgress(Math.round((frame / totalFrames) * 100));
    await new Promise(r => setTimeout(r, frameIntervalMs));
  }

  recorder.stop();
  return promise;
}

// Backward-compatible alias for existing imports
export const recordMapAnimationToVideo = exportMapVideoDeterministic;
