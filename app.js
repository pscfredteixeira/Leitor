/* Leitor v0.2 — biblioteca local PDF/EPUB e narração neural Kokoro opcional.
   Arquivos completos ficam no dispositivo. Com Kokoro, apenas trechos de texto são enviados ao servidor configurado. */
'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  db: null, books: [], filter: 'all', search: '', active: null,
  pdfDoc: null, pdfTask: null, pdfPage: 1, pdfRenderSerial: 0, pdfText: '',
  epubBook: null, rendition: null, epubRelocationSerial: 0,
  currentText: '', speechSegments: [], speechIndex: 0, utterance: null, speechWatchdog: null,
  speaking: false, paused: false, speechGeneration: 0, voices: [], toastTimer: null,
  objectUrls: [], loadingBook: false,
  kokoroEndpoint: '', kokoroApiKey: '', kokoroController: null, kokoroObjectUrl: null, kokoroAudio: null, kokoroGenerating: false
};
const DB_NAME = 'leitor-library-v1';
const STORE = 'books';
const PDF_MODULE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs';
const PDF_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
const coverColors = [
  ['#5d557e', '#a597c8'], ['#466c6b', '#9fb8ad'],
  ['#875a58', '#d1a895'], ['#5b647f', '#b3bdd4'],
  ['#93765e', '#dbc5a2'], ['#685f78', '#bbb1cb']
];

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
function byId(id) { return document.getElementById(id); }
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('visible'), 4200);
}
function formatPercent(value) { return Math.min(100, Math.max(0, Math.round(Number(value) || 0))); }
function stripExtension(name) { return name.replace(/\.(pdf|epub)$/i, ''); }
function idFromFile(file) { return String(file.size) + '_' + String(file.lastModified) + '_' + file.name; }
function getCoverColors(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return coverColors[Math.abs(h) % coverColors.length];
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('leitor-theme', theme);
  $('#theme-toggle').textContent = theme === 'dark' ? '☀' : '☾';
  $('#reader-theme').textContent = theme === 'dark' ? '☀' : '◐';
  if (state.rendition) {
    state.rendition.themes.default({
      body: {background: theme === 'dark' ? '#2b2633' : '#fffefa',
             color: theme === 'dark' ? '#eee9f0' : '#2c2831',
             'line-height': '1.85 !important'}
    });
  }
}
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('Armazenamento local indisponível neste navegador.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function databaseRequest(operation, value) {
  return new Promise((resolve, reject) => {
    if (!state.db) return reject(new Error('Banco de dados indisponível.'));
    const tx = state.db.transaction(STORE, operation === 'getAll' ? 'readonly' : 'readwrite');
    const store = tx.objectStore(STORE);
    let request;
    if (operation === 'getAll') request = store.getAll();
    else if (operation === 'put') request = store.put(value);
    else if (operation === 'delete') request = store.delete(value);
    else return reject(new Error('Operação desconhecida.'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}
async function refreshBooks() {
  state.books = await databaseRequest('getAll');
  state.books.sort((a,b) => (b.lastOpened || b.addedAt || 0) - (a.lastOpened || a.addedAt || 0));
  renderLibrary();
}
async function saveActive() {
  if (!state.active) return;
  $('#save-status').textContent = 'Salvando…';
  const entry = {...state.active};
  try {
    await databaseRequest('put', entry);
    $('#save-status').textContent = '✓ Salvo';
  } catch (error) {
    $('#save-status').textContent = 'Não salvo';
    toast('Não foi possível salvar o progresso. Verifique o espaço disponível.');
    console.error(error);
  }
}
function clearCoverUrls() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
}
function displayCover(book) {
  const colors = getCoverColors(book.id);
  if (book.coverBlob instanceof Blob) {
    const url = URL.createObjectURL(book.coverBlob);
    state.objectUrls.push(url);
    return '<div class="book-cover has-art" style="background-image:url(&quot;' + escapeHTML(url) + '&quot;)"></div>';
  }
  return '<div class="book-cover" style="background:linear-gradient(147deg,' + colors[0] + ',' + colors[1] + ')">' +
    '<span class="cover-small">' + escapeHTML(book.format.toUpperCase()) + ' · LEITOR</span>' +
    '<strong class="cover-title">' + escapeHTML(book.title) + '</strong><span class="cover-symbol">✳</span></div>';
}
function renderLibrary() {
  clearCoverUrls();
  const all = state.books;
  $('#count-all').textContent = all.length;
  $('#count-pdf').textContent = all.filter((b) => b.format === 'pdf').length;
  $('#count-epub').textContent = all.filter((b) => b.format === 'epub').length;
  $('.total').textContent = '(' + all.length + ')';
  $('#filter-description').textContent = state.filter === 'all' ? 'Todos os formatos' : state.filter.toUpperCase();
  document.querySelectorAll('[data-filter]').forEach((button) =>
    button.classList.toggle('active', button.dataset.filter === state.filter));
  const filtered = all.filter((b) =>
    (state.filter === 'all' || b.format === state.filter) &&
    (b.title + ' ' + (b.author || '')).toLocaleLowerCase('pt-BR').includes(state.search)
  );
  $('#book-grid').innerHTML = filtered.map((b) =>
    '<article class="book-card">' +
      '<button class="book-open" data-id="' + escapeHTML(b.id) + '" aria-label="Abrir ' + escapeHTML(b.title) + '">' +
        displayCover(b) +
        '<h3>' + escapeHTML(b.title) + '</h3><p>' + escapeHTML(b.author || (b.format === 'pdf' ? 'Documento PDF' : 'Livro EPUB')) + '</p>' +
        '<div class="book-progress"><span style="width:' + formatPercent(b.percent) + '%"></span></div>' +
        '<div class="book-meta">' + (b.percent ? formatPercent(b.percent) + '% lido' : 'Ainda não iniciado') + '</div>' +
      '</button><button class="remove-book" data-remove="' + escapeHTML(b.id) + '" title="Remover da biblioteca" aria-label="Remover ' + escapeHTML(b.title) + '">×</button></article>'
  ).join('');
  const isEmpty = all.length === 0;
  $('#empty-state').classList.toggle('hidden', !isEmpty);
  $('#book-grid').classList.toggle('hidden', isEmpty);
  if (!isEmpty && filtered.length === 0) {
    $('#book-grid').innerHTML = '<p style="color:var(--muted);font-size:13px">Nenhum livro encontrado.</p>';
  }
  const latest = all.filter((b) => Boolean(b.lastOpened)).sort((a,b) => b.lastOpened - a.lastOpened)[0];
  $('#continue-section').classList.toggle('hidden', !latest || Boolean(state.search));
  if (latest) {
    $('#continue-title').textContent = latest.title;
    $('#continue-details').textContent = latest.format === 'pdf'
      ? 'Página ' + (latest.pdfPage || 1) + (latest.pdfPages ? ' de ' + latest.pdfPages : '')
      : formatPercent(latest.percent) + '% concluído';
    $('#continue-progress').style.width = formatPercent(latest.percent) + '%';
    $('#continue-card').dataset.id = latest.id;
    const colors = getCoverColors(latest.id);
    $('#continue-art').style.background = 'linear-gradient(140deg,' + colors[0] + ',' + colors[1] + ')';
    $('#continue-art').textContent = latest.title.charAt(0).toLocaleUpperCase('pt-BR');
  }
}
async function importFiles(fileList) {
  const valid = Array.from(fileList || []).filter((file) => /\.(pdf|epub)$/i.test(file.name));
  if (!valid.length) return toast('Escolha um arquivo PDF ou EPUB.');
  let count = 0;
  for (const file of valid) {
    const id = idFromFile(file);
    if (state.books.some((b) => b.id === id)) continue;
    const format = file.name.toLowerCase().endsWith('.epub') ? 'epub' : 'pdf';
    const entry = {
      id, format, file, title:stripExtension(file.name), author:'', addedAt:Date.now(),
      lastOpened:0, percent:0, pdfPage:1, pdfPages:0, epubCfi:'', coverBlob:null
    };
    if (format === 'epub' && typeof window.ePub === 'function') {
      let preview = null;
      try {
        preview = window.ePub(await file.arrayBuffer());
        await preview.ready;
        const metadata = await preview.loaded.metadata;
        if (metadata?.title) entry.title = metadata.title;
        if (metadata?.creator) entry.author = metadata.creator;
        const coverUrl = await preview.coverUrl();
        if (coverUrl) {
          try { entry.coverBlob = await (await fetch(coverUrl)).blob(); }
          catch (_) { /* Capa opcional */ }
        }
      } catch (error) { console.warn('Metadados EPUB indisponíveis', error); }
      finally { try { preview?.destroy(); } catch (_) {} }
    }
    try {
      await databaseRequest('put', entry);
      state.books.push(entry);
      count++;
    } catch (error) {
      console.error(error);
      toast('Falha ao importar. Verifique espaço disponível e permissões do navegador.');
      break;
    }
  }
  await refreshBooks();
  toast(count ? count + (count === 1 ? ' livro adicionado.' : ' livros adicionados.') : 'Este livro já está na biblioteca.');
}
function readerView(open) {
  $('#sidebar').classList.toggle('hidden', open);
  $('#library-view').classList.toggle('hidden', open);
  $('#reader-view').classList.toggle('hidden', !open);
  window.scrollTo({top:0,behavior:'instant'});
}
async function cleanupReader() {
  stopSpeech();
  state.pdfRenderSerial++;
  if (state.pdfTask) { try {state.pdfTask.cancel();} catch (_) {} state.pdfTask = null; }
  if (state.rendition) { try {state.rendition.destroy();} catch (_) {} }
  if (state.epubBook) { try {state.epubBook.destroy();} catch (_) {} }
  if (state.pdfDoc) { try {await state.pdfDoc.destroy();} catch (_) {} }
  state.pdfDoc = null; state.epubBook = null; state.rendition = null;
  state.currentText = ''; state.pdfText = ''; state.active = null;
  $('#pdf-stage').classList.add('hidden');
  $('#epub-stage').classList.add('hidden');
  $('#reader-loading').classList.remove('hidden');
  $('#epub-container').innerHTML = '';
}
async function closeReader() {
  if (state.active) await saveActive();
  await cleanupReader();
  readerView(false);
  await refreshBooks();
}
async function openBook(id) {
  const book = state.books.find((b) => b.id === id);
  if (!book || state.loadingBook) return;
  state.loadingBook = true;
  try {
    await cleanupReader();
    state.active = {...book, lastOpened:Date.now()};
    readerView(true);
    $('#reader-title').textContent = book.title;
    $('#reader-author').textContent = book.author || 'Minha biblioteca';
    $('#reader-format').textContent = book.format.toUpperCase();
    $('#reader-position').textContent = 'Carregando…';
    $('#reader-page').textContent = '—';
    $('#save-status').textContent = 'Preparando…';
    if (book.format === 'pdf') await openPDF();
    else await openEPUB();
    await saveActive();
  } catch (error) {
    console.error('Falha ao abrir livro', error);
    const explanation = state.active?.format === 'epub'
      ? (!window.JSZip || typeof window.ePub !== 'function'
        ? 'O carregador de EPUB não iniciou. Confira a conexão e atualize a página.'
        : 'Não foi possível interpretar este EPUB. Verifique se o arquivo está completo e sem DRM.')
      : 'Não foi possível abrir este PDF. Verifique se está completo ou protegido por senha.';
    const technical = String(error?.message || '').trim().slice(0, 160);
    $('#reader-loading').textContent = explanation + (technical ? ' Detalhes: ' + technical : '');
    $('#save-status').textContent = 'Falha ao abrir';
    toast(explanation);
  } finally { state.loadingBook = false; }
}

let pdfjsCache = null;
async function pdfjs() {
  if (!pdfjsCache) {
    pdfjsCache = await import(PDF_MODULE);
    pdfjsCache.GlobalWorkerOptions.workerSrc = PDF_WORKER;
  }
  return pdfjsCache;
}
async function openPDF() {
  $('#reader-loading').textContent = 'Carregando seu PDF…';
  const lib = await pdfjs();
  state.pdfDoc = await lib.getDocument({data: new Uint8Array(await state.active.file.arrayBuffer())}).promise;
  state.active.pdfPages = state.pdfDoc.numPages;
  state.pdfPage = Math.max(1, Math.min(state.active.pdfPage || 1, state.pdfDoc.numPages));
  $('#pdf-stage').classList.remove('hidden');
  await renderPDFPage();
}
async function renderPDFPage() {
  if (!state.pdfDoc) return;
  const serial = ++state.pdfRenderSerial;
  stopSpeech();
  if (state.pdfTask) { try {state.pdfTask.cancel();} catch (_) {} state.pdfTask = null; }
  $('#reader-loading').textContent = 'Preparando página…';
  $('#reader-loading').classList.remove('hidden');
  const page = await state.pdfDoc.getPage(state.pdfPage);
  if (serial !== state.pdfRenderSerial) return;
  const nativeViewport = page.getViewport({scale:1});
  const parentWidth = $('#reader-body').clientWidth || 750;
  const scale = Math.max(.3, Math.min(2.6, (parentWidth - (innerWidth < 700 ? 35 : 100)) / nativeViewport.width));
  const viewport = page.getViewport({scale});
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const canvas = $('#pdf-canvas');
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = Math.round(viewport.width) + 'px';
  canvas.style.height = Math.round(viewport.height) + 'px';
  const context = canvas.getContext('2d');
  state.pdfTask = page.render({canvasContext:context, viewport, transform:[ratio,0,0,ratio,0,0]});
  try { await state.pdfTask.promise; } catch (error) {
    if (error?.name === 'RenderingCancelledException') return;
    throw error;
  }
  if (serial !== state.pdfRenderSerial) return;
  state.pdfTask = null;
  const textContent = await page.getTextContent();
  if (serial !== state.pdfRenderSerial) return;
  state.pdfText = textContent.items.map((item) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
  state.currentText = state.pdfText;
  const segments = splitIntoSentences(state.pdfText);
  $('#pdf-text').innerHTML = segments.map((sentence, index) =>
    '<span data-sentence="' + index + '">' + escapeHTML(sentence) + ' </span>').join('');
  $('#pdf-text-block').classList.toggle('hidden', !segments.length);
  $('#speech-excerpt').textContent = segments.length
    ? 'Página pronta. Toque em Ouvir para começar.'
    : 'Este PDF não contém texto selecionável nesta página. Se for digitalizado, precisará de OCR para ser narrado.';
  $('#reader-loading').classList.add('hidden');
  $('#reader-body').scrollTop = 0;
  state.active.pdfPage = state.pdfPage;
  state.active.percent = Math.round(state.pdfPage / state.pdfDoc.numPages * 100);
  updateReaderPosition();
  await saveActive();
}
async function openEPUB() {
  if (typeof window.JSZip !== 'function') throw new Error('JSZip não carregou — conexão ou bloqueio de CDN.');
  if (typeof window.ePub !== 'function') throw new Error('Biblioteca EPUB não foi carregada.');
  $('#reader-loading').textContent = 'Preparando seu EPUB…';
  const epubBuffer = await state.active.file.arrayBuffer();
  if (!epubBuffer.byteLength) throw new Error('Arquivo EPUB está vazio.');
  state.epubBook = window.ePub(epubBuffer, {replacements:'blobUrl'});
  await state.epubBook.ready;
  const metadata = await state.epubBook.loaded.metadata;
  if (metadata?.title) { state.active.title = metadata.title; $('#reader-title').textContent = metadata.title; }
  if (metadata?.creator) { state.active.author = metadata.creator; $('#reader-author').textContent = metadata.creator; }
  $('#epub-stage').classList.remove('hidden');
  // A altura explícita evita iframes de 0px em alguns WebKit/iPhones.
  const bodyHeight = $('#reader-body').getBoundingClientRect().height;
  const frameHeight = Math.max(390, Math.floor(bodyHeight || 480));
  $('#epub-stage').style.height = frameHeight + 'px';
  state.rendition = state.epubBook.renderTo('epub-container', {
    width:'100%', height:frameHeight + 'px', flow:'paginated', spread:'none', manager:'default'
  });
  state.rendition.themes.default({
    body:{'font-family':'Georgia,serif !important','line-height':'1.85 !important',
      background:document.documentElement.dataset.theme === 'dark' ? '#2b2633' : '#fffefa',
      color:document.documentElement.dataset.theme === 'dark' ? '#eee9f0' : '#2c2831',
      padding:'0 5px !important'}
  });
  state.rendition.themes.fontSize('108%');
  state.rendition.on('relocated', onEpubRelocated);
  await state.rendition.display(state.active.epubCfi || undefined);
  $('#reader-loading').classList.add('hidden');
  loadVisibleEpubText();
  state.epubBook.locations.generate(1200).then(() => {
    if (state.rendition && state.active?.format === 'epub') {
      onEpubRelocated(state.rendition.currentLocation());
    }
  }).catch((error) => console.warn('Percentual EPUB aproximado', error));
}
function onEpubRelocated(location) {
  if (!location?.start || !state.active || state.active.format !== 'epub') return;
  const cfi = location.start.cfi;
  if (!cfi) return;
  const changed = state.active.epubCfi !== cfi;
  state.active.epubCfi = cfi;
  const locations = state.epubBook?.locations;
  if (locations && typeof locations.length === 'function' && locations.length()) {
    state.active.percent = formatPercent(locations.percentageFromCfi(cfi) * 100);
  } else {
    const index = location.start.index || 0;
    const sections = state.epubBook?.spine?.items?.length || 1;
    state.active.percent = formatPercent((index / sections) * 100);
  }
  updateReaderPosition();
  if (changed) { stopSpeech(); loadVisibleEpubText(); }
  saveActive();
}
function loadVisibleEpubText() {
  const contents = state.rendition?.getContents() || [];
  const doc = contents[0]?.document;
  const body = doc?.body;
  state.currentText = body ? (body.innerText || body.textContent || '').replace(/\s+/g, ' ').trim() : '';
  if (state.currentText.length > 30000) state.currentText = state.currentText.slice(0, 30000);
}
function updateReaderPosition() {
  if (!state.active) return;
  if (state.active.format === 'pdf') {
    const current = state.pdfPage;
    const total = state.pdfDoc?.numPages || state.active.pdfPages || '?';
    $('#reader-position').textContent = 'PÁGINA ' + current + ' DE ' + total;
    $('#reader-page').textContent = current + ' / ' + total;
    $('#prev-page').disabled = current <= 1;
    $('#next-page').disabled = current >= total;
  } else {
    $('#reader-position').textContent = formatPercent(state.active.percent) + '% DO LIVRO';
    $('#reader-page').textContent = 'Progresso: ' + formatPercent(state.active.percent) + '%';
    $('#prev-page').disabled = false;
    $('#next-page').disabled = false;
  }
}
async function turnPage(direction) {
  if (!state.active || state.loadingBook) return;
  if (state.active.format === 'pdf') {
    const wanted = Math.max(1, Math.min(state.pdfDoc.numPages, state.pdfPage + direction));
    if (wanted !== state.pdfPage) {
      state.pdfPage = wanted;
      try { await renderPDFPage(); } catch (error) { console.error(error); toast('Não foi possível carregar a página.'); }
    }
  } else if (state.rendition) {
    stopSpeech();
    try {
      if (direction > 0) await state.rendition.next();
      else await state.rendition.prev();
      loadVisibleEpubText();
    } catch (error) { console.error(error); toast('Não foi possível mudar de página.'); }
  }
}

function splitIntoSentences(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  let sentences;
  if (typeof Intl.Segmenter === 'function') {
    sentences = Array.from(new Intl.Segmenter('pt-BR', {granularity:'sentence'}).segment(normalized), (part) => part.segment.trim());
  } else {
    sentences = normalized.match(/[^.!?…]+[.!?…]*/g) || [normalized];
  }
  const chunks = [];
  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    if (sentence.length <= 190) { chunks.push(sentence.trim()); continue; }
    let buffer = '';
    for (const word of sentence.split(' ')) {
      if (buffer && (buffer + ' ' + word).length > 190) { chunks.push(buffer); buffer = word; }
      else buffer += (buffer ? ' ' : '') + word;
    }
    if (buffer) chunks.push(buffer);
  }
  return chunks;
}
/* Kokoro é gerado em um backend Python separado, necessário para o fonemizador pt-BR.
   Não enviar livros inteiros: apenas a frase atual (até 400 caracteres). */
const KOKORO_VOICES = [
  {id:'pf_dora',label:'Dora · feminina (Brasil)'},
  {id:'pm_alex',label:'Alex · masculina (Brasil)'},
  {id:'pm_santa',label:'Santa · masculina (Brasil)'}
];
function isKokoro() { return $('#speech-engine').value === 'kokoro'; }
function updateVoiceOptions() {
  const dropdown = $('#voice-select');
  if (!dropdown) return;
  if (isKokoro()) {
    dropdown.replaceChildren(...KOKORO_VOICES.map((v) => new Option(v.label, v.id)));
    const chosen = localStorage.getItem('leitor-kokoro-voice') || 'pf_dora';
    dropdown.value = KOKORO_VOICES.some((v) => v.id === chosen) ? chosen : 'pf_dora';
  } else {
    availableVoices();
  }
  $('#kokoro-config').classList.toggle('hidden', !isKokoro());
  $('#kokoro-connection').textContent = state.kokoroEndpoint ? 'endereço salvo' : 'não conectado';
  reportAudio(isKokoro()
    ? (state.kokoroEndpoint
      ? 'Kokoro selecionado. Toque em Testar voz; a primeira geração pode demorar.'
      : 'Kokoro selecionado, mas o motor ainda não está hospedado. Abra Configurar servidor Kokoro.')
    : 'Voz padrão do dispositivo selecionada. A qualidade varia conforme o iPhone.',
    state.kokoroEndpoint || !isKokoro() ? '' : 'pending');
}
function loadKokoroSettings() {
  state.kokoroEndpoint = localStorage.getItem('leitor-kokoro-endpoint') || '';
  state.kokoroApiKey = sessionStorage.getItem('leitor-kokoro-key') || '';
  $('#kokoro-url').value = state.kokoroEndpoint;
  $('#kokoro-key').value = state.kokoroApiKey;
  $('#speech-engine').value = localStorage.getItem('leitor-speech-engine') === 'system' ? 'system' : 'kokoro';
  state.kokoroAudio = $('#kokoro-player');
  updateVoiceOptions();
}
function normalizeKokoroURL(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('Informe o endereço HTTPS do servidor Kokoro.');
  let url;
  try { url = new URL(text); } catch (_) {throw new Error('O endereço não parece ser uma URL válida.');}
  const local = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('Use HTTPS para funcionar no iPhone e no GitHub Pages.');
  if (location.protocol === 'https:' && url.protocol === 'http:')
    throw new Error('Um site HTTPS não pode acessar um servidor HTTP. Configure HTTPS.');
  return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
}
async function connectKokoro() {
  let endpoint;
  try {endpoint = normalizeKokoroURL($('#kokoro-url').value);}
  catch(error) {reportAudio(error.message, 'error');toast(error.message);return;}
  $('#kokoro-connection').textContent = 'verificando…';
  reportAudio('Verificando conexão com o servidor Kokoro…', 'pending');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint + '/health', {signal:controller.signal, cache:'no-store'});
    if (!response.ok) throw new Error('Servidor respondeu HTTP ' + response.status);
    const data = await response.json();
    if (data.engine !== 'kokoro' || data.status !== 'ok') throw new Error('Este endereço não é um servidor Kokoro compatível com o Leitor.');
    state.kokoroEndpoint = endpoint;
    state.kokoroApiKey = $('#kokoro-key').value.trim();
    localStorage.setItem('leitor-kokoro-endpoint', endpoint);
    sessionStorage.setItem('leitor-kokoro-key', state.kokoroApiKey);
    $('#kokoro-connection').textContent = 'conectado';
    reportAudio('Servidor Kokoro conectado. Escolha Dora, Alex ou Santa e toque em Testar voz.', 'success');
    toast('Kokoro conectado! Agora teste a voz.');
  } catch (error) {
    $('#kokoro-connection').textContent = 'falha na conexão';
    const message = error.name === 'AbortError' ? 'O servidor não respondeu dentro do limite.' : error.message;
    reportAudio('Não conectou: ' + message + '. Confira o HTTPS, o CORS e se o servidor está ligado.', 'error');
    toast('Não foi possível conectar ao Kokoro.');
  } finally {clearTimeout(timer);}
}
function stopKokoro() {
  if (state.kokoroController) {
    state.kokoroController.abort();
    state.kokoroController = null;
  }
  const player = state.kokoroAudio;
  if (player) {
    player.pause();
    player.onended = null;
    player.onerror = null;
    player.onplaying = null;
    player.removeAttribute('src');
    player.load();
    player.classList.add('hidden');
  }
  if (state.kokoroObjectUrl) {
    URL.revokeObjectURL(state.kokoroObjectUrl);
    state.kokoroObjectUrl = null;
  }
  state.kokoroGenerating = false;
}
async function playKokoroSegment(generation) {
  if (generation !== state.speechGeneration || !state.speaking || !state.active && !state.testingVoice) return;
  if (state.speechIndex >= state.speechSegments.length) {
    state.speaking = false;
    state.kokoroGenerating = false;
    $('#save-status').textContent = '✓ Salvo';
    reportAudio('Trecho narrado até o fim. Avance a página para continuar.', 'success');
    updateSpeechButtons();
    return;
  }
  const segment = state.speechSegments[state.speechIndex].slice(0,400);
  const controller = new AbortController();
  state.kokoroController = controller;
  state.kokoroGenerating = true;
  showSpokenSegment();
  $('#save-status').textContent = 'Gerando voz neural…';
  reportAudio('Kokoro preparando ' + (state.speechIndex + 1) + ' de ' + state.speechSegments.length + ' trechos. A primeira geração pode demorar.', 'pending');
  updateSpeechButtons();
  try {
    const response = await fetch(state.kokoroEndpoint + '/api/tts', {
      method:'POST',
      mode:'cors',
      headers:{'Content-Type':'application/json', ...(state.kokoroApiKey ? {'X-Leitor-Key':state.kokoroApiKey} : {})},
      body:JSON.stringify({
        text:segment,
        voice:$('#voice-select').value,
        speed:Number($('#speed-range').value)
      }),
      signal:controller.signal
    });
    if (!response.ok) {
      let message = 'HTTP ' + response.status;
      try {const detail = await response.json(); message = detail.detail || message;} catch (_) {}
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('O servidor retornou áudio vazio.');
    if (generation !== state.speechGeneration || controller.signal.aborted) return;
    state.kokoroGenerating = false;
    if (state.kokoroObjectUrl) URL.revokeObjectURL(state.kokoroObjectUrl);
    state.kokoroObjectUrl = URL.createObjectURL(blob);
    const player = state.kokoroAudio;
    player.src = state.kokoroObjectUrl;
    player.playbackRate = 1;
    player.classList.remove('hidden');
    player.onplaying = () => {
      if (generation !== state.speechGeneration) return;
      $('#save-status').textContent = '♫ Kokoro';
      reportAudio('Narrando com Kokoro · ' + $('#voice-select').selectedOptions[0].textContent, 'success');
    };
    player.onended = () => {
      if (generation !== state.speechGeneration) return;
      state.speechIndex++;
      playKokoroSegment(generation);
    };
    player.onerror = () => {
      if (generation !== state.speechGeneration) return;
      reportAudio('Erro de reprodução do WAV. Toque novamente no controle de áudio.', 'error');
    };
    // Safari pode bloquear autoplay depois de uma resposta HTTP assíncrona;
    // manter controles HTML nativos para o usuário iniciar manualmente.
    try {
      await player.play();
    } catch (error) {
      if (generation !== state.speechGeneration) return;
      reportAudio('Áudio gerado com sucesso. Toque no botão ▶ do player abaixo para ouvir no iPhone.', 'pending');
      toast('Áudio Kokoro pronto. Toque em ▶ no player de áudio.');
    }
  } catch (error) {
    if (controller.signal.aborted || generation !== state.speechGeneration) return;
    state.speaking = false;
    state.kokoroGenerating = false;
    $('#save-status').textContent = 'Erro Kokoro';
    updateSpeechButtons();
    reportAudio('Falha no Kokoro: ' + (error instanceof TypeError ? 'rede, CORS ou servidor desconectado' : error.message), 'error');
    toast('O motor Kokoro não respondeu. Confira a configuração do servidor.');
  } finally {
    if (state.kokoroController === controller) state.kokoroController = null;
  }
}
function startKokoro(segments, testing = false) {
  if (!state.kokoroEndpoint) {
    $('#kokoro-config').open = true;
    reportAudio('O Kokoro precisa de um servidor HTTPS. Configure o endereço abaixo antes de ouvir.', 'error');
    toast('Configure o servidor Kokoro para usar as vozes neurais.');
    return;
  }
  stopSpeech();
  state.speechSegments = segments;
  state.speechIndex = 0;
  state.speaking = true;
  state.paused = false;
  state.testingVoice = testing;
  try {
    if (navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (_) {}
  updateSpeechButtons();
  playKokoroSegment(state.speechGeneration);
}

function reportAudio(message, stateName = '') {
  const el = $('#audio-diagnostic');
  if (el) {
    el.textContent = message;
    el.dataset.state = stateName;
  }
}
function availableVoices() {
  if (isKokoro() || !('speechSynthesis' in window)) return;
  const all = window.speechSynthesis.getVoices();
  const portuguese = all.filter((voice) => /^pt([-_]|$)/i.test(voice.lang));
  portuguese.sort((a,b) => {
    const score = (v) => (/(natural|neural|premium|enhanced)/i.test(v.name) ? 4 : 0) +
      (/pt[-_]BR/i.test(v.lang) ? 2 : 0) + (/microsoft|google/i.test(v.name) ? 1 : 0);
    return score(b) - score(a);
  });
  state.voices = portuguese.length ? portuguese : all;
  const select = $('#voice-select');
  const selection = select.value || localStorage.getItem('leitor-voice') || '';
  select.replaceChildren(new Option('Automática · Português', ''));
  state.voices.forEach((voice) => select.add(new Option(voice.name + ' (' + voice.lang + ')', voice.voiceURI)));
  if (Array.from(select.options).some((opt) => opt.value === selection)) select.value = selection;
}
function selectedVoice() {
  // Não reconstruir o seletor dentro do gesto de reprodução: Safari pode perder a ativação.
  return state.voices.find((voice) => voice.voiceURI === $('#voice-select').value) || null;
}
function updateSpeechButtons() {
  $('#play-speech').textContent = state.speaking ? (state.paused ? '▶ Continuar' : 'Ⅱ Pausar') : '▶ Ouvir';
}
function showSpokenSegment() {
  const sentence = state.speechSegments[state.speechIndex] || '';
  if (state.speaking) $('#speech-excerpt').textContent = sentence || 'Iniciando a narração…';
  document.querySelectorAll('#pdf-text [data-sentence]').forEach((el) => {
    const active = Number(el.dataset.sentence) === state.speechIndex && state.speaking && !state.testingVoice;
    el.classList.toggle('active-sentence', active);
    if (active && innerWidth < 700) el.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}
function stopSpeech(cancel = true) {
  state.speechGeneration++;
  stopKokoro();
  clearTimeout(state.speechWatchdog);
  state.speechWatchdog = null;
  if (cancel && 'speechSynthesis' in window) {
    try {window.speechSynthesis.cancel();} catch (_) {}
  }
  state.utterance = null;
  state.speaking = false;
  state.paused = false;
  state.testingVoice = false;
  state.speechIndex = 0;
  state.speechSegments = [];
  showSpokenSegment();
  updateSpeechButtons();
}
function speakNext(generation) {
  if (generation !== state.speechGeneration || !state.speaking || state.paused) return;
  if (state.speechIndex >= state.speechSegments.length) {
    state.speaking = false; state.paused = false;
    state.utterance = null; state.testingVoice = false;
    $('#save-status').textContent = '✓ Salvo';
    updateSpeechButtons(); showSpokenSegment();
    $('#speech-excerpt').textContent = 'Leitura deste trecho concluída.';
    reportAudio('A reprodução terminou. Para continuar, toque em Ouvir na próxima página.', 'success');
    return;
  }
  const phrase = state.speechSegments[state.speechIndex];
  showSpokenSegment();
  const utterance = new SpeechSynthesisUtterance(phrase);
  const voice = selectedVoice();
  utterance.lang = voice?.lang || 'pt-BR';
  if (voice) utterance.voice = voice;
  utterance.rate = Number($('#speed-range').value);
  utterance.volume = 1;
  state.utterance = utterance;
  let started = false;
  const token = state.speechIndex;
  utterance.onstart = () => {
    if (generation !== state.speechGeneration || token !== state.speechIndex) return;
    started = true;
    clearTimeout(state.speechWatchdog);
    $('#save-status').textContent = '♫ Narrando';
    reportAudio('O Safari iniciou a voz. Se não ouvir nada, compare com Testar som e confira a saída de áudio.', 'success');
  };
  utterance.onend = () => {
    if (generation !== state.speechGeneration || token !== state.speechIndex) return;
    clearTimeout(state.speechWatchdog);
    state.utterance = null;
    state.speechIndex++;
    speakNext(generation);
  };
  utterance.onerror = (event) => {
    if (generation !== state.speechGeneration || ['interrupted','canceled'].includes(event.error)) return;
    clearTimeout(state.speechWatchdog);
    const code = event.error || 'desconhecido';
    console.warn('Erro de voz:', code);
    state.speaking = false;
    state.utterance = null;
    $('#save-status').textContent = 'Falha no áudio';
    updateSpeechButtons();
    reportAudio('Falha na voz (' + code + '). Tente escolher outra voz ou abrir diretamente no Safari.', 'error');
    toast('A narração não conseguiu iniciar. Veja o diagnóstico sob o título LEITURA EM VOZ ALTA.');
  };
  // O primeiro speak precisa ocorrer no próprio clique: não usar await ou setTimeout aqui.
  try {
    window.speechSynthesis.speak(utterance);
  } catch(error) {
    state.speaking = false;
    updateSpeechButtons();
    reportAudio('Erro ao iniciar o narrador: ' + error.message, 'error');
    return;
  }
  clearTimeout(state.speechWatchdog);
  state.speechWatchdog = setTimeout(() => {
    if (generation !== state.speechGeneration || token !== state.speechIndex || started || !state.speaking || state.paused) return;
    reportAudio('A voz do Safari não respondeu em 6 segundos. Toque em Testar som e depois em Testar voz. Talvez o navegador esteja bloqueando a síntese.', 'error');
    $('#speech-excerpt').textContent = 'A voz não respondeu. Confira o diagnóstico abaixo.';
    toast('A voz não iniciou. Use os botões Testar som e Testar voz.');
  }, 6000);
}
function startSpeech(segments, testing = false) {
  if (isKokoro()) return startKokoro(segments, testing);
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
    reportAudio('Seu navegador não disponibiliza a API de narração. Abra no Safari.', 'error');
    toast('Este navegador não oferece leitura em voz alta.');
    return;
  }
  try {
    if (navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (_) {}
  // Em iOS, cancelar sempre imediatamente antes de falar pode silenciar a primeira fala.
  // Só cancelar se realmente houver fala anterior na fila; preservar o gesto do usuário.
  const synth = window.speechSynthesis;
  const busy = Boolean(synth.speaking || synth.pending || synth.paused);
  stopSpeech(busy);
  state.speechSegments = segments;
  state.speechIndex = 0;
  state.speaking = true;
  state.paused = false;
  state.testingVoice = testing;
  reportAudio('Solicitando voz ao Safari…', 'pending');
  $('#save-status').textContent = 'Iniciando voz…';
  updateSpeechButtons();
  speakNext(state.speechGeneration);
}
function testVoice() {
  startSpeech(['Olá! Este é o teste de voz do Leitor. Se você está ouvindo esta frase, a narração funciona.'], true);
}
function makeTestTone() {
  // WAV PCM, independente de SpeechSynthesis; dura 0,6 segundo e testa a saída de áudio.
  const sampleRate = 22050, seconds = .6, samples = Math.floor(sampleRate * seconds);
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const put = (offset, str) => {for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));};
  put(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true);
  put(8, 'WAVE'); put(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const frequency = t < .3 ? 660 : 880;
    const envelope = Math.min(1,t * 30, (seconds - t) * 30);
    view.setInt16(44 + i * 2, Math.round(Math.sin(t * 2 * Math.PI * frequency) * 11000 * Math.max(0,envelope)), true);
  }
  return new Blob([bytes], {type:'audio/wav'});
}
function testSound() {
  // Teste independente da voz e do conteúdo do PDF, iniciado diretamente pelo toque.
  stopSpeech();
  let audio;
  const url = URL.createObjectURL(makeTestTone());
  try {
    if (navigator.audioSession && 'type' in navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (_) {}
  audio = new Audio();
  audio.src = url; audio.volume = 1; audio.preload = 'auto';
  audio.onplaying = () => reportAudio('O navegador está reproduzindo o som de teste. Você ouviu dois bipes? Se não, verifique volume, silencioso e Bluetooth.', 'success');
  audio.onerror = () => reportAudio('O navegador não conseguiu abrir o som de teste. Abra o Leitor diretamente no Safari.', 'error');
  audio.onended = () => {URL.revokeObjectURL(url);};
  reportAudio('Reproduzindo dois bipes de teste…', 'pending');
  const result = audio.play();
  if (result && typeof result.catch === 'function') {
    result.catch((error) => {
      URL.revokeObjectURL(url);
      reportAudio('O Safari bloqueou o som de teste: ' + error.message, 'error');
    });
  }
  state.toneAudio = audio;
}
function toggleSpeech() {
  if (isKokoro()) {
    if (state.kokoroGenerating) {
      reportAudio('O Kokoro está gerando a narração. Se quiser cancelar, toque em Parar.', 'pending');
      return;
    }
    if (state.speaking && state.paused) {
      state.paused = false;
      const resume = state.kokoroAudio?.play();
      if (resume?.catch) resume.catch(() => reportAudio('Toque em ▶ no player nativo para continuar a narração.', 'pending'));
      updateSpeechButtons();
      return;
    }
    if (state.speaking) {
      state.paused = true;
      state.kokoroAudio?.pause();
      reportAudio('Narração neural pausada.', 'pending');
      updateSpeechButtons();
      return;
    }
    if (state.active?.format === 'epub') loadVisibleEpubText();
    const segments = splitIntoSentences(state.currentText);
    if (!segments.length) {
      const msg = state.active?.format === 'pdf'
        ? 'Este PDF não tem texto selecionável nesta página. PDFs digitalizados precisam de OCR.'
        : 'Não foi encontrado texto nesta página. Tente avançar para a próxima.';
      reportAudio(msg, 'error'); toast(msg); return;
    }
    return startKokoro(segments);
  }
  if (!('speechSynthesis' in window)) {
    reportAudio('O navegador não oferece voz do sistema.', 'error');
    return toast('Voz do sistema indisponível neste navegador.');
  }
  if (state.paused) {
    state.paused = false;
    window.speechSynthesis.resume();
    reportAudio('Narração retomada.', 'success');
    updateSpeechButtons();
    return;
  }
  if (state.speaking) {
    state.paused = true;
    window.speechSynthesis.pause();
    reportAudio('Narração pausada.', 'pending');
    updateSpeechButtons();
    return;
  }
  if (state.active?.format === 'epub') loadVisibleEpubText();
  const segments = splitIntoSentences(state.currentText);
  if (!segments.length) {
    const message = state.active?.format === 'pdf'
      ? 'Esta página do PDF não tem texto selecionável. PDFs digitalizados precisam de OCR.'
      : 'Não foi encontrado texto nesta página.';
    reportAudio(message, 'error');
    return toast(message);
  }
  startSpeech(segments);
}
async function removeBook(id) {
  const book = state.books.find((b) => b.id === id);
  if (!book) return;
  if (!confirm('Remover "' + book.title + '" da biblioteca deste dispositivo?')) return;
  try { await databaseRequest('delete', id); await refreshBooks(); toast('Livro removido da biblioteca.'); }
  catch (error) { console.error(error); toast('Não foi possível remover o livro.'); }
}
function setupEvents() {
  const chooseFiles = () => $('#file-input').click();
  for (const id of ['add-books','empty-import','mobile-add','sidebar-import'])
    byId(id).addEventListener('click', chooseFiles);
  $('#file-input').addEventListener('change', async (event) => {
    await importFiles(event.target.files);
    event.target.value = '';
  });
  $('#search-input').addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLocaleLowerCase('pt-BR');
    renderLibrary();
  });
  document.querySelectorAll('[data-filter]').forEach((button) =>
    button.addEventListener('click', () => {state.filter = button.dataset.filter;renderLibrary();}));
  $('#book-grid').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) return removeBook(remove.dataset.remove);
    const open = event.target.closest('[data-id]');
    if (open) await openBook(open.dataset.id);
  });
  $('#continue-card').addEventListener('click', (event) => openBook(event.currentTarget.dataset.id));
  $('#back-to-library').addEventListener('click', closeReader);
  $('#prev-page').addEventListener('click', () => turnPage(-1));
  $('#next-page').addEventListener('click', () => turnPage(1));
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#reader-theme').addEventListener('click', toggleTheme);
  $('#play-speech').addEventListener('click', toggleSpeech);
  $('#test-voice').addEventListener('click', testVoice);
  $('#test-sound').addEventListener('click', testSound);
  $('#stop-speech').addEventListener('click', () => stopSpeech());
  $('#speech-engine').addEventListener('change', (event) => {
    stopSpeech(); localStorage.setItem('leitor-speech-engine', event.target.value);updateVoiceOptions();
  });
  $('#kokoro-connect').addEventListener('click', connectKokoro);
  $('#speed-range').addEventListener('input', (event) => {
    $('#speed-output').textContent = Number(event.target.value).toFixed(1).replace('.',',') + '×';
  });
  $('#voice-select').addEventListener('change', (event) => {
    localStorage.setItem(isKokoro() ? 'leitor-kokoro-voice' : 'leitor-voice', event.target.value);
    if (state.speaking) { stopSpeech(); toast('Voz alterada. Toque em Ouvir para recomeçar.'); }
  });
  document.addEventListener('keydown', (event) => {
    if ($('#reader-view').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); turnPage(1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); turnPage(-1); }
    if (event.key === 'Escape') closeReader();
  });
  if ('speechSynthesis' in window) {
    availableVoices();
    window.speechSynthesis.onvoiceschanged = availableVoices;
    setTimeout(availableVoices, 700);
    setTimeout(availableVoices, 2200);
  }
}
async function init() {
  setupEvents();
  loadKokoroSettings();
  try {
    applyTheme(localStorage.getItem('leitor-theme') === 'dark' ? 'dark' : 'light');
    state.db = await openDB();
    await refreshBooks();
  } catch (error) {
    console.error('Falha no armazenamento local', error);
    toast('Este navegador bloqueou o armazenamento. Ative o armazenamento local para guardar os livros.');
  }
}
init();