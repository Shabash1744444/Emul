import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

// --- ЗАЩИТА КНОПКИ "НАЗАД" (ДВОЙНОЙ КЛИК) ---
let lastBackPress = 0;
const exitThreshold = 2000; // 2 секунды на второе нажатие

App.addListener('backButton', async () => {
    // 1. Если мы в игре
    if (window.location.hash === '#game') {
        const now = Date.now();
        
        // Проверяем, было ли нажатие недавно (второй клик)
        if (now - lastBackPress < exitThreshold) {
            // ВТОРОЙ КЛИК: Выходим окончательно
            if (typeof window.executeCleanup === 'function') {
                window.executeCleanup(true); // true значит "пропустить сохранение", т.к. уже сохранили при первом клике
            }
            lastBackPress = 0;
        } else {
            // ПЕРВЫЙ КЛИК: Подготовка к выходу
            lastBackPress = now;
            
            const isHtml = window.currentGame && window.currentGame.t === 'h';
            
            if (!isHtml && typeof window.saveGameState === 'function') {
                // Если это НЕ HTML игра - сохраняем прогресс
                await window.saveGameState(true); 
                if (typeof window.showToast === 'function') {
                    window.showToast("Прогресс сохранен. Нажмите 'Назад' еще раз для выхода", "info", 2000);
                }
            } else {
                // Если это HTML - просто предупреждаем
                if (typeof window.showToast === 'function') {
                    window.showToast("Нажмите 'Назад' еще раз для выхода", "info", 2000);
                }
            }
        }
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
    
    // 4. Если открыта панель редактирования (удаление/лого)
    const editPanel = document.getElementById('editPanel');
    if (editPanel && (editPanel.style.display === 'block' || editPanel.classList.contains('show'))) {
        if (typeof window.toggleLibraryEditMode === 'function') {
            window.toggleLibraryEditMode();
        }
        return;
    }

    // 5. Иначе - закрываем приложение
    App.exitApp();
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

const makeFakeFile = (blob, fileName) => {
    try {
        return new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    } catch (e) {
        blob.name = fileName;
        blob.lastModified = Date.now();
        return blob;
    }
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
    if (typeof Archive !== 'undefined') {
        Archive.init({ workerUrl: 'worker-bundle.js' });
    }

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

async function scanDownloadFolder() {
    let allFiles = [];
    async function walk(currentPath, depth) {
        if (depth > 3) return; 
        try {
            let dir = await Filesystem.readdir({ path: currentPath, directory: Directory.ExternalStorage });
            let filesArray = dir.files || [];
            for (let i = 0; i < filesArray.length; i++) {
                let item = filesArray[i];
                let name = typeof item === 'string' ? item : item.name;
                let type = typeof item === 'string' ? 'unknown' : item.type;
                let fullPath = currentPath === 'Download' ? `Download/${name}` : `${currentPath}/${name}`;
                if (type === 'directory' || (typeof item === 'object' && item.type === 'directory')) {
                    await walk(fullPath, depth + 1);
                } else {
                    allFiles.push({ name: name, path: fullPath });
                }
            }
        } catch(e) {}
    }
    await walk('Download', 0);
    return allFiles;
}

window.isRadarRunning = false;
async function runDownloadRadar(manualTrigger = true) { return; }
window.runDownloadRadar = runDownloadRadar;

function isRealRom(fileName, fileDataU8) {
    const lower = fileName.toLowerCase();
    const ext = lower.split('.').pop();
    if (!['nes', 'md', 'sfc', 'smc', 'gen', 'bin', 'ngp', 'ngc'].includes(ext)) return false;
    if (fileDataU8.length < 4096) return false;
    return true; 
}

document.addEventListener('DOMContentLoaded', () => {
    const initExtendedProcessor = () => {
        if (typeof window.processSingleFile !== 'function') {
            setTimeout(initExtendedProcessor, 50);
            return;
        }
        if (window.processSingleFile.isExtended) return;
        const coreProcessSingleFile = window.processSingleFile;
        
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped = fflate.unzipSync(arr);
                for (const path in unzipped) {
                    const ext = path.toLowerCase().split('.').pop();
                    if (['nes','md','sfc','smc','gba'].includes(ext)) {
                        await coreProcessSingleFile(new File([unzipped[path]], path.split('/').pop()));
                    }
                }
                return;
            }
            return await coreProcessSingleFile(file);
        };
        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    initExtendedProcessor();
});
