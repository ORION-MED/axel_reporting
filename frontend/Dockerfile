# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
	npm ci \
	--no-audit \
	--no-fund \
	--fetch-retries=5 \
	--fetch-retry-factor=2 \
	--fetch-retry-mintimeout=20000 \
	--fetch-retry-maxtimeout=120000
COPY . .
ARG VITE_API_BASE_URL=/
ARG VITE_SUPPORT_PORTAL_URL=
ARG VITE_SUPPORT_KB_URL=
ARG VITE_YANDEX_METRIKA_ID=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SUPPORT_PORTAL_URL=$VITE_SUPPORT_PORTAL_URL
ENV VITE_SUPPORT_KB_URL=$VITE_SUPPORT_KB_URL
ENV VITE_YANDEX_METRIKA_ID=$VITE_YANDEX_METRIKA_ID
RUN npx vite build

FROM nginx:1.27-bookworm AS runner
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost/ > /dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
