import { safeJsonStringify } from '../utils-core';

export { safeJsonStringify };

export function safeClone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  try {
    const jsonStr = safeJsonStringify(obj);
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    console.warn('[safeJson] safeClone fallback:', e);
    return obj;
  }
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn('[safeJson] safeJsonParse failed:', e);
    return fallback;
  }
}

export function sanitizeScenes(scenes: any[]): any[] {
  if (!Array.isArray(scenes)) return [];
  return scenes.map(scene => {
    if (!scene || typeof scene !== 'object') return scene;
    const cleanScene = { ...scene };
    delete cleanScene._imageObjectURL;
    delete cleanScene._videoObjectURL;
    delete cleanScene._audioObjectURL;
    delete cleanScene._sfxObjectURL;
    delete cleanScene._sfxBuffer;
    delete cleanScene._isAnimating;
    delete cleanScene._isUploadingVideo;

    if (Array.isArray(cleanScene.lines)) {
      cleanScene.lines = cleanScene.lines.map((shot: any) => {
        if (!shot || typeof shot !== 'object') return shot;
        const cleanShot = { ...shot };
        delete cleanShot._imageObjectURL;
        delete cleanShot._videoObjectURL;
        delete cleanShot._audioObjectURL;
        delete cleanShot._sfxObjectURL;
        delete cleanShot._sfxBuffer;
        delete cleanShot._isAnimating;
        delete cleanShot._isUploadingVideo;
        return cleanShot;
      });
    }
    return cleanScene;
  });
}
