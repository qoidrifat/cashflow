import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleAuth } from 'google-auth-library';
import { Storage } from '@google-cloud/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

const VALID_TABS = new Set(['help', 'transactions', 'insight', 'gmail', 'receipts']);
const USER_SCOPED_TABS = new Set(['transactions', 'insight', 'gmail', 'receipts']);
const SENSITIVE_KEY_PATTERN = /(token|refresh|secret|service_role|api[_-]?key|private[_-]?key|jwt|authorization|credential|base64|image|body|raw|signed_url|public_url)/i;

function envFlag(value) {
  return String(value || '').toLowerCase() === 'true';
}

function resolveCredentialPath(rawPath) {
  if (!rawPath) return '';
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(SERVER_ROOT, rawPath);
}

export function getAgentSearchConfig() {
  const credentialPath = resolveCredentialPath(process.env.GOOGLE_APPLICATION_CREDENTIALS || './google-agent-search-service-account.json');
  return {
    enabled: envFlag(process.env.AGENT_SEARCH_ENABLED),
    projectId: process.env.AGENT_SEARCH_PROJECT_ID || process.env.GCP_PROJECT_ID || '',
    location: process.env.AGENT_SEARCH_LOCATION || 'global',
    collection: process.env.AGENT_SEARCH_COLLECTION || 'default_collection',
    engineId: process.env.AGENT_SEARCH_ENGINE_ID || '',
    servingConfigId: process.env.AGENT_SEARCH_SERVING_CONFIG_ID || 'default_config',
    dataStores: {
      help: process.env.AGENT_SEARCH_KNOWLEDGE_DATA_STORE_ID || '',
      transactions: process.env.AGENT_SEARCH_TRANSACTIONS_DATA_STORE_ID || '',
      insight: process.env.AGENT_SEARCH_TRANSACTIONS_DATA_STORE_ID || '',
      gmail: process.env.AGENT_SEARCH_GMAIL_LOGS_DATA_STORE_ID || '',
      receipts: process.env.AGENT_SEARCH_RECEIPTS_DATA_STORE_ID || '',
    },
    buckets: {
      docs: process.env.AGENT_SEARCH_DOCS_BUCKET || '',
      data: process.env.AGENT_SEARCH_DATA_BUCKET || '',
    },
    credentialPath,
    credentialExists: !!credentialPath && fs.existsSync(credentialPath),
    hasUserHashSalt: !!process.env.AGENT_SEARCH_USER_HASH_SALT,
  };
}

function publicConfig(config = getAgentSearchConfig()) {
  return {
    enabled: config.enabled,
    projectId: config.projectId,
    location: config.location,
    collection: config.collection,
    engineId: config.engineId,
    servingConfigId: config.servingConfigId,
    credentialExists: config.credentialExists,
    dataStoresConfigured: Object.fromEntries(
      Object.entries(config.dataStores).map(([key, value]) => [key, !!value]),
    ),
    bucketsConfigured: {
      docs: !!config.buckets.docs,
      data: !!config.buckets.data,
    },
    hasUserHashSalt: config.hasUserHashSalt,
  };
}

function assertConfigured(config = getAgentSearchConfig()) {
  if (!config.enabled) {
    const error = new Error('Agent Search belum dikonfigurasi.');
    error.code = 'AGENT_SEARCH_NOT_CONFIGURED';
    throw error;
  }
  if (!config.projectId || !config.engineId) {
    const error = new Error('Project ID atau Engine ID Agent Search belum diisi.');
    error.code = 'AGENT_SEARCH_NOT_CONFIGURED';
    throw error;
  }
  if (!config.credentialExists) {
    const error = new Error('File credential Agent Search tidak ditemukan.');
    error.code = 'AGENT_SEARCH_CREDENTIAL_MISSING';
    throw error;
  }
}

