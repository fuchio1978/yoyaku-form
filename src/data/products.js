const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, '..', '..', 'storage', 'products.json');

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
