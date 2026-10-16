export type UpdateVideoContextFn = (...args: any[]) => any;

let impl: UpdateVideoContextFn = () => {};

export function registerUpdateVideoContext(fn: UpdateVideoContextFn) {
  impl = fn;
}

export function updateVideoContext(...args: any[]) {
  return impl(...args);
}
