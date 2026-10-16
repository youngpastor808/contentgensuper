export type RestoreApiKeysFn = () => void | Promise<void>;

let impl: RestoreApiKeysFn = async () => {};

export function registerRestoreApiKeysFromCloudOrDB(fn: RestoreApiKeysFn) {
  impl = fn;
}

export function restoreApiKeysFromCloudOrDB() {
  return impl();
}
