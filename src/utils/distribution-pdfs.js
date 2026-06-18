const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./env');

loadEnv();

const storageRoot = process.env.PERSISTENT_STORAGE_PATH || path.join(__dirname, '..', '..', 'storage');
const legacyPdfPath = path.join(storageRoot, 'haifu-PDF.pdf');
const pdfStorePath = path.join(storageRoot, 'distribution-pdfs.json');
const pdfFilesDir = path.join(storageRoot, 'distribution-pdfs');

const LEGACY_PDF_ID = 'legacy-haifu-pdf';
const LEGACY_PDF_URL = '/haifu-PDF';

function ensurePdfRecordShape(record) {
  if (!record || typeof record !== 'object') return null;

  return {
    id: String(record.id || ''),
    title: String(record.title || ''),
    urlPath: normalizeUrlPath(record.urlPath || ''),
    storedFileName: String(record.storedFileName || ''),
    originalFileName: String(record.originalFileName || ''),
    legacy: !!record.legacy,
    lockedUrl: !!record.lockedUrl,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function normalizeUrlPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let normalized = raw.replace(/^https?:\/\/[^/]+/i, '');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/\/{2,}/g, '/');
  if (normalized.length > 1) {
    normalized = normalized.replace(/\/+$/, '');
  }
  return normalized;
}

function loadStoredDistributionPdfs() {
  if (!fs.existsSync(pdfStorePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(pdfStorePath, 'utf-8');
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(ensurePdfRecordShape).filter(Boolean);
  } catch (error) {
    console.error('Failed to load distribution PDFs', error);
    return [];
  }
}

function getLegacyPdfRecord() {
  if (!fs.existsSync(legacyPdfPath)) {
    return null;
  }

  return {
    id: LEGACY_PDF_ID,
    title: '既存配布PDF',
    urlPath: LEGACY_PDF_URL,
    storedFileName: path.basename(legacyPdfPath),
    originalFileName: path.basename(legacyPdfPath),
    legacy: true,
    lockedUrl: true,
    createdAt: null,
    updatedAt: fs.statSync(legacyPdfPath).mtime.toISOString(),
  };
}

function getDistributionPdfs() {
  const stored = loadStoredDistributionPdfs();
  const legacy = getLegacyPdfRecord();

  if (!legacy) {
    return stored.filter((item) => item.id !== LEGACY_PDF_ID);
  }

  const merged = stored.filter((item) => item.id !== LEGACY_PDF_ID);
  const matching = stored.find((item) => item.id === LEGACY_PDF_ID);
  if (matching) {
    merged.unshift({
      ...legacy,
      ...matching,
      id: LEGACY_PDF_ID,
      urlPath: LEGACY_PDF_URL,
      storedFileName: path.basename(legacyPdfPath),
      originalFileName: matching.originalFileName || legacy.originalFileName,
      legacy: true,
      lockedUrl: true,
    });
    return merged;
  }

  merged.unshift(legacy);
  return merged;
}

function saveDistributionPdfs(items) {
  const data = items
    .filter((item) => item)
    .map((item) => ({
      id: String(item.id || ''),
      title: String(item.title || ''),
      urlPath: item.id === LEGACY_PDF_ID ? LEGACY_PDF_URL : normalizeUrlPath(item.urlPath || ''),
      storedFileName:
        item.id === LEGACY_PDF_ID ? path.basename(legacyPdfPath) : String(item.storedFileName || ''),
      originalFileName: String(item.originalFileName || ''),
      legacy: item.id === LEGACY_PDF_ID,
      lockedUrl: !!item.lockedUrl,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    }));

  fs.mkdirSync(path.dirname(pdfStorePath), { recursive: true });
  fs.writeFileSync(pdfStorePath, JSON.stringify(data, null, 2));
}

function getPdfAbsolutePath(item) {
  if (!item) return '';
  if (item.id === LEGACY_PDF_ID) {
    return legacyPdfPath;
  }
  return path.join(pdfFilesDir, item.storedFileName || '');
}

function findDistributionPdfById(id) {
  return getDistributionPdfs().find((item) => item.id === id);
}

function findDistributionPdfByPath(urlPath) {
  const normalized = normalizeUrlPath(urlPath);
  return getDistributionPdfs().find((item) => normalizeUrlPath(item.urlPath) === normalized);
}

function writeDistributionPdfFile(itemId, fileName, data) {
  const safeFileName = path.basename(fileName);
  if (!/\.pdf$/i.test(safeFileName)) {
    throw new Error('Unsupported file type');
  }

  if (itemId === LEGACY_PDF_ID) {
    fs.mkdirSync(path.dirname(legacyPdfPath), { recursive: true });
    fs.writeFileSync(legacyPdfPath, data);
    return path.basename(legacyPdfPath);
  }

  const ext = path.extname(safeFileName) || '.pdf';
  const storedFileName = `${itemId}${ext.toLowerCase()}`;
  const targetPath = path.join(pdfFilesDir, storedFileName);
  fs.mkdirSync(pdfFilesDir, { recursive: true });
  fs.writeFileSync(targetPath, data);
  return storedFileName;
}

function deleteDistributionPdfFile(item) {
  if (!item || item.id === LEGACY_PDF_ID) {
    return;
  }

  const targetPath = getPdfAbsolutePath(item);
  if (targetPath && targetPath.startsWith(pdfFilesDir) && fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
}

module.exports = {
  LEGACY_PDF_ID,
  LEGACY_PDF_URL,
  deleteDistributionPdfFile,
  findDistributionPdfById,
  findDistributionPdfByPath,
  getDistributionPdfs,
  getPdfAbsolutePath,
  normalizeUrlPath,
  saveDistributionPdfs,
  writeDistributionPdfFile,
};
