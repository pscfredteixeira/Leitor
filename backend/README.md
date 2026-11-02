# Motor Kokoro PT-BR para o Leitor

Este backend expõe uma API de voz neural Kokoro 82M. O Leitor fica no GitHub Pages; o motor em português depende deste servidor Python, porque o pacote kokoro-js 1.2.1 ainda não oferece a fonemização pt-BR correta.

## O que foi implementado

- POST /api/tts: gera áudio WAV mono 24 kHz.
- Vozes pf_dora (feminina), pm_alex e pm_santa (masculinas).
- Velocidade de 0,7 a 1,5 e limite de 400 caracteres por requisição.
- GET /health: verifica se o servidor está acessível (não carrega o modelo).
- LEITOR_API_KEY: chave opcional; se definida, deve ser enviada no cabeçalho X-Leitor-Key.
- CORS_ORIGINS: origens permitidas separadas por vírgula. Por padrão, aceita o GitHub Pages do Leitor e páginas localhost.

Somente os trechos narrados são transmitidos ao servidor: os arquivos PDF/EPUB completos permanecem no dispositivo.

## Testar no Windows com Docker

1. Instale e inicie o Docker Desktop.
2. Na pasta raiz do repositório execute:

    docker build -t leitor-kokoro ./backend

    docker run --rm -p 7860:7860 -e LEITOR_API_KEY=escolha-uma-chave-forte leitor-kokoro

3. Abra no navegador: http://localhost:7860/health
4. Em outro terminal, inicie um servidor HTTP na raiz do Leitor (por exemplo: python -m http.server 8080).
5. Entre em http://localhost:8080, abra um livro e configure Kokoro com URL http://localhost:7860, a chave escolhida e o botão Conectar. Depois toque em Testar voz.

O primeiro áudio precisa baixar e inicializar um modelo pesado. É normal demorar e consumir memória; não espere saída instantânea no primeiro uso.

## Acessar pelo iPhone

O GitHub Pages usa HTTPS, e não pode usar um endereço HTTP do PC para a narração no iPhone. É necessário expor o servidor com HTTPS.

Uma solução para testar sem contratar hospedagem é Cloudflare Tunnel no Windows. Com o contêiner funcionando, instale cloudflared e execute:

    cloudflared tunnel --url http://localhost:7860

O terminal mostrará um endereço HTTPS, geralmente temporário e terminado em trycloudflare.com. No iPhone, dentro do Leitor, escolha Kokoro, configure essa URL e informe a mesma chave. O computador deve permanecer ligado e o túnel conectado. O endereço pode mudar quando reiniciar.

Para uso permanente, publique o contêiner em hospedagem capaz de executar Docker/Python, com HTTPS e memória suficiente para PyTorch. O GitHub Pages não hospeda o motor de voz. Alguns provedores cobram pelo serviço.

## Testar o endpoint diretamente

Exemplo de requisição JSON:

    POST /api/tts
    Content-Type: application/json
    X-Leitor-Key: escolha-uma-chave-forte

    {"text":"Olá! Vamos ler um bom livro?","voice":"pf_dora","speed":1}

Resposta: um arquivo WAV que pode ser reproduzido.

## Cuidados

- Não confunda LEITOR_API_KEY com outro nome: este é o nome da variável usado pelo backend.
- Sem LEITOR_API_KEY, qualquer cliente com acesso à API pode gerar áudio, mesmo se CORS bloquear determinadas páginas.
- Hospedar a API publicamente permite que o provedor de hospedagem processe o texto enviado. Não use servidores desconhecidos para textos confidenciais.
- O Safari pode exigir um toque no player nativo após cada geração; o app revela o controle quando a reprodução automática é bloqueada.
- Esta integração não significa que já exista um servidor publicado: é preciso executar e conectar o backend.
- O destaque sincronizado por palavra e a pré-geração de áudio para eliminar pausas ainda não estão implementados.

## Créditos

Motor de síntese: hexgrad/Kokoro-82M (Apache 2.0), linguagem pt-BR com KPipeline e espeak-ng. Interface de API: FastAPI.
