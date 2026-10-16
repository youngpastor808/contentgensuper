/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Optimized Subtitle Renderers
 * Enhanced with cinematic "Pop" animations and tilt effects for word-level highlighting.
 * Refined to minimize canvas state changes (save/restore) and expensive calculations.
 */

import type { SubtitleLayout, SubtitleStyle, SubtitleRenderContext, LayoutWord } from "./subtitle-engine";
import { roundRectPath } from "./canvas-paths";

/* -----------------------------------------------------------
   COLOR PRESETS
----------------------------------------------------------- */

export const SubtitleColorPresets = {
    karaoke: {
        active: "#FACC15",
        inactive: "#FFFFFF",
        outline: "#000000",
    },
    cinematic: {
        text: "#FFFFFF",
        shadow: "rgba(0,0,0,0.8)",
    },
    yellowBox: {
        box: "#FACC15",
        text: "#1A1A1A",
    },
    tiktok: {
        box: "#FACC15",
        activeText: "#000000",
        inactiveText: "#FFFFFF",
        background: "rgba(0,0,0,0.65)",
    },
    anime: {
        stroke: "#000000",
        text: "#FFFFFF",
    },
    neon: {
        glow: "#00FFFF",
        center: "#FFFFFF",
    },
    typewriter: {
        text: "#FFFFFF",
        cursor: "#FACC15",
    },
    hormozi: {
        active: "#22C55E",      // Vibrant Hormozi punch green
        activeBox: "#FACC15",   // Optional bright yellow / gold
        inactive: "#FFFFFF",    // Clean white
        outline: "#000000",     // Crisp black stroke
    },
    mrbeast: {
        active: "#FACC15",
        inactive: "#FFFFFF",
        innerOutline: "#00E5FF",
        outerOutline: "#000000",
    },
    minimal_editorial: {
        text: "#F8FAFC",
        activeText: "#38BDF8",
        background: "rgba(15, 23, 42, 0.60)",
        accent: "#38BDF8",
    },
    terminal: {
        text: "rgba(74, 222, 128, 0.65)",
        activeText: "#E0FFE5",
        background: "rgba(5, 15, 10, 0.88)",
        border: "#22C55E",
        cursor: "#22C55E",
    },
    bilingual: {
        primary: "#FFFFFF",
        secondary: "#94A3B8",
        active: "#F59E0B",
        outline: "#000000",
    },
    kinetic_gold: {
        active: "#FACC15",
        inactive: "#FFFFFF",
        outline: "rgba(0, 0, 0, 0.90)",
    },
};

/* -----------------------------------------------------------
   SHARED RENDER HELPERS
----------------------------------------------------------- */

/** Draw rounded backgrounds behind each line in a single fill (optionally stroked). */
export function drawLineBackgrounds(
    ctx: CanvasRenderingContext2D,
    layout: SubtitleLayout,
    lineHeight: number,
    padX: number,
    padY: number,
    radius: number,
    fill: string,
    stroke?: { color: string; width: number }
) {
    // If there is no fill and no stroke, there is nothing to render — return early.
    // If fill is transparent but a stroke is defined, we construct the path and stroke it without filling.
    const hasFill = Boolean(fill && fill !== 'transparent');
    if (!hasFill && !stroke) return;
    ctx.beginPath();
    for (const line of layout.lines) {
        if (!line.words.length) continue;
        const first = line.words[0];
        const last = line.words[line.words.length - 1];
        const minX = first.x - first.width / 2;
        const w = (last.x + last.width / 2) - minX;
        roundRectPath(ctx, minX - padX, line.y - lineHeight / 2 - padY, w + padX * 2, lineHeight + padY * 2, radius);
    }
    if (fill && fill !== 'transparent') {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.stroke();
    }
}

/** Iterate words once: batch-draw inactive words via callback, return the active word. */
export function splitActiveWord(
    layout: SubtitleLayout,
    activeIdx: number,
    drawInactive: (word: LayoutWord, index: number) => void
): { word: LayoutWord; index: number } | null {
    let active: { word: LayoutWord; index: number } | null = null;
    let i = 0;
    for (const line of layout.lines) {
        for (const word of line.words) {
            if (i === activeIdx && activeIdx >= 0) {
                active = { word, index: i };
            } else {
                drawInactive(word, i);
            }
            i++;
        }
    }
    return active;
}

