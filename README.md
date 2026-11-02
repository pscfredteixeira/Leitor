# Leitor — PDF, EPUB e vozes neurais em português

O Leitor é uma biblioteca pessoal web, gratuita, para ler PDF e EPUB no computador e no iPhone.

Site: https://pscfredteixeira.github.io/Leitor/

## Funcionalidades

- Importação de PDF/EPUB, biblioteca com busca e capas.
- Progresso independente de cada livro, armazenado no IndexedDB.
- Retomada da página do PDF e do ponto EPUB.
- Temas claro/escuro e interface adaptada ao celular.
- Narração com três motores, cada um com funcionamento diferente.

### 1. Neural local — Português (opção padrão)

Narração brasileira com o modelo Piper pt_BR-faber-medium pela biblioteca aberta [vozz](https://github.com/Pedro21062014/vozz), versão 0.2.7. A voz é neural, mas NÃO é o Kokoro. Ela foi incluída para oferecer leitura sem configuração de servidor.

1. Selecione Motor → Neural local · português.
2. Toque em Testar voz ou Ouvir.
3. No primeiro uso, o navegador baixa aproximadamente 30 MB de modelo e recursos para sintetizar localmente, sem enviar o texto a uma API.
4. O controle nativo de áudio aparece depois de gerar a fala, pois o iPhone pode impedir o autoplay após síntese assíncrona.
5. A geração usa WebAssembly e pode ser lenta ou não funcionar em aparelhos/navegadores com pouca memória.

A integração foi escrita e verificada sintaticamente, mas ainda NÃO foi comprovada com áudio real no Safari do usuário. Se surgir erro, a mensagem de diagnóstico da tela indicará o problema.

### 2. Kokoro — neural com servidor (opcional)

Vozes brasileiras Dora, Alex e Santa, geradas pelo Kokoro Python. PRECISA de um servidor HTTPS em execução. O GitHub Pages não executa Python, PyTorch ou Kokoro.

O código do backend está em [backend](./backend/README.md), com instruções para rodar em Windows/Docker e expor com um túnel HTTPS. Essa opção não funciona apenas com o GitHub Pages, até que um servidor seja conectado.

### 3. Voz do aparelho

Web Speech API. Funciona dependendo do navegador, mas as vozes podem soar robóticas.

## Alternativa imediata para iPhone: Kokoro sem servidor

O aplicativo [Sandbook](https://apps.apple.com/br/app/id6745732885) oferece Kokoro executado no próprio iPhone, em português brasileiro, leitura de PDF/EPUB com acompanhamento de palavras e retomada da posição, gratuitamente. É um aplicativo separado e não compartilha a biblioteca com o nosso Leitor.

## Privacidade

- PDF e EPUB ficam no dispositivo, no armazenamento do site.
- A opção Neural local não envia texto para síntese remota, mas baixa bibliotecas e modelo de voz por CDN na primeira execução.
- A opção Kokoro com servidor envia apenas os trechos narrados para o endereço configurado; use um servidor confiável em documentos particulares.
- Limpar dados do navegador pode apagar a biblioteca; mantenha os originais.
- Não existe sincronização automática entre computador e iPhone.

## Limitações e próximos sprints

- Alguns arquivos EPUB com DRM não funcionam.
- PDFs digitalizados sem texto selecionável exigem OCR, ainda não incluído.
- Reprodução contínua sem pausas entre frases e destaque palavra a palavra são recursos futuros.
- Futuro: testar e ajustar a síntese local no Safari, otimizar a latência e avaliar sincronização entre dispositivos.

## Publicação

O site é estático (HTML, CSS, JavaScript, PDF.js, epub.js e IndexedDB). GitHub Pages, branch main, pasta raiz. Para teste local, use um servidor como Live Server ou o comando python -m http.server 8080 na raiz.
