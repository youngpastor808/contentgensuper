/**
 * Pure layout + animation maths for the pop-up B-roll Picture-in-Picture card.
 *
 * This is a line-for-line mirror of the geometry in `drawPopUpBrollPipOverlay` (src/videoRenderer.ts) with
 * the browser state passed in as arguments, so the Remotion cloud render can place the card at exactly the
 * same pixels. scripts/parity-tests/pip-layout.test.cjs checks it against the real function.
 *
 * NO imports: safe for both the browser app and the Remotion bundle.
 */
export interface PipLayoutInput {
  /** Export frame size in pixels. */
  cw: number;
  ch: number;
  /** Seconds since the clip started, and the clip's duration in seconds. */
  timeInClip: number;
  clipDur: number;
  pipPosition?: string;
  pipX?: number;
  pipY?: number;
  pipAnchorX?: number;
  pipAnchorY?: number;
  pipScale?: number;
  pipAnimation?: string;
  /** height / width of the media (before clamping). Defaults to 9/16 like the browser. */
  mediaAspect?: number;
  /** state.cinematicLetterbox */
  letterbox?: boolean;
}

export interface PipCard {
  visible: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  cornerRadius: number;
  borderWidth: number;
  shadowBlur: number;
  shadowOffsetY: number;
  badge: { x: number; y: number; w: number; h: number; fontPx: number; pad: number };
}

export function computePipCard(i: PipLayoutInput): PipCard {
  const { cw, ch } = i;
  const clipDur = Math.max(0.001, i.clipDur);
  const timeInClip = i.timeInClip;
  const timeLeftInClip = clipDur - timeInClip;
  const enterDur = Math.min(0.4, clipDur * 0.25);
  const exitDur = Math.min(0.35, clipDur * 0.25);

  let scaleMultiplier = 1.0;
  let alpha = 1.0;
  let slideX = 0;
  const slideY = 0;

  const animType = i.pipAnimation || 'pop_spring';
  const position = i.pipPosition || 'top_right';
  const hasCustomPos = (position === 'custom' || typeof i.pipX === 'number') && typeof i.pipY === 'number';
  const isLeft = !hasCustomPos && position.includes('left');

  if (timeInClip < enterDur) {
    const p = Math.max(0, Math.min(1, timeInClip / enterDur));
    if (animType === 'pop_spring') {
      const overshoot = 1 + 0.16 * Math.sin(p * Math.PI) * (1 - p);
      scaleMultiplier = p * overshoot;
      alpha = Math.min(1, p * 1.6);
    } else if (animType === 'slide_in') {
      const ease = 1 - Math.pow(1 - p, 3);
      const distance = Math.round(cw * 0.14);
      slideX = (1 - ease) * (isLeft ? -distance : distance);
      alpha = Math.min(1, p * 2);
    } else {
      const ease = 1 - Math.pow(1 - p, 2);
      scaleMultiplier = 0.82 + 0.18 * ease;
      alpha = Math.min(1, p * 1.5);
    }
  } else if (timeLeftInClip < exitDur) {
    const p = Math.max(0, Math.min(1, timeLeftInClip / exitDur));
    if (animType === 'pop_spring' || animType === 'zoom_fade') {
      scaleMultiplier = 0.85 + 0.15 * p;
      alpha = Math.min(1, p * 1.8);
    } else if (animType === 'slide_in') {
      const ease = Math.pow(p, 3);
      const distance = Math.round(cw * 0.14);
      slideX = (1 - ease) * (isLeft ? -distance : distance);
      alpha = Math.min(1, p * 1.8);
    }
  }

  const empty: PipCard = {
    visible: false, x: 0, y: 0, w: 0, h: 0, alpha: 0, cornerRadius: 0, borderWidth: 0, shadowBlur: 0, shadowOffsetY: 0,
    badge: { x: 0, y: 0, w: 0, h: 0, fontPx: 0, pad: 0 },
  };
  if (alpha <= 0.001 || scaleMultiplier <= 0.001) return empty;

  const scaleRatio = typeof i.pipScale === 'number' ? i.pipScale : 0.36;
  const cardW = Math.round(cw * scaleRatio * Math.max(0.01, scaleMultiplier));

  let mediaAspect = typeof i.mediaAspect === 'number' && isFinite(i.mediaAspect) && i.mediaAspect > 0 ? i.mediaAspect : 9 / 16;
  mediaAspect = Math.max(0.45, Math.min(1.2, mediaAspect));
  const cardH = Math.round(cardW * mediaAspect);

  const marginX = Math.round(cw * 0.035);
  let topSafe = Math.round(ch * 0.04);
  let bottomSafe = Math.round(ch * 0.04);
  if (i.letterbox) {
    const targetAR = 2.39;
    const currentAR = cw / ch;
    if (currentAR < targetAR) {
      const activeH = cw / targetAR;
      const barH = Math.round((ch - activeH) / 2);
      topSafe += barH;
      bottomSafe += barH;
    }
  }

  let posX = cw - cardW - marginX + slideX;
  let posY = topSafe + slideY;

  if (hasCustomPos) {
    const anchorX = typeof i.pipAnchorX === 'number' ? i.pipAnchorX : 0.5;
    const anchorY = typeof i.pipAnchorY === 'number' ? i.pipAnchorY : 0.5;
    posX = (i.pipX ?? 0.5) * cw - cardW * anchorX + slideX;
    posY = (i.pipY ?? 0.5) * ch - cardH * anchorY + slideY;
    posX = Math.max(0, Math.min(cw - cardW, posX));
    posY = Math.max(topSafe, Math.min(ch - bottomSafe - cardH, posY));
  } else if (position === 'top_left') {
    posX = marginX + slideX;
    posY = topSafe + slideY;
  } else if (position === 'bottom_right') {
    posX = cw - cardW - marginX + slideX;
    posY = ch - cardH - bottomSafe + slideY;
  } else if (position === 'bottom_left') {
    posX = marginX + slideX;
    posY = ch - cardH - bottomSafe + slideY;
  } else if (position === 'center_right') {
    posX = cw - cardW - marginX + slideX;
    posY = Math.round((ch - cardH) / 2) + slideY;
  } else if (position === 'center_left') {
    posX = marginX + slideX;
    posY = Math.round((ch - cardH) / 2) + slideY;
  }

  const badgeH = Math.round(18 * (ch / 720));
  const badgePad = Math.round(6 * (cw / 1280));
  return {
    visible: true,
    x: posX,
    y: posY,
    w: cardW,
    h: cardH,
    alpha: Math.max(0, Math.min(1, alpha)),
    cornerRadius: Math.max(8, Math.round(12 * (cw / 1280))),
    borderWidth: Math.max(2, Math.round(2.5 * (cw / 1280))),
    shadowBlur: Math.round(20 * (cw / 1280)),
    shadowOffsetY: Math.round(8 * (ch / 720)),
    badge: {
      x: posX + badgePad,
      y: posY + cardH - badgeH - badgePad,
      w: Math.round(72 * (cw / 1280)),
      h: badgeH,
      fontPx: Math.max(9, Math.round(10 * (cw / 1280))),
      pad: badgePad,
    },
  };
}

/** height/width of a video/image element, exactly as the browser derives it (before clamping). */
export function mediaAspectOf(media: any): number | undefined {
  if (!media) return undefined;
  const nw = media.videoWidth || media.naturalWidth || media.width;
  const nh = media.videoHeight || media.naturalHeight || media.height;
  return nw && nh ? nh / nw : undefined;
}