/* -----------------------------------------------------------
   STYLE: KARAOKE (Pop & Scale)
----------------------------------------------------------- */

export const KaraokeRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "miter";

        ctx.lineWidth = Math.floor(options.fontSize * 0.14);
        ctx.strokeStyle = options.colors.outline || "#000000";
        ctx.fillStyle = options.colors.inactive || "#FFFFFF";

        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.strokeText(word.text, word.x, word.y);
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.save();
            ctx.lineWidth = Math.floor(options.fontSize * 0.16);
            ctx.strokeStyle = options.colors.outline || "#000000";
            ctx.translate(active.word.x, active.word.y);
            ctx.scale(1.12, 1.12);
            ctx.rotate(active.index % 2 === 0 ? 0.02 : -0.02);
            ctx.strokeText(active.word.text, 0, 0);
            ctx.fillStyle = options.colors.active || "#FACC15";
            ctx.fillText(active.word.text, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: CINEMATIC
----------------------------------------------------------- */

export const CinematicRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";

        // Pure cinematic film subtitle: no thick cartoon stroke.
        // Elegant tracking, medium weight, and soft filmic shadow for legibility over bright shots.
        ctx.shadowColor = options.colors.shadow || "rgba(0,0,0,0.85)";
        ctx.shadowBlur = Math.max(6, Math.floor(options.fontSize * 0.16));
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = options.colors.text || "#FFFFFF";

        for (const line of layout.lines) {
            for (const word of line.words) {
                ctx.fillText(word.text, word.x, word.y);
            }
        }
        ctx.restore();
    },
};

/* -----------------------------------------------------------
   STYLE: YELLOW BOX
----------------------------------------------------------- */

export const YellowBoxRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const paddingX = options.fontSize * 0.25;
        const paddingY = options.fontSize * 0.08;

        // BATCH 1: Draw bounded boxes in one path using shared helper
        drawLineBackgrounds(
            ctx,
            layout,
            options.lineHeight,
            paddingX,
            paddingY,
            8,
            options.colors.box || "#FACC15"
        );

        // BATCH 2: Draw all text
        ctx.fillStyle = options.colors.text || "#1A1A1A";
        for (const line of layout.lines) {
            for (const word of line.words) {
                ctx.fillText(word.text, word.x, word.y);
            }
        }
        ctx.restore();
    },
};

/* -----------------------------------------------------------
   STYLE: TIKTOK (Energetic Pop & Clean Highlight Pill)
----------------------------------------------------------- */

export const TikTokRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const bgPaddingX = Math.round(options.fontSize * 0.22);
        const bgPaddingY = Math.round(options.fontSize * 0.08);

        // 1. Draw sleek translucent rounded pill behind lines for contrast
        const bgColor = options.colors.background || "rgba(0, 0, 0, 0.65)";
        if (bgColor && bgColor !== 'transparent') {
            drawLineBackgrounds(ctx, layout, options.lineHeight, bgPaddingX, bgPaddingY, 6, bgColor);
        }

        // 2. Batched Inactive Words (white text with dark stroke)
        ctx.lineWidth = Math.max(2, Math.floor(options.fontSize * 0.10));
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
        ctx.fillStyle = options.colors.inactiveText || "#FFFFFF";

        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.strokeText(word.text, word.x, word.y);
            ctx.fillText(word.text, word.x, word.y);
        });

        // 3. Active Word (yellow highlight pill + bold black text)
        if (active) {
            const activePadX = Math.round(options.fontSize * 0.20);
            const activePadY = Math.round(options.fontSize * 0.08);
            ctx.fillStyle = options.colors.box || "#FACC15";
            ctx.beginPath();
            roundRectPath(
                ctx,
                active.word.x - active.word.width / 2 - activePadX,
                active.word.y - options.lineHeight / 2 - activePadY,
                active.word.width + activePadX * 2,
                options.lineHeight + activePadY * 2,
                5
            );
            ctx.fill();

            ctx.fillStyle = options.colors.activeText || "#000000";
            ctx.fillText(active.word.text, active.word.x, active.word.y);
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: ANIME (High Contrast)
----------------------------------------------------------- */

export const AnimeRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.lineWidth = Math.floor(options.fontSize * 0.28);
        ctx.lineJoin = "round";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeStyle = options.colors.stroke || "#000000";
        ctx.fillStyle = options.colors.text || "#FFFFFF";

        for (const line of layout.lines) {
            for (const word of line.words) {
                ctx.strokeText(word.text, word.x, word.y);
                ctx.fillText(word.text, word.x, word.y);
            }
        }
        ctx.restore();
    },
};

