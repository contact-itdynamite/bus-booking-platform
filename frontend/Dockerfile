FROM nginx:1.25-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nginx config (place nginx.conf in the frontend/ directory)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy all frontend UIs
COPY user-ui/     /usr/share/nginx/html/user-ui/
COPY operator-ui/ /usr/share/nginx/html/operator-ui/
COPY admin-ui/    /usr/share/nginx/html/admin-ui/

# Default user-ui index at root
COPY user-ui/index.html /usr/share/nginx/html/index.html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost || exit 1

CMD ["nginx", "-g", "daemon off;"]