function getAuthClient() {
  const config = getAgentSearchConfig();
  assertConfigured(config);
  return new GoogleAuth({
    keyFile: config.credentialPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
}

function getStorageClient() {
  const config = getAgentSearchConfig();
  assertConfigured(config);
  return new Storage({
    projectId: config.projectId,
    keyFilename: config.credentialPath,
  });
}

export async function checkAgentSearchHealth() {
  const config = getAgentSearchConfig();
  if (!config.enabled) {
    return {
      ok: false,
      ...publicConfig(config),
      code: 'AGENT_SEARCH_NOT_CONFIGURED',
      message: 'Agent Search belum dikonfigurasi. Isi env server dan ikuti panduan setup.',
    };
  }
  if (!config.credentialExists) {
    return {
      ok: false,
      ...publicConfig(config),
      code: 'AGENT_SEARCH_CREDENTIAL_MISSING',
      message: 'File service account Agent Search tidak ditemukan di server.',
    };
  }
  if (!config.projectId || !config.engineId) {
    return {
      ok: false,
      ...publicConfig(config),
      code: 'AGENT_SEARCH_NOT_CONFIGURED',
      message: 'Project ID dan Engine ID Agent Search wajib diisi.',
    };
  }

  try {
    const auth = getAuthClient();
    const client = await auth.getClient();
    await client.getAccessToken();
    return {
      ok: true,
      ...publicConfig(config),
      message: 'Agent Search siap digunakan.',
    };
  } catch (error) {
    const classified = classifyAgentSearchError(error);
    return {
      ok: false,
      ...publicConfig(config),
      code: classified.code,
      message: classified.message,
      ...(process.env.NODE_ENV !== 'production' ? { detail: classified.detail } : {}),
    };
  }
}

function assertValidTab(tab) {
  const safeTab = tab || 'help';
  if (!VALID_TABS.has(safeTab)) {
    const error = new Error('Tab AI Search tidak valid.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
  return safeTab;
}

function assertUserForTab(tab, userId) {
  if (USER_SCOPED_TABS.has(tab) && !userId) {
    const error = new Error('Login diperlukan untuk mencari data user.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
}

function cleanText(value, maxLength = 800) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeDateOnly(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : safeDate(value)?.slice(0, 10) || null;
}

export function sanitizeAgentSearchPayload(input) {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeAgentSearchPayload(item)).filter((item) => item !== undefined);
  }
  if (!input || typeof input !== 'object') {
    return typeof input === 'string' ? cleanText(input, 2000) : input;
  }

  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string' && /data:image\/|-----BEGIN|ya29\.|eyJ[a-zA-Z0-9_-]*\./.test(value)) continue;
    if (value && typeof value === 'object') {
      output[key] = sanitizeAgentSearchPayload(value);
      continue;
    }
    output[key] = typeof value === 'string' ? cleanText(value, 2000) : value;
  }
  return output;
}

let saltWarned = false;

/**
 * Fail-fast AGENT_SEARCH_USER_HASH_SALT (Sprint 1.4 — SECURITY_AUDIT H-2).
 * Fallback dev menghasilkan hash yang dapat direkonstruksi (pola sha256(userId:salt)
 * diketahui) dan berubah bila salt di-set setelah data ter-upload → data store jadi
 * tidak match. Produksi WAJIB set salt kuat (fail-fast, pola BETTER_AUTH_SECRET).
 */
function assertProductionSalt() {
  const salt = process.env.AGENT_SEARCH_USER_HASH_SALT;
  const isFallback = !salt || salt === 'cashflow-dev-agent-search-salt-change-in-production';
  if (!isFallback) return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[AgentSearch] PRODUCTION: AGENT_SEARCH_USER_HASH_SALT wajib di-set ke nilai kuat yang unik. ' +
        'Fallback dev menghasilkan hash yang dapat direkonstruksi. Set env lalu re-sync data store.',
    );
  }
  if (!saltWarned) {
    saltWarned = true;
    console.warn(
      '[AgentSearch] PERINGATAN: memakai fallback dev AGENT_SEARCH_USER_HASH_SALT. ' +
        'Set env di produksi sebelum launch.',
    );
  }
}

export function hashUserId(userId) {
  if (!userId) return '';
  assertProductionSalt();
  const salt = process.env.AGENT_SEARCH_USER_HASH_SALT || 'cashflow-dev-agent-search-salt-change-in-production';
  return `hash_${crypto.createHash('sha256').update(`${userId}:${salt}`).digest('hex')}`;
}

export function buildTransactionSearchDocument(transaction) {
  const userHash = hashUserId(transaction.user_id || transaction.userId);
  const amount = safeNumber(transaction.amount) || 0;
  const merchant = cleanText(transaction.merchant, 160);
  const category = cleanText(transaction.category_name || transaction.categoryName || transaction.category, 120);
  const note = cleanText(transaction.note, 500);
  const type = cleanText(transaction.type, 40) || 'expense';
  const paymentMethod = cleanText(transaction.payment_method || transaction.paymentMethod, 80);
  const source = cleanText(transaction.source, 60) || 'manual';
  const transactionDate = safeDateOnly(transaction.transaction_date || transaction.date);
  const titlePrefix = type === 'income' ? 'Pemasukan' : type === 'refund' ? 'Refund' : 'Pengeluaran';

  return sanitizeAgentSearchPayload({
    id: `transaction_${transaction.id}`,
    transaction_id: String(transaction.id),
    user_id_hash: userHash,
    title: cleanText(`${titlePrefix} ${merchant || category || 'Transaksi'} Rp${amount.toLocaleString('id-ID')}`, 220),
    type,
    amount,
    currency: transaction.currency || 'IDR',
    merchant,
    category,
    payment_method: paymentMethod,
    note,
    transaction_date: transactionDate,
    source,
    created_at: safeDate(transaction.created_at || transaction.createdAt),
    search_text: cleanText(`${titlePrefix} ${merchant} ${category} ${paymentMethod} ${note} ${source} ${amount}`, 1200),
  });
}

export function buildGmailLogSearchDocument(log) {
  const messageId = log.message_id || log.gmail_message_id || log.messageId || '';
  const hash = messageId ? crypto.createHash('sha256').update(String(messageId)).digest('hex').slice(0, 18) : '';
  const sender = cleanText(log.sender, 180);
  const senderDomain = cleanText(log.sender_domain || sender.match(/@([^>\s]+)/)?.[1] || '', 140);
  const subject = cleanText(log.subject, 220);
  const status = cleanText(log.final_status || log.status, 80);
  const errorCode = cleanText(log.error_code, 100);
  const extractedNote = cleanText(log.extracted_note || log.note, 500);
  const metadata = sanitizeAgentSearchPayload(log.metadata || {});

  return sanitizeAgentSearchPayload({
    id: `gmail_log_${log.id || hash}`,
    gmail_message_id_hash: hash,
    user_id_hash: hashUserId(log.user_id || log.userId),
    title: cleanText(`Gmail Sync: ${senderDomain || 'email'} ${subject}`, 240),
    subject,
    sender_domain: senderDomain,
    final_status: status,
    error_code: errorCode || null,
    error_message: cleanText(log.error_message || metadata.errorMessage, 280) || null,
    extracted_note: extractedNote,
    amount: safeNumber(metadata.amount || metadata.extractedAmount),
    merchant: cleanText(metadata.merchant || metadata.extractedMerchant, 160),
    confidence_score: safeNumber(log.confidence_score || log.confidenceScore),
    email_date: safeDate(log.email_date || log.emailDate),
    scanned_at: safeDate(log.scanned_at || log.scannedAt),
    search_text: cleanText(`${senderDomain} ${subject} ${status} ${errorCode} ${extractedNote}`, 1200),
  });
}

export function buildReceiptSearchDocument(transaction) {
  const doc = buildTransactionSearchDocument(transaction);
  return {
    ...doc,
    id: `receipt_trx_${transaction.id}`,
    title: cleanText(`Scan Bukti: ${doc.merchant || doc.category || 'Transaksi'} Rp${Number(doc.amount || 0).toLocaleString('id-ID')}`, 220),
    source: 'receipt_scan',
    search_text: cleanText(`struk bukti scan receipt ${doc.merchant} ${doc.category} ${doc.payment_method} ${doc.note} ${doc.amount}`, 1200),
  };
}

function inferSection(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('gmail')) return 'Gmail Sync';
  if (normalized.includes('transaction')) return 'Transactions';
  if (normalized.includes('supabase')) return 'Supabase';
  if (normalized.includes('ui')) return 'UI';
  if (normalized.includes('audit')) return 'Audit';
  if (normalized.includes('google-cloud')) return 'Google Cloud';
  return 'CashFlow';
}

