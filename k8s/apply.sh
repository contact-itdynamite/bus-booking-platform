#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BusConnect – kubectl apply script
# Usage: ./k8s/apply.sh [GMAIL_APP_PASSWORD]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NAMESPACE="busconnect"
K8S_DIR="$(cd "$(dirname "$0")/base" && pwd)"
SMTP_PASS="${1:-REPLACE_WITH_GMAIL_APP_PASSWORD}"
SCHEMA_FILE="$(dirname "$0")/../database/schema.sql"

echo "🚌  BusConnect – Kubernetes Deploy"
echo "   Namespace : $NAMESPACE"
echo "   K8S Dir   : $K8S_DIR"

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v kubectl >/dev/null || { echo "❌ kubectl not found"; exit 1; }

# ── Namespace first ───────────────────────────────────────────────────────────
kubectl apply -f "$K8S_DIR/00-namespace.yaml"

# ── Patch secret with real SMTP password ─────────────────────────────────────
echo "🔑  Creating secret with SMTP credentials..."
kubectl create secret generic busconnect-secret \
  --namespace="$NAMESPACE" \
  --from-literal=DB_PASSWORD="buspassword123" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || echo 'fallback_secret')" \
  --from-literal=SMTP_USER="contact.busconnect@gmail.com" \
  --from-literal=SMTP_PASS="$SMTP_PASS" \
  --dry-run=client -o yaml | kubectl apply -f -

# ── Load SQL schema into ConfigMap ────────────────────────────────────────────
if [[ -f "$SCHEMA_FILE" ]]; then
  echo "📦  Loading schema into ConfigMap..."
  kubectl create configmap busconnect-schema \
    --from-file=schema.sql="$SCHEMA_FILE" \
    --namespace="$NAMESPACE" \
    --dry-run=client -o yaml | kubectl apply -f -
fi

# ── Apply all manifests in order ──────────────────────────────────────────────
for f in "$K8S_DIR"/*.yaml; do
  echo "  applying $(basename $f)..."
  kubectl apply -f "$f"
done

# ── Wait for postgres ─────────────────────────────────────────────────────────
echo ""
echo "⏳  Waiting for postgres to be ready..."
kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=120s

# ── Run schema init job ───────────────────────────────────────────────────────
echo "🗄️   Running DB schema init job..."
kubectl apply -f "$K8S_DIR/12-db-init-job.yaml"
kubectl wait --for=condition=complete job/busconnect-db-init -n "$NAMESPACE" --timeout=120s || \
  kubectl logs job/busconnect-db-init -n "$NAMESPACE"

# ── Status ────────────────────────────────────────────────────────────────────
echo ""
echo "✅  Deployment complete!"
echo ""
kubectl get pods -n "$NAMESPACE"
echo ""
kubectl get svc -n "$NAMESPACE"
echo ""
echo "💡  Port-forward commands:"
echo "    kubectl port-forward svc/api-gateway 8080:8080 -n $NAMESPACE"
echo "    kubectl port-forward svc/frontend    3000:80   -n $NAMESPACE"
