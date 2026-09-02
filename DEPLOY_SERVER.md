# Развертывание на сервере (Debian + Docker Compose + Nginx)

## 1. Установка Docker и плагина Compose

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 2. Клонирование проекта и подготовка env

```bash
git clone <your-repo-url> telemedicine
cd telemedicine
cp .env.production.example .env
nano .env
```

Обязательные изменения в `.env`:
- JWT_SECRET
- все пароли БД
- CORS_ORIGINS (ваш домен)
- SEED_ADMIN_PASSWORD
- RABBITMQ_USER/RABBITMQ_PASS
- S3_ACCESS_KEY/S3_SECRET_KEY
- S3_ENDPOINT=http://minio:9000 и S3_FORCE_PATH_STYLE=true, если используется встроенный MinIO

## 3. Запуск стека в серверном режиме

`docker-compose.server.yml` привязывает к localhost frontend/backend, все БД, MinIO и RabbitMQ. Наружу должен быть открыт только системный Nginx/reverse proxy.

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml build --parallel
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d
```

## 4. Настройка reverse proxy в Nginx

```bash
sudo cp deploy/nginx/telemed.conf.example /etc/nginx/sites-available/telemed.conf
sudo nano /etc/nginx/sites-available/telemed.conf
sudo ln -s /etc/nginx/sites-available/telemed.conf /etc/nginx/sites-enabled/telemed.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Проверка

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml ps
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3001/api
```

## 6. Обновление релиза

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.server.yml build --parallel
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d
```
