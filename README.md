# Leitor

Leitor é uma biblioteca pessoal gratuita para **PDF e EPUB**, com retomada automática da leitura e narração no navegador. O projeto funciona como um site estático, sem cadastro nem servidor.

## Primeira versão — Sprint 1

- Importação de PDFs e EPUBs, biblioteca com busca, filtros e capas quando disponíveis.
- Leitura de PDF com navegação por página e texto extraído para acompanhar a narração.
- Leitura de EPUB com navegação e retomada pela localização EPUB CFI.
- Arquivos e progresso de cada livro armazenados no **IndexedDB** do dispositivo.
- Botão **Continue lendo** para retomar o último livro.
- Narração com vozes do navegador, seleção de voz, pausa, parada e velocidade.
- Interface responsiva com tema claro e escuro.

## Publicar no GitHub Pages

1. Abra **Settings → Pages** no repositório.
2. Escolha **Deploy from a branch**.
3. Selecione **main** e **/(root)** e clique em **Save**.
4. Aguarde o GitHub concluir a implantação e abra o link que aparecer na tela de Pages.

Este aplicativo não exige npm nem etapas de compilação. Para testar localmente, rode um servidor HTTP na pasta do projeto, como Live Server ou o comando python -m http.server 8080, e abra http://localhost:8080.

## Limitações importantes

**Qualidade de voz:** nesta primeira versão a voz vem do Web Speech API, portanto depende das vozes disponíveis no Windows, iPhone e navegador. Voz neural local de alta qualidade, especialmente em português brasileiro, **ainda não foi implementada**; está no planejamento do Sprint 2.

**Sincronização:** no PDF com camada de texto o leitor destaca a **frase** no painel de texto abaixo da página; o EPUB mostra a frase narrada no controle de áudio. O destaque exato da palavra no próprio documento está planejado para o Sprint 3.

**Armazenamento:** os livros e o ponto de leitura ficam no navegador onde foram adicionados, não na conta do GitHub. Não há sincronização entre computador e iPhone. Limpar os dados do navegador ou remover o site pode apagar sua biblioteca; preserve os arquivos originais.

**PDF digitalizado e DRM:** PDFs só com imagem exigem OCR, que não está implementado. Arquivos com proteção DRM podem não funcionar.

**Rede e privacidade:** as dependências PDF.js e epub.js são carregadas por CDN e exigem conexão na primeira abertura. Os livros não são enviados ao servidor deste projeto; algumas vozes disponibilizadas pelo sistema podem usar serviços de nuvem do fabricante.

## Próximos passos

- Sprint 2: avaliar e integrar motor neural de voz natural em português, com testes de desempenho em Windows/iPhone.
- Sprint 3: destacar palavras sincronizadas ao áudio no PDF e no EPUB.
- Sprint 4: anotações, favoritos, seleção de trechos, sumário e tipografia ajustável.
- Sprint 5: aplicativo instalável (PWA) e sincronização opcional entre dispositivos.

## Tecnologias

HTML, CSS, JavaScript, IndexedDB, [PDF.js](https://mozilla.github.io/pdf.js/), [epub.js](https://github.com/futurepress/epub.js/) e Web Speech API.
