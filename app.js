/* Leitor v0.1 — biblioteca local, PDF/EPUB e leitura em voz alta.
   Documentos não são enviados para servidores. Dependências são carregadas via CDN. */
'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  db: null, books: [], filter: 'all', search: '', active: null,
  pdfDoc: null, pdfTask: null, pdfPage: 1, pdfRenderSerial: 0, pdfText: '',
  epubBook: null, rendition: null, epubRelocationSerial: 0,
  currentText: '', speechSegments: [], speechIndex: 0, utterance: null, speechWatchdog: null,
  speaking: false, paused: false, speechGeneration: 0, voices: [], toastTimer: null,
  objectUrls: [], loadingBook: false
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
    $('#reader-loading').textContent = explanation;
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
function availableVoices() {
  if (!('speechSynthesis' in window)) return;
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
  if (Array.from(select.options).some((o) => o.value === selection)) select.value = selection;
}
function selectedVoice() {
  availableVoices();
  const selected = state.voices.find((voice) => voice.voiceURI === $('#voice-select').value);
  return selected || state.voices.find((voice) => /^pt[-_]BR$/i.test(voice.lang)) ||
    state.voices.find((voice) => /^pt([-_]|$)/i.test(voice.lang)) || null;
}
function updateSpeechButtons() {
  $('#play-speech').textContent = state.speaking ? (state.paused ? '▶ Continuar' : 'Ⅱ Pausar') : '▶ Ouvir';
}
function showSpokenSegment() {
  const sentence = state.speechSegments[state.speechIndex] || '';
  if (state.speaking) $('#speech-excerpt').textContent = sentence || 'Aguardando a voz…';
  document.querySelectorAll('#pdf-text [data-sentence]').forEach((el) => {
    const active = Number(el.dataset.sentence) === state.speechIndex && state.speaking && !state.testingVoice;
    el.classList.toggle('active-sentence', active);
    if (active && innerWidth < 700) el.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}
function stopSpeech() {
  state.speechGeneration++;
  clearTimeout(state.speechWatchdog);
  state.speechWatchdog = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
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
    state.speaking = false;
    state.paused = false;
    state.utterance = null;
    state.testingVoice = false;
    updateSpeechButtons();
    showSpokenSegment();
    $('#speech-excerpt').textContent = 'Leitura deste trecho concluída.';
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
  state.utterance = utterance; // manter referência viva no Safari
  let started = false;
  const token = state.speechIndex;
  utterance.onstart = () => {
    if (generation !== state.speechGeneration || token !== state.speechIndex) return;
    started = true;
    clearTimeout(state.speechWatchdog);
    $('#save-status').textContent = '♫ Narrando';
  };
  utterance.onend = () => {
    if (generation !== state.speechGeneration || token !== state.speechIndex) return;
    clearTimeout(state.speechWatchdog);
    state.utterance = null;
    $('#save-status').textContent = '✓ Salvo';
    state.speechIndex++;
    speakNext(generation);
  };
  utterance.onerror = (event) => {
    if (generation !== state.speechGeneration || ['interrupted','canceled'].includes(event.error)) return;
    clearTimeout(state.speechWatchdog);
    console.warn('Falha na síntese de voz:', event.error);
    state.speaking = false;
    state.utterance = null;
    updateSpeechButtons();
    $('#speech-excerpt').textContent = 'A voz do navegador falhou. Escolha outra voz e use Testar voz.';
    toast('Não foi possível reproduzir esta voz. Use Testar voz para experimentar outra.');
  };
  window.speechSynthesis.speak(utterance);
  clearTimeout(state.speechWatchdog);
  state.speechWatchdog = setTimeout(() => {
    if (generation !== state.speechGeneration || token !== state.speechIndex || started || !state.speaking || state.paused) return;
    $('#speech-excerpt').textContent = 'A voz não iniciou no Safari. Toque em Parar, escolha outra voz e use Testar voz.';
    toast('Sem resposta da voz do sistema. Experimente Testar voz, outra voz ou abrir no Safari.');
  }, 4800);
}
function startSpeech(segments, testing = false) {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
    toast('Este navegador não oferece leitura de voz.');
    return;
  }
  // Reproduzir imediatamente dentro do clique: iOS bloqueia áudio iniciado depois de awaits.
  stopSpeech();
  state.speechSegments = segments;
  state.speechIndex = 0;
  state.speaking = true;
  state.paused = false;
  state.testingVoice = testing;
  updateSpeechButtons();
  $('#save-status').textContent = 'Iniciando voz…';
  speakNext(state.speechGeneration);
}
function testVoice() {
  startSpeech(['Olá! Esta é uma demonstração da voz selecionada no Leitor.'], true);
}
function toggleSpeech() {
  if (!('speechSynthesis' in window)) return toast('Seu navegador não suporta leitura em voz alta.');
  if (state.paused) {
    state.paused = false;
    window.speechSynthesis.resume();
    updateSpeechButtons();
    return;
  }
  if (state.speaking) {
    state.paused = true;
    window.speechSynthesis.pause();
    updateSpeechButtons();
    return;
  }
  if (state.active?.format === 'epub') loadVisibleEpubText();
  const segments = splitIntoSentences(state.currentText);
  if (!segments.length) {
    if (state.active?.format === 'pdf') {
      toast('Não há texto selecionável nesta página. Use Testar voz para conferir o áudio; PDF digitalizado precisa de OCR.');
    } else {
      toast('Ainda não encontrei texto nesta página. Tente avançar uma página ou use Testar voz.');
    }
    return;
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
  $('#stop-speech').addEventListener('click', stopSpeech);
  $('#speed-range').addEventListener('input', (event) => {
    $('#speed-output').textContent = Number(event.target.value).toFixed(1).replace('.',',') + '×';
  });
  $('#voice-select').addEventListener('change', (event) => {
    localStorage.setItem('leitor-voice', event.target.value);
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