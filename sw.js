const CACHE_NAME = 'arcade-hub-v1';

// Список файлов, которые мы намертво прибиваем к памяти устройства
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './js-dos.js',
    './wdosbox.js',
    './wdosbox.wasm.js',
    './jsnes.min.js',
    './mgba_libretro.js',
    './snes9x_libretro.js',
    './genesis_plus_gx_libretro.js',
    './mednafen_ngp_libretro.js',
    './libarchive.js',
    './arcade-extensions.bundle.js',
    './covers_list.txt'
];

// 1. УСТАНОВКА (Загружаем всё в кэш)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Кэширование файлов...');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// 2. АКТИВАЦИЯ (Удаляем старый кэш, если поменяли версию)
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Удаление старого кэша:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 3. ПЕРЕХВАТ ЗАПРОСОВ (Сначала ищем в кэше, потом идем в сеть)
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Если файл есть в кэше — отдаем моментально
                if (response) {
                    return response;
                }
                // Иначе скачиваем из интернета
                return fetch(event.request);
            })
    );
});
