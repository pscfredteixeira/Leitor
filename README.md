# Leitor — PDF, EPUB e narração neural

Leitor é uma biblioteca pessoal para ler e acompanhar PDFs e EPUBs no computador e no celular.

Site: https://pscfredteixeira.github.io/Leitor/

## Recursos disponíveis

- Importação de PDFs e EPUBs, biblioteca, busca, capas (quando disponíveis) e progresso individual.
- Retomada automática da página do PDF e posição EPUB por CFI, no mesmo dispositivo.
- Tema claro/escuro e navegação responsiva.
- Voz do aparelho (Web Speech API), para casos em que a voz neural não esteja disponível.
- **Integração com o motor Kokoro PT-BR:** escolha Dora, Alex ou Santa e reproduza áudio neural por trechos (arquivos WAV).
- Configuração do endereço HTTPS de um backend Kokoro, teste de conexão e player de áudio compatível com iPhone.
- Chave de acesso opcional; guardada apenas na sessão do navegador.

## Kokoro: o que é preciso para funcionar

**O motor Kokoro não roda no GitHub Pages**. O site e o código da integração foram publicados, mas as vozes neurais só poderão ser ouvidas quando o backend Python estiver executando e seu endereço HTTPS for configurado no app.

O projeto do servidor está na pasta [backend](./backend), junto com um [guia de instalação e conexão no iPhone](./backend/README.md). É possível testá-lo no Windows com Docker e disponibilizá-lo por um túnel HTTPS, sem contratar hospedagem (mas o PC terá de ficar ligado). Para um endereço fixo, será necessária uma hospedagem adequada para executar o modelo, possivelmente paga.

No leitor, abra um PDF/EPUB, selecione Kokoro · neural, escolha a voz, expanda Configurar servidor Kokoro, insira o endereço HTTPS e a chave (se houver), toque em Conectar e finalmente em Testar voz.

**Por que não usamos apenas kokoro-js?** A versão 1.2.1 do pacote tem arquivos de voz em português brasileiro, mas seu gerador e fonemizador ainda não tratam corretamente o idioma. O backend usa o pipeline oficial Python com o idioma p (pt-BR).

## Privacidade e limitações

- Os arquivos completos e o progresso ficam em IndexedDB no aparelho, não no GitHub. Limpar os dados do site pode apagá-los. Preserve os arquivos originais.
- Quando o Kokoro remoto está ativado, somente o texto de cada trecho narrado (até 400 caracteres por requisição) é enviado ao **servidor configurado**; para documentos sensíveis, use um servidor sob seu controle.
- Os diferentes dispositivos não sincronizam automaticamente a biblioteca.
- O Safari pode bloquear a reprodução automática após a geração; nesse caso o player nativo aparece com o botão de reprodução.
- A geração por trechos pode criar pequenas pausas entre frases. A sincronização exata por palavra ainda não existe.
- PDFs digitalizados sem texto selecionável precisam de OCR, ainda não implementado.
- Modelos e scripts podem exigir internet, especialmente na primeira inicialização do backend.
- A interface e a API foram implementadas, mas ainda não houve verificação de áudio Kokoro real no iPhone nem implantação de um backend público conectado.

## Execução do site

O frontend é estático: HTML, CSS, JavaScript, IndexedDB, PDF.js, epub.js e Web Speech API. É publicado no GitHub Pages pelo branch main, pasta raiz.

Para testar localmente, execute na raiz do repositório: python -m http.server 8080. Acesse http://localhost:8080.

## Próximas melhorias

- Hospedagem estável do motor neural e medição da qualidade/latência no iPhone.
- Pré-geração de trechos para reduzir pausas entre frases.
- Destaque sincronizado por palavra nos livros e arquivos PDF.
- OCR, anotações, favoritos e sumário.
- Sincronização opcional da biblioteca entre dispositivos.

Créditos: [Kokoro (Apache 2.0)](https://github.com/hexgrad/kokoro) e bibliotecas de código aberto citadas nos arquivos do projeto.
