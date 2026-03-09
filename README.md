# 🚌 BusConnect – Production Microservices Bus Booking Platform

A fully-featured, production-grade bus booking platform similar to RedBus.
Built with **Node.js microservices**, **PostgreSQL**, and a **Vanilla JS frontend**.

---

## 📁 Project Structure

```
bus-booking-platform/
├── api-gateway/              # Reverse proxy + rate limiting  :8080
├── auth-service/             # JWT auth + OTP email           :3001
├── user-service/             # User profile management        :3002
├── operator-service/         # Bus, route, schedule mgmt      :3003
├── booking-service/          # Seat locking + booking engine  :3004
├── wallet-service/           # Credits + payment flow         :3005
├── promo-service/            # Promo code management          :3006
├── admin-service/            # Admin dashboard + reports      :3007
├── notification-service/     # Email (OTP/confirm/cancel)     :3008
├── frontend/
│   ├── user-ui/              # Search, book, wallet, history
│   ├── operator-ui/          # Buses, routes, schedules
│   ├── admin-ui/             # Dashboard, reports, logs
│   └── Dockerfile
├── database/schema.sql       # Full PostgreSQL schema + seeds
├── docker/docker-compose.yml # Run all locally
├── k8s/base/                 # Kubernetes manifests (00–12)
│   ├── apply.sh              # One-command kubectl deploy
│   └── ...
└── helm/busconnect/          # Helm chart
    └── deploy.sh             # One-command Helm deploy
```

Each service follows: `src/{controllers,routes,middleware,utils,config}/`

---

## 🏗️ Architecture

```
Frontend (Nginx) ──► API Gateway :8080 ──► auth/user/operator/booking/wallet/promo/admin/notification
                                                        │
                                                   PostgreSQL :5432
```

**Wallet flow:**
- Admin starts with 10 Crore credits
- New user signup → Admin sends 1000 bonus credits to user
- User books ticket → User pays full fare → Operator gets 90% → Admin gets 10% commission

---

## 🚀 Quick Start – Docker Compose

```bash
cd bus-booking-platform/docker

# Set Gmail App Password (see Email Setup section)
SMTP_PASS="your_app_password" docker compose up -d

# Init schema (first run only)
docker exec -i busconnect-postgres psql -U busadmin -d busplatform < ../database/schema.sql

# Access
# User UI:     http://localhost:3000
# Operator UI: http://localhost:3000/operator-ui/
# Admin UI:    http://localhost:3000/admin-ui/
# API:         http://localhost:8080
```

---

## ☸️ Kubernetes – kubectl

```bash
# One command deploy (pass Gmail App Password)
./k8s/apply.sh "your_gmail_app_password"

# Or manually:
kubectl apply -f k8s/base/00-namespace.yaml

kubectl create secret generic busconnect-secret \
  --namespace=busconnect \
  --from-literal=DB_PASSWORD="buspassword123" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SMTP_USER="contact.busconnect@gmail.com" \
  --from-literal=SMTP_PASS="your_app_password"

kubectl create configmap busconnect-schema \
  --from-file=schema.sql=database/schema.sql -n busconnect

kubectl apply -f k8s/base/

# Port-forward
kubectl port-forward svc/api-gateway 8080:8080 -n busconnect
kubectl port-forward svc/frontend    3000:80   -n busconnect
```

---

## 🪖 Helm Deploy

```bash
# Install
./helm/deploy.sh install "your_gmail_app_password"

# Upgrade
./helm/deploy.sh upgrade "your_gmail_app_password"

# Manual with full control
helm install busconnect ./helm/busconnect \
  --namespace busconnect --create-namespace \
  --set secrets.smtpUser=contact.busconnect@gmail.com \
  --set secrets.smtpPass="your_app_password" \
  --set secrets.jwtSecret="$(openssl rand -hex 32)"
```

---

## 📧 Gmail App Password Setup

Emails are sent from **contact.busconnect@gmail.com**.

1. Visit https://myaccount.google.com/security → Enable **2-Step Verification**
2. Visit https://myaccount.google.com/apppasswords
3. Create an App Password → **Mail** → **Other: BusConnect**
4. Copy the 16-character password
5. Use it as `SMTP_PASS` in all commands above

---

## 🔑 Default Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@busconnect.com | admin123 |

> Change immediately in production. Set in `database/schema.sql` seed.

---

## 🌐 Key API Endpoints (via Gateway :8080)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/user/register` | None | Register user |
| POST | `/api/auth/user/login` | None | User login |
| POST | `/api/auth/admin/login` | None | Admin login |
| GET | `/api/bookings/search?from=&to=&date=` | None | Search buses |
| POST | `/api/bookings/initiate` | User | Lock seats |
| POST | `/api/bookings/confirm` | User | Pay + confirm |
| GET | `/api/bookings/my` | User | My bookings |
| POST | `/api/bookings/:id/cancel` | User/Op/Admin | Cancel |
| GET | `/api/wallet/balance` | Any | Wallet balance |
| POST | `/api/promos/validate` | User | Check promo |
| GET | `/api/admin/dashboard` | Admin | Dashboard stats |
| PATCH | `/api/admin/operators/:id/approve` | Admin | Approve operator |
| GET | `/api/admin/reports/bookings` | Admin | Booking report |
| GET | `/health` | None | Gateway health |

---

## ⚙️ Environment Variables

Each service has `.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | Change in production |
| `DB_PASSWORD` | `buspassword123` | PostgreSQL password |
| `SMTP_USER` | `contact.busconnect@gmail.com` | Gmail sender |
| `SMTP_PASS` | — | Gmail App Password |
| `COMMISSION_RATE` | `0.10` | 10% admin commission |
| `SIGNUP_BONUS` | `1000` | Credits per new user |

---

## 🏗️ Building Images

```bash
for svc in auth-service user-service operator-service booking-service \
           wallet-service promo-service admin-service notification-service api-gateway; do
  docker build -t busconnect/$svc:latest ./$svc/
done
docker build -t busconnect/frontend:latest ./frontend/
```

---

## 🔒 Security Features

- JWT authentication on every API call
- bcrypt password hashing (rounds=12)
- Email OTP for signup + booking payment
- Rate limiting at gateway (500 req/15min)
- Role-based access: `user`, `operator`, `admin`
- DB row locking (`FOR UPDATE`) prevents double-booking
- K8s NetworkPolicy isolates services

---

## 📊 Monitoring

```bash
kubectl get pods -n busconnect
kubectl logs -l app=booking-service -n busconnect -f
kubectl top pods -n busconnect
curl http://localhost:8080/health | jq .
```

---

## 🏆 Tech Stack

Node.js 20 + Express | PostgreSQL 15 | JWT + bcrypt | Nodemailer/Gmail | Winston logging | HTML5 + CSS3 + Vanilla JS | Docker + Docker Compose | Kubernetes + HPA + PDB + NetworkPolicy | Helm 3

---

**Developed by Sreekanth K** – Lead DevSecOps and Site Reliability Engineer
