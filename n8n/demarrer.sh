#!/usr/bin/env bash
#
# Démarre la chaîne de publication automatique des photos.
#
# Ouvre le tunnel, récupère son adresse publique, lance n8n avec les bons
# réglages, et place l'URL du webhook dans le presse-papiers.
#
# Usage :  ./demarrer.sh
# Arrêt  :  Ctrl+C dans ce terminal
#
set -uo pipefail

PORT=5678
LOG=/tmp/cloudflared-portfolio.log

# --- n8n est installé sous nvm : il n'est pas toujours dans le PATH ----------
if ! command -v n8n >/dev/null 2>&1; then
  for bin in "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$bin/n8n" ] && export PATH="$bin:$PATH" && break
  done
fi
for outil in n8n cloudflared; do
  command -v "$outil" >/dev/null 2>&1 || { echo "✗ $outil introuvable." >&2; exit 1; }
done

# --- le secret ne doit jamais figurer dans ce fichier ------------------------
if [ -z "${CLOUDINARY_API_SECRET:-}" ]; then
  cat >&2 <<'AIDE'
✗ CLOUDINARY_API_SECRET n'est pas défini.

  À faire une seule fois (récupérez la valeur dans Cloudinary,
  Settings → Access Keys) :

    echo 'export CLOUDINARY_API_SECRET=votre_secret' >> ~/.zshrc
    source ~/.zshrc

AIDE
  exit 1
fi

# --- repartir propre : restes d'une session précédente -----------------------
pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null
pkill -f "$(command -v n8n) start" 2>/dev/null
sleep 1

# --- ouverture du tunnel -----------------------------------------------------
echo "→ Ouverture du tunnel…"
rm -f "$LOG"
cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

URL=""
for _ in $(seq 1 60); do
  URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "✗ Adresse du tunnel introuvable. Voir $LOG" >&2
  exit 1
fi

WEBHOOK="$URL/webhook/cloudinary-photo"
printf '%s' "$WEBHOOK" | pbcopy

cat <<INFO

┌─────────────────────────────────────────────────────────────────┐
  URL DU WEBHOOK (déjà copiée dans le presse-papiers) :

  $WEBHOOK

  Cette adresse change à chaque démarrage. Collez-la dans Cloudinary :
  Settings → Webhook Notifications → votre notification → URL
└─────────────────────────────────────────────────────────────────┘

→ Démarrage de n8n… (Ctrl+C pour tout arrêter)

INFO

# --- n8n au premier plan : Ctrl+C arrête l'ensemble --------------------------
WEBHOOK_URL="$URL" \
CLOUDINARY_API_SECRET="$CLOUDINARY_API_SECRET" \
N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
n8n start
