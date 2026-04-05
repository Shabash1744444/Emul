import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';

// --- ЗАЩИТА КНОПКИ "НАЗАД" (ДВОЙНОЙ КЛИК) ---
let lastBackPress = 0;
const exitThreshold = 2000;

App.addListener('backButton', async () => {
    if (window.location.hash === '#game') {
        const now = Date.now();
        if (now - lastBackPress < exitThreshold) {
            if (typeof window.executeCleanup === 'function') window.executeCleanup(true);
            lastBackPress = 0;
        } else {
            lastBackPress = now;
            const isHtml = window.currentGame && window.currentGame.t === 'h';
            if (!isHtml && typeof window.saveGameState === 'function') {
                await window.saveGameState(true); 
                if (typeof window.showToast === 'function') window.showToast("Прогресс сохранен. Нажмите 'Назад' еще раз для выхода", "info", 2000);
            } else {
                if (typeof window.showToast === 'function') window.showToast("Нажмите еще раз для выхода", "info", 2000);
            }
        }
        return;
    }
    
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
        if (typeof window.toggleLibraryEditMode === 'function') window.toggleLibraryEditMode();
        return;
    }
    App.exitApp();
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
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
    try { return new File([blob], fileName, { type: blob.type || 'application/octet-stream' }); } 
    catch (e) { blob.name = fileName; blob.lastModified = Date.now(); return blob; }
};

// --- НАДЕЖНОЕ СОХРАНЕНИЕ ГИГАНТСКИХ ФАЙЛОВ "КУСОЧКАМИ" ---
window.nativeSaveZip = async (blob, fileName) => {
    try {
        const btn = document.getElementById('exportLibraryBtn');
        const chunkSize = 4 * 1024 * 1024; // Увеличили чанк до 4MB
        const totalChunks = Math.ceil(blob.size / chunkSize);

        let currentDir = Directory.Documents;
        let useShare = false;

        // Проверяем прямой доступ в Documents
        try {
            await Filesystem.writeFile({ path: 'test.tmp', data: '1', directory: currentDir });
            await Filesystem.deleteFile({ path: 'test.tmp', directory: currentDir });
        } catch (e) {
            currentDir = Directory.Data; 
            useShare = true; 
        }

        try { await Filesystem.deleteFile({ path: fileName, directory: currentDir }); } catch(e) {}
        
        for (let i = 0; i < totalChunks; i++) {
            const chunk = blob.slice(i * chunkSize, (i + 1) * chunkSize);
            
            const base64Chunk = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const res = reader.result;
                    resolve(res.substr(res.indexOf(',') + 1));
                };
                reader.onerror = reject;
                reader.readAsDataURL(chunk);
            });

            if (i === 0) {
                await Filesystem.writeFile({ path: fileName, data: base64Chunk, directory: currentDir });
            } else {
                await Filesystem.appendFile({ path: fileName, data: base64Chunk, directory: currentDir });
            }
            
            if (btn) btn.innerHTML = `⏳ ЗАПИСЬ... ${Math.round(((i + 1) / totalChunks) * 100)}%`;
            
            // ВАЖНО: Очистка памяти!
            await new Promise(r => setTimeout(r, 20)); 
        }

        if (btn) btn.innerHTML = '⏳ ФИНИШ...';
        // Ждем, пока система закроет файл на диске
        await new Promise(r => setTimeout(r, 1000));

        if (useShare) {
            if (btn) btn.innerHTML = '⏳ МЕНЮ...';
            const fileUri = await Filesystem.getUri({ path: fileName, directory: currentDir });
            await Share.share({ title: 'Бэкап Arcade Hub', text: 'Архив с играми.', url: fileUri.uri, dialogTitle: 'Сохранить файл' });
            if (btn) btn.innerHTML = '✅ ГОТОВО';
        } else {
            if (btn) btn.innerHTML = '✅ СОХРАНЕНО';
            if (typeof window.showToast === 'function') window.showToast(`Файл успешно сохранен в папку "Документы"`, 'success', 4000);
        }

        return true;
        
    } catch (err) {
        console.error('Ошибка сохранения:', err); 
        const btn = document.getElementById('exportLibraryBtn');
        if (btn) btn.innerHTML = '⚠️ ОШИБКА';
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
                try { await Browser.open({ url: targetUrl, presentationStyle: 'popover', toolbarColor: '#1f2937' }); return; } catch (err) {}
            }
            window.open(targetUrl, '_blank');
        });
    });

