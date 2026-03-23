import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';

// ==========================================
// БАЗОВЫЕ УТИЛИТЫ
// ==========================================
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

function getAndroidVersion() {
    if (!Capacitor.isNativePlatform()) return 0;
    const ua = navigator.userAgent;
    const match = ua.match(/Android\s+(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof Archive !== 'undefined') {
        Archive.init({ workerUrl: 'worker-bundle.js' });
    }

    document.querySelectorAll('a[target="_blank"]').forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetUrl = link.href;
            if (Capacitor.isNativePlatform()) {
                try {
                    await Browser.open({ url: targetUrl, presentationStyle: 'popover', toolbarColor: '#1f2937' });
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => {
                            setTimeout(() => runDownloadRadar(true), 1500); 
                        });
                        window._browserListenerAdded = true;
                    }
                } catch (err) { window.open(targetUrl, '_blank'); }
            } else {
                window.open(targetUrl, '_blank');
            }
        });
    });

    setTimeout(() => runDownloadRadar(false), 2000);
});

// ==========================================
// УНИВЕРСАЛЬНЫЙ СКАНЕР (ОБХОД ANDROID 11+)
// ==========================================
async function universalFileScan() {
    const androidVer = getAndroidVersion();
    let allFiles = [];
    
    if (androidVer > 0 && androidVer < 11) {
        try {
            allFiles = await scanLegacyExternalStorage();
            if (allFiles.length > 0) return allFiles;
        } catch (e) {}
    }
    
    try {
        allFiles = await scanWithMediaStorePaths();
        if (allFiles.length > 0) return allFiles;
    } catch (e) {}
    
    if (androidVer >= 11) {
        try {
            allFiles = await scanAppSpecificDirs();
        } catch (e) {}
    }
    return allFiles;
}

async function scanLegacyExternalStorage() {
    let files = [];
    async function walk(currentPath, depth) {
        if (depth > 3) return;
        try {
            const result = await Filesystem.readdir({ path: currentPath, directory: Directory.ExternalStorage });
            for (const item of result.files || []) {
                const name = typeof item === 'string' ? item : item.name;
                const type = typeof item === 'string' ? 'unknown' : item.type;
                const fullPath = currentPath === 'Download' ? `Download/${name}` : `${currentPath}/${name}`;
                
                if (type === 'directory' || (typeof item === 'object' && item.type === 'directory')) {
                    await walk(fullPath, depth + 1);
                } else {
                    files.push({ name, path: fullPath, directory: Directory.ExternalStorage });
                }
            }
        } catch (e) {}
    }
    await walk('Download', 0);
    return files;
}

async function scanWithMediaStorePaths() {
    let files = [];
    const validExts = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc', '.html'];
    const pathVariations = ['Download', 'Downloads', 'Documents/Download', 'DCIM/Download'];
    
    for (const testPath of pathVariations) {
        try {
            const result = await Filesystem.readdir({ path: testPath, directory: Directory.ExternalStorage }).catch(() => null);
            if (!result || !result.files) continue;
            
            for (const item of result.files || []) {
                const name = typeof item === 'string' ? item : item.name;
                if (!validExts.some(ext => name.toLowerCase().endsWith(ext))) continue;
                files.push({ name, path: `${testPath}/${name}`, directory: Directory.ExternalStorage });
            }
        } catch (e) {}
    }
    return files;
}

async function scanAppSpecificDirs() {
    let files = [];
    const dirsToCheck = [Directory.Cache, Directory.Data, Directory.Documents];
    const validExts = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
    
    for (const dir of dirsToCheck) {
        try {
            const result = await Filesystem.readdir({ path: '', directory: dir }).catch(() => null);
            if (!result || !result.files) continue;
            for (const item of result.files) {
                const name = typeof item === 'string' ? item : item.name;
                if (validExts.some(ext => name.toLowerCase().endsWith(ext))) {
                    files.push({ name, path: name, directory: dir });
                }
            }
        } catch (e) {}
    }
    return files;
}