function cleanMarkdown(content) {
  return content
    .replace(/```[\s\S]*?```/g, (match) => (SENSITIVE_KEY_PATTERN.test(match) ? '' : match))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, 40000);
}

export function buildKnowledgeDocument(file) {
  const relativePath = path.relative(PROJECT_ROOT, file).replace(/\\/g, '/');
  const raw = fs.readFileSync(file, 'utf8');
  const content = cleanMarkdown(raw);
  const title = cleanText(
    raw.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, path.extname(file)).replace(/[-_]/g, ' '),
    220,
  );
  return sanitizeAgentSearchPayload({
    id: relativePath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title,
    path: relativePath,
    section: inferSection(relativePath),
    content,
    type: 'knowledge_base',
    updated_at: fs.statSync(file).mtime.toISOString(),
  });
}

function createJsonl(documents) {
  return documents.map((document) => JSON.stringify(document)).join('\n') + (documents.length ? '\n' : '');
}

async function uploadJsonl({ bucketName, objectName, documents }) {
  if (!bucketName) {
    const error = new Error('Bucket Agent Search belum dikonfigurasi.');
    error.code = 'AGENT_SEARCH_NOT_CONFIGURED';
    throw error;
  }
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(objectName);
  await file.save(createJsonl(documents), {
    contentType: 'application/jsonl',
    resumable: false,
    metadata: {
      cacheControl: 'no-store',
    },
  });
  return `gs://${bucketName}/${objectName}`;
}

