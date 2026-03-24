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
                    // Возвращаем слушатель для ручного запуска, если нужно, но без автозапуска
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => { 
                            // Автозапуск после закрытия браузера убран.
                        });
                        window._browserListenerAdded = true;
                    }
                    return; 
                } catch (err) {}
            }
            window.open(targetUrl, '_blank');
        });
    });

    // АВТОСКАН ОТКЛЮЧЕН
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

window.isRadarRunning = false;

async function runDownloadRadar(manualTrigger = true) {
    if (!Capacitor.isNativePlatform()) {
        alert('📡 Радар работает только в APK');
        return;
    }
    
    if (window.isRadarRunning) return; 
    window.isRadarRunning = true;
    
    try {
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') await Filesystem.requestPermissions();
    } catch(e) {}
    
    try {
        const allFoundFiles = await scanDownloadFolder();
        if (!allFoundFiles || allFoundFiles.length === 0) {
            alert('📡 Папка Загрузок пуста или нет прав доступа.');
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
        else alert('✅ Новых игр (и архивов) в Загрузках не найдено!');
    } catch (error) {
        console.error('Радар ошибка:', error);
        alert('❌ Ошибка сканирования. Проверьте права приложения в настройках Android.');
    } finally {
        window.isRadarRunning = false; 
    }
}
window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(filesObjects) {
    const existing = document.getElementById('radar-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'radar-overlay';
    overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(5px);`;
    
    // ЧЕКБОКСЫ ДЛЯ РАДАРА
    let fileNamesHtml = filesObjects.map((f, index) => `
        <label style="display: flex; align-items: center; background: rgba(56,189,248,0.1); padding: 8px; border-radius: 6px; margin-bottom: 6px; font-size: 12px; border-left: 3px solid #38bdf8; cursor: pointer;">
            <input type="checkbox" class="radar-file-checkbox" value="${index}" checked style="margin-right: 10px; width: 16px; height: 16px;">
            <span style="word-break: break-all;">${f.name}</span>
        </label>
    `).join('');
    
    overlay.innerHTML = `
        <div style="background: #1f2937; border: 2px solid #38bdf8; border-radius: 16px; padding: 24px; max-width: 400px; width: 100%; color: #fff;">
            <h3 style="color: #38bdf8; margin-top: 0; text-align: center;">📡 РАДАР ЗАГРУЗОК</h3>
            <p style="font-size: 13px; color: #94a3b8; text-align: center; margin-bottom: 16px;">Найдено файлов: <b>${filesObjects.length}</b></p>
            <div style="max-height: 250px; overflow-y: auto; margin-bottom: 20px; padding-right: 5px;">${fileNamesHtml}</div>
            <button id="radar-install-btn" style="width: 100%; background: #10b981; color: #fff; border: none; padding: 14px; border-radius: 10px; font-weight: bold; cursor: pointer; margin-bottom: 10px;">📥 УСТАНОВИТЬ ВЫБРАННЫЕ</button>
            <button id="radar-ignore-btn" style="width: 100%; background: #ef4444; color: #fff; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; margin-bottom: 10px;">❌ ПРОПУСТИТЬ ВСЕ</button>
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

        // Собираем только те файлы, которые отмечены галочкой
        const checkboxes = document.querySelectorAll('.radar-file-checkbox');
        const selectedFiles = [];
        const ignoredFiles = []; // Те, с которых сняли галочку

        checkboxes.forEach(cb => {
            const file = filesObjects[parseInt(cb.value)];
            if (cb.checked) {
                selectedFiles.push(file);
            } else {
                ignoredFiles.push(file.name);
            }
        });

        if (selectedFiles.length === 0) {
            // Если ничего не выбрано, просто закрываем и добавляем всё в игнор
            let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
            ignored.push(...ignoredFiles);
            localStorage.setItem('radar_ignored', JSON.stringify(ignored));
            overlay.remove();
            return;
        }
        
        let installed = 0, failed = 0;
        let currentIgnored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        // Сразу добавляем снятые галочки в игнор
        currentIgnored.push(...ignoredFiles);
        localStorage.setItem('radar_ignored', JSON.stringify(currentIgnored));

        for (let i = 0; i < selectedFiles.length; i++) {
            const fileObj = selectedFiles[i];
            overlay.firstElementChild.innerHTML = `
                <h3 style="color: #38bdf8; margin-top: 0; text-align: center;">⏳ УСТАНОВКА...</h3>
                <p style="font-size: 14px; color: #fff; text-align: center;">${i + 1} / ${selectedFiles.length}<br><span style="color: #94a3b8; font-size: 12px; word-break: break-all;">${fileObj.name}</span></p>
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
                
                // Сохраняем прогресс радара после каждого файла
                currentIgnored.push(fileObj.name);
                localStorage.setItem('radar_ignored', JSON.stringify(currentIgnored));
                
            } catch (err) {
                console.error('Ошибка файла:', fileObj.name, err);
                failed++;
                currentIgnored.push(fileObj.name);
                localStorage.setItem('radar_ignored', JSON.stringify(currentIgnored));
            }
            await new Promise(r => setTimeout(r, 600));
        }
        
        if (typeof window.renderAllGames === 'function') window.renderAllGames();
        
        overlay.firstElementChild.innerHTML = `
            <h3 style="color: ${failed === 0 ? '#10b981' : '#f59e0b'}; margin-top: 0; text-align: center;">${failed === 0 ? '✅ ГОТОВО!' : '⚠️ ЧАСТИЧНО ГОТОВО'}</h3>
            <p style="color: #94a3b8; text-align: center;">Успешно: <b style="color: #10b981;">${installed}</b><br>${failed > 0 ? `Ошибок: <b style="color: #ef4444;">${failed}</b>` : ''}</p>
            <button onclick="this.closest('#radar-overlay').remove()" style="width: 100%; background: #3b82f6; color: #fff; border: none; padding: 14px; border-radius: 10px; font-weight: bold; cursor: pointer;">ОТЛИЧНО!</button>
        `;
    };
}

// СУРОВЫЙ ФИЛЬТР МУСОРА
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
                        if (isRealRom(f.path.split('/').pop(), new Uint8Array(buffer))) {
                            romFiles.push({ path: f.path, file: f.file });
                        }
                    }
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                // ЖЕСТКИЙ ФИЛЬТР DOS для архивов внутри .7z / .rar
                if (!hasValidContent && dosFiles.length > 0) {
                    const exes = dosFiles.map(f => f.path.split('/').pop().toLowerCase());
                    const priority = ['go.bat', 'go.exe', 'start.bat', 'start.exe', 'play.bat', 'play.exe', 'run.bat', 'run.exe']; 
                    let hasExe = exes.some(e => e.endsWith('.exe') || e.endsWith('.bat') || e.endsWith('.com'));
                    
                    if (hasExe) {
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
                    const data = unzipped[path];
                    
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) nestedArchives.push({ path, data });
                    
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) {
                        if (isRealRom(path.split('/').pop(), data)) {
                            romFiles.push({ path, data });
                        }
                    }
                }

                let hasValidContent = false;

                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let newBlob = new Blob([arc.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await window.processSingleFileExtended(newFile);
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
                        await new Promise(r => setTimeout(r, 500));
                    }
                    hasValidContent = true;
                }

                // ЖЕСТКИЙ ФИЛЬТР DOS для .zip
                if (!hasValidContent && hasDos) {
                    let hasExe = false;
                    for (const path in unzipped) {
                        const low = path.toLowerCase();
                        if (low.endsWith('.exe') || low.endsWith('.bat') || low.endsWith('.com')) {
                            hasExe = true; break;
                        }
                    }
                    if (hasExe) {
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
