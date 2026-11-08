// Isolated UI localization: never replaces interactive nodes or their listeners.
const supported = ['en', 'zh-CN', 'vi'];
const names = {en: 'English', 'zh-CN': '简体中文', vi: 'Tiếng Việt'};
const fallback = {language:'Language',theme:'Theme'};
function normalize(value) {
  const code = String(value || '').toLowerCase();
  if (code.startsWith('zh')) return 'zh-CN';
  if (code.startsWith('vi')) return 'vi';
  return 'en';
}
function initialLanguage() {
  try {
    const saved = localStorage.getItem('pdfEditorLanguage');
    if (supported.includes(saved)) return saved;
  } catch (_) {}
  return normalize(navigator.languages?.[0] || navigator.language);
}
let current = initialLanguage();
let messages = {};
let loadSequence = 0;
export const t = (key, fallbackText = key) => messages[key] || fallbackText;
function setOwnText(element, value) {
  // Keep icon/other child nodes intact, replacing only the direct text node.
  const node = [...element.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
  if (node) node.textContent = value;
  else element.append(document.createTextNode(value));
}
function translateUI() {
  document.documentElement.lang = current;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    setOwnText(element, t(element.dataset.i18n, element.textContent));
  });
  for (const [attribute, selector] of [['placeholder','data-i18n-placeholder'],['aria-label','data-i18n-aria'],['title','data-i18n-title']]) {
    document.querySelectorAll('[' + selector + ']').forEach(element =>
      element.setAttribute(attribute, t(element.getAttribute(selector), element.getAttribute(attribute))));
  }
  const label = document.getElementById('languageLabel');
  if (label) label.textContent = names[current];
  document.querySelectorAll('[data-language-choice]').forEach(button => {
    const selected = button.dataset.languageChoice === current;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.dispatchEvent(new CustomEvent('pdf-editor-language-change', {detail:{language:current}}));
}
async function setLanguage(code, persist = true) {
  if (!supported.includes(code)) return;
  const sequence = ++loadSequence;
  let dictionary;
  try {
    const response = await fetch(new URL('./locales/' + code + '.json', import.meta.url));
    if (!response.ok) throw new Error('Translation HTTP ' + response.status);
    dictionary = await response.json();
  } catch (error) {
    console.warn('Unable to load translations:', error);
    if (code !== 'en') return setLanguage('en', false);
    dictionary = {};
  }
  if (sequence !== loadSequence) return;
  current = code;
  messages = dictionary;
  if (persist) {
    try { localStorage.setItem('pdfEditorLanguage', code); } catch (_) {}
  }
  translateUI();
}
export function initializeLocalization() {
  document.querySelectorAll('[data-language-choice]').forEach(button =>
    button.addEventListener('click', () => void setLanguage(button.dataset.languageChoice)));
  void setLanguage(current, false);
}
export const localization = {t, get language() {return current;}, setLanguage};
