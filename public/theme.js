// Run before styles load so the first paint already uses the chosen theme.
(() => {
  let preference;
  try { preference = localStorage.getItem('domino-theme'); } catch { /* Storage may be blocked. */ }
  if (preference !== 'light' && preference !== 'dark') preference = undefined;
  let button;
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    if (button) {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.textContent = dark ? '☀ Светлая тема' : '☾ Тёмная тема';
      button.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    }
  }
  apply(preference || 'dark');
  document.addEventListener('DOMContentLoaded', () => {
    button = document.getElementById('theme-toggle');
    apply(document.documentElement.dataset.theme);
    button.addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(preference);
      try { localStorage.setItem('domino-theme', preference); } catch { /* Keep the session choice. */ }
    });
  });
})();