/* -----------------------------------------------------------
   STYLE: NEON (Glowing Core)
----------------------------------------------------------- */

export const NeonRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.save();
            ctx.shadowColor = options.colors.glow || "#00FFFF";
            ctx.shadowBlur = 14;
            ctx.fillStyle = options.colors.glow || "#00FFFF";
            ctx.fillText(active.word.text, active.word.x, active.word.y);

            ctx.shadowBlur = 0;
            ctx.fillStyle = options.colors.center || "#FFFFFF";
            ctx.fillText(active.word.text, active.word.x, active.word.y);
            ctx.restore();
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: TYPEWRITER (Synchronized & Grapheme Safe)
----------------------------------------------------------- */

export const TypewriterRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        let charsToShow = 0;
        
        if (options.hasTimestamps && options.activeWordIndex !== -1) {
            let charCounter = 0;
            const words = layout.plainText.split(/\s+/);
            for (let i = 0; i <= options.activeWordIndex && i < words.length; i++) {
                charCounter += words[i].length + 1;
            }
            charsToShow = charCounter;
        } else {
            charsToShow = Math.floor(progress * layout.plainText.length);
        }

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = options.colors.text;

        let drawn = 0;
        let lastX = 0;
        let lastY = 0;
        const spaceWidth = layout.spaceWidth;

        for (const line of layout.lines) {
            const totalWidth = line.words.reduce((sum, w) => sum + w.width, 0) + (spaceWidth * (line.words.length - 1));
            let x = Math.max(options.width * 0.05, options.width / 2 - totalWidth / 2);

            for (const word of line.words) {
                if (drawn >= charsToShow) break;
                
                // Grapheme-safe character loop using precomputed graphemes and widths
                const graphemes = word.graphemes || [...word.text];
                for (let i = 0; i < graphemes.length; i++) {
                    if (drawn < charsToShow) {
                        const ch = graphemes[i];
                        ctx.fillText(ch, x, line.y);
                        const chW = word.charWidths[i] ?? ctx.measureText(ch).width;
                        x += chW;
                        drawn++;
                        lastX = x;
                        lastY = line.y;
                    }
                }
                
                x += spaceWidth;
                if (drawn < charsToShow) drawn++;
            }
            if (drawn >= charsToShow) break;
        }

        // Animated cursor
        const showTypewriterCursor = !options.isPlaying || Math.floor((options.clipTime ?? 0) / 0.53) % 2 === 0;
        if (progress < 0.99 && lastX > 0 && showTypewriterCursor) {
            ctx.fillStyle = options.colors.cursor;
            ctx.fillRect(lastX + 2, lastY - options.fontSize * 0.5, 3, options.fontSize);
        }
        ctx.restore();
    },
};

/* -----------------------------------------------------------
   STYLE: HORMOZI (Signature Bold Punch & Heavy Black Border)
----------------------------------------------------------- */

export const HormoziRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;

        ctx.lineWidth = Math.max(3, Math.floor(options.fontSize * 0.14));
        ctx.strokeStyle = options.colors.outline || "#000000";
        ctx.fillStyle = options.colors.inactive || "#FFFFFF";

        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.strokeText(word.text, word.x, word.y);
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.lineWidth = Math.max(4, Math.floor(options.fontSize * 0.18));
            ctx.strokeText(active.word.text, active.word.x, active.word.y);
            const activeColor = active.word.isEmphasized
                ? (options.colors.activeBox || "#FACC15")
                : (options.colors.active || "#22C55E");
            ctx.fillStyle = activeColor;
            ctx.fillText(active.word.text, active.word.x, active.word.y);
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: MRBEAST (Comic Dual Outline & Punch)
----------------------------------------------------------- */

