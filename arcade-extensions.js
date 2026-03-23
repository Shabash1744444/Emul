import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Browser } from '@capacitor/browser';

// ==========================================
// БАЗОВЫЕ УТИЛИТЫ ДЛЯ РАБОТЫ С ФАЙЛАМИ
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

// Функция-спасатель для WebView
const makeFakeFile = (blob, fileName) => {
    try {
        return new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    } catch (e) {
        blob.name = fileName;
        blob.lastModified = Date.now();
        return blob;
    }
};

// ==========================================
// ИНИЦИАЛИЗАЦИЯ И ПЕРЕХВАТ ССЫЛОК
// ==========================================

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
                    await Browser.open({ 
                        url: targetUrl, 
                        presentationStyle: 'popover',
                        toolbarColor: '#1f2937' 
                    });
                    
                    if (!window._browserListenerAdded) {
                        Browser.addListener('browserFinished', () => {
                            setTimeout(runDownloadRadar, 1500); 
                        });
                        window._browserListenerAdded = true;
                    }
                    return; 
                } catch (err) {
                    console.error('Browser plugin ошибка:', err);
                }
            }
            window.open(targetUrl, '_blank');
        });
    });

    setTimeout(() => runDownloadRadar(false), 2000);
});

// ==========================================
// РАДАР ЗАГРУЗОК (СКАНИРОВАНИЕ)
// ==========================================

function showPermissionModal() {
    if (document.getElementById('radar-perm-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'radar-perm-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #ef4444; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    modal.innerHTML = `
        <h3 style="margin-top:0; color:#ef4444;">📡 ДОСТУП ЗАКРЫТ</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px; text-align:left;">
            Эмулятор не может прочитать папку "Загрузки". Чтобы всё заработало:<br><br>
            1. Зайдите в <b>Настройки телефона</b>.<br>
            2. Найдите <b>Приложения</b> ➔ <b>Специальные разрешения</b> ➔ <b>Доступ ко всем файлам</b>.<br>
            3. Включите тумблер для <b>Arcade Hub</b>.<br>
            4. <b style="color:#fcd34d;">ОБЯЗАТЕЛЬНО:</b> Закройте эмулятор (смахните из недавних) и откройте заново!
        </p>
        <button id="perm-close-btn" class="action-btn" style="width:100%; background:#3b82f6; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ПОНЯТНО, СДЕЛАЮ</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('perm-close-btn').onclick = () => {
        overlay.remove();
    };
}

// Рекурсивный поиск файлов внутри Download (макс глубина = 3)
async function scanDownloadFolder() {
    let allFiles = [];
    
    async function walk(currentPath, depth) {
        if (depth > 3) return; 
        try {
            let dir = await Filesystem.readdir({ 
                path: currentPath, 
                directory: Directory.ExternalStorage 
            });
            
            let filesArray = dir.files;
            for (let i = 0; i < filesArray.length; i++) {
                let item = filesArray[i];
                let name = typeof item === 'string' ? item : item.name;
                let type = typeof item === 'string' ? 'unknown' : item.type;
                let fullPath = currentPath === 'Download' ? `Download/${name}` : `${currentPath}/${name}`;
                
                if (type === 'directory') {
                    await walk(fullPath, depth + 1);
                } else if (type === 'file') {
                    allFiles.push({ name: name, path: fullPath });
                } else {
                    try {
                        let stat = await Filesystem.stat({ 
                            path: fullPath, 
                            directory: Directory.ExternalStorage 
                        });
                        if (stat.type === 'directory') {
                            await walk(fullPath, depth + 1);
                        } else {
                            allFiles.push({ name: name, path: fullPath });
                        }
                    } catch(e) {
                        allFiles.push({ name: name, path: fullPath });
                    }
                }
            }
        } catch(e) {
            console.error("Ошибка чтения папки:", currentPath, e);
        }
    }
    
    await walk('Download', 0);
    return allFiles;
}

async function runDownloadRadar(manualTrigger = false) {
    if (!Capacitor.isNativePlatform()) {
        if (manualTrigger) alert('📡 Радар работает только в APK');
        return;
    }
    
    try {
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== 'granted') {
            await Filesystem.requestPermissions();
        }
    } catch(e) {}
    
    try {
        const allFoundFiles = await scanDownloadFolder();
        
        if (!allFoundFiles || allFoundFiles.length === 0) {
            if (manualTrigger) showPermissionModal();
            return;
        }

        let ignoredFiles = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        const validExtensions = ['.zip', '.rar', '.7z', '.nes', '.smc', '.sfc', '.md', '.gen', '.bin', '.ngp', '.ngc'];
        
        const newFiles = allFoundFiles.filter(f => {
            const fileName = f.name.toLowerCase(); 
            return validExtensions.some(ext => fileName.endsWith(ext)) && !ignoredFiles.includes(f.name);
        });

        if (newFiles.length > 0) {
            promptRadarInstall(newFiles);
        } else {
            if (manualTrigger) alert('✅ Новых игр (и архивов) в Загрузках не найдено!');
        }
    } catch (error) {
        console.error('Радар: Ошибка чтения директории:', error);
        if (manualTrigger || !localStorage.getItem('radar_perm_shown')) {
            showPermissionModal();
            localStorage.setItem('radar_perm_shown', 'true'); 
        }
    }
}

window.runDownloadRadar = runDownloadRadar;

