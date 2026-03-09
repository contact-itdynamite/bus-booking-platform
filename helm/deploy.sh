#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BusConnect – Helm Deploy Script
# Usage: ./helm/deploy.sh [install|upgrade|uninstall] [GMAIL_APP_PASSWORD]
#
# Gmail App Password setup:
#   1. Enable 2FA on contact.busconnect@gmail.com
#   2. Go to https://myaccount.google.com/apppasswords
#   3. Create an App Password for "Mail"
#   4. Pass it as the second argument: ./helm/deploy.sh install "xxxx xxxx xxxx xxxx"
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CHART_DIR="$(cd "$(dirname "$0")/busconnect" && pwd)"
NAMESPACE="busconnect"
RELEASE="busconnect"
ACTION="${1:-install}"
SMTP_PASS="${2:-REPLACE_WITH_GMAIL_APP_PASSWORD}"

echo "🚌  BusConnect Helm Deploy"
echo "   Action    : $ACTION"
echo "   Namespace : $NAMESPACE"
echo "   Chart     : $CHART_DIR"
echo ""

# ── Pre-flight checks ──────────────────────────────────────────────────────────
command -v helm  >/dev/null 2>&1 || { echo "❌  helm not found. Install: https://helm.sh/docs/intro/install/"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "❌  kubectl not found."; exit 1; }

# ── Create namespace if missing ────────────────────────────────────────────────
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE"

# ── Load schema into ConfigMap ─────────────────────────────────────────────────
SCHEMA_FILE="$(dirname "$0")/../database/schema.sql"
if [[ -f "$SCHEMA_FILE" ]]; then
  echo "📦  Loading schema into ConfigMap..."
  kubectl create configmap busconnect-schema \
    --from-file=schema.sql="$SCHEMA_FILE" \
    -n "$NAMESPACE" \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "✅  Schema ConfigMap ready"
fi

# ── Helm install / upgrade ─────────────────────────────────────────────────────
HELM_ARGS=(
  "$RELEASE" "$CHART_DIR"
  --namespace "$NAMESPACE"
  --create-namespace
  --set "secrets.smtpUser=contact.busconnect@gmail.com"
  --set "secrets.smtpPass=${SMTP_PASS}"
  --set "secrets.jwtSecret=$(openssl rand -hex 32 2>/dev/null || echo 'fallback_jwt_secret_change_me')"
  --set "secrets.dbPassword=buspassword123"
  --set "global.imagePullPolicy=IfNotPresent"
  --timeout 10m
  --wait
)

if [[ "$ACTION" == "install" ]]; then
  echo "🚀  Installing chart..."
  helm install "${HELM_ARGS[@]}"

elif [[ "$ACTION" == "upgrade" ]]; then
  echo "🔄  Upgrading chart..."
  helm upgrade --install "${HELM_ARGS[@]}"

elif [[ "$ACTION" == "uninstall" ]]; then
  echo "🗑️   Uninstalling chart..."
  helm uninstall "$RELEASE" --namespace "$NAMESPACE"
  echo "✅  Uninstalled"
  exit 0

elif [[ "$ACTION" == "dry-run" ]]; then
  echo "📋  Dry-run (template only)..."
  helm template "${HELM_ARGS[@]}" --debug
  exit 0

else
  echo "❌  Unknown action: $ACTION  (use: install | upgrade | uninstall | dry-run)"
  exit 1
fi

echo ""
echo "✅  Deployment complete!"
echo ""
echo "📊  Pod status:"
kubectl get pods -n "$NAMESPACE"
echo ""
echo "🌐  Services:"
kubectl get svc -n "$NAMESPACE"
echo ""
echo "🔗  Ingress:"
kubectl get ingress -n "$NAMESPACE" 2>/dev/null || echo "No ingress found"
echo ""
echo "💡  To port-forward the API gateway locally:"
echo "    kubectl port-forward svc/api-gateway 8080:8080 -n $NAMESPACE"
echo ""
echo "💡  To view logs:"
echo "    kubectl logs -l app.kubernetes.io/name=api-gateway -n $NAMESPACE -f"
