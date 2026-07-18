self.addEventListener('activate', (event) => {
    event.waitUntil(caches.delete('apis'));
});
