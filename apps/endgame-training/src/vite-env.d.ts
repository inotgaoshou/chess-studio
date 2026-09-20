/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_SKIN_DEV_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
