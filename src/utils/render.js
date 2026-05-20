const fs = require('fs');
const path = require('path');

const NAVIGATION_VARIANTS = {
  default: [
    { href: '/', label: 'ホーム' },
    { href: '/about', label: 'ふちLABO.' },
    { href: '/kouza', label: '講座' },
    { href: '/voice', label: '受講生の声' },
    { href: '/contact', label: 'お問い合わせ' },
  ],
  chigusa: [
    { href: '/', label: 'ホーム' },
    { href: '/about', label: 'ふちLABO.' },
    { href: '/contact', label: 'お問い合わせ' },
  ],
};

function buildNavHtml(navVariant = 'default') {
  const links = NAVIGATION_VARIANTS[navVariant] || NAVIGATION_VARIANTS.default;
  return links.map((link) => `<a href="${link.href}">${link.label}</a>`).join('\n');
}

function renderPage({
  title,
  content,
  subtitle = '',
  backLink = '/',
  hideHeading = false,
  navVariant = 'default',
  bodyClass = '',
  pageClass = '',
  headExtras = '',
}) {
  const layoutPath = path.join(__dirname, '..', 'templates', 'layout.html');
  let layout = fs.readFileSync(layoutPath, 'utf-8');
  const navHtml = buildNavHtml(navVariant);

  if (hideHeading) {
    layout = layout.replace(
      /\s*<section class="page-heading">[\s\S]*?<\/section>/,
      ''
    );
  }

  return layout
    .replace('{{title}}', title)
    .replace('{{headExtras}}', headExtras)
    .replace('{{bodyClass}}', bodyClass)
    .replace('{{desktopNav}}', navHtml)
    .replace('{{mobileNav}}', navHtml)
    .replace('{{subtitle}}', subtitle)
    .replace('{{backLink}}', backLink)
    .replace('{{pageClass}}', pageClass)
    .replace('{{content}}', content);
}

function formatCurrency(currency, value) {
  return `${currency}${value.toLocaleString('ja-JP')}`;
}

module.exports = { renderPage, formatCurrency };
