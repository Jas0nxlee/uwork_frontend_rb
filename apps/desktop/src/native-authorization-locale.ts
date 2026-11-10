/** Locale-owned copy for the product-selected native authorization entry. */
const dictionaries = {
  en_US: { title: 'Sign in to your organization', organization: 'Organization', start: 'Sign in', cancel: 'Cancel', waiting: 'Scan the QR code to continue', expired: 'This sign-in request expired. Please try again.', failed: 'Sign-in is unavailable. Please try again.', loading: 'Loading sign-in…', retry: 'Try again' },
  zh_CN: { title: '登录企业账号', organization: '组织', start: '登录', cancel: '取消', waiting: '请扫码继续登录', expired: '本次登录已过期，请重试。', failed: '暂时无法登录，请重试。', loading: '正在加载登录…', retry: '重试' },
  ja_JP: { title: '組織にログイン', organization: '組織', start: 'ログイン', cancel: 'キャンセル', waiting: 'QRコードをスキャンして続行', expired: 'ログインの有効期限が切れました。もう一度お試しください。', failed: 'ログインできません。もう一度お試しください。', loading: 'ログインを読み込み中…', retry: '再試行' },
  es_ES: { title: 'Inicia sesión en tu organización', organization: 'Organización', start: 'Iniciar sesión', cancel: 'Cancelar', waiting: 'Escanea el código QR para continuar', expired: 'La solicitud ha caducado. Inténtalo de nuevo.', failed: 'No se puede iniciar sesión. Inténtalo de nuevo.', loading: 'Cargando inicio de sesión…', retry: 'Reintentar' },
  fr_FR: { title: 'Connectez-vous à votre organisation', organization: 'Organisation', start: 'Se connecter', cancel: 'Annuler', waiting: 'Scannez le code QR pour continuer', expired: 'Cette demande a expiré. Réessayez.', failed: 'Connexion indisponible. Réessayez.', loading: 'Chargement de la connexion…', retry: 'Réessayer' },
  de_DE: { title: 'Bei Ihrer Organisation anmelden', organization: 'Organisation', start: 'Anmelden', cancel: 'Abbrechen', waiting: 'QR-Code scannen, um fortzufahren', expired: 'Diese Anmeldung ist abgelaufen. Bitte erneut versuchen.', failed: 'Anmeldung nicht verfügbar. Bitte erneut versuchen.', loading: 'Anmeldung wird geladen…', retry: 'Erneut versuchen' },
  ru_RU: { title: 'Войти в организацию', organization: 'Организация', start: 'Войти', cancel: 'Отмена', waiting: 'Отсканируйте QR-код, чтобы продолжить', expired: 'Срок запроса истёк. Повторите попытку.', failed: 'Вход недоступен. Повторите попытку.', loading: 'Загрузка входа…', retry: 'Повторить' },
  pt_BR: { title: 'Entre na sua organização', organization: 'Organização', start: 'Entrar', cancel: 'Cancelar', waiting: 'Leia o código QR para continuar', expired: 'Esta solicitação expirou. Tente novamente.', failed: 'Não foi possível entrar. Tente novamente.', loading: 'Carregando entrada…', retry: 'Tentar novamente' },
} as const
/**
 * @param locale - resolved desktop language.
 * @returns typed localized entry copy; unsupported languages use English.
 */
export function nativeAuthorizationMessages(locale: string) {
  const keys: Record<string, keyof typeof dictionaries> = { en: 'en_US', 'zh-CN': 'zh_CN', ja: 'ja_JP', es: 'es_ES', fr: 'fr_FR', de: 'de_DE', ru: 'ru_RU', pt: 'pt_BR' }
  return dictionaries[keys[locale] ?? 'en_US']
}