async function importDocumentsToDataStore({ dataStoreId, gcsUri }) {
  if (!dataStoreId) return { triggered: false, reason: 'data_store_not_configured' };
  const config = getAgentSearchConfig();
  const auth = getAuthClient();
  const client = await auth.getClient();
  const endpoint = `https://discoveryengine.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/locations/${encodeURIComponent(config.location)}/collections/${encodeURIComponent(config.collection)}/dataStores/${encodeURIComponent(dataStoreId)}/branches/default_branch/documents:import`;
  const response = await client.request({
    url: endpoint,
    method: 'POST',
    data: {
      gcsSource: {
        inputUris: [gcsUri],
        dataSchema: 'custom',
      },
      reconciliationMode: 'INCREMENTAL',
    },
  });
  return { triggered: true, operation: response.data?.name || null };
}

function walkMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const result = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist'].includes(entry.name)) stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) result.push(fullPath);
    }
  }
  return result;
}

export async function syncCashFlowDocs() {
  const config = getAgentSearchConfig();
  assertConfigured(config);
  const docsDir = path.resolve(PROJECT_ROOT, 'docs');
  const rootDocs = [
    'GMAIL_SYNC_SETUP_GUIDE.md',
    'SETUP_GEMINI_SERVER.md',
    'ANALISIS_FITUR_CASHFLOW.md',
    'PROJECT_AGENT_ALIGNMENT_AUDIT.md',
  ].map((file) => path.resolve(PROJECT_ROOT, file)).filter((file) => fs.existsSync(file));
  const files = [...walkMarkdownFiles(docsDir), ...rootDocs];
  const skipped = [];
  const documents = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    if (/-----BEGIN PRIVATE KEY-----|service_role|refresh_token|client_secret/i.test(raw)) {
      skipped.push({ path: path.relative(PROJECT_ROOT, file).replace(/\\/g, '/'), reason: 'possible_secret' });
      continue;
    }
    const document = buildKnowledgeDocument(file);
    if (!document.content) {
      skipped.push({ path: document.path, reason: 'empty_content' });
      continue;
    }
    documents.push(document);
  }

  const objectName = `cashflow-docs-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const gcsUri = await uploadJsonl({ bucketName: config.buckets.docs, objectName, documents });
  const importResult = await importDocumentsToDataStore({ dataStoreId: config.dataStores.help, gcsUri }).catch((error) => ({
    triggered: false,
    error: classifyAgentSearchError(error),
  }));

  return {
    ok: true,
    filesProcessed: files.length,
    documentsUploaded: documents.length,
    skipped,
    gcsUri,
    import: importResult,
  };
}

import { getTurso } from '../lib/turso.js';

async function fetchRows(table, userId, _select = '*') {
  const turso = getTurso();
  if (!turso) return [];
  const result = await turso.execute({
    sql: `SELECT * FROM ${table} WHERE user_id = ? LIMIT 2000`,
    args: [userId],
  });
  return result.rows || [];
}


export async function syncTransactionsForUser({ userId }) {
  if (!userId) {
    const error = new Error('User ID wajib tersedia dari token Supabase.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
  const config = getAgentSearchConfig();
  assertConfigured(config);
  const rows = await fetchRows('transactions', userId);
  const documents = rows.map(buildTransactionSearchDocument);
  const objectName = `users/${hashUserId(userId)}/transactions-${Date.now()}.jsonl`;
  const gcsUri = await uploadJsonl({ bucketName: config.buckets.data, objectName, documents });
  const importResult = await importDocumentsToDataStore({ dataStoreId: config.dataStores.transactions, gcsUri }).catch((error) => ({
    triggered: false,
    error: classifyAgentSearchError(error),
  }));
  return { ok: true, rowsRead: rows.length, documentsUploaded: documents.length, gcsUri, import: importResult };
}

export async function syncGmailLogsForUser({ userId }) {
  if (!userId) {
    const error = new Error('User ID wajib tersedia dari token Supabase.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
  const config = getAgentSearchConfig();
  assertConfigured(config);
  const rows = await fetchRows(
    'gmail_sync_logs',
    userId,
    'id,user_id,message_id,gmail_message_id,subject,sender,sender_domain,email_date,status,final_status,error_code,error_message,extracted_note,confidence_score,scanned_at,metadata',
  );
  const documents = rows.map(buildGmailLogSearchDocument);
  const objectName = `users/${hashUserId(userId)}/gmail-logs-${Date.now()}.jsonl`;
  const gcsUri = await uploadJsonl({ bucketName: config.buckets.data, objectName, documents });
  const importResult = await importDocumentsToDataStore({ dataStoreId: config.dataStores.gmail, gcsUri }).catch((error) => ({
    triggered: false,
    error: classifyAgentSearchError(error),
  }));
  return { ok: true, rowsRead: rows.length, documentsUploaded: documents.length, gcsUri, import: importResult };
}

export async function syncReceiptsForUser({ userId }) {
  if (!userId) {
    const error = new Error('User ID wajib tersedia dari token Supabase.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
  const config = getAgentSearchConfig();
  assertConfigured(config);
  const rows = (await fetchRows('transactions', userId)).filter((transaction) => {
    const metadata = transaction.metadata && typeof transaction.metadata === 'object' ? transaction.metadata : {};
    return transaction.source === 'receipt_scan' || metadata.inputSource === 'receipt_scan';
  });
  const documents = rows.map(buildReceiptSearchDocument);
  const objectName = `users/${hashUserId(userId)}/receipts-${Date.now()}.jsonl`;
  const gcsUri = await uploadJsonl({ bucketName: config.buckets.data, objectName, documents });
  const importResult = await importDocumentsToDataStore({ dataStoreId: config.dataStores.receipts, gcsUri }).catch((error) => ({
    triggered: false,
    error: classifyAgentSearchError(error),
  }));
  return { ok: true, rowsRead: rows.length, documentsUploaded: documents.length, gcsUri, import: importResult };
}

function buildServingConfigPath(config) {
  return `projects/${config.projectId}/locations/${config.location}/collections/${config.collection}/engines/${config.engineId}/servingConfigs/${config.servingConfigId}`;
}

function buildFilter(tab, userId) {
  const filters = [];
  if (tab === 'help') filters.push('type: ANY("knowledge_base")');
  if (tab === 'transactions' || tab === 'insight') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
  if (tab === 'gmail') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
  if (tab === 'receipts') filters.push('user_id_hash: ANY("' + hashUserId(userId) + '")');
  return filters.join(' AND ');
}

function extractDocumentPayload(result) {
  const document = result.document || {};
  const data = document.structData || document.derivedStructData || {};
  const snippets = document.derivedStructData?.snippets || result.document?.derivedStructData?.snippets || [];
  return sanitizeAgentSearchPayload({
    id: data.id || document.id || document.name,
    title: data.title || document.title || cleanText(document.name, 120),
    snippet: Array.isArray(snippets) ? snippets.map((item) => item.snippet || item.htmlSnippet || '').filter(Boolean).join(' ') : '',
    ...data,
  });
}

/**
 * Filter results to the owning user.
 *
 * Privacy model:
 * - The Discovery Engine server-side `filter` param is the PRIMARY user-scope.
 * - This client re-filter is defense-in-depth.
 *
 * IMPORTANT: If the server-side filter WAS applied (serverFilterApplied=true),
 * Discovery Engine already scoped results to this user. In that case, results
 * that lack a retrievable `user_id_hash` field (schema not marked retrievable)
 * are STILL owned by the user — dropping them causes false-empty results.
 * So when the server filter is trusted, we keep results whose hash is absent,
 * and only drop results whose hash is PRESENT and MISMATCHED.
 *
 * If the server filter was NOT applied (fallback path, no filter sent), we
 * cannot trust scoping — we strictly require an exact hash match and drop
 * anything missing the field (fail-closed to protect privacy).
 */
function filterOwnedResults(results, tab, userId, { serverFilterApplied = false } = {}) {
  if (!USER_SCOPED_TABS.has(tab)) return results;
  const expectedHash = hashUserId(userId);
  return results.filter((result) => {
    const hash = result.user_id_hash;
    if (hash === expectedHash) return true;
    if (hash === undefined || hash === null || hash === '') {
      // Field not retrievable. Trust server filter if it was applied.
      return serverFilterApplied;
    }
    // Field present but mismatched → never belongs to this user.
    return false;
  });
}

async function discoveryRequest(pathSuffix, data) {
  const config = getAgentSearchConfig();
  assertConfigured(config);
  const auth = getAuthClient();
  const client = await auth.getClient();
  const url = `https://discoveryengine.googleapis.com/v1/${buildServingConfigPath(config)}${pathSuffix}`;
  const response = await client.request({ url, method: 'POST', data });
  return response.data;
}

