import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@app': resolve(__dirname, 'src/app'),
                '@pages': resolve(__dirname, 'src/pages'),
                '@widgets': resolve(__dirname, 'src/widgets'),
                '@features': resolve(__dirname, 'src/features'),
                '@entities': resolve(__dirname, 'src/entities'),
                '@shared': resolve(__dirname, 'src/shared'),
            },
        },
        server: {
            port: Number(env.VITE_PORT) || 3000,
            fs: {
                allow: [resolve(__dirname, '..')],
            },
            // Разрешаем Яндекс.Метрике/Webvisor отображать сайт во фрейме
            headers: {
                'Content-Security-Policy': "frame-ancestors 'self' https://webvisor.com https://*.webvisor.com https://metrika.yandex.ru https://*.yandex.ru",
            },
            proxy: {
                '/api': {
                    target: env.VITE_API_TARGET || 'http://localhost:3001',
                    changeOrigin: true,
                },
            },
        },
        preview: {
            port: Number(env.VITE_PORT) || 3000,
            headers: {
                'Content-Security-Policy': "frame-ancestors 'self' https://webvisor.com https://*.webvisor.com https://metrika.yandex.ru https://*.yandex.ru",
            },
            proxy: {
                '/api': {
                    target: env.VITE_API_TARGET || 'http://localhost:3001',
                    changeOrigin: true,
                },
            },
        },
    };
});
