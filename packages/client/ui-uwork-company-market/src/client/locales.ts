/** Company market copy; keys are shared by all supported application locales. */

/** en company market dictionary. */
export const en = {
  'title': 'Company market',
  'search': 'Search company skills',
  'submit': 'Search',
  'refresh': 'Refresh',
  'retry': 'Retry',
  'loading': 'Loading company skills',
  'empty': 'No skills found',
  'total': 'Skills: {count}',
  'version': 'Version {version}',
  'previous': 'Previous',
  'next': 'Next',
  'page': 'Page {page}',
  'source': 'Source: {source}',
  'retained': 'Showing previous results',
  'network': 'Could not reach the company market',
  'invalid': 'The company catalog is invalid',
  'limit': 'The company catalog exceeds its configured limits',
  'auth': 'The company market refused anonymous access',
  'rate': 'Too many requests. Try again later',
  'query': 'The search query or page is invalid',
} as const

/** zh company market dictionary. */
export const zh = {
  'title': '公司市场',
  'search': '搜索公司技能',
  'submit': '搜索',
  'refresh': '刷新',
  'retry': '重试',
  'loading': '正在加载公司技能',
  'empty': '没有找到技能',
  'total': '{count} 个技能',
  'version': '版本 {version}',
  'previous': '上一页',
  'next': '下一页',
  'page': '第 {page} 页',
  'source': '来源：{source}',
  'retained': '当前显示上次结果',
  'network': '无法连接公司市场',
  'invalid': '公司技能目录格式无效',
  'limit': '公司技能目录超出配置限制',
  'auth': '公司市场拒绝匿名访问',
  'rate': '请求过于频繁，请稍后重试',
  'query': '搜索内容或页码无效',
} satisfies Record<keyof typeof en, string>

/** ja company market dictionary. */
export const ja = {
  'title': '会社マーケット',
  'search': '会社のスキルを検索',
  'submit': '検索',
  'refresh': '更新',
  'retry': '再試行',
  'loading': '会社のスキルを読み込み中',
  'empty': 'スキルが見つかりません',
  'total': '{count} 件のスキル',
  'version': 'バージョン {version}',
  'previous': '前へ',
  'next': '次へ',
  'page': '{page} ページ',
  'source': '提供元: {source}',
  'retained': '前回の結果を表示中',
  'network': '会社マーケットに接続できません',
  'invalid': '会社のカタログが無効です',
  'limit': '会社のカタログが設定上限を超えています',
  'auth': '会社マーケットが匿名アクセスを拒否しました',
  'rate': 'リクエストが多すぎます。後でもう一度お試しください',
  'query': '検索内容またはページが無効です',
} satisfies Record<keyof typeof en, string>

/** de company market dictionary. */
export const de = {
  'title': 'Unternehmensmarkt',
  'search': 'Unternehmens-Skills suchen',
  'submit': 'Suchen',
  'refresh': 'Aktualisieren',
  'retry': 'Erneut versuchen',
  'loading': 'Unternehmens-Skills werden geladen',
  'empty': 'Keine Skills gefunden',
  'total': '{count} Skills',
  'version': 'Version {version}',
  'previous': 'Zurück',
  'next': 'Weiter',
  'page': 'Seite {page}',
  'source': 'Quelle: {source}',
  'retained': 'Vorherige Ergebnisse werden angezeigt',
  'network': 'Unternehmensmarkt nicht erreichbar',
  'invalid': 'Der Unternehmenskatalog ist ungültig',
  'limit': 'Der Unternehmenskatalog überschreitet die konfigurierten Grenzen',
  'auth': 'Der Unternehmensmarkt hat den anonymen Zugriff verweigert',
  'rate': 'Zu viele Anfragen. Später erneut versuchen',
  'query': 'Suchanfrage oder Seite ist ungültig',
} satisfies Record<keyof typeof en, string>