export async function queryAgentSearch({ query, tab = 'help', userId }) {
  const safeTab = assertValidTab(tab);
  assertUserForTab(safeTab, userId);
  const safeQuery = cleanText(query, 500);
  if (safeQuery.length < 2) {
    const error = new Error('Query minimal 2 karakter.');
    error.code = 'AGENT_SEARCH_INVALID_REQUEST';
    throw error;
  }
  const filter = buildFilter(safeTab, userId);
  const payload = {
    query: safeQuery,
    pageSize: 10,
    queryExpansionSpec: { condition: 'AUTO' },
    spellCorrectionSpec: { mode: 'AUTO' },
    ...(filter ? { filter } : {}),
  };

  let data;
  let serverFilterApplied = Boolean(filter);
  let fallbackUsed = false;
  try {
    data = await discoveryRequest(':search', payload);
  } catch (searchError) {
    // If search fails with filter, retry without filter as fallback
    const errStatus = searchError?.response?.status || searchError?.code;
    if (errStatus === 400 && filter) {
      try {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.filter;
        data = await discoveryRequest(':search', fallbackPayload);
        serverFilterApplied = false; // server-side scope NOT applied on fallback
        fallbackUsed = true;
      } catch (retryError) {
        throw retryError;
      }
    } else {
      throw searchError;
    }
  }

  const rawCount = data?.totalSize ?? (Array.isArray(data?.results) ? data.results.length : 0);
  const rawResults = (data?.results || []).map(extractDocumentPayload);
  const fieldPresentCount = rawResults.filter((r) => r.user_id_hash !== undefined && r.user_id_hash !== null && r.user_id_hash !== '').length;
  const results = filterOwnedResults(rawResults, safeTab, userId, { serverFilterApplied });

  // Observability (no PII): pinpoint where results vanish.
  console.log('[agent-search] query diagnostics', {
    tab: safeTab,
    hashPrefix: userId ? hashUserId(userId).slice(0, 16) : null,
    serverFilterApplied,
    fallbackUsed,
    rawCount,
    extractedCount: rawResults.length,
    userIdHashFieldPresent: fieldPresentCount,
    finalCount: results.length,
  });

  return {
    ok: true,
    results,
    answer: null,
    diagnostics: {
      tab: safeTab,
      resultCount: results.length,
      rawCount,
      fallbackUsed,
      userIdHashRetrievable: fieldPresentCount > 0,
    },
  };
}

