/** Locale-owned product name; proper brand spelling is shared by all supported locales. */
export const en = { name: 'UWork' } as const

/** Brand copy for the supported application locales. */
export const dictionaries = { en, zh: en, ja: en, es: en, fr: en, de: en, ru: en, pt: en }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product branding used by the UWork sidebar and blank home. */
    uworkBrand: keyof typeof en
  }
}