// --- РАСШИРЕННЫЙ ПАРСЕР АРХИВОВ (DOS + RAR/7Z/ZIP + ROMS + ОБЛОЖКИ) ---
    const initExtendedProcessor = () => {
        if (typeof window.processSingleFile !== 'function') { setTimeout(initExtendedProcessor, 50); return; }
        if (window.processSingleFile.isExtended) return;
        
        const coreProcessSingleFile = window.processSingleFile;
        
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc', '.html'];
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

                // МАГИЯ ОБЛОЖЕК
                let covers = {};
                for (let f of fileList) {
                    let ext = f.path.split('.').pop().toLowerCase();
                    if (['png', 'jpg', 'jpeg'].includes(ext)) {
                        let name = f.path.split('/').pop();
                        covers[name] = f.file;
                        covers[name.replace(/\.[^/.]+$/, "")] = f.file;
                    }
                }

                let dosFiles = fileList.filter(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let romFiles = [];
                
                for (let f of fileList) {
                    if (validRomExts.some(ext => f.path.toLowerCase().endsWith(ext))) {
                        const buffer = await readBlobSafe(f.file);
                        if (f.path.toLowerCase().endsWith('.html') || isRealRom(f.path.split('/').pop(), new Uint8Array(buffer))) {
                            romFiles.push({ path: f.path, file: f.file });
                        }
                    }
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let baseName = cleanName.replace(/\.[^/.]+$/, "");
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        
                        let coverFile = covers[cleanName] || covers[baseName];
                        if (coverFile) {
                            newFile._customCover = await new Promise((res, rej) => {
                                const reader = new FileReader();
                                reader.onloadend = () => res(reader.result);
                                reader.readAsDataURL(coverFile);
                            });
                        } else if (file._customCover) {
                            newFile._customCover = file._customCover;
                        }

                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let baseName = cleanName.replace(/\.[^/.]+$/, "");
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        
                        let coverFile = covers[cleanName] || covers[baseName];
                        if (coverFile) {
                            newFile._customCover = await new Promise((res, rej) => {
                                const reader = new FileReader();
                                reader.onloadend = () => res(reader.result);
                                reader.readAsDataURL(coverFile);
                            });
                        } else if (file._customCover) {
                            newFile._customCover = file._customCover;
                        }

                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent && dosFiles.length > 0) {
                    const exes = dosFiles.map(f => f.path.split('/').pop().toLowerCase());
                    let hasExe = exes.some(e => e.endsWith('.exe') || e.endsWith('.bat') || e.endsWith('.com'));
                    if (hasExe) {
                        const zipData = {};
                        for (let f of fileList) zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                        if (typeof fflate !== 'undefined') {
                            const zipped = fflate.zipSync(zipData);
                            let zipBlob = new Blob([zipped], {type: 'application/zip'});
                            let newZipFile = makeFakeFile(zipBlob, file.name.replace(/\.(rar|7z)$/i, '.zip'));
                            
                            if (file._customCover) newZipFile._customCover = file._customCover;
                            
                            await coreProcessSingleFile(newZipFile);
                            hasValidContent = true;
                        }
                    }
                }
                if (!hasValidContent) throw new Error("Архив пуст или содержит мусор");
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped;
                try { unzipped = fflate.unzipSync(arr); } catch(e) { throw new Error("Ошибка чтения ZIP"); }

                let hasDos = false, romFiles = [], nestedArchives = [], covers = {};
                
                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    const data = unzipped[path];
                    const ext = lowPath.split('.').pop();
                    const cleanName = path.split('/').pop();
                    const baseName = cleanName.replace(/\.[^/.]+$/, "");

                    if (['png', 'jpg', 'jpeg'].includes(ext)) {
                        covers[cleanName] = { data, ext };
                        covers[baseName] = { data, ext };
                    }
                    else if (validDosExts.some(e => lowPath.endsWith(e))) hasDos = true;
                    else if (validArchiveExts.some(e => lowPath.endsWith(e))) nestedArchives.push({ path, data, cleanName, baseName });
                    else if (validRomExts.some(e => lowPath.endsWith(e))) {
                        if (lowPath.endsWith('.html') || isRealRom(path.split('/').pop(), data)) {
                            romFiles.push({ path, data, cleanName, baseName });
                        }
                    }
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let newBlob = new Blob([arc.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, arc.cleanName);
                        
                        let coverObj = covers[arc.cleanName] || covers[arc.baseName];
                        if (coverObj) {
                            let mime = coverObj.ext === 'png' ? 'image/png' : 'image/jpeg';
                            let imgBlob = new Blob([coverObj.data], {type: mime});
                            newFile._customCover = await new Promise((res, rej) => {
                                const reader = new FileReader();
                                reader.onloadend = () => res(reader.result);
                                reader.readAsDataURL(imgBlob);
                            });
                        } else if (file._customCover) {
                            newFile._customCover = file._customCover;
                        }

                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let newBlob = new Blob([rom.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, rom.cleanName);
                        
                        let coverObj = covers[rom.cleanName] || covers[rom.baseName];
                        if (coverObj) {
                            let mime = coverObj.ext === 'png' ? 'image/png' : 'image/jpeg';
                            let imgBlob = new Blob([coverObj.data], {type: mime});
                            newFile._customCover = await new Promise((res, rej) => {
                                const reader = new FileReader();
                                reader.onloadend = () => res(reader.result);
                                reader.readAsDataURL(imgBlob);
                            });
                        } else if (file._customCover) {
                            newFile._customCover = file._customCover;
                        }

                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent && hasDos) {
                    let hasExe = false;
                    for (const path in unzipped) {
                        const low = path.toLowerCase();
                        if (low.endsWith('.exe') || low.endsWith('.bat') || low.endsWith('.com')) {
                            hasExe = true; break;
                        }
                    }
                    if (hasExe) {
                        if (file._customCover) {
                            // Уже есть картинка от внешнего парсера
                        } else {
                            let gameName = file.name.split('/').pop();
                            let baseName = gameName.replace(/\.[^/.]+$/, "");
                            let coverObj = covers[gameName] || covers[baseName];
                            if (coverObj) {
                                let mime = coverObj.ext === 'png' ? 'image/png' : 'image/jpeg';
                                let imgBlob = new Blob([coverObj.data], {type: mime});
                                file._customCover = await new Promise((res, rej) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => res(reader.result);
                                    reader.readAsDataURL(imgBlob);
                                });
                            }
                        }
                        await coreProcessSingleFile(file);
                        hasValidContent = true;
                    }
                }
                if (!hasValidContent) throw new Error("Архив пуст или содержит мусор");
                return;
            }
            return await coreProcessSingleFile(file);
        };
        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    initExtendedProcessor();
});

