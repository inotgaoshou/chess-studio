/// <reference types="vite/client" />
declare const __APP_ENV__: "test" | "production";

interface ImportMetaEnv {
  readonly VITE_ENABLE_SKIN_DEV_TOOLS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
