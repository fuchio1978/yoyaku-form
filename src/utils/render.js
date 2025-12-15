const fs = require('fs');
const path = require('path');

function renderPage({ title, content, subtitle = '', backLink = '/' }) {
  const layoutPath = path.join(__dirname, '..', 'templates', 'layout.html');
  const layout = fs.readFileSync(layoutPath, 'utf-8');
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
