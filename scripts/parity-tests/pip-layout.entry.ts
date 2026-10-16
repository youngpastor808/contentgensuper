import { state } from '../../src/state';
import { drawPopUpBrollPipOverlay } from '../../src/videoRenderer';
import { computePipCard } from '../../src/pip-layout';
(window as any).__t = { state, drawPopUpBrollPipOverlay, computePipCard };
