// ---------------------------------------------------------------------------
// sky.js — atmosphere, sun, moon, clouds and an astronomically-placed star
// field. The player is expected to steer by the stars, so the catalogue is
// real and precessed back to roughly 1200 BC.
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { GLSL_NOISE } from '../core/noise.js';
import { moonTexture } from '../core/textures.js';

const D2R = Math.PI / 180;

// ---------------------------------------------------------------------------
// Star catalogue. RA (hours), Dec (degrees), visual magnitude, colour index.
// The bright stars Homer's sailors actually used, plus enough others that the
// constellations read. Coordinates are J2000; we precess them below.
// ---------------------------------------------------------------------------

const STARS = [
  // name,           RA h,     Dec °,    mag,   B-V
  ['Sirius',          6.7525, -16.7161, -1.46,  0.00],
  ['Canopus',         6.3992, -52.6957, -0.72,  0.15],
  ['Arcturus',       14.2610,  19.1825, -0.05,  1.23],
  ['Vega',           18.6156,  38.7837,  0.03,  0.00],
  ['Capella',         5.2782,  45.9980,  0.08,  0.80],
  ['Rigel',           5.2423,  -8.2016,  0.13, -0.03],
  ['Procyon',         7.6550,   5.2250,  0.34,  0.42],
  ['Betelgeuse',      5.9195,   7.4070,  0.50,  1.85],
  ['Achernar',        1.6286, -57.2367,  0.46, -0.16],
  ['Altair',         19.8464,   8.8683,  0.77,  0.22],
  ['Aldebaran',       4.5987,  16.5093,  0.85,  1.54],
  ['Antares',        16.4901, -26.4320,  1.09,  1.83],
  ['Spica',          13.4199, -11.1613,  0.97, -0.23],
  ['Pollux',          7.7553,  28.0262,  1.14,  1.00],
  ['Fomalhaut',      22.9608, -29.6222,  1.16,  0.09],
  ['Deneb',          20.6905,  45.2803,  1.25,  0.09],
  ['Regulus',        10.1395,  11.9672,  1.35, -0.11],
  ['Castor',          7.5766,  31.8883,  1.58,  0.03],
  ['Bellatrix',       5.4189,   6.3497,  1.64, -0.22],
  ['Elnath',          5.4382,  28.6075,  1.65, -0.13],
  ['Alnilam',         5.6036,  -1.2019,  1.69, -0.18],
  ['Alnitak',         5.6793,  -1.9426,  1.77, -0.21],
  ['Mintaka',         5.5334,  -0.2991,  2.23, -0.18],
  ['Saiph',           5.7959, -9.66961,  2.06, -0.17],
  ['Alnair',         22.1372, -46.9610,  1.74, -0.13],
  ['Alioth',         12.9005,  55.9598,  1.77, -0.02],  // Ursa Major
  ['Dubhe',          11.0621,  61.7510,  1.79,  1.07],
  ['Alkaid',         13.7923,  49.3133,  1.86, -0.19],
  ['Mizar',          13.3987,  54.9254,  2.23,  0.02],
  ['Merak',          11.0307,  56.3824,  2.37,  0.03],
  ['Phecda',         11.8972,  53.6948,  2.44,  0.04],
  ['Megrez',         12.2571,  57.0326,  3.31,  0.08],
  ['Polaris',         2.5303,  89.2641,  1.98,  0.60],  // near-pole today; NOT in 1200 BC
  ['Kochab',         14.8451,  74.1555,  2.08,  1.47],  // Ursa Minor — the pole star of the era
  ['Pherkad',        15.3455,  71.8340,  3.00,  0.06],
  ['Thuban',         14.0731,  64.3758,  3.65, -0.05],  // Draco — pole star ~2700 BC
  ['Schedar',         0.6751,  56.5373,  2.24,  1.17],  // Cassiopeia
  ['Caph',            0.1530,  59.1498,  2.28,  0.34],
  ['Gamma Cas',       0.9451,  60.7167,  2.47, -0.15],
  ['Ruchbah',         1.4303,  60.2353,  2.68,  0.16],
  ['Segin',           1.9066,  63.6701,  3.35, -0.15],
  ['Alpheratz',       0.1398,  29.0904,  2.06, -0.11],  // Pegasus square
  ['Scheat',         23.0629,  28.0828,  2.42,  1.66],
  ['Markab',         23.0793,  15.2053,  2.49, -0.04],
  ['Algenib',         0.2206,  15.1836,  2.83, -0.19],
  ['Hamal',           2.1195,  23.4624,  2.00,  1.15],  // Aries
  ['Sheratan',        1.9105,  20.8080,  2.64,  0.17],
  ['Alcyone',         3.7914,  24.1051,  2.87, -0.09],  // Pleiades
  ['Atlas',           3.8194,  24.0534,  3.62, -0.08],
  ['Electra',         3.7449,  24.1133,  3.70, -0.11],
  ['Maia',            3.7719,  24.3675,  3.86, -0.07],
  ['Merope',          3.7719,  23.9481,  4.14, -0.06],
  ['Taygeta',         3.7551,  24.4672,  4.30, -0.11],
  ['Denebola',       11.8177,  14.5720,  2.14,  0.09],
  ['Algieba',        10.3328,  19.8415,  2.28,  1.13],
  ['Alphard',         9.4597,  -8.6586,  1.98,  1.44],
  ['Gacrux',         12.5194, -57.1132,  1.63,  1.60],
  ['Acrux',          12.4433, -63.0991,  0.77, -0.24],
  ['Mimosa',         12.7953, -59.6888,  1.25, -0.24],
  ['Hadar',          14.0637, -60.3730,  0.61, -0.23],
  ['Rigil Kent',     14.6601, -60.8354, -0.27,  0.71],
  ['Menkalinan',      5.9922,  44.9474,  1.90,  0.08],
  ['Alhena',          6.6285,  16.3993,  1.93,  0.00],
  ['Mirfak',          3.4054,  49.8612,  1.79,  0.48],
  ['Algol',           3.1361,  40.9556,  2.12, -0.05],
  ['Almach',          2.0650,  42.3297,  2.10,  1.37],
  ['Mirach',          1.1622,  35.6206,  2.05,  1.58],
  ['Enif',           21.7364,   9.8750,  2.39,  1.52],
  ['Sadr',           20.3705,  40.2567,  2.23,  0.68],
  ['Albireo',        19.5121,  27.9597,  3.18,  1.09],
  ['Gienah Cygni',   20.7702,  33.9703,  2.48, -0.10],
  ['Delta Cygni',    19.7496,  45.1308,  2.87, -0.03],
  ['Eltanin',        17.9434,  51.4889,  2.23,  1.52],
  ['Rastaban',       17.5072,  52.3014,  2.79,  0.95],
  ['Alphecca',       15.5781,  26.7147,  2.22, -0.02],
  ['Unukalhai',      15.7379,   6.4256,  2.63,  1.17],
  ['Rasalhague',     17.5822,  12.5600,  2.08,  0.15],
  ['Sabik',          17.1729, -15.7250,  2.43,  0.06],
  ['Shaula',         17.5601, -37.1038,  1.62, -0.22],
  ['Sargas',         17.6220, -42.9978,  1.86,  0.40],
  ['Dschubba',       16.0055, -22.6217,  2.29, -0.12],
  ['Graffias',       16.0906, -19.8054,  2.56, -0.07],
  ['Kaus Australis', 18.4029, -34.3846,  1.85, -0.03],
  ['Nunki',          18.9211, -26.2967,  2.05, -0.22],
  ['Ascella',        19.0435, -29.8803,  2.60,  0.06],
  ['Deneb Algedi',   21.7840, -16.1273,  2.85,  0.18],
  ['Sadalsuud',      21.5250,  -5.5712,  2.90,  0.83],
  ['Diphda',          0.7264, -17.9866,  2.04,  1.02],
  ['Menkar',          3.0380,   4.0897,  2.53,  1.63],
  ['Mira',            2.3225,  -2.9776,  3.04,  1.42],
  ['Acamar',          2.9710, -40.3047,  2.90,  0.13],
  ['Zaurak',          3.9678, -13.5086,  2.97,  1.59],
  ['Cursa',           5.1308,  -5.0864,  2.79, -0.13],
  ['Wezen',           7.1399, -26.3932,  1.83,  0.67],
  ['Adhara',          6.9770, -28.9721,  1.50, -0.21],
  ['Mirzam',          6.3783, -17.9559,  1.98, -0.24],
  ['Aludra',          7.4015, -29.3031,  2.45, -0.08],
  ['Naos',            8.0597, -40.0031,  2.21, -0.27],
  ['Avior',           8.3752, -59.5095,  1.86,  1.20],
  ['Miaplacidus',     9.2200, -69.7172,  1.68,  0.07],
  ['Suhail',          9.1332, -43.4326,  2.21,  1.66],
  ['Alsephina',       8.7451, -54.7089,  1.96,  0.04],
  ['Turais',          9.2848, -59.2753,  2.21,  0.19],
  ['Alkes',          10.9962,  -0.4380,  4.08,  1.08],
  ['Gienah Corvi',   12.2634, -17.5419,  2.59, -0.11],
  ['Algorab',        12.4972, -16.5154,  2.94, -0.05],
  ['Kraz',           12.5735, -23.3966,  2.65,  0.89],
  ['Zubenelgenubi',  14.8479, -16.0418,  2.75,  0.15],
  ['Zubeneschamali', 15.2830,  -9.3829,  2.61, -0.07],
  ['Muphrid',        13.9114,  18.3977,  2.68,  0.58],
  ['Izar',           14.7498,  27.0742,  2.35,  0.97],
  ['Seginus',        14.5346,  38.3082,  3.03,  0.19],
  ['Nekkar',         15.0322,  40.3906,  3.49,  0.95],
  ['Cor Caroli',     12.9338,  38.3187,  2.89, -0.12],
  ['Talitha',        8.9868,   48.0417,  3.14,  0.22],
  ['Tania Australis', 10.3721, 41.4995,  3.06,  1.60],
  ['Alula Borealis', 11.3081,  33.0943,  3.49,  1.40],
  ['Muscida',         8.5041,  60.7182,  3.35,  0.86],
  ['Yildun',         17.5369,  86.5865,  4.36,  0.00],
  ['Epsilon UMi',    16.7661,  82.0373,  4.21,  0.89],
  ['Zeta UMi',       15.7345,  77.7944,  4.29,  0.04],
  ['Eta UMi',        16.2917,  75.7554,  4.95,  0.37],
];

