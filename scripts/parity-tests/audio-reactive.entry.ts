import { state } from '../../src/state';
import { timelineState } from '../../src/state-timeline';
import { drawGraphics, computeSpectrumBands } from '../../src/graphics-engine';
import { createAudioReactiveProvider } from '../../remotion/src/audioReactive';
import { buildAudioReactivePayload } from '../../src/exporter/audio-reactive-payload';
import { installAudioReactive } from '../../remotion/src/audioReactive';
import { drawGraphicsOnCanvas } from '../../remotion/src/graphicsCanvas';
(window as any).__t = { state, timelineState, drawGraphics, buildAudioReactivePayload, installAudioReactive, drawGraphicsOnCanvas, computeSpectrumBands, createAudioReactiveProvider };
