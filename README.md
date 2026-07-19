# Player Prediction Arena

Plataforma de prediction market gamificado para hackathon, com cartas NFT conceituais, backend Python/FastAPI, frontend TypeScript e banco PostgreSQL.

Cloudflare entra apenas para dominio, DNS, proxy e SSL. A aplicacao roda no seu Ubuntu.

## Arquitetura

```text
Usuario
  -> Cloudflare DNS/proxy/SSL
  -> Nginx no Ubuntu
      -> /             frontend React/Vite em /var/www/player-arena
      -> /api          proxy para FastAPI em 127.0.0.1:3001
          -> PostgreSQL
          -> TXLine obrigatorio para fixtures da Copa
          -> APIs auxiliares gratuitas quando houver mapeamento confiavel
```

Politica de dados: veja `docs/DATA_SOURCES.md`.

## Stack

- Frontend: React + Vite + TypeScript.
- Backend: Python + FastAPI.
- Banco: PostgreSQL.
- Reverse proxy: Nginx.
- Processo: systemd.
- Dominio: Cloudflare DNS/proxy.
- Dados obrigatorios de partidas: TXLine.
- Dados auxiliares gratuitos: API-FOOTBALL/OpenLigaDB/StatsBomb somente quando houver mapeamento confiavel.
- `ALLOW_DEMO_DATA=false` em producao para nao publicar jogos ficticios.
- Usuarios entram por Google Identity Services ou assinatura de carteira Solana.
- Saldo financeiro interno aparece como `$` no produto e como USDC apenas na tela Rewards.
- Arena Points sao separados do saldo USDC e servem para ranking/recompensas.

## Regras implementadas

- Bonus aplica somente sobre lucro liquido, nunca sobre stake.
- Maximo de 1 `Moment Card` por aposta.
- Maximo de 1 `Power Card` por aposta.
- Maximo de 1 `Historic Squad Card` por aposta.
- Carta usada em uma partida fica bloqueada para aquela partida ate a liquidacao.
- Starter Pack e liberado apos 10 apostas.
- Starter Pack contem 3 cartas basicas.

## Estrutura

```text
player-prediction-arena/
  index.html
  package.json
  schema.sql
  src/                         frontend TypeScript
  shared/                      regras compartilhadas do frontend
  server/                      backend FastAPI
    requirements.txt
    .env.example
    app/
      main.py
      routes.py
      db.py
      domain.py
      services/
        txline.py
        openligadb.py
  infra/
    nginx/player-arena.conf
    systemd/player-arena-api.service
    env/player-arena-api.env.example
```

## 1. Entrar no servidor

No seu computador:

```bash
ssh root@SEU_IP
```

Atualize o Ubuntu:

```bash
apt update
apt upgrade -y
```

Instale pacotes basicos:

```bash
apt install -y git curl ca-certificates build-essential unzip nano nginx postgresql postgresql-contrib python3 python3-venv python3-pip
```

Crie um usuario para a aplicacao:

```bash
adduser arena
usermod -aG sudo arena
```

Entre nele:

```bash
su - arena
```

## 2. Instalar Node.js