function promptRadarInstall(filesObjects) {
    const overlay = document.createElement('div');
    overlay.id = 'radar-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #38bdf8; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    let fileNamesHtml = filesObjects.slice(0, 3).map(f => `<strong style="color:#fff; word-break:break-all;">${f.name}</strong>`).join('<br>');
    if (filesObjects.length > 3) fileNamesHtml += `<br><span style="color:#aaa; font-size:11px;">...и еще ${filesObjects.length - 3} файлов</span>`;

    modal.innerHTML = `
        <h3 style="margin-top:0; color:#38bdf8;">РАДАР ЗАГРУЗОК 📡</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Найдено файлов: <b>${filesObjects.length}</b><br><br>${fileNamesHtml}</p>
        <button id="radar-install-btn" class="action-btn" style="width:100%; background:#10b981; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">📥 ПРОВЕРИТЬ И УСТАНОВИТЬ ВСЕ</button>
        <button id="radar-ignore-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">❌ ПРОПУСТИТЬ МУСОР</button>
        <button id="radar-close-btn" class="action-btn" style="width:100%; background:#475569; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">СВЕРНУТЬ (Отложить)</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('radar-close-btn').onclick = () => overlay.remove();

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        filesObjects.forEach(f => ignored.push(f.name));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        let installed = 0;
        let failed = 0;
        let processedFileNames = []; 

        for (let i = 0; i < filesObjects.length; i++) {
            let fileObj = filesObjects[i];

            modal.innerHTML = `
                <h3 style="color:#38bdf8; text-shadow: 0 2px 4px #000;">Анализ... ${i + 1}/${filesObjects.length}</h3>
                <p style="font-size:12px; color:#aaa;">${fileObj.name}</p>
            `;
            
            try {
                const fileUri = await Filesystem.getUri({
                    path: fileObj.path,
                    directory: Directory.ExternalStorage
                });
                
                const webViewUrl = Capacitor.convertFileSrc(fileUri.uri);
                const response = await fetch(webViewUrl);
                
                if (!response.ok) throw new Error('Не удалось прочитать файл');
                
                const blob = await response.blob();
                const fakeFile = makeFakeFile(blob, fileObj.name);
                
                await window.processSingleFile(fakeFile); 
                
                installed++;
                processedFileNames.push(fileObj.name); 
            } catch (err) {
                console.error('Пропущен файл:', fileObj.name, err.message);
                failed++;
            }
        }
        
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(...processedFileNames);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));

        if (typeof window.renderAllGames === 'function') window.renderAllGames();

        modal.innerHTML = `
            <h3 style="margin-top:0; color:#10b981;">✅ АНАЛИЗ ЗАВЕРШЕН!</h3>
            <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
                Успешно: ${installed} шт.<br>
                ${failed > 0 ? `Ошибок распаковки: ${failed} шт.<br><br>` : '<br>'}
            </p>
            <button id="radar-close-final" class="action-btn" style="width:100%; background:#3b82f6; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ПОНЯТНО, ЗАКРЫТЬ</button>
        `;
        
        document.getElementById('radar-close-final').onclick = () => overlay.remove();
    };
}

// ==========================================
// УМНАЯ РАСПАКОВКА АРХИВОВ С РЕКУРСИЕЙ И ЗАЩИТОЙ DOS
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.processSingleFile === 'function') {
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
                        if (obj[key] instanceof File) {
                            fileList.push({ path: path + key, file: obj[key] });
                        } else {
                            flatten(obj[key], path + key + '/');
                        }
                    }
                }
                flatten(extractedFiles);

                let dosFiles = fileList.filter(f => validDosExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let romFiles = fileList.filter(f => validRomExts.some(ext => f.path.toLowerCase().endsWith(ext)));
                let nestedArchives = fileList.filter(f => validArchiveExts.some(ext => f.path.toLowerCase().endsWith(ext)));

                // ЗАЩИТА DOS: Собираем ZIP и передаем ядру
                if (dosFiles.length > 0) {
                    const zipData = {};
                    for(let f of fileList) {
                        zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    }
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
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newBlob = new Blob([await readBlobSafe(f.file)], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent) throw new Error("Архив пуст или не содержит поддерживаемых игр");
                return;
            } 
            else if (fileName.endsWith('.zip')) {
                const buffer = await readBlobSafe(file);
                const arr = new Uint8Array(buffer);
                let unzipped;

                try {
                    unzipped = fflate.unzipSync(arr);
                } catch(e) { throw new Error("Ошибка чтения ZIP архива"); }

                let hasDos = false;
                let romFiles = [];
                let nestedArchives = [];

                for (const path in unzipped) {
                    const lowPath = path.toLowerCase();
                    if (validDosExts.some(ext => lowPath.endsWith(ext))) hasDos = true;
                    if (validRomExts.some(ext => lowPath.endsWith(ext))) {
                        romFiles.push({ path: path, data: unzipped[path] });
                    }
                    if (validArchiveExts.some(ext => lowPath.endsWith(ext))) {
                        nestedArchives.push({ path: path, data: unzipped[path] });
                    }
                }

                // ЗАЩИТА DOS: Отдаем ядру
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
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let newBlob = new Blob([rom.data], {type: 'application/octet-stream'});
                        let newFile = makeFakeFile(newBlob, cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                if (!hasValidContent) throw new Error("В ZIP архиве не найдено ROM или DOS-игр");
                return;
            }
            else {
                if (!validRomExts.some(ext => fileName.endsWith(ext)) && !fileName.endsWith('.html')) {
                    throw new Error("Неизвестный формат файла");
                }
            }
            
            return await coreProcessSingleFile(file);
        };

        window.processSingleFile = window.processSingleFileExtended;
    }
});
