/** Source UWork Zai palettes mapped onto the native application's semantic roles.
 * Keep status colors, focus indicators, and typography with their existing owners.
 * Source: UWork_frontend/packages/ui/src/styles.css (.theme-zai-light/dark).
 */
export const uworkTokens = {
  '--dsw-alias-bg-base': { light: '#f5f5f5', dark: '#0f0f0f' },
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#202020' },
  '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#2b2b2b' },
  '--dsw-alias-bg-layer-3': { light: '#ffffff', dark: '#2b2b2b' },
  '--dsw-specific-sidebar-fill': { light: '#f0f0f0', dark: '#161616' },
  '--dsw-specific-input-major': { light: '#ffffff', dark: '#2b2b2b' },
  '--dsw-alias-label-primary': { light: '#262626', dark: '#d4d4d4' },
  '--dsw-alias-label-primary-dimmed': { light: '#262626', dark: '#d4d4d4' },
  '--dsw-alias-label-secondary': { light: '#595959', dark: '#adadad' },
  '--dsw-alias-label-tertiary': { light: '#666666', dark: '#999999' },
  '--dsw-alias-label-primary-inverted': { light: '#ffffff', dark: '#0f0f0f' },
  '--dsw-alias-brand-primary': { light: '#000000', dark: '#ffffff' },
  '--dsw-alias-brand-text': { light: '#000000', dark: '#ffffff' },
  '--dsw-alias-button-primary-hover': { light: '#262626', dark: '#e5e5e5' },
  '--dsw-alias-border-l1': { light: 'rgba(13, 13, 13, 0.05)', dark: 'rgba(255, 255, 255, 0.05)' },
  '--dsw-alias-border-l2': { light: 'rgba(13, 13, 13, 0.1)', dark: 'rgba(255, 255, 255, 0.1)' },
  '--dsw-alias-border-l3': { light: 'rgba(13, 13, 13, 0.15)', dark: 'rgba(255, 255, 255, 0.15)' },
  '--dsw-alias-interactive-bg-hover': { light: 'rgba(13, 13, 13, 0.05)', dark: 'rgba(255, 255, 255, 0.05)' },
  '--dsw-alias-interactive-bg-active': { light: 'rgba(13, 13, 13, 0.05)', dark: 'rgba(255, 255, 255, 0.1)' },
  '--dsw-specific-sidebar-nav-item-active': { light: 'rgba(13, 13, 13, 0.05)', dark: 'rgba(255, 255, 255, 0.1)' },
} as const