Ainda como usuario `arena`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
source ~/.bashrc
nvm install --lts
nvm use --lts
node -v
npm -v
```

## 3. Enviar projeto para o servidor

Se for enviar direto do Windows:

```powershell
scp -r "C:\Users\USER\Documents\New project\player-prediction-arena" arena@SEU_IP:/home/arena/
```

No servidor:

```bash
cd /home/arena/player-prediction-arena
ls
```

Se estiver usando Git:

```bash
git clone URL_DO_REPOSITORIO player-prediction-arena
cd player-prediction-arena
```

## 4. Configurar PostgreSQL

Volte temporariamente para `root` ou use `sudo`:

```bash
sudo -u postgres psql
```

Dentro do `psql`:

```sql
CREATE USER arena WITH PASSWORD 'troque-esta-senha';
CREATE DATABASE player_arena OWNER arena;
\q
```

Aplicar schema:

```bash
cd /home/arena/player-prediction-arena
psql "postgresql://arena:troque-esta-senha@127.0.0.1:5432/player_arena" -f schema.sql
```

Se `psql` nao conectar por senha, edite a autenticacao local do Postgres:

```bash
sudo nano /etc/postgresql/*/main/pg_hba.conf
```

Garanta uma linha como:

```text
host    all             all             127.0.0.1/32            scram-sha-256
```

Reinicie:

```bash
sudo systemctl restart postgresql
```

## 5. Configurar backend FastAPI

Entre na pasta do backend:

```bash
cd /home/arena/player-prediction-arena/server
```

Crie ambiente virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Instale dependencias:

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

Crie `.env`:

```bash
cp .env.example .env
nano .env
```

Configure:

```text
APP_ENV=production
API_HOST=127.0.0.1
API_PORT=3001
DATABASE_URL=postgresql://arena:troque-esta-senha@127.0.0.1:5432/player_arena
CORS_ORIGINS=https://arena.seudominio.com
TXLINE_API_BASE=https://txline.txodds.com
TXLINE_API_TOKEN=COLE_SEU_TOKEN_TXLINE
TXLINE_GUEST_JWT=
TXLINE_COMPETITION_ID=
TXLINE_NETWORK=devnet
API_FOOTBALL_BASE=https://v3.football.api-sports.io
API_FOOTBALL_KEY=
API_FOOTBALL_LEAGUE_ID=1
API_FOOTBALL_SEASON=2026
ADMIN_EMAILS=server-only-admin@example.com
GOOGLE_CLIENT_ID=SEU_GOOGLE_OAUTH_CLIENT_ID
OPENLIGADB_BASE=https://api.openligadb.de
ALLOW_DEMO_DATA=false
```

`TXLINE_API_TOKEN` e o token ativado retornado por `/api/token/activate`. `TXLINE_GUEST_JWT` pode ficar vazio; o backend tenta criar uma sessao guest automaticamente em `/auth/guest/start`. O valor real de `ADMIN_EMAILS` deve ficar somente no `.env` privado do servidor; admin so e concedido depois que o Google verifica esse email.

Para o botao de Google aparecer no frontend, crie tambem `.env` na raiz do projeto antes do build:

```text
VITE_GOOGLE_CLIENT_ID=SEU_GOOGLE_OAUTH_CLIENT_ID
```

Arquivos reais de ambiente nunca devem ir para o GitHub. Este repositorio versiona apenas `.env.example`, `server/.env.example` e `infra/env/*.example`; `.env`, `server/.env`, `.dev.vars`, `server/.venv`, `node_modules` e `dist` ficam ignorados por `.gitignore`.

Antes de qualquer push publico, confira:

```bash
git status --short
git diff --check
git ls-files | grep -E '(^|/)(\\.env|\\.dev\\.vars)$'
```

O ultimo comando nao deve retornar nada.

Em producao, se `TXLINE_API_TOKEN` estiver vazio ou invalido, `/api/matches` retorna `503` em vez de mostrar mockups. Para uma demo local controlada, use `ALLOW_DEMO_DATA=true`.

## 6. Criar servico systemd

Copie o servico:

```bash
sudo cp /home/arena/player-prediction-arena/infra/systemd/player-arena-api.service /etc/systemd/system/player-arena-api.service
```

Recarregue systemd:

```bash
sudo systemctl daemon-reload
```

Ative e inicie:

```bash
sudo systemctl enable --now player-arena-api
```

Ver status:

```bash
sudo systemctl status player-arena-api
```

Ver logs:

```bash
journalctl -u player-arena-api -f
```

## 7. Build do frontend

Volte para a raiz do projeto:

```bash
cd /home/arena/player-prediction-arena
```

Instale dependencias:

```bash
npm install
```

Gere build:

```bash
npm run build
```

Publique em `/var/www`:

```bash
sudo mkdir -p /var/www/player-arena
sudo rsync -av --delete dist/ /var/www/player-arena/
sudo chown -R www-data:www-data /var/www/player-arena
```

## 8. Configurar Nginx

Copie a config:

```bash
sudo cp /home/arena/player-prediction-arena/infra/nginx/player-arena.conf /etc/nginx/sites-available/player-arena.conf
```

Edite o dominio:

```bash
sudo nano /etc/nginx/sites-available/player-arena.conf
```

Troque:

```text
server_name arena.seudominio.com;
```

pelo seu dominio real.

Ative:

```bash
sudo ln -s /etc/nginx/sites-available/player-arena.conf /etc/nginx/sites-enabled/player-arena.conf
```

Se existir default e quiser remover:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

Teste:

```bash
sudo nginx -t
```

Recarregue:

```bash
sudo systemctl reload nginx
```

## 9. Firewall do Ubuntu

Se usar UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

Nao exponha a porta `3001`. Ela fica apenas em `127.0.0.1`.

## 10. Cloudflare: dominio, proxy e SSL

No painel Cloudflare:

1. Entre em `Websites`.
2. Adicione seu dominio se ainda nao estiver na Cloudflare.
3. Troque os nameservers no registrador do dominio.
4. Aguarde ativacao.

Crie DNS:

```text
Type: A
Name: arena
IPv4 address: IP_DO_SERVIDOR
Proxy status: Proxied
TTL: Auto
```

Em `SSL/TLS`:

```text
Encryption mode: Full
```

Se instalar certificado de origem Cloudflare ou Let's Encrypt no servidor, use:

```text
Full (strict)
```

Para hackathon, `Full` ja costuma ser suficiente se Nginx estiver com HTTPS. Se quiser comecar rapido apenas HTTP no servidor, Cloudflare pode aceitar dependendo da configuracao, mas o melhor e instalar certificado.

## 11. HTTPS no servidor

Opcao simples com Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d arena.seudominio.com
```

Depois:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Na Cloudflare, mude para:

```text
SSL/TLS -> Full (strict)
```

## 12. Deploy depois de mudancas

Frontend:

```bash
cd /home/arena/player-prediction-arena
npm install
npm run build
sudo rsync -av --delete dist/ /var/www/player-arena/
sudo chown -R www-data:www-data /var/www/player-arena
```

Backend:

```bash
cd /home/arena/player-prediction-arena/server
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart player-arena-api
journalctl -u player-arena-api -f
```

Banco:

```bash
cd /home/arena/player-prediction-arena
psql "$DATABASE_URL" -f schema.sql
```

Se `DATABASE_URL` nao estiver no shell:

```bash
psql "postgresql://arena:troque-esta-senha@127.0.0.1:5432/player_arena" -f schema.sql
```

## 13. Endpoints

Health:

```text
GET /api/health
```

Catalogo:

```text
GET /api/catalog
```

Partidas:

```text
GET /api/matches
```

Liquidar uma posicao:

```text
POST /api/settle
```

Ver sessao autenticada:

```text
GET /api/me
```

Login com Google:

```text
POST /api/auth/google
```

Login com Solana:

```text
POST /api/auth/solana/challenge
POST /api/auth/solana/verify
```

Logout:

```text
POST /api/auth/logout
```

Estado persistente de usuario autenticado:

```text
GET /api/users/{user_id}/state
```

Criar posicao persistente:

```text
POST /api/users/{user_id}/positions
```

Abrir Starter Pack persistente:

```text
POST /api/users/{user_id}/open-pack
```

Liquidar todas as posicoes abertas de um usuario em uma partida:

```text
POST /api/users/{user_id}/settle-match/{match_id}
```

Creditar usuario com creditos internos da plataforma:

```text
POST /api/admin/credits
```

O endpoint exige sessao autenticada de admin. O admin e definido por email em `ADMIN_EMAILS`, somente no `.env` do servidor. O valor e informado em centavos (`amountCents`). Exemplo: `25000` representa `$250.00`; em Rewards esse saldo e apresentado como USDC interno.

Creditar Arena Points por evento:

```text
POST /api/admin/points
```

## 14. Onde alterar regras

Frontend:

```text
shared/cards.ts
shared/settlement.ts
src/App.tsx
```

Backend:

```text
server/app/domain.py
server/app/routes.py
```

Adaptador TXLine:

```text
server/app/services/txline.py
```

Adaptador auxiliar OpenLigaDB, apenas quando `ALLOW_DEMO_DATA=true`:

```text
server/app/services/openligadb.py
```

## 15. Observacao importante sobre TXLine

O adaptador usa:

```text
/api/fixtures/snapshot
```

As chamadas reais enviam dois headers:

```text
Authorization: Bearer <guest_jwt>
X-Api-Token: <activated_api_token>
```

Se a TXLine retornar nomes de campos diferentes no payload real, ajuste:

```text
server/app/services/txline.py
```

Principalmente id da fixture, nomes dos times, placar, status, eventos com jogador, logos e tags especiais como bicicleta/olimpico, se existirem.

## 16. Ordem recomendada para primeiro deploy

1. Subir projeto no servidor.
2. Instalar PostgreSQL.
3. Criar banco e aplicar `schema.sql`.
4. Criar `.env` do backend.
5. Instalar Python deps.
6. Ativar `systemd`.
7. Buildar frontend.
8. Configurar Nginx.
9. Apontar Cloudflare.
10. Abrir `https://arena.seudominio.com`.
11. Conectar token real da TXLine antes de divulgar o dominio.