// ==========================================
// ЗАПУСК РАДАРА С ЗАЩИТОЙ ОТ ЗАВИСАНИЯ
// ==========================================
async function runDownloadRadar(manualTrigger = false) {
    if (!Capacitor.isNativePlatform()) {
        if (manualTrigger) alert('📡 Радар работает только в приложении Android');
        return;
    }
    
    const btn = document.getElementById('radarBtn');
    const originalText = btn ? btn.innerHTML : '📡 СКАНИРОВАТЬ';
    if (btn) { btn.innerHTML = '⏳ СКАНИРУЮ...'; btn.style.pointerEvents = 'none'; }
    
    try {
        let permStatus;
        try {
            const checkPromise = Filesystem.checkPermissions();
            const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000));
            permStatus = await Promise.race([checkPromise, timeoutPromise]);
        } catch (e) { permStatus = { publicStorage: 'prompt' }; }
        
        if (permStatus.publicStorage === 'prompt' || permStatus.publicStorage === 'denied') {
            try {
                const reqPromise = Filesystem.requestPermissions();
                const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
                await Promise.race([reqPromise, timeoutPromise]);
            } catch (e) {}
        }
        
        const allFoundFiles = await universalFileScan();
        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExts = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc', '.html'];
        
        const newFiles = allFoundFiles.filter(f => {
            const fileName = f.name.toLowerCase();
            return validExts.some(ext => fileName.endsWith(ext)) && !ignoredFiles.includes(f.name);
        });
        
        if (newFiles.length > 0) {
            promptRadarInstall(newFiles);
        } else {
            if (manualTrigger) {
                if (getAndroidVersion() >= 11) showAndroid11HelpModal();
                else alert('✅ Новых игр в Загрузках не найдено!');
            }
        }
    } catch (error) {
        console.error('Радар ошибка:', error);
    } finally {
        if (btn) { btn.innerHTML = originalText; btn.style.pointerEvents = 'auto'; }
    }
}
window.runDownloadRadar = runDownloadRadar;

// ==========================================
// МОДАЛКИ И УСТАНОВКА
// ==========================================
function showAndroid11HelpModal() {
    if (document.getElementById('android11-help')) return;
    const overlay = document.createElement('div');
    overlay.id = 'android11-help';
    overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);`;
    overlay.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #38bdf8; border-radius: 16px; padding: 24px; max-width: 380px; width: 100%; color: #fff;">
            <h3 style="color: #38bdf8; margin-top: 0; text-align: center;">📡 Android 11+ Режим</h3>
            <p style="font-size: 13px; color: #94a3b8; margin-bottom: 20px;">Доступ к папке ограничена системой. Выберите файлы вручную.</p>
            <div style="display: flex; gap: 10px;">
                <button onclick="triggerManualFilePicker()" style="flex: 1; background: #10b981; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">📁 ВЫБРАТЬ</button>
                <button onclick="this.closest('#android11-help').remove()" style="flex: 1; background: #475569; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">ЗАКРЫТЬ</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

window.triggerManualFilePicker = function() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.zip,.rar,.7z,.nes,.smc,.sfc,.md,.gen,.bin,.ngp,.ngc,.html';
    input.onchange = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        const fileObjects = files.map(f => ({ name: f.name, source: 'manual_pick', fileHandle: f }));
        promptRadarInstall(fileObjects, true); 
    };
    input.click();
    document.getElementById('android11-help')?.remove();
}

function promptRadarInstall(filesObjects, isManualMode = false) {
    const uniqueFiles = [];
    const seenNames = new Set();
    for (const f of filesObjects) {
        if (!seenNames.has(f.name)) { seenNames.add(f.name); uniqueFiles.push(f); }
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'radar-overlay';
    overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);`;
    
    let fileNamesHtml = uniqueFiles.slice(0, 5).map(f => `<div style="background: rgba(56,189,248,0.1); padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 12px; border-left: 3px solid #38bdf8;">${f.name}</div>`).join('');
    if (uniqueFiles.length > 5) fileNamesHtml += `<div style="color: #94a3b8; font-size: 11px;">...и ещё ${uniqueFiles.length - 5} файлов</div>`;
    
    overlay.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #38bdf8; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; color: #fff;">
            <h3 style="color: #38bdf8; margin-top: 0; text-align: center;">📡 РАДАР ЗАГРУЗОК</h3>
            <p style="font-size: 13px; color: #94a3b8; text-align: center; margin-bottom: 16px;">Найдено: <b>${uniqueFiles.length}</b></p>
            <div style="max-height: 200px; overflow-y: auto; margin-bottom: 20px;">${fileNamesHtml}</div>
            <button id="radar-install-btn" style="width: 100%; background: #10b981; color: #fff; border: none; padding: 14px; border-radius: 10px; font-weight: bold; cursor: pointer; margin-bottom: 10px;">📥 УСТАНОВИТЬ ВСЕ</button>
            <button id="radar-ignore-btn" style="width: 100%; background: #ef4444; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; margin-bottom: 10px;">❌ ПРОПУСТИТЬ</button>
            <button id="radar-close-btn" style="width: 100%; background: #475569; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer;">ОТЛОЖИТЬ</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('radar-close-btn').onclick = () => overlay.remove();

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        uniqueFiles.forEach(f => ignored.push(f.name));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        if (typeof window.processSingleFile !== 'function') {
            alert('❌ Эмулятор не готов. Подождите загрузки.');
            return;
        }
        
        let installed = 0, failed = 0, processedNames = [];

        for (let i = 0; i < uniqueFiles.length; i++) {
            const fileObj = uniqueFiles[i];
            overlay.firstElementChild.innerHTML = `
                <h3 style="color: #38bdf8; margin-top: 0;">⏳ УСТАНОВКА...</h3>
                <p style="font-size: 14px; color: #fff; text-align: center;">${i + 1} / ${uniqueFiles.length}<br><span style="color: #94a3b8; font-size: 12px;">${fileObj.name}</span></p>
                <div style="background: #374151; height: 6px; border-radius: 3px; margin: 20px 0;"><div style="background: #10b981; height: 100%; width: ${((i + 1) / uniqueFiles.length) * 100}%; transition: width 0.3s;"></div></div>
            `;

            try {
                let blob;
                if (isManualMode && fileObj.fileHandle) {
                    blob = fileObj.fileHandle;
                } else {
                    const fileUri = await Filesystem.getUri({ path: fileObj.path, directory: fileObj.directory });
                    const response = await fetch(Capacitor.convertFileSrc(fileUri.uri));
                    if (!response.ok) throw new Error('Cannot access file');
                    blob = await response.blob();
                }
                
                const fakeFile = makeFakeFile(blob, fileObj.name);
                await window.processSingleFile(fakeFile);
                installed++;
                processedNames.push(fileObj.name);
            } catch (err) {
                console.error('Ошибка файла:', fileObj.name, err);
                failed++;
            }
            await new Promise(r => setTimeout(r, 50));
        }
        
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(...processedNames);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        
        if (typeof window.renderAllGames === 'function') window.renderAllGames();
        
        overlay.firstElementChild.innerHTML = `
            <h3 style="color: ${failed === 0 ? '#10b981' : '#f59e0b'}; margin-top: 0; text-align: center;">${failed === 0 ? '✅ ГОТОВО!' : '⚠️ ЧАСТИЧНО ГОТОВО'}</h3>
            <p style="color: #94a3b8; text-align: center;">Успешно: <b style="color: #10b981;">${installed}</b><br>${failed > 0 ? `Ошибок: <b style="color: #ef4444;">${failed}</b>` : ''}</p>
            <button onclick="this.closest('#radar-overlay').remove()" style="width: 100%; background: #3b82f6; color: #fff; border: none; padding: 14px; border-radius: 10px; font-weight: bold; cursor: pointer;">ОТЛИЧНО!</button>
        `;
    };
}

