/// <reference types="@lynx-js/rspeedy/client" />

declare module '@lynx-js/types' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GlobalProps {
    /** Optional PHP API origin for Lynx Explorer, e.g. http://192.168.x.x:8000 */
    apiBase?: string
  }
}

// This export makes the file a module
export {}
