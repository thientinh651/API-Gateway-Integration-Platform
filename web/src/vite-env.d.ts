/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_X_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