export async function answerAgentSearch({ query, tab = 'help', userId }) {
  const safeTab = assertValidTab(tab);
  assertUserForTab(safeTab, userId);
  const searchResponse = await queryAgentSearch({ query, tab: safeTab, userId });

  let answer = null;
  try {
    const filter = buildFilter(safeTab, userId);
    const data = await discoveryRequest(':answer', {
      query: { text: cleanText(query, 500) },
      relatedQuestionsSpec: { enable: true },
      answerGenerationSpec: {
        ignoreAdversarialQuery: true,
        ignoreNonAnswerSeekingQuery: false,
        ignoreLowRelevantContent: true,
        includeCitations: true,
      },
      searchSpec: {
        searchParams: {
          maxReturnResults: 8,
          ...(filter ? { filter } : {}),
        },
      },
    });
    answer = {
      text: cleanText(data.answer?.answerText || data.answer?.answer || '', 3000),
      citations: data.answer?.citations || [],
      sourceCount: Array.isArray(data.answer?.citations) ? data.answer.citations.length : searchResponse.results.length,
    };
  } catch (error) {
    answer = {
      text: '',
      citations: [],
      sourceCount: searchResponse.results.length,
      warning: classifyAgentSearchError(error).message,
    };
  }

  return {
    ...searchResponse,
    answer,
  };
}

