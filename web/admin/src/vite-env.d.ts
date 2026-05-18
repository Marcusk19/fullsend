/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * Merged with `vite/client`. Root Vite project uses `base: '/'` for a shared build;
 * the admin app is still deployed at the public path `/admin/` (see OAuth helpers).
 */
interface ImportMetaEnv {
  /** Vite `base` (`'/'` in this repo; not the admin public path). */
  readonly BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
