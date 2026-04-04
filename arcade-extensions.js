import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

App.addListener('backButton', ({ canGoBack }) => {
    // 1. Если мы в игре - имитируем нажатие браузерной кнопки. 
    // Вся логика двойного клика, сохранений и HTML теперь лежит в popstate (index.html)
    if (window.location.hash === '#game') {
        window.history.back();
        return;
    }
    
    // 2. Если открыто инфо-модальное окно
    const infoOverlay = document.getElementById('infoModalOverlay');
    if (infoOverlay && (infoOverlay.style.display === 'flex' || infoOverlay.classList.contains('show'))) {
        document.getElementById('closeInfoBtn').click();
        return;
    }
    
    // 3. Если открыто окно сброса прогресса
    const resetOverlay = document.getElementById('resetModalOverlay');
    if (resetOverlay && (resetOverlay.style.display === 'flex' || resetOverlay.classList.contains('show'))) {
        document.getElementById('btnResetCancel').click();
        return;
    }
    
    // 4. Если открыта панель редактирования
    const editPanel = document.getElementById('editPanel');
    if (editPanel && (editPanel.style.display === 'block' || editPanel.classList.contains('show'))) {
        if (typeof window.toggleLibraryEditMode === 'function') window.toggleLibraryEditMode();
        return;
    }

    // 5. Иначе - закрываем приложение
    if (canGoBack) {
        window.history.back();
    } else {
        App.exitApp();
    }
});

const readBlobSafe = (b) => {
    if (b.arrayBuffer) return b.arrayBuffer();
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsArrayBuffer(b);
    });
};

// --- НАДЕЖНОЕ СОХРАНЕНИЕ ГИГАНТСКИХ ФАЙЛОВ "КУСОЧКАМИ" ---
window.nativeSaveZip = async (blob, fileName) => {
    try {
        const chunkSize = 5 * 1024 * 1024; 
        const totalChunks = Math.ceil(blob.size / chunkSize);
        const btn = document.getElementById('exportLibraryBtn');
        
        for (let i = 0; i < totalChunks; i++) {
            const chunk = blob.slice(i * chunkSize, (i + 1) * chunkSize);
            const base64Chunk = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(chunk);
            });

            if (i === 0) {
                await Filesystem.writeFile({ path: fileName, data: base64Chunk, directory: Directory.Documents });
            } else {
                await Filesystem.appendFile({ path: fileName, data: base64Chunk, directory: Directory.Documents });
            }
            if (btn) btn.innerHTML = `⏳ ЗАПИСЬ... ${Math.round(((i + 1) / totalChunks) * 100)}%`;
        }

        if (typeof window.showToast === 'function') {
            window.showToast(`Архив ${fileName} сохранен в Документы.`, 'success', 4000);
        }
        return true;
    } catch (err) {
        console.error('Ошибка Capacitor Filesystem:', err);
        return false;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Archive !== 'undefined') Archive.init({ workerUrl: 'worker-bundle.js' });

    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    externalLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetUrl = link.href;
            if (Capacitor.isNativePlatform()) {
                try {
                    await Browser.open({ url: targetUrl, presentationStyle: 'popover', toolbarColor: '#1f2937' });
                    return; 
                } catch (err) {}
            }
            window.open(targetUrl, '_blank');
        });
    });
});

async function scanDownloadFolder() { return []; }
window.isRadarRunning = false;
window.runDownloadRadar = async function(manualTrigger = true) { return; };