/** es company market dictionary. */
export const es = {
  'title': 'Mercado de la empresa',
  'search': 'Buscar habilidades de la empresa',
  'submit': 'Buscar',
  'refresh': 'Actualizar',
  'retry': 'Reintentar',
  'loading': 'Cargando habilidades de la empresa',
  'empty': 'No se encontraron habilidades',
  'total': '{count} habilidades',
  'version': 'Versión {version}',
  'previous': 'Anterior',
  'next': 'Siguiente',
  'page': 'Página {page}',
  'source': 'Fuente: {source}',
  'retained': 'Mostrando los resultados anteriores',
  'network': 'No se pudo conectar con el mercado de la empresa',
  'invalid': 'El catálogo de la empresa no es válido',
  'limit': 'El catálogo supera los límites configurados',
  'auth': 'El mercado de la empresa rechazó el acceso anónimo',
  'rate': 'Demasiadas solicitudes. Inténtalo más tarde',
  'query': 'La búsqueda o la página no es válida',
} satisfies Record<keyof typeof en, string>

/** fr company market dictionary. */
export const fr = {
  'title': 'Marché de l’entreprise',
  'search': 'Rechercher des compétences de l’entreprise',
  'submit': 'Rechercher',
  'refresh': 'Actualiser',
  'retry': 'Réessayer',
  'loading': 'Chargement des compétences de l’entreprise',
  'empty': 'Aucune compétence trouvée',
  'total': '{count} compétences',
  'version': 'Version {version}',
  'previous': 'Précédent',
  'next': 'Suivant',
  'page': 'Page {page}',
  'source': 'Source : {source}',
  'retained': 'Affichage des résultats précédents',
  'network': 'Impossible de joindre le marché de l’entreprise',
  'invalid': 'Le catalogue de l’entreprise est invalide',
  'limit': 'Le catalogue dépasse les limites configurées',
  'auth': 'Le marché de l’entreprise a refusé l’accès anonyme',
  'rate': 'Trop de requêtes. Réessayez plus tard',
  'query': 'La recherche ou la page est invalide',
} satisfies Record<keyof typeof en, string>

/** ru company market dictionary. */
export const ru = {
  'title': 'Корпоративный каталог',
  'search': 'Поиск корпоративных навыков',
  'submit': 'Найти',
  'refresh': 'Обновить',
  'retry': 'Повторить',
  'loading': 'Загрузка корпоративных навыков',
  'empty': 'Навыки не найдены',
  'total': 'Навыков: {count}',
  'version': 'Версия {version}',
  'previous': 'Назад',
  'next': 'Далее',
  'page': 'Страница {page}',
  'source': 'Источник: {source}',
  'retained': 'Показаны предыдущие результаты',
  'network': 'Не удалось подключиться к корпоративному каталогу',
  'invalid': 'Корпоративный каталог некорректен',
  'limit': 'Каталог превышает заданные ограничения',
  'auth': 'Корпоративный каталог отклонил анонимный доступ',
  'rate': 'Слишком много запросов. Повторите позже',
  'query': 'Некорректный запрос или номер страницы',
} satisfies Record<keyof typeof en, string>

/** pt company market dictionary. */
export const pt = {
  'title': 'Mercado da empresa',
  'search': 'Pesquisar competências da empresa',
  'submit': 'Pesquisar',
  'refresh': 'Atualizar',
  'retry': 'Tentar novamente',
  'loading': 'A carregar competências da empresa',
  'empty': 'Nenhuma competência encontrada',
  'total': '{count} competências',
  'version': 'Versão {version}',
  'previous': 'Anterior',
  'next': 'Seguinte',
  'page': 'Página {page}',
  'source': 'Origem: {source}',
  'retained': 'A mostrar resultados anteriores',
  'network': 'Não foi possível contactar o mercado da empresa',
  'invalid': 'O catálogo da empresa é inválido',
  'limit': 'O catálogo excede os limites configurados',
  'auth': 'O mercado da empresa recusou o acesso anónimo',
  'rate': 'Demasiados pedidos. Tente mais tarde',
  'query': 'A pesquisa ou a página é inválida',
} satisfies Record<keyof typeof en, string>

/** Supported company market dictionaries. */
export const dictionaries = { en, zh, ja, de, es, fr, ru, pt }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Public company skills tab. */
    uworkCompanyMarket: keyof typeof en
  }
}
