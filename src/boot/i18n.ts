import { boot } from 'quasar/wrappers';
import { createI18n } from 'vue-i18n';
import { translations, defaultLocale } from 'src/i18n';

function getInitialLocale(): string {
  const stored = localStorage.getItem('locale');
  if (stored && Object.keys(translations).includes(stored)) return stored;
  return defaultLocale;
}

export const i18n = createI18n({
  legacy: false,  // Composition API mode
  locale: getInitialLocale(),
  fallbackLocale: defaultLocale,
  messages: translations
});

export default boot(({ app }) => {
  app.use(i18n);
});