export const MrBeastRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;

        const outerOutline = options.colors.outerOutline || "#000000";
        const inactiveOuterWidth = Math.max(3, Math.floor(options.fontSize * 0.14));
        const inactiveInnerWidth = Math.max(1.5, Math.floor(options.fontSize * 0.07));
        const inactiveFill = options.colors.inactive || "#FFFFFF";

        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.lineWidth = inactiveOuterWidth;
            ctx.strokeStyle = outerOutline;
            ctx.strokeText(word.text, word.x, word.y);

            ctx.lineWidth = inactiveInnerWidth;
            ctx.strokeStyle = "#334155";
            ctx.strokeText(word.text, word.x, word.y);

            ctx.fillStyle = inactiveFill;
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.lineWidth = Math.max(4, Math.floor(options.fontSize * 0.18));
            ctx.strokeStyle = outerOutline;
            ctx.strokeText(active.word.text, active.word.x, active.word.y);

            ctx.lineWidth = Math.max(2, Math.floor(options.fontSize * 0.09));
            ctx.strokeStyle = options.colors.innerOutline || "#00E5FF";
            ctx.strokeText(active.word.text, active.word.x, active.word.y);

            ctx.fillStyle = options.colors.active || "#FACC15";
            ctx.fillText(active.word.text, active.word.x, active.word.y);
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: MINIMAL EDITORIAL (Refined Documentary Clean)
----------------------------------------------------------- */

export const MinimalEditorialRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const bgPadX = Math.round(options.fontSize * 0.35);
        const bgPadY = Math.round(options.fontSize * 0.12);

        // 1. Sleek minimal dark backdrop
        const bgColor = options.colors.background || "rgba(15, 23, 42, 0.60)";
        if (bgColor && bgColor !== "transparent") {
            drawLineBackgrounds(ctx, layout, options.lineHeight, bgPadX, bgPadY, 4, bgColor);
        }

        // 2. High-contrast typography with elegant accent line for active word
        ctx.fillStyle = options.colors.text || "#F8FAFC";
        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            // Underline accent indicator
            const accentColor = options.colors.accent || "#38BDF8";
            ctx.fillStyle = accentColor;
            const underlineY = active.word.y + options.lineHeight * 0.32;
            ctx.fillRect(active.word.x - active.word.width / 2, underlineY, active.word.width, Math.max(2, options.fontSize * 0.06));

            // Active word text
            ctx.fillStyle = options.colors.activeText || "#FFFFFF";
            ctx.fillText(active.word.text, active.word.x, active.word.y);
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: RETRO TERMINAL (Monospace Cyber Console)
----------------------------------------------------------- */

