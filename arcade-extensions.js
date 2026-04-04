import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

// --- ЗАЩИТА КНОПКИ "НАЗАД" (ДВОЙНОЙ КЛИК) ---
let lastBackPress = 0;
const exitThreshold = 2000; 

App.addListener('backButton', async () => {
    if (window.location.hash === '#game') {
        const now = Date.now();
        const isHtml = window.currentGame && window.currentGame.t === 'h';
        
        if (now - lastBackPress < exitThreshold) {
            // ВТОРОЙ КЛИК: Выход
            if (typeof window.executeCleanup === 'function') {
                window.executeCleanup(true); 
            }
            lastBackPress = 0;
        } else {
            // ПЕРВЫЙ КЛИК
            lastBackPress = now;
            
            if (isHtml) {
                // ПРАВКА: Для HTML просто просим нажать еще раз (без сохранения)
                if (typeof window.showToast === 'function') {
                    window.showToast("Нажмите 'Назад' еще раз для выхода", "info", 2000);
                }
            } else {
                // Для всех остальных: сохраняем и пишем про сейв
                if (typeof window.saveGameState === 'function') {
                    await window.saveGameState(true); 
                    if (typeof window.showToast === 'function') {
                        window.showToast("Прогресс сохранен. Нажмите 'Назад' еще раз для выхода", "info", 2000);
                    }
                }
            }
        }
        return;
    }
    
    // Закрытие модалок
    const infoOverlay = document.getElementById('infoModalOverlay');
    if (infoOverlay && (infoOverlay.style.display === 'flex' || infoOverlay.classList.contains('show'))) {
        document.getElementById('closeInfoBtn').click(); return;
    }
    const resetOverlay = document.getElementById('resetModalOverlay');
    if (resetOverlay && (resetOverlay.style.display === 'flex' || resetOverlay.classList.contains('show'))) {
        document.getElementById('btnResetCancel').click(); return;
    }
    const editPanel = document.getElementById('editPanel');
    if (editPanel && (editPanel.style.display === 'block' || editPanel.classList.contains('show'))) {
        if (typeof window.toggleLibraryEditMode === 'function') window.toggleLibraryEditMode(); return;
    }

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
    } catch (err) { return false; }
};

function isRealRom(fileName, fileDataU8) {
    const lower = fileName.toLowerCase();
    const ext = lower.split('.').pop();
    if (!['nes', 'md', 'sfc', 'smc', 'gen', 'bin', 'ngp', 'ngc', 'gba', 'gbc', 'gb'].includes(ext)) return false;
    if (fileDataU8.length < 4096) return false;
    return true; 
}

// --- ТВОЯ ОРИГИНАЛЬНАЯ ЛОГИКА ПАРСИНГА (ВОССТАНОВЛЕНО ПОЛНОСТЬЮ) ---
document.addEventListener('DOMContentLoaded', () => {
    if (typeof Archive !== 'undefined') {
        Archive.init({ workerUrl: 'worker-bundle.js' });
    }

    const initExtendedProcessor = () => {
        if (typeof window.processSingleFile !== 'function') {
            setTimeout(initExtendedProcessor, 50); return;
        }
        if (window.processSingleFile.isExtended) return;
        const coreProcessSingleFile = window.processSingleFile;
        
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc', '.gba', '.gbc', '.gb'];
            const validDosExts = ['.exe', '.bin', '.bat', '.com'];
            const validArchiveExts = ['.zip', '.rar', '.7z'];
            
            if ((fileName.endsWith('.rar') || fileName.endsWith('.7z')) && typeof Archive !== 'undefined') {
                const archive = await Archive.open(file);
                const extractedFiles = await archive.getFilesObject();
                let fileList = [];
                function flatten(obj, path = '') {
                    for (let key in obj) {
                        if (obj[key] instanceof File) fileList.push({ path: path + key, file: obj[key] });
                        else if (typeof obj[key] === 'object') flatten(obj[key], path + key + '/');
                    }
                }
                flatten(extractedFiles);

                let dosFiles = fileList.filter(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let romFiles = [];
                for (let f of fileList) {
                    if (validRomExts.some(ext => f.path.toLowerCase().endsWith(ext))) {
                        const buffer = await readBlobSafe(f.file);
                        if (isRealRom(f.path.split('/').pop(), new Uint8Array(buffer))) romFiles.push({ path: f.path, file: f.file });
                    }
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        await window.processSingleFileExtended(new File([await readBlobSafe(f.file)], f.path.split('/').pop()));
                    }
                    hasValidContent = true;
                }
                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        await coreProcessSingleFile(new File([await readBlobSafe(f.file)], f.path.split('/').pop()));
                    }
                    hasValidContent = true;
                }
                if (!hasValidContent && dosFiles.length > 0) {
                    const zipData = {};
                    for (let f of fileList) zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    const zipped = fflate.zipSync(zipData);
                    await coreProcessSingleFile(makeFakeFile(new Blob([zipped]), file.name.replace(/\.(rar|7z)$/i, '.zip')));
                    hasValidContent = true;
                }
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const unzipped = fflate.unzipSync(new Uint8Array(buffer));
                let hasDos = false, romFiles = [], nestedArchives = [];
                for (const path in unzipped) {
                    const low = path.toLowerCase();
                    if (validDosExts.some(ext => low.endsWith(ext))) hasDos = true;
                    if (validArchiveExts.some(ext => low.endsWith(ext))) nestedArchives.push({ path, data: unzipped[path] });
                    if (validRomExts.some(ext => low.endsWith(ext))) {
                        if (isRealRom(path.split('/').pop(), unzipped[path])) romFiles.push({ path, data: unzipped[path] });
                    }
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        await window.processSingleFileExtended(makeFakeFile(new Blob([arc.data]), arc.path.split('/').pop()));
                    }
                    hasValidContent = true;
                }
                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        await coreProcessSingleFile(makeFakeFile(new Blob([rom.data]), rom.path.split('/').pop()));
                    }
                    hasValidContent = true;
                }
                if (!hasValidContent && hasDos) {
                    await coreProcessSingleFile(file);
                    hasValidContent = true;
                }
                return;
            }
            return await coreProcessSingleFile(file);
        };
        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    initExtendedProcessor();

    // Ссылки
    const externalLinks = document.querySelectorAll('a[target="_blank"]');
    externalLinks.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            if (Capacitor.isNativePlatform()) {
                await Browser.open({ url: link.href, presentationStyle: 'popover', toolbarColor: '#1f2937' });
            } else { window.open(link.href, '_blank'); }
        });
    });
});

async function scanDownloadFolder() { return []; }
window.runDownloadRadar = async () => { return; };
