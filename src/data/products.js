const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../utils/env');

loadEnv();

// 永続ストレージのルート（Render の Persistent Disk など）
// PERSISTENT_STORAGE_PATH が指定されていればそちらを優先し、なければ従来どおりローカルstorageを使用
const storageRoot = process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const storePath = path.join(storageRoot, 'products.json');

function loadProducts() {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  const raw = fs.readFileSync(storePath, 'utf-8');
  return JSON.parse(raw);
}

function saveProducts(products) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(products, null, 2));
}

function getProducts() {
  return loadProducts();
}

function getProduct(id) {
  return loadProducts().find((product) => product.id === id);
}

module.exports = { getProducts, getProduct, saveProducts };
