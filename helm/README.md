# BusConnect – Helm Chart Deployment

## Prerequisites
- Kubernetes cluster (minikube, k3s, EKS, GKE, AKS)
- Helm 3.x
- kubectl configured

## Quick Deploy

### 1. Build Docker images
```bash
cd bus-booking-platform

# Build all service images
docker build -t busconnect/auth-service:latest auth-service/
docker build -t busconnect/user-service:latest user-service/
docker build -t busconnect/operator-service:latest operator-service/
docker build -t busconnect/booking-service:latest booking-service/
docker build -t busconnect/wallet-service:latest wallet-service/
docker build -t busconnect/promo-service:latest promo-service/
docker build -t busconnect/admin-service:latest admin-service/
docker build -t busconnect/notification-service:latest notification-service/
docker build -t busconnect/api-gateway:latest api-gateway/
```

### 2. Deploy with Helm (inline secrets)

```bash
# Install (pass Gmail App Password inline)
./helm/deploy.sh install "your_gmail_app_password_here"

# Or manually with full control:
helm install busconnect ./helm/busconnect \
  --namespace busconnect \
  --create-namespace \
  --set secrets.smtpUser=contact.busconnect@gmail.com \
  --set secrets.smtpPass="your_16_char_app_password" \
  --set secrets.jwtSecret="$(openssl rand -hex 32)" \
  --set secrets.dbPassword="buspassword123" \
  --wait
```

### 3. Upgrade
```bash
./helm/deploy.sh upgrade "your_gmail_app_password_here"
# or
helm upgrade busconnect ./helm/busconnect \
  --namespace busconnect \
  --set secrets.smtpPass="your_app_password"
```

### 4. Uninstall
```bash
./helm/deploy.sh uninstall
```

## Gmail App Password Setup
1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Go to https://myaccount.google.com/apppasswords
4. Generate an App Password for "Mail"
5. Use the 16-character password in `--set secrets.smtpPass`

## Configuration

Key values to override:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `secrets.smtpUser` | `contact.busconnect@gmail.com` | Gmail sender address |
| `secrets.smtpPass` | *(required)* | Gmail App Password |
| `secrets.jwtSecret` | *(auto-generated)* | JWT signing secret |
| `secrets.dbPassword` | `buspassword123` | PostgreSQL password |
| `apiGateway.ingress.host` | `busconnect.local` | Your domain |
| `apiGateway.ingress.tlsSecret` | `` | TLS secret for HTTPS |
| `services.booking.replicaCount` | `3` | Booking service replicas |
| `hpa.enabled` | `false` | Enable Horizontal Pod Autoscaler |
| `postgres.storage` | `10Gi` | Database storage size |

## Access the App

```bash
# Port-forward API Gateway
kubectl port-forward svc/api-gateway 8080:8080 -n busconnect

# Port-forward Frontend
kubectl port-forward svc/frontend 3000:80 -n busconnect
```

Then visit:
- User UI: http://localhost:3000/user-ui/
- Operator UI: http://localhost:3000/operator-ui/
- Admin UI: http://localhost:3000/admin-ui/

## Schema Initialisation

On first install the db-init Job runs `database/schema.sql` automatically.

To run manually:
```bash
kubectl create configmap busconnect-schema \
  --from-file=schema.sql=database/schema.sql \
  -n busconnect --dry-run=client -o yaml | kubectl apply -f -
```

## Monitoring

```bash
# All pods
kubectl get pods -n busconnect

# Service logs
kubectl logs -l app.kubernetes.io/name=booking-service -n busconnect -f

# Events
kubectl get events -n busconnect --sort-by=.lastTimestamp
```
