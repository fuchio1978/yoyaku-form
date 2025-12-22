const fs = require('fs');
const path = require('path');

function renderPage({ title, content, subtitle = '', backLink = '/', hideHeading = false }) {
  const layoutPath = path.join(__dirname, '..', 'templates', 'layout.html');
  let layout = fs.readFileSync(layoutPath, 'utf-8');

  if (hideHeading) {
    layout = layout.replace(
      /\s*<section class="page-heading">[\s\S]*?<\/section>/,
      ''
    );
  }

  return layout
    .replace('{{title}}', title)
    .replace('{{subtitle}}', subtitle)
    .replace('{{backLink}}', backLink)
    .replace('{{content}}', content);
}

function formatCurrency(currency, value) {
  return `${currency}${value.toLocaleString('ja-JP')}`;
}

module.exports = { renderPage, formatCurrency };
