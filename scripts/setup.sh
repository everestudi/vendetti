#!/usr/bin/env bash
#
# Setup interativo do Vendetti.
# Você cola valores no SEU terminal local — nada trafega por chat de IA.
#

set -e

cd "$(dirname "$0")/.."

cat <<'BANNER'

  ╔══════════════════════════════════════════════════════╗
  ║   Vendetti — setup local                             ║
  ╚══════════════════════════════════════════════════════╝

BANNER

# ----------------------------------------------------------
# 1. .env.local
# ----------------------------------------------------------
if [ -f .env.local ]; then
  echo "ℹ️  .env.local já existe — vou pular a criação."
  echo "   (Se quiser recriar, apague .env.local antes de rodar de novo.)"
else
  echo "▶ Vou pedir 2 valores. Eles ficam só no SEU arquivo .env.local."
  echo

  # DATABASE_URL
  echo "📋 Cole o Connection string do Neon (vem completo, com senha):"
  echo "   Ex: postgresql://neondb_owner:xxx@ep-xxx.sa-east-1.aws.neon.tech/neondb?sslmode=require"
  printf "   > "
  IFS= read -r DATABASE_URL
  if [[ ! "$DATABASE_URL" =~ ^postgresql:// ]]; then
    echo "❌ Não parece um Connection string válido. Aborta."
    exit 1
  fi

  # BOOTSTRAP_PASSWORD
  echo
  echo "🔐 Escolha uma senha pra entrar no /login (anote, vai usar toda vez):"
  printf "   senha: "
  IFS= read -rs BOOTSTRAP_PASSWORD
  echo
  printf "   confirma: "
  IFS= read -rs BOOTSTRAP_PASSWORD_CONFIRM
  echo
  if [ -z "$BOOTSTRAP_PASSWORD" ] || [ "$BOOTSTRAP_PASSWORD" != "$BOOTSTRAP_PASSWORD_CONFIRM" ]; then
    echo "❌ Senha vazia ou diferente. Aborta."
    exit 1
  fi

  # AUTH_SECRET automático
  AUTH_SECRET=$(openssl rand -base64 32)

  # Grava .env.local sem expansão de shell (printf é seguro)
  {
    printf 'DATABASE_URL=%s\n' "$DATABASE_URL"
    printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET"
    printf 'BOOTSTRAP_PASSWORD=%s\n' "$BOOTSTRAP_PASSWORD"
    printf 'NEXTAUTH_URL=http://localhost:3000\n'
  } > .env.local
  chmod 600 .env.local

  echo "✓ .env.local criado (modo 600 — só você lê)"
fi

# ----------------------------------------------------------
# 2. Dependências npm
# ----------------------------------------------------------
echo
echo "▶ Instalando dependências (pode demorar 1-2 min na primeira vez)..."
npm install

# ----------------------------------------------------------
# 3. Playwright Chromium
# ----------------------------------------------------------
echo
echo "▶ Baixando Chromium pro scraper Vendtef..."
npx playwright install chromium

# ----------------------------------------------------------
# 4. Prisma — gera client e cria tabelas no Neon
# ----------------------------------------------------------
echo
echo "▶ Gerando Prisma client..."
npx dotenv -e .env.local -- npx prisma generate

echo
echo "▶ Criando tabelas no Postgres do Neon..."
npx dotenv -e .env.local -- npx prisma db push

# ----------------------------------------------------------
# 5. Pronto
# ----------------------------------------------------------
cat <<'DONE'

  ╔══════════════════════════════════════════════════════╗
  ║   ✅ Pronto!                                          ║
  ╚══════════════════════════════════════════════════════╝

  Agora roda:   npm run dev
  Abre:         http://localhost:3000

  1) login com a senha que você escolheu agora
  2) navega para /settings
  3) cola a Anthropic API key (e as outras conforme tiver)

DONE
