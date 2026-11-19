/// <reference types="vite/client" />

declare module 'virtual:plugin-registry' {
  export const PLUGIN_REGISTRY: import('./shared/plugin-registry.ts').PluginRegistryEntry[];
}
