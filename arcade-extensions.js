import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';

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
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => { setTimeout(() => runDownloadRadar(true), 1500); });
                        window._browserListenerAdded = true;
                    }
                    return; 
                } catch (err) {}
            }
            window.open(targetUrl, '_blank');
        });
    });

    setTimeout(() => runDownloadRadar(false), 2000);
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

// ФИКС 3: Блокировка от одновременного запуска автоскана и ручного клика
window.isRadarRunning = false;

async function runDownloadRadar(manualTrigger = false) {
    if (!Capacitor.isNativePlatform()) {
        if (manualTrigger) alert('📡 Радар работает только в APK');
        return;
    }
    
    if (window.isRadarRunning) return; // Защита от дублей
    window.isRadarRunning = true;
    
    try {
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') await Filesystem.requestPermissions();
    } catch(e) {}
    
    try {
        const allFoundFiles = await scanDownloadFolder();
        if (!allFoundFiles || allFoundFiles.length === 0) {
            if (manualTrigger) alert('📡 Папка Загрузок пуста или нет прав доступа.');
            window.isRadarRunning = false;
            return;
        }

        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExtensions = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
        
        const newFiles = allFoundFiles.filter(f => {
            const fileName = f.name.toLowerCase(); 
            return validExtensions.some(ext => fileName.endsWith(ext)) && !ignoredFiles.includes(f.name);
        });

        if (newFiles.length > 0) promptRadarInstall(newFiles);
        else if (manualTrigger) alert('✅ Новых игр (и архивов) в Загрузках не найдено!');
    } catch (error) {
        console.error('Радар ошибка:', error);
        if (manualTrigger) alert('❌ Ошибка сканирования. Проверьте права приложения в настройках Android.');
    } finally {
        window.isRadarRunning = false; // Снимаем блокировку
    }
}
window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(filesObjects) {
    const existing = document.getElementById('radar-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'radar-overlay';
    overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);`;
    
    let fileNamesHtml = filesObjects.slice(0, 5).map(f => `<div style="background: rgba(56,189,248,0.1); padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 12px; border-left: 3px solid #38bdf8;">${f.name}</div>`).join('');
    if (filesObjects.length > 5) fileNamesHtml += `<div style="color: #94a3b8; font-size: 11px;">...и ещё ${filesObjects.length - 5} файлов</div>`;
    
    overlay.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #38bdf8; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; color: #fff;">
            <h3 style="color: #38bdf8; margin-top: 0; text-align: center;">📡 РАДАР ЗАГРУЗОК</h3>
            <p style="font-size: 13px; color: #94a3b8; text-align: center; margin-bottom: 16px;">Найдено: <b>${filesObjects.length}</b></p>
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
        filesObjects.forEach(f => ignored.push(f.name));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        if (typeof window.processSingleFile !== 'function') {
            alert('❌ Эмулятор не готов. Подождите загрузки.');
            return;
        }
        
        let installed = 0, failed = 0, processedNames = [];

        for (let i = 0; i < filesObjects.length; i++) {
            const fileObj = filesObjects[i];
            overlay.firstElementChild.innerHTML = `
                <h3 style="color: #38bdf8; margin-top: 0;">⏳ УСТАНОВКА...</h3>
                <p style="font-size: 14px; color: #fff; text-align: center;">${i + 1} / ${filesObjects.length}<br><span style="color: #94a3b8; font-size: 12px;">${fileObj.name}</span></p>
            `;

            try {
                const fileData = await Filesystem.readFile({
                    path: fileObj.path,
                    directory: Directory.ExternalStorage
                });
                
                const base64Response = await fetch(`data:application/octet-stream;base64,${fileData.data}`);
                const blob = await base64Response.blob();
                const fakeFile = makeFakeFile(blob, fileObj.name);
                
                await window.processSingleFile(fakeFile); 
                installed++;
                processedNames.push(fileObj.name);
            } catch (err) {
                console.error('Ошибка файла:', fileObj.name, err);
                failed++;
            }
            // ФИКС 1: Увеличена пауза, чтобы файлы не "перебивали" друг друга
            await new Promise(r => setTimeout(r, 600));
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
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc'];
            // ФИКС 2: DOS теперь берет только .exe и .bin
            const validDosExts = ['.exe', '.bin'];
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

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await window.processSingleFileExtended(newFile);
                        // ФИКС 1: Пауза для паков внутри архива
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await coreProcessSingleFile(newFile);
                        // ФИКС 1: Пауза для паков
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (dosFiles.length > 0 && romFiles.length === 0 && nestedArchives.length === 0) {
                    const zipData = {};
                    for (let f of fileList) zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    if (typeof fflate !== 'undefined') {
                        const zipped = fflate.zipSync(zipData);
                        let zipBlob = new Blob([zipped], {type: 'application/zip'});
                        let newZipFile = makeFakeFile(zipBlob, file.name.replace(/\.(rar|7z)$/i, '.zip'));
                        await coreProcessSingleFile(newZipFile);
                        hasValidContent = true;
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

                let hasDos = false, romFiles = [], nestedArchives = [];
                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) romFiles.push({ path, data: unzipped[path] });
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) nestedArchives.push({ path, data: unzipped[path] });
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let newBlob = new Blob([arc.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await window.processSingleFileExtended(newFile);
                        // ФИКС 1: Пауза
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let newBlob = new Blob([rom.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        // ФИКС 1: Пауза
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (hasDos && romFiles.length === 0 && nestedArchives.length === 0) {
                    await coreProcessSingleFile(file);
                    hasValidContent = true;
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