export const TerminalRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const bgPadX = Math.round(options.fontSize * 0.4);
        const bgPadY = Math.round(options.fontSize * 0.14);

        // Terminal Box with resolution-scaled tech border
        const bgColor = options.colors.background || "rgba(5, 15, 10, 0.88)";
        const borderColor = options.colors.border || "#22C55E";
        const borderWidth = Math.max(1.5, Math.floor(options.fontSize * 0.04));

        drawLineBackgrounds(
            ctx,
            layout,
            options.lineHeight,
            bgPadX,
            bgPadY,
            3,
            bgColor,
            { color: borderColor, width: borderWidth }
        );

        // Subtle interior scanlines inside the terminal box bounds
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = "#000000";
        for (const line of layout.lines) {
            const boxTop = line.y - options.lineHeight / 2 - bgPadY;
            const boxBottom = line.y + options.lineHeight / 2 + bgPadY;
            const totalWidth = line.words.reduce((sum, w) => sum + w.width, 0) + layout.spaceWidth * (line.words.length - 1);
            const boxLeft = Math.max(options.width * 0.05, options.width / 2 - totalWidth / 2) - bgPadX;
            const boxW = totalWidth + bgPadX * 2;
            for (let y = Math.floor(boxTop); y < boxBottom; y += 3) {
                ctx.fillRect(boxLeft, y, boxW, 1);
            }
        }
        ctx.restore();

        // Monospace text with authentic phosphor CRT bloom
        ctx.shadowColor = "rgba(34, 197, 94, 0.55)";
        ctx.shadowBlur = Math.floor(options.fontSize * 0.16);

        ctx.fillStyle = options.colors.text || "rgba(74, 222, 128, 0.65)";
        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.fillStyle = options.colors.activeText || "#E0FFE5";
            // Chevron: cap width to fit neatly inside spaceWidth without overlapping previous word
            const chevronX = active.word.x - active.word.width / 2 - Math.max(2, options.fontSize * 0.06);
            ctx.save();
            ctx.textAlign = "right";
            const chevW = ctx.measureText(">").width;
            if (chevW > layout.spaceWidth - 2) {
                ctx.font = ctx.font.replace(/(\d+)px/, (_, s) => `${Math.floor(+s * 0.72)}px`);
            }
            ctx.fillText(">", chevronX, active.word.y);
            ctx.restore();

            ctx.fillText(active.word.text, active.word.x, active.word.y);

            // Blinking box cursor: pause/scrub-safe (always shows when paused) and scaled with resolution
            const blinkPeriod = 0.53;
            const showCursor = !options.isPlaying || Math.floor((options.clipTime ?? 0) / blinkPeriod) % 2 === 0;
            if (showCursor) {
                const activeWordEndX = active.word.x + active.word.width / 2;
                const cursorW = Math.min(options.fontSize * 0.28, Math.max(3, layout.spaceWidth - 3));
                const cursorH = options.fontSize * 0.76;
                const cursorX = activeWordEndX + Math.max(2, Math.floor(options.fontSize * 0.06));
                ctx.fillStyle = options.colors.cursor || "#22C55E";
                ctx.fillRect(cursorX, active.word.y - cursorH / 2, cursorW, cursorH);
            }
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: BILINGUAL / SPLIT-SUB (Dual Line Stacked Hierarchy)
----------------------------------------------------------- */

export const BilingualRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, Math.floor(options.fontSize * 0.12));
        ctx.strokeStyle = options.colors.outline || "#000000";

        // Pass 1: batched inactive words
        ctx.fillStyle = options.colors.primary || "#FFFFFF";
        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.strokeText(word.text, word.x, word.y);
            ctx.fillText(word.text, word.x, word.y);
        });

        // Pass 2: single active word with transform
        if (active) {
            ctx.save();
            ctx.translate(active.word.x, active.word.y);
            ctx.scale(1.10, 1.10);
            ctx.strokeText(active.word.text, 0, 0);
            ctx.fillStyle = options.colors.active || "#F59E0B";
            ctx.fillText(active.word.text, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }
};

/* -----------------------------------------------------------
   STYLE: KINETIC GOLD (Documentary Karaoke Word-by-Word Highlight)
----------------------------------------------------------- */

export const KineticGoldRenderer: SubtitleStyle = {
    draw(ctx, layout, progress, options) {
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";

        // Heavy rounded outline stroke for maximum contrast on any background
        const outlineWidth = Math.max(3, Math.floor(options.fontSize * 0.18));
        ctx.lineWidth = outlineWidth;
        ctx.strokeStyle = options.colors.outline || "rgba(0, 0, 0, 0.90)";
        ctx.fillStyle = options.colors.inactive || "#FFFFFF";

        // Subtle soft shadow behind words
        ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
        ctx.shadowBlur = Math.max(4, Math.floor(options.fontSize * 0.10));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = Math.max(2, Math.floor(options.fontSize * 0.04));

        const active = splitActiveWord(layout, options.activeWordIndex, (word) => {
            ctx.strokeText(word.text, word.x, word.y);
            ctx.fillText(word.text, word.x, word.y);
        });

        if (active) {
            ctx.save();
            ctx.translate(active.word.x, active.word.y);
            ctx.scale(1.10, 1.10);
            ctx.lineWidth = outlineWidth * 1.15;
            ctx.strokeStyle = options.colors.outline || "rgba(0, 0, 0, 0.95)";
            ctx.strokeText(active.word.text, 0, 0);

            // Vibrant Docugen Gold #FACC15
            ctx.fillStyle = options.colors.active || "#FACC15";
            ctx.fillText(active.word.text, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }
};