export function classifyAgentSearchError(error) {
  const rawMessage = error?.message || error?.details || String(error || '');
  const message = rawMessage.toLowerCase();
  const status = error?.code || error?.response?.status;
  let code = error?.code && String(error.code).startsWith('AGENT_SEARCH_') ? error.code : 'AGENT_SEARCH_UNKNOWN_ERROR';
  let userMessage = 'Agent Search mengalami error teknis. Coba lagi nanti.';

  if (code === 'AGENT_SEARCH_NOT_CONFIGURED') {
    userMessage = 'Agent Search belum dikonfigurasi. Isi env server dan ikuti panduan setup.';
  } else if (code === 'AGENT_SEARCH_CREDENTIAL_MISSING') {
    userMessage = 'File service account Agent Search tidak ditemukan di server.';
  } else if (code === 'AGENT_SEARCH_INVALID_REQUEST') {
    userMessage = rawMessage;
  } else if (status === 400 && (message.includes('invalid argument') || message.includes('invalid filter') || message.includes('invalid value'))) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Konfigurasi filter Agent Search tidak valid. Data store mungkin belum memiliki field yang diperlukan.';
  } else if (status === 403 || message.includes('permission denied') || message.includes('iam')) {
    code = 'AGENT_SEARCH_PERMISSION_DENIED';
    userMessage = 'Akses Google Cloud ditolak. Periksa role service account Agent Search.';
  } else if (message.includes('api') && (message.includes('disabled') || message.includes('not enabled'))) {
    code = 'AGENT_SEARCH_API_DISABLED';
    userMessage = 'Discovery Engine API atau API pendukung belum aktif di Google Cloud.';
  } else if (status === 404 && message.includes('data')) {
    code = 'AGENT_SEARCH_DATA_STORE_NOT_FOUND';
    userMessage = 'Data Store Agent Search tidak ditemukan. Periksa Data Store ID.';
  } else if (status === 404 || message.includes('engine')) {
    code = 'AGENT_SEARCH_ENGINE_NOT_FOUND';
    userMessage = 'Search App atau Engine Agent Search tidak ditemukan. Periksa Engine ID.';
  } else if (status === 429 || message.includes('quota') || message.includes('resource exhausted')) {
    code = 'AGENT_SEARCH_QUOTA_EXCEEDED';
    userMessage = 'Quota Agent Search tercapai. Coba lagi setelah quota tersedia.';
  } else if (message.includes('invalid') || status === 400) {
    code = 'AGENT_SEARCH_INVALID_REQUEST';
    userMessage = 'Konfigurasi Agent Search perlu diperiksa. Pastikan data store dan engine sudah di-setup dengan benar.';
  } else if (message.includes('fetch') || message.includes('network') || message.includes('enotfound') || message.includes('econn')) {
    code = 'AGENT_SEARCH_NETWORK_ERROR';
    userMessage = 'Server gagal terhubung ke Google Cloud Agent Search.';
  }

  return {
    code,
    message: userMessage,
    detail: rawMessage,
  };
}

export function getPublicAgentSearchConfig() {
  return publicConfig();
}