// Named asterism links — drawn faintly so the player can actually recognise
// the shapes they are told to steer by.
const ASTERISMS = {
  'Arktos': [ // the Bear — "she alone has no share in the baths of Ocean"
    ['Dubhe','Merak'],['Merak','Phecda'],['Phecda','Megrez'],['Megrez','Dubhe'],
    ['Megrez','Alioth'],['Alioth','Mizar'],['Mizar','Alkaid'],
  ],
  'Ursa Minor': [
    ['Polaris','Yildun'],['Yildun','Epsilon UMi'],['Epsilon UMi','Zeta UMi'],
    ['Zeta UMi','Kochab'],['Kochab','Pherkad'],['Pherkad','Eta UMi'],['Eta UMi','Zeta UMi'],
  ],
  'Orion': [
    ['Betelgeuse','Bellatrix'],['Bellatrix','Mintaka'],['Mintaka','Alnilam'],
    ['Alnilam','Alnitak'],['Alnitak','Betelgeuse'],['Mintaka','Rigel'],['Alnitak','Saiph'],
    ['Rigel','Saiph'],
  ],
  'Cassiopeia': [
    ['Caph','Schedar'],['Schedar','Gamma Cas'],['Gamma Cas','Ruchbah'],['Ruchbah','Segin'],
  ],
  'Cygnus': [
    ['Deneb','Sadr'],['Sadr','Albireo'],['Gienah Cygni','Sadr'],['Sadr','Delta Cygni'],
  ],
  'Scorpius': [
    ['Dschubba','Graffias'],['Dschubba','Antares'],['Antares','Sargas'],['Sargas','Shaula'],
  ],
  'Bootes': [
    ['Arcturus','Muphrid'],['Arcturus','Izar'],['Izar','Seginus'],['Seginus','Nekkar'],
  ],
};

/**
 * Precess equatorial coordinates from J2000 to a target year (negative = BC).
 * Uses the standard rotate-to-ecliptic / shift-longitude / rotate-back method,
 * which is more than accurate enough at naked-eye resolution.
 */
