{{/*
BusConnect Helm Chart – _helpers.tpl
*/}}

{{/* Chart name */}}
{{- define "busconnect.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Namespace */}}
{{- define "busconnect.namespace" -}}
{{- .Values.global.namespace | default "busconnect" }}
{{- end }}

{{/* Common labels */}}
{{- define "busconnect.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Service-specific selector labels */}}
{{- define "busconnect.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .release }}
{{- end }}

{{/* Image with optional registry */}}
{{- define "busconnect.image" -}}
{{- $registry := .root.Values.global.imageRegistry -}}
{{- $tag := .root.Values.global.imageTag | default "latest" -}}
{{- if $registry -}}
{{ $registry }}{{ .image }}:{{ $tag }}
{{- else -}}
{{ .image }}:{{ $tag }}
{{- end }}
{{- end }}

{{/* Common env from ConfigMap + Secret */}}
{{- define "busconnect.commonEnv" -}}
- name: NODE_ENV
  value: "production"
- name: DB_HOST
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: DB_HOST
- name: DB_PORT
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: DB_PORT
- name: DB_NAME
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: DB_NAME
- name: DB_USER
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: DB_USER
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: busconnect-secret
      key: DB_PASSWORD
- name: JWT_SECRET
  valueFrom:
    secretKeyRef:
      name: busconnect-secret
      key: JWT_SECRET
- name: AUTH_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: AUTH_SERVICE_URL
- name: USER_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: USER_SERVICE_URL
- name: OPERATOR_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: OPERATOR_SERVICE_URL
- name: BOOKING_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: BOOKING_SERVICE_URL
- name: WALLET_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: WALLET_SERVICE_URL
- name: PROMO_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: PROMO_SERVICE_URL
- name: ADMIN_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: ADMIN_SERVICE_URL
- name: NOTIFICATION_SERVICE_URL
  valueFrom:
    configMapKeyRef:
      name: busconnect-config
      key: NOTIFICATION_SERVICE_URL
{{- end }}
