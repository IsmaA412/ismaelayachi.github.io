#!/usr/bin/env bash
#
# Démarre la chaîne de publication automatique des photos.
#
# Deux modes, choisis automatiquement :
#
#   ngrok        URL FIXE. À coller dans Cloudinary une seule fois, jamais
#                plus. C'est le mode recommandé — voir « Mise en place » plus
#                bas. Activé dès que NGROK_DOMAIN est défini.
#
#   cloudflared  Repli. L'adresse change à CHAQUE démarrage et doit être
#                reportée dans Cloudinary, sinon les uploads sont perdus
#                silencieusement.
#
# Usage :  ./demarrer.sh
# Arrêt  :  Ctrl+C
#
# ---------------------------------------------------------------------------
# Mise en place du mode permanent (une seule fois, 5 minutes) :
#
#   1. Créez un compte gratuit sur https://dashboard.ngrok.com/signup
#   2. brew install ngrok
#   3. Copiez votre authtoken depuis le tableau de bord, puis :
#        ngrok config add-authtoken VOTRE_TOKEN
#   4. Relevez votre domaine statique offert (Domains dans le tableau de
#      bord), de la forme  quelque-chose.ngrok-free.app  puis :
#        echo 'export NGROK_DOMAIN=quelque-chose.ngrok-free.app' >> ~/.zshrc
#        source ~/.zshrc
#   5. Relancez ce script et collez l'URL affichée dans Cloudinary. C'est la
#      dernière fois que vous aurez à le faire.
# ---------------------------------------------------------------------------
set -uo pipefail

PORT=5678
LOG=/tmp/tunnel-portfolio.log

# --- n8n est installé sous nvm : il n'est pas toujours dans le PATH ----------
if ! command -v n8n >/dev/null 2>&1; then
  for bin in "$HOME"/.nvm/versions/node/*/bin; do
    [ -x "$bin/n8n" ] && export PATH="$bin:$PATH" && break
  done
fi
command -v n8n >/dev/null 2>&1 || { echo "✗ n8n introuvable." >&2; exit 1; }

# --- le secret ne doit jamais figurer dans ce fichier ------------------------
if [ -z "${CLOUDINARY_API_SECRET:-}" ]; then
  cat >&2 <<'AIDE'
✗ CLOUDINARY_API_SECRET n'est pas défini.

  À faire une seule fois (valeur dans Cloudinary, Settings → Access Keys) :

    echo 'export CLOUDINARY_API_SECRET=votre_secret' >> ~/.zshrc
    source ~/.zshrc

AIDE
  exit 1
fi

# --- choix du mode -----------------------------------------------------------
MODE=""
if [ -n "${NGROK_DOMAIN:-}" ]; then
  if command -v ngrok >/dev/null 2>&1; then
    MODE="ngrok"
  else
    echo "⚠ NGROK_DOMAIN est défini mais ngrok n'est pas installé (brew install ngrok)." >&2
    echo "  Repli sur cloudflared : l'adresse changera à chaque démarrage." >&2
    echo >&2
  fi
fi
if [ -z "$MODE" ]; then
  command -v cloudflared >/dev/null 2>&1 || {
    echo "✗ Ni ngrok ni cloudflared ne sont installés." >&2; exit 1; }
  MODE="cloudflared"
fi

# --- repartir propre : restes d'une session précédente -----------------------
pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null
pkill -f "ngrok http $PORT" 2>/dev/null
pkill -f "$(command -v n8n) start" 2>/dev/null
sleep 1
rm -f "$LOG"

# --- ouverture du tunnel -----------------------------------------------------
if [ "$MODE" = "ngrok" ]; then
  echo "→ Ouverture du tunnel ngrok sur $NGROK_DOMAIN…"
  ngrok http "$PORT" --url "https://$NGROK_DOMAIN" --log stdout >"$LOG" 2>&1 &
  URL="https://$NGROK_DOMAIN"
else
  echo "→ Ouverture d'un tunnel cloudflared temporaire…"
  cloudflared tunnel --url "http://localhost:$PORT" >"$LOG" 2>&1 &
  URL=""
fi
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

# --- attendre que le tunnel soit joignable -----------------------------------
for _ in $(seq 1 60); do
  if [ "$MODE" = "cloudflared" ] && [ -z "$URL" ]; then
    URL=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1)
  fi
  if [ -n "$URL" ] && curl -s -o /dev/null -m 5 "$URL" 2>/dev/null; then
    PRET=1; break
  fi
  # ngrok échoue vite et bruyamment : inutile d'attendre 60 s
  if grep -qiE 'ERR_NGROK|authentication failed|not authorized' "$LOG" 2>/dev/null; then
    echo "✗ ngrok a refusé de démarrer :" >&2
    grep -iE 'ERR_NGROK|msg=|err=' "$LOG" | tail -5 >&2
    echo >&2
    echo "  Authtoken manquant ? →  ngrok config add-authtoken VOTRE_TOKEN" >&2
    exit 1
  fi
  sleep 1
done

if [ -z "${PRET:-}" ]; then
  echo "✗ Le tunnel n'a pas répondu. Journal : $LOG" >&2
  tail -5 "$LOG" >&2
  exit 1
fi

WEBHOOK="$URL/webhook/cloudinary-photo"
printf '%s' "$WEBHOOK" | pbcopy

echo
echo "┌───────────────────────────────────────────────────────────────────┐"
echo "  URL DU WEBHOOK (copiée dans le presse-papiers) :"
echo
echo "  $WEBHOOK"
echo
if [ "$MODE" = "ngrok" ]; then
  echo "  ✓ ADRESSE FIXE : elle ne changera plus. Si elle est déjà"
  echo "    enregistrée dans Cloudinary, vous n'avez RIEN à faire."
else
  echo "  ⚠ ADRESSE TEMPORAIRE : elle a changé depuis le dernier"
  echo "    démarrage. Collez-la dans Cloudinary, sinon vos uploads"
  echo "    seront perdus sans aucun message d'erreur."
fi
echo
echo "  Cloudinary → Settings → Webhook Notifications"
echo "  Deux événements à cocher :  Upload  et  Delete"
echo "└───────────────────────────────────────────────────────────────────┘"
echo
if [ "$MODE" = "cloudflared" ]; then
  echo "  Pour ne plus jamais avoir à recoller cette URL, voyez la marche à"
  echo "  suivre en tête de ce script (mode ngrok, gratuit, 5 minutes)."
  echo
fi
echo "→ Démarrage de n8n… (Ctrl+C pour tout arrêter)"
echo

# --- n8n au premier plan : Ctrl+C arrête l'ensemble --------------------------
WEBHOOK_URL="$URL" \
CLOUDINARY_API_SECRET="$CLOUDINARY_API_SECRET" \
N8N_BLOCK_ENV_ACCESS_IN_NODE=false \
n8n start