// ==========================================
// РАСПАКОВКА И ЗАЩИТА DOS (ОТЛОЖЕННАЯ ИНИЦИАЛИЗАЦИЯ)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const initWhenReady = () => {
        if (typeof window.processSingleFile !== 'function') {
            setTimeout(initWhenReady, 50);
            return;
        }
        if (window.processSingleFile.isExtended) return;
        
        const coreProcessSingleFile = window.processSingleFile;
        
        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
            const validDosExts = ['.exe', '.bat', '.com'];
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
                let romFiles = fileList.filter(f => validRomExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));

                if (dosFiles.length > 0) {
                    const zipData = {};
                    for (let f of fileList) zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    if (typeof fflate !== 'undefined') {
                        const zipped = fflate.zipSync(zipData);
                        let zipBlob = new Blob([zipped], {type: 'application/zip'});
                        let newZipFile = makeFakeFile(zipBlob, file.name.replace(/\.(rar|7z)$/i, '.zip'));
                        await coreProcessSingleFile(newZipFile);
                        return;
                    }
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newBlob = new Blob([await readBlobSafe(f.file)], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 10));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newBlob = new Blob([await readBlobSafe(f.file)], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 10));
                    }
                    hasValidContent = true;
                }
                if (!hasValidContent) throw new Error("Архив пуст");
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped;
                try { unzipped = fflate.unzipSync(arr); } catch(e) { throw new Error("Ошибка чтения ZIP"); }

                let hasDos = false, romFiles = [], nestedArchives = [];
                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) romFiles.push({ path, data: unzipped[path] });
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) nestedArchives.push({ path, data: unzipped[path] });
                }

                if (hasDos) {
                    await coreProcessSingleFile(file);
                    return;
                }

                let hasValidContent = false;
                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let newBlob = new Blob([arc.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 10));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let newBlob = new Blob([rom.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 10));
                    }
                    hasValidContent = true;
                }
                if (!hasValidContent) throw new Error("В ZIP не найдено ROM или DOS");
                return;
            }
            return await coreProcessSingleFile(file);
        };
        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    initWhenReady();
});