// --- СКАНЕР ПАПКИ ЗАГРУЗОК (ОТКЛЮЧЕН, НО РАБОЧИЙ) ---
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
                } else if (type === 'file' || (typeof item === 'object' && item.type === 'file')) {
                    allFiles.push({ name: name, path: fullPath });
                } else {
                    try {
                        let stat = await Filesystem.stat({ path: fullPath, directory: Directory.ExternalStorage });
                        if (stat.type === 'directory') await walk(fullPath, depth + 1);
                        else allFiles.push({ name: name, path: fullPath });
                    } catch(e) {
                        allFiles.push({ name: name, path: fullPath });
                    }
                }
            }
        } catch(e) { console.error("Ошибка чтения папки:", currentPath, e); }
    }
    await walk('Download', 0);
    return allFiles;
}

window.isRadarRunning = false;
async function runDownloadRadar(manualTrigger = true) {
    console.log("📡 Сканер загрузок временно отключен. Используйте ручное добавление игр.");
    return;
}
window.runDownloadRadar = runDownloadRadar;

// --- СУРОВЫЙ ФИЛЬТР МУСОРА ---
function isRealRom(fileName, fileDataU8) {
    const lower = fileName.toLowerCase();
    const ext = lower.split('.').pop();
    if (!['nes', 'md', 'sfc', 'smc', 'gen', 'bin', 'ngp', 'ngc'].includes(ext)) return false;

    const trashPatterns = ['readme', 'aliases', 'utech', 'info', 'license', 'manual', 'caching', 'code_of_conduct', 'changes', 'contributing', 'contributors'];
    const baseName = lower.replace(/\.[^/.]+$/, '');
    if (trashPatterns.some(p => baseName.includes(p))) return false;

    if (fileDataU8.length < 4096) return false;

    let isText = true;
    let checkLen = Math.min(fileDataU8.length, 100);
    for(let i = 0; i < checkLen; i++) {
        let b = fileDataU8[i];
        if (!( (b >= 32 && b < 127) || b === 0x0A || b === 0x0D || b === 0x09 )) {
            isText = false; break;
        }
    }
    if (isText) return false;

    return true; 
}