function precess(raHours, decDeg, year) {
  const ra = raHours * 15 * D2R, dec = decDeg * D2R;
  const eps0 = 23.4393 * D2R;
  const yrs = year - 2000;
  // general precession in longitude, ~50.29"/yr
  const dLon = (50.2879 * yrs) / 3600 * D2R;
  // obliquity drifts slowly; at -1200 it was ~23.86°
  const eps1 = (23.4393 + 0.0130042 * (-yrs / 100)) * D2R;

  // equatorial → ecliptic
  const sinB = Math.sin(dec) * Math.cos(eps0) - Math.cos(dec) * Math.sin(eps0) * Math.sin(ra);
  const b = Math.asin(Math.max(-1, Math.min(1, sinB)));
  const l = Math.atan2(
    Math.sin(ra) * Math.cos(eps0) + Math.tan(dec) * Math.sin(eps0),
    Math.cos(ra)
  );
  const l2 = l + dLon;
  // ecliptic → equatorial with the era's obliquity
  const sinD = Math.sin(b) * Math.cos(eps1) + Math.cos(b) * Math.sin(eps1) * Math.sin(l2);
  const dec2 = Math.asin(Math.max(-1, Math.min(1, sinD)));
  const ra2 = Math.atan2(
    Math.sin(l2) * Math.cos(eps1) - Math.tan(b) * Math.sin(eps1),
    Math.cos(l2)
  );
  return { ra: (ra2 + Math.PI * 4) % (Math.PI * 2), dec: dec2 };
}

/** Convert B−V colour index to a linear RGB tint. */
function bvToRGB(bv) {
  // approximate blackbody: Ballesteros' formula for temperature, then a fit
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const x = Math.max(1000, Math.min(40000, t)) / 100;
  let r, g, b;
  if (x <= 66) { r = 255; } else { r = 329.7 * Math.pow(x - 60, -0.1332); }
  if (x <= 66) { g = 99.47 * Math.log(x) - 161.1; } else { g = 288.1 * Math.pow(x - 60, -0.0755); }
  if (x >= 66) { b = 255; } else if (x <= 19) { b = 0; } else { b = 138.5 * Math.log(x - 10) - 305; }
  const c = (v) => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2);
  return [c(r), c(g), c(b)];
}

// ---------------------------------------------------------------------------
// Atmosphere shader
// ---------------------------------------------------------------------------

const ATMO_COMMON = /* glsl */`
  // Physical-ish single scattering. Units are metres, Earth-scaled.
  const float R_PLANET = 6371000.0;
  const float R_ATMOS  = 6471000.0;
  const vec3  BETA_R   = vec3(5.802e-6, 13.558e-6, 33.1e-6); // Rayleigh
  const float BETA_M   = 3.996e-6;                            // Mie scatter
  const float BETA_MA  = 4.40e-6;                             // Mie extinction
  const vec3  BETA_O   = vec3(0.650e-6, 1.881e-6, 0.085e-6);  // ozone
  const float H_R = 8000.0;
  const float H_M = 1200.0;
  // stands in for solar spectral irradiance in our working units
  uniform float uSkyScale;
  uniform float uMultiScatter;

  float rayleighPhase(float mu){ return 3.0 / (16.0 * 3.14159265) * (1.0 + mu*mu); }
  float miePhase(float mu, float g){
    float g2 = g*g;
    return 3.0 / (8.0*3.14159265) * ((1.0-g2)*(1.0+mu*mu)) /
           ((2.0+g2) * pow(1.0 + g2 - 2.0*g*mu, 1.5));
  }

  // ray-sphere; returns far intersection distance (assumes origin inside)
  float atmosDist(vec3 o, vec3 d, float R){
    float b = dot(o, d);
    float c = dot(o, o) - R*R;
    float disc = b*b - c;
    if(disc < 0.0) return -1.0;
    return -b + sqrt(disc);
  }
  bool hitsPlanet(vec3 o, vec3 d){
    float b = dot(o, d);
    float c = dot(o, o) - R_PLANET*R_PLANET;
    float disc = b*b - c;
    return (disc > 0.0) && (-b - sqrt(disc) > 0.0);
  }

  vec3 opticalDepthToSun(vec3 p, vec3 sunDir, int steps){
    float far = atmosDist(p, sunDir, R_ATMOS);
    if(far <= 0.0) return vec3(1e9);
    float ds = far / float(steps);
    float odR = 0.0, odM = 0.0;
    for(int i = 0; i < 8; i++){
      if(i >= steps) break;
      vec3 s = p + sunDir * (ds * (float(i) + 0.5));
      float h = max(0.0, length(s) - R_PLANET);
      odR += exp(-h / H_R) * ds;
      odM += exp(-h / H_M) * ds;
    }
    return BETA_R * odR + vec3(BETA_MA) * odM + BETA_O * odR * 0.12;
  }

  // returns in-scattered radiance, and writes transmittance along the view ray
  vec3 skyRadiance(vec3 origin, vec3 dir, vec3 sunDir, float turbidity,
                   int viewSteps, out vec3 transmit){
    float far = atmosDist(origin, dir, R_ATMOS);
    if(hitsPlanet(origin, dir)){
      float b = dot(origin, dir);
      float c = dot(origin, origin) - R_PLANET*R_PLANET;
      far = -b - sqrt(max(0.0, b*b - c));
    }
    far = max(far, 0.0);
    float ds = far / float(viewSteps);
    float mu = dot(dir, sunDir);
    float pR = rayleighPhase(mu);
    float pM = miePhase(mu, 0.76);

    vec3 sumR = vec3(0.0), sumM = vec3(0.0);
    vec3 msR  = vec3(0.0), msM  = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    float mieScale = BETA_M * turbidity;

    for(int i = 0; i < 16; i++){
      if(i >= viewSteps) break;
      vec3 p = origin + dir * (ds * (float(i) + 0.5));
      float h = max(0.0, length(p) - R_PLANET);
      float hr = exp(-h / H_R) * ds;
      float hm = exp(-h / H_M) * ds;
      odR += hr; odM += hm;

      vec3 odSun = opticalDepthToSun(p, sunDir, 5);
      vec3 odView = BETA_R * odR + vec3(BETA_MA * turbidity) * odM + BETA_O * odR * 0.12;
      vec3 atten = exp(-(odSun + odView));

      sumR += hr * atten;
      sumM += hm * atten;

      // Higher-order scattering. A pure single-scattering sky is always too
      // dark and far too red along long paths, because in reality most of the
      // light reaching you near the horizon has bounced several times. This is
      // Hillaire's approximation: re-integrate with heavily softened
      // extinction and an isotropic phase.
      vec3 msAtten = exp(-(odSun * 0.22 + odView * 0.5)) * 0.55 + 0.14;
      msR += hr * msAtten;
      msM += hm * msAtten;
    }
    transmit = exp(-(BETA_R * odR + vec3(BETA_MA * turbidity) * odM + BETA_O * odR * 0.12));

    vec3 single = sumR * BETA_R * pR + sumM * mieScale * pM;
    vec3 multi  = (msR * BETA_R + msM * mieScale) * 0.0795774;  // 1/(4π)
    return (single + multi * uMultiScatter) * uSkyScale;
  }
`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w;   // force to far plane
  }
`;

// Fullscreen-quad vertex stage for baking the sky into an equirectangular map.
const SKY_BAKE_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Shared mapping between a direction and equirectangular UV. */
const DIR_UV = /* glsl */`
  vec2 dirToUV(vec3 d){
    return vec2(atan(d.z, d.x) / 6.2831853 + 0.5,
                acos(clamp(d.y, -1.0, 1.0)) / 3.14159265);
  }
  vec3 uvToDir(vec2 uv){
    float phi = (uv.x - 0.5) * 6.2831853;
    float theta = uv.y * 3.14159265;
    float st = sin(theta);
    return vec3(cos(phi) * st, cos(theta), sin(phi) * st);
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;

  uniform vec3  uSunDir;
  uniform vec3  uMoonDir;
  uniform float uSunIntensity;
  uniform float uMoonIntensity;
  uniform float uTurbidity;
  uniform float uTime;
  uniform float uCloudCover;      // 0..1
  uniform float uCloudHeight;
  uniform float uCloudTop;
  uniform float uStormy;          // 0..1 darkens & thickens
  uniform float uExposure;
  uniform int   uViewSteps;
  uniform int   uCloudSteps;
  uniform float uStarBright;
  uniform sampler2D uStarTex;     // equirect star map in CELESTIAL coordinates
  uniform mat3  uStarMat;         // world dir -> celestial dir

  ${ATMO_COMMON}
  ${GLSL_NOISE}
  ${DIR_UV}

  // --- cloud layer -------------------------------------------------------
  float cloudDensity(vec3 p, float cover, int oct){
    vec3 q = p * 0.00019;
    q.x += uTime * 0.0040;
    q.z += uTime * 0.0025;
    // vertical profile: flat bottoms, billowing tops — the shape that reads
    // as cumulus rather than as fog
    float hN = clamp((p.y - uCloudHeight) / max(1.0, uCloudTop - uCloudHeight), 0.0, 1.0);
    float profile = smoothstep(0.0, 0.12, hN) * (1.0 - smoothstep(0.42, 1.0, hN));

    float base = fbm(q, oct) * 0.5 + 0.5;
    float d = (base - (1.0 - cover)) * profile * 2.4;
    if(d <= 0.0) return 0.0;
    // erode the edges with higher-frequency billows
    float det = fbm(q * 5.3 + vec3(0.0, uTime * 0.03, 0.0), 2) * 0.5 + 0.5;
    d -= (1.0 - det) * 0.42 * (1.0 - uStormy * 0.35);
    return max(0.0, d) * mix(1.0, 2.1, uStormy);
  }

  vec4 clouds(vec3 dir, vec3 sunDir, vec3 sunCol, vec3 ambCol){
    if(dir.y < 0.006) return vec4(0.0);
    float cover = mix(0.30, 0.92, uCloudCover);
    float t0 = uCloudHeight / dir.y;
    float t1 = uCloudTop / dir.y;
    if(t0 > 320000.0) return vec4(0.0);
    t1 = min(t1, 360000.0);
    float span = t1 - t0;
    if(span <= 0.0) return vec4(0.0);

    int steps = uCloudSteps;
    float dt = span / float(steps);
    float trans = 1.0;
    vec3 scat = vec3(0.0);
    float jitter = hash12(gl_FragCoord.xy * 0.7 + uTime) * dt;

    float mu = dot(dir, sunDir);
    // extinction coefficient, per metre
    const float SIGMA = 0.00042;

    for(int i = 0; i < 24; i++){
      if(i >= steps || trans < 0.015) break;
      vec3 p = dir * (t0 + dt * float(i) + jitter);
      float d = cloudDensity(p, cover, 4);
      if(d > 0.002){
        // optical depth toward the sun, sampled sparsely with growing steps
        float sh = 0.0;
        float sl = 190.0;
        for(int j = 0; j < 4; j++){
          sh += cloudDensity(p + sunDir * sl, cover, 2) * sl;
          sl *= 2.05;
        }

        // Multiple-scattering approximation: three octaves with progressively
        // weaker extinction and flatter phase. This is what stops thick cloud
        // reading as a black lump — real cloud interiors are bright because
        // light bounces, and single scattering cannot express that.
        vec3 energy = vec3(0.0);
        float a = 1.0, b = 1.0, c = 1.0;
        for(int o = 0; o < 3; o++){
          float ph = mix(miePhase(mu, 0.72 * c), 0.079577, 1.0 - c);
          energy += a * exp(-sh * SIGMA * b) * ph;
          a *= 0.52; b *= 0.42; c *= 0.55;
        }

        // powder term — darkens the sunward edges of dense cloud
        float powder = 1.0 - exp(-d * 7.0);
        powder = mix(1.0, powder, clamp(0.5 - mu * 0.5, 0.0, 1.0));

        vec3 col = sunCol * energy * powder * 2.6;
        col += ambCol * (0.55 + 0.45 * (1.0 - exp(-d * 2.0)));   // sky fill
        col *= mix(1.0, 0.34, uStormy);

        float a2 = 1.0 - exp(-d * SIGMA * dt);
        scat += col * a2 * trans;
        trans *= 1.0 - a2;
      }
    }
    // fade the slab out toward the horizon so its edge never shows
    float horizonFade = smoothstep(0.0, 0.075, dir.y);
    return vec4(scat * horizonFade, (1.0 - trans) * horizonFade);
  }

  void main(){
    vec3 dir = uvToDir(vUv);
    vec3 origin = vec3(0.0, R_PLANET + 12.0, 0.0);

    vec3 transmit;
    vec3 sun = skyRadiance(origin, dir, uSunDir, uTurbidity, uViewSteps, transmit) * uSunIntensity;

    // the moon lights the sky too, ~400,000× fainter but it sets the night blue
    vec3 tm;
    vec3 moon = skyRadiance(origin, dir, uMoonDir, uTurbidity, 4, tm) * uMoonIntensity;

    vec3 col = sun + moon;

    // --- clouds composited over the sky
    vec3 sunCol = vec3(1.0, 0.93, 0.82) * uSunIntensity
                + vec3(0.55, 0.62, 0.85) * uMoonIntensity * 1.6;
    // ambient the clouds sit in: the sky directly above them
    vec3 zenithT;
    vec3 ambCol = skyRadiance(origin, vec3(0.0, 1.0, 0.0), uSunDir, uTurbidity, 4, zenithT)
                * uSunIntensity * 0.55;
    vec4 cl = clouds(dir, uSunDir, sunCol, ambCol);
    col = col * (1.0 - cl.a) + cl.rgb;

    // haze thickens toward the horizon; this is what sells Mediterranean air
    float hz = pow(1.0 - clamp(dir.y, 0.0, 1.0), 6.0);
    vec3 hazeCol = mix(vec3(0.30, 0.34, 0.40), vec3(0.62, 0.64, 0.66),
                       clamp(uSunDir.y * 2.0, 0.0, 1.0));
    col = mix(col, col * 0.70 + hazeCol * 0.22 * uSunIntensity, hz * 0.70);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Cheap full-resolution background pass.
//
// The expensive scattering + cloud integral above is rendered into a cubemap a
// couple of faces per frame. This pass just samples it, then adds back the
// things that must stay pixel-sharp: the sun and moon discs, their glow, and
// the stars.
// ---------------------------------------------------------------------------

const BG_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vDir;

  uniform sampler2D uSkyMap;      // equirectangular, baked by the pass above
  uniform sampler2D uStarTex;
  uniform mat3  uStarMat;
  uniform vec3  uSunDir;
  uniform vec3  uMoonDir;
  uniform float uSunIntensity;
  uniform float uMoonIntensity;
  uniform float uStarBright;
  uniform float uMoonPhase;
  uniform float uTime;

  ${DIR_UV}

  float luminanceApprox(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash12(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main(){
    vec3 dir = normalize(vDir);
    vec3 col = texture2D(uSkyMap, dirToUV(dir)).rgb;

    // --- stars, in the celestial frame the catalogue was baked in
    vec3 cd = normalize(uStarMat * dir);
    vec2 uv = vec2(atan(cd.z, cd.x) / 6.2831853 + 0.5,
                   acos(clamp(cd.y, -1.0, 1.0)) / 3.14159265);
    vec3 stars = texture2D(uStarTex, uv).rgb;
    // atmospheric extinction near the horizon — stars genuinely dim as they set
    float ext = smoothstep(-0.03, 0.22, dir.y);
    float starVis = uStarBright * ext * smoothstep(0.34, 0.0, luminanceApprox(col));
    // scintillation
    float tw = 0.86 + 0.14 * sin(uTime * 5.3 + uv.x * 811.0 + uv.y * 373.0);
    col += stars * starVis * 2.6 * tw;

    // --- sun disc with limb darkening
    float cosSun = dot(dir, uSunDir);
    float sunAng = 0.00465;
    float disc = smoothstep(cos(sunAng * 1.05), cos(sunAng * 0.95), cosSun);
    if(disc > 0.0){
      float r = clamp(acos(clamp(cosSun, -1.0, 1.0)) / sunAng, 0.0, 1.0);
      float limb = pow(max(0.0, 1.0 - r * r), 0.28);
      col += vec3(1.0, 0.95, 0.88) * disc * limb * 26.0 * max(uSunIntensity, 0.0);
    }
    float glow = pow(max(0.0, cosSun), 1400.0) * 0.55
               + pow(max(0.0, cosSun), 90.0) * 0.055;
    col += vec3(1.0, 0.90, 0.76) * glow * uSunIntensity * 2.2;

    // --- moon disc, with a terminator so the phase is actually visible
    float cosMoon = dot(dir, uMoonDir);
    float moonAng = 0.00466;
    float md = smoothstep(cos(moonAng * 1.03), cos(moonAng * 0.97), cosMoon);
    if(md > 0.0){
      // build a local frame on the moon's disc to shade the phase
      vec3 mu = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
      float sx = dot(normalize(dir - uMoonDir * cosMoon), mu);
      float term = smoothstep(-0.12, 0.12, sx - (uMoonPhase * 2.0 - 1.0));
      float lit = mix(0.03, 1.0, term);
      col += vec3(0.94, 0.94, 0.99) * md * lit * 1.9;
    }
    col += vec3(0.55, 0.62, 0.86) * pow(max(0.0, cosMoon), 1800.0)
         * uMoonIntensity * 6000.0;

    // dither before the tone mapper ever sees it — this is where sky banding
    // is actually cured, not in post
    col += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.0022;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// small helper injected before use
const LUM = /* glsl */`
  float luminanceApprox(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// ---------------------------------------------------------------------------

export class Sky {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} opts { year, latitude, quality }
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.year = opts.year ?? -1200;
    this.latitude = opts.latitude ?? 37.5;   // the Aegean
    this.quality = opts.quality ?? 'high';

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunIntensity = 1;
    this.moonIntensity = 0;
    this.moonPhase = 0.62;

    this.starTex = this._buildStarTexture();

    // The scattering pass only ever runs at cube resolution, so we can afford
    // generous step counts even on weak hardware.
    const steps = this.quality === 'low' ? [7, 10] : this.quality === 'medium' ? [9, 14] : [12, 20];
    this.mapSize = this.quality === 'low' ? 512 : this.quality === 'medium' ? 1024 : 2048;

    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunIntensity: { value: 1 },
      uMoonIntensity: { value: 0 },
      uTurbidity: { value: 2.2 },
      uSkyScale: { value: 22.0 },
      uMultiScatter: { value: 1.35 },
      uTime: { value: 0 },
      uCloudCover: { value: 0.34 },
      uCloudHeight: { value: 1500 },
      uCloudTop: { value: 3100 },
      uStormy: { value: 0 },
      uExposure: { value: 1 },
      uViewSteps: { value: steps[0] },
      uCloudSteps: { value: steps[1] },
      uStarBright: { value: 0 },
      uStarTex: { value: this.starTex },
      uStarMat: { value: new THREE.Matrix3() },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_BAKE_VERT,
      // LUM must be declared before skyRadiance uses it
      fragmentShader: SKY_FRAG.replace('precision highp float;',
                                       'precision highp float;\n' + LUM),
      uniforms: this.uniforms,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });

    // --- the equirectangular map the expensive pass bakes into -------------
    // An equirect map rather than a cube: no face seams to reconcile, one
    // unambiguous direction↔UV mapping shared by the background, the ocean's
    // reflections and the star field.
    const MW = this.mapSize, MH = this.mapSize >> 1;
    this.skyRT = new THREE.WebGLRenderTarget(MW, MH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.skyRT.texture.wrapS = THREE.RepeatWrapping;
    this.skyRT.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.bakeScene = new THREE.Scene();
    this.bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute(
      [-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quadMesh = new THREE.Mesh(quad, this.material);
    quadMesh.frustumCulled = false;
    this.bakeScene.add(quadMesh);

    this.stripCount = 6;
    this._strip = 0;
    this._stripsLeft = this.stripCount;

    // --- cheap full-res background ---------------------------------------
    this.bgUniforms = {
      uSkyMap: { value: this.skyRT.texture },
      uStarTex: { value: this.starTex },
      uStarMat: { value: this.uniforms.uStarMat.value },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunIntensity: { value: 1 },
      uMoonIntensity: { value: 0 },
      uStarBright: { value: 0 },
      uMoonPhase: { value: this.moonPhase },
      uTime: { value: 0 },
    };
    this.bgMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: BG_FRAG,
      uniforms: this.bgUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.bgMaterial);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;

    // --- IBL ---------------------------------------------------------------
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileCubemapShader();
    this._pmremRT = null;
    this._envDirty = true;
    this._lastEnvSun = new THREE.Vector3(999, 999, 999);

    // --- sun / moon lights ----------------------------------------------
    this.sunLight = new THREE.DirectionalLight(0xfff0dc, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(
      this.quality === 'low' ? 1024 : 2048, this.quality === 'low' ? 1024 : 2048);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 220;
    const S = 46;
    Object.assign(this.sunLight.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.035;
    this.sunLight.shadow.camera.updateProjectionMatrix();

    this.hemi = new THREE.HemisphereLight(0x9fbcd8, 0x2a2216, 0.35);

    this.moonLight = new THREE.DirectionalLight(0x93a8d8, 0);
    this.moonLight.castShadow = false;
  }

  /** Attach everything the sky owns to a scene. */
  addTo(scene) {
    scene.add(this.mesh);
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);
    scene.add(this.hemi);
    scene.add(this.moonLight);
    this.scene = scene;
  }

  // -------------------------------------------------------------------------
  // Star texture: an equirectangular map baked once. Building it on the CPU
  // means the stars are real positions rather than noise, and costs nothing
  // per frame.
  // -------------------------------------------------------------------------
  _buildStarTexture() {
    const W = 4096, H = 2048;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';

    // The map is baked in the CELESTIAL frame (+Y = north celestial pole).
    // The shader rotates view rays into this frame each night, so the sky
    // turns properly and the pole sits at the right altitude for our latitude.
    const dirOf = (ra, dec) => [
      Math.cos(dec) * Math.cos(ra),
      Math.sin(dec),
      -Math.cos(dec) * Math.sin(ra),
    ];

    const put = (dir, mag, rgb) => {
      const [x, y, z] = dir;
      const u = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) * W;
      const v = (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * H;
      // flux from magnitude
      const flux = Math.pow(10, -0.4 * (mag - 1.0));
      const radius = Math.max(0.9, 1.1 + (6.0 - mag) * 0.62);
      const peak = Math.min(1.6, flux * 0.30);
      const grd = g.createRadialGradient(u, v, 0, u, v, radius * 2.6);
      const rr = Math.min(255, rgb[0] * 255 * peak);
      const gg = Math.min(255, rgb[1] * 255 * peak);
      const bb = Math.min(255, rgb[2] * 255 * peak);
      grd.addColorStop(0, `rgba(${rr | 0},${gg | 0},${bb | 0},1)`);
      grd.addColorStop(0.32, `rgba(${rr | 0},${gg | 0},${bb | 0},0.42)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(u, v, radius * 2.6, 0, Math.PI * 2); g.fill();
      // draw again near the seam so bright stars don't get clipped
      if (u < 8 || u > W - 8) {
        const u2 = u < 8 ? u + W : u - W;
        const grd2 = g.createRadialGradient(u2, v, 0, u2, v, radius * 2.6);
        grd2.addColorStop(0, `rgba(${rr | 0},${gg | 0},${bb | 0},1)`);
        grd2.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd2;
        g.beginPath(); g.arc(u2, v, radius * 2.6, 0, Math.PI * 2); g.fill();
      }
    };

    // --- Milky Way: a broad band along the galactic equator ---------------
    // galactic north pole (J2000) ≈ RA 12h51m, Dec +27.13°
    const gp = precess(12.85, 27.13, this.year);
    const gpDir = dirOf(gp.ra, gp.dec);
    const off = document.createElement('canvas');
    off.width = W / 2; off.height = H / 2;
    const og = off.getContext('2d');
    const img = og.createImageData(W / 2, H / 2);
    const d = img.data;
    for (let py = 0; py < H / 2; py++) {
      const theta = (py / (H / 2)) * Math.PI;
      for (let px = 0; px < W / 2; px++) {
        const phi = ((px / (W / 2)) - 0.5) * Math.PI * 2;
        const dx = Math.cos(phi) * Math.sin(theta);
        const dy = Math.cos(theta);
        const dz = Math.sin(phi) * Math.sin(theta);
        const dotp = dx * gpDir[0] + dy * gpDir[1] + dz * gpDir[2];
        const b = Math.abs(dotp);                     // 0 at galactic equator
        let v = Math.exp(-b * b * 26.0);              // the band
        // clumping and dust lanes
        const s = Math.sin(px * 0.11) * Math.sin(py * 0.17) * 0.5 + 0.5;
        const s2 = Math.sin(px * 0.031 + py * 0.043) * 0.5 + 0.5;
        v *= 0.35 + 0.65 * (s * 0.35 + s2 * 0.65);
        v *= 1 - Math.pow(Math.max(0, Math.sin(px * 0.017 + 1.2)), 8) * 0.7;  // rift
        const i = (py * (W / 2) + px) * 4;
        const k = v * 62;
        d[i] = k * 0.92; d[i + 1] = k * 0.94; d[i + 2] = k * 1.0; d[i + 3] = 255;
      }
    }
    og.putImageData(img, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(off, 0, 0, W, H);

    // --- faint background stars ------------------------------------------
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 9000; i++) {
      const ra = rand() * Math.PI * 2;
      const dec = Math.asin(rand() * 2 - 1);
      const mag = 4.6 + rand() * 1.9;
      const bv = rand() * 1.8 - 0.3;
      put(dirOf(ra, dec), mag, bvToRGB(bv));
    }

    // --- catalogue stars ---------------------------------------------------
    this.starDirs = {};
    for (const [name, raH, decD, mag, bv] of STARS) {
      const p = precess(raH, decD, this.year);
      const dir = dirOf(p.ra, p.dec);
      this.starDirs[name] = { dir, ra: p.ra, dec: p.dec, mag };
      put(dir, mag, bvToRGB(bv));
    }

    // --- faint asterism lines: only just visible, they read as recognition
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(120,140,190,0.055)';
    g.lineWidth = 1.4;
    for (const links of Object.values(ASTERISMS)) {
      for (const [a, b] of links) {
        const A = this.starDirs[a], B = this.starDirs[b];
        if (!A || !B) continue;
        const uvOf = (dd) => [
          (Math.atan2(dd[2], dd[0]) / (Math.PI * 2) + 0.5) * W,
          (Math.acos(Math.max(-1, Math.min(1, dd[1]))) / Math.PI) * H,
        ];
        const [ax, ay] = uvOf(A.dir), [bx, by] = uvOf(B.dir);
        if (Math.abs(ax - bx) > W * 0.5) continue;   // skip seam-crossers
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      }
    }

    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  /**
   * @param {number} hours  local solar time, 0..24
   * @param {number} dayOfYear 0..365
   */
  setTime(hours, dayOfYear = 200) {
    const lat = this.latitude * D2R;
    // solar declination
    const decl = 23.86 * D2R * Math.sin(2 * Math.PI * (dayOfYear - 81) / 365.24);
    const H = (hours - 12) * 15 * D2R;   // hour angle

    const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
    const az = Math.atan2(
      -Math.sin(H) * Math.cos(decl),
      Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(H)
    ); // 0 = north, increasing eastward

    // local frame: +X east, +Z south, +Y up  →  north is -Z
    this.sunDir.set(
      Math.cos(alt) * Math.sin(az),
      Math.sin(alt),
      -Math.cos(alt) * Math.cos(az)
    ).normalize();

    // Moon: offset in hour angle by phase; good enough to be believable and
    // to give the player a second, slower clock.
    const mH = H - (this.moonPhase * 2 - 1) * Math.PI;
    const mdecl = decl * 0.5 + 0.18 * Math.sin(dayOfYear * 0.9);
    const msinAlt = Math.sin(lat) * Math.sin(mdecl) + Math.cos(lat) * Math.cos(mdecl) * Math.cos(mH);
    const malt = Math.asin(Math.max(-1, Math.min(1, msinAlt)));
    const maz = Math.atan2(
      -Math.sin(mH) * Math.cos(mdecl),
      Math.cos(lat) * Math.sin(mdecl) - Math.sin(lat) * Math.cos(mdecl) * Math.cos(mH)
    );
    this.moonDir.set(
      Math.cos(malt) * Math.sin(maz), Math.sin(malt), -Math.cos(malt) * Math.cos(maz)
    ).normalize();

    // local sidereal angle: the sky turns once per sidereal day, and drifts
    // ~4 minutes earlier each night, which is why the seasons have their stars
    this.lst = ((hours / 24) * 1.0027379 + dayOfYear / 365.24) * Math.PI * 2;
    this._updateStarMatrix();
    this._applyLighting();
  }

  /**
   * Build the world→celestial rotation. World is +X east, +Y up, -Z north.
   * Celestial is +Y = north celestial pole. Composing a spin about the pole
   * by the sidereal angle with a tilt that puts the pole at altitude = φ
   * gives us both the correct rising direction and correct circumpolar caps.
   */
  _updateStarMatrix() {
    const lat = this.latitude * D2R;
    // celestial → world
    const tilt = new THREE.Matrix4().makeRotationX(lat - Math.PI / 2);
    const spin = new THREE.Matrix4().makeRotationY(-this.lst);
    const c2w = tilt.multiply(spin);
    // shader needs world → celestial, i.e. the transpose (both are rotations)
    const w2c = c2w.clone().transpose();
    this.uniforms.uStarMat.value.setFromMatrix4(w2c);
    this._c2w = c2w;
  }

  _applyLighting() {
    const sa = this.sunDir.y;
    // atmospheric extinction near the horizon, plus civil twilight falloff
    const above = Math.max(0, sa);
    this.sunIntensity = Math.pow(above, 0.42) * 1.0;
    if (sa < 0) this.sunIntensity = Math.max(0, Math.exp(sa * 22.0) * 0.5);
    this.moonIntensity = Math.max(0, this.moonDir.y) * 0.000012
      * (0.35 + 0.65 * Math.sin(Math.PI * this.moonPhase));

    this.uniforms.uSunIntensity.value = Math.max(this.sunIntensity, 0.0006);
    this.uniforms.uMoonIntensity.value = this.moonIntensity * 90000;
    this.uniforms.uStarBright.value = Math.max(0, 1 - Math.max(0, sa + 0.12) * 9.0);
    if (this.bgUniforms) {
      this.bgUniforms.uSunIntensity.value = this.uniforms.uSunIntensity.value;
      this.bgUniforms.uMoonIntensity.value = this.moonIntensity;
      this.bgUniforms.uStarBright.value = this.uniforms.uStarBright.value;
      this.bgUniforms.uMoonPhase.value = this.moonPhase;
    }

    // --- directional light colour: cheap Rayleigh extinction along the path
    const airmass = 1 / Math.max(0.05, sa + 0.06);
    const ext = (b) => Math.exp(-b * airmass * 0.62);
    const c = new THREE.Color(ext(0.45), ext(1.02), ext(2.10));
    const peak = Math.max(c.r, c.g, c.b) || 1;
    c.multiplyScalar(1 / peak);

    this.sunLight.color.copy(c);
    this.sunLight.intensity = Math.max(0, Math.pow(Math.max(0, sa), 0.45)) * 4.6;
    this.sunLight.position.copy(this.sunDir).multiplyScalar(120);

    this.moonLight.color.setRGB(0.55, 0.63, 0.92);
    this.moonLight.intensity = Math.max(0, this.moonDir.y) * 0.30
      * (0.3 + 0.7 * Math.sin(Math.PI * this.moonPhase))
      * Math.max(0, 1 - Math.max(0, sa) * 6);
    this.moonLight.position.copy(this.moonDir).multiplyScalar(120);

    // hemisphere fill tracks the sky's own colour so nothing floats
    const dayT = THREE.MathUtils.clamp(sa * 3.0, 0, 1);
    this.hemi.color.setRGB(
      0.28 + dayT * 0.34, 0.36 + dayT * 0.38, 0.52 + dayT * 0.40
    );
    this.hemi.groundColor.setRGB(0.10 + dayT * 0.10, 0.09 + dayT * 0.08, 0.07 + dayT * 0.06);
    this.hemi.intensity = 0.14 + dayT * 0.62 + this.moonLight.intensity * 0.5;

    this._envDirty = true;
  }

  setWeather({ cloudCover, stormy, turbidity }) {
    if (cloudCover !== undefined) this.uniforms.uCloudCover.value = cloudCover;
    if (stormy !== undefined) {
      this.uniforms.uStormy.value = stormy;
      // storm cloud is both lower and far deeper than fair-weather cumulus
      this.uniforms.uCloudHeight.value = 1500 - stormy * 900;
      this.uniforms.uCloudTop.value = 3100 + stormy * 5200;
    }
    if (turbidity !== undefined) this.uniforms.uTurbidity.value = turbidity;
    this._stripsLeft = this.stripCount;
  }

  /** Call once per frame. `target` is the object shadows should follow. */
  update(dt, camera, shadowTarget) {
    this.uniforms.uTime.value += dt;
    this.bgUniforms.uTime.value += dt;

    // the dome is unit-radius and drawn at the far plane, so it must stay
    // centred on the eye or the direction it encodes goes wrong
    if (camera) this.mesh.position.copy(camera.position);

    if (shadowTarget) {
      const p = shadowTarget;
      this.sunLight.position.copy(this.sunDir).multiplyScalar(120).add(p);
      this.sunLight.target.position.copy(p);
      this.sunLight.target.updateMatrixWorld();
    }

    // Clouds drift continuously, so the map is never truly static; refresh it
    // on a rolling basis and force a full pass whenever the sun moves.
    if (this._lastEnvSun.distanceToSquared(this.sunDir) > 4e-6) {
      this._lastEnvSun.copy(this.sunDir);
      this._stripsLeft = Math.max(this._stripsLeft, this.stripCount);
    }
    this._cloudAccum = (this._cloudAccum || 0) + dt;
    if (this._cloudAccum > 0.20) {
      this._cloudAccum = 0;
      this._stripsLeft = Math.max(this._stripsLeft, this.stripCount);
    }
  }

  /**
   * Bake a horizontal strip of the sky map per call. Spreading the work keeps
   * the per-frame cost flat instead of spiking every Nth frame; a full refresh
   * takes `stripCount` calls.
   */
  renderSky(renderer, strips = 2) {
    if (this._stripsLeft <= 0) return false;
    const prev = renderer.getRenderTarget();
    const prevScissor = renderer.getScissorTest();
    const H = this.skyRT.height, W = this.skyRT.width;
    const band = Math.ceil(H / this.stripCount);

    renderer.setRenderTarget(this.skyRT);
    renderer.setScissorTest(true);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;   // never wipe the strips we are keeping

    for (let n = 0; n < strips && this._stripsLeft > 0; n++) {
      const y = this._strip * band;
      renderer.setScissor(0, y, W, Math.min(band, H - y));
      renderer.render(this.bakeScene, this.bakeCam);
      this._strip = (this._strip + 1) % this.stripCount;
      this._stripsLeft--;
      if (this._stripsLeft === 0) this._envDirty = true;
    }

    renderer.autoClear = prevAuto;
    renderer.setScissorTest(prevScissor);
    renderer.setRenderTarget(prev);
    return true;
  }

  /** Rebuild the PMREM used for image-based lighting. Cheap; call rarely. */
  updateEnvironment(renderer, scene) {
    if (!this._envDirty) return false;
    this._envDirty = false;
    const next = this.pmrem.fromEquirectangular(this.skyRT.texture);
    if (this._pmremRT) this._pmremRT.dispose();
    this._pmremRT = next;
    scene.environment = next.texture;
    return true;
  }

  get envMap() { return this.skyRT.texture; }

  /** Where a named star currently sits in world space (unit vector). */
  starDirection(name) {
    const s = this.starDirs[name];
    if (!s || !this._c2w) return null;
    return new THREE.Vector3(s.dir[0], s.dir[1], s.dir[2])
      .applyMatrix4(this._c2w).normalize();
  }

  /** Altitude/azimuth of a named star, in degrees. Used by the star HUD. */
  starAltAz(name) {
    const d = this.starDirection(name);
    if (!d) return null;
    const alt = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / D2R;
    let az = Math.atan2(d.x, -d.z) / D2R;
    if (az < 0) az += 360;
    return { alt, az };
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.bgMaterial.dispose();
    this.skyRT.dispose();
    if (this._pmremRT) this._pmremRT.dispose();
    this.pmrem.dispose();
    this.starTex.dispose();
  }
}

export { STARS, ASTERISMS, precess };
