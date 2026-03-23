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
// РАДАР ЗАГРУЗОК (СТАРЫЙ НАДЕЖНЫЙ МЕТОД)
// ==========================================
function showPermissionModal() {
    if (document.getElementById('radar-perm-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'radar-perm-overlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:99999; display:flex; align-items:center; justify-content:center; padding:20px; flex-direction:column; backdrop-filter:blur(5px);';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2937; border:2px solid #ef4444; border-radius:12px; padding:20px; width:100%; max-width:350px; text-align:center; color:#fff; box-shadow: 0 10px 25px rgba(0,0,0,0.8);';
    
    modal.innerHTML = `
        <h3 style="margin-top:0; color:#ef4444;">📡 НУЖЕН ДОСТУП</h3>
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
            Android заблокировал сканирование папки "Загрузки".<br><br>
            Чтобы эмулятор сам находил скачанные игры, нажми кнопку ниже и включи тумблер <b>"Доступ ко всем файлам"</b>.
        </p>
        <button id="perm-settings-btn" class="action-btn" style="width:100%; background:#38bdf8; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">⚙️ ОТКРЫТЬ НАСТРОЙКИ</button>
        <button id="perm-close-btn" class="action-btn" style="width:100%; background:#475569; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">СВЕРНУТЬ (Спросить позже)</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('perm-settings-btn').onclick = () => {
        window.location.href = "intent:#Intent;action=android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION;package=com.arcade.hub;end";
        setTimeout(() => {
            window.location.href = "intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;data=package:com.arcade.hub;end";
        }, 800);
        overlay.remove();
    };

    document.getElementById('perm-close-btn').onclick = () => {
        overlay.remove();
    };
}

async function requestStoragePermission() {
    if (window.NativeFilesystem && window.NativeFilesystem.requestPermissions) {
        try {
            const result = await window.NativeFilesystem.requestPermissions();
            return result.publicStorage === 'granted';
        } catch(e) {
            console.log('Permission request error:', e);
        }
    }
    return true; 
}

// НОВОЕ: Рекурсивный поиск файлов внутри Download (макс глубина = 3)
async function scanDownloadFolder() {
    let allFiles = [];
    
    async function walk(currentPath, depth) {
        if (depth > 3) return; 
        try {
            let dir = await Filesystem.readdir({ 
                path: currentPath, 
                directory: Directory.ExternalStorage 
            });
            
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
        console.log('Радар: Работаем в браузере, сканер отключен.');
        if (manualTrigger) alert('📡 Радар работает только в скомпилированном APK');
        return;
    }
    
    if (manualTrigger) {
        try { await Filesystem.requestPermissions(); } catch(e) {}
    }
    
    try {
        const allFoundFiles = await scanDownloadFolder();
        
        if (!allFoundFiles || allFoundFiles.length === 0) {
            if (manualTrigger) alert('📂 Папка загрузок пуста или недоступна.');
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
        console.error('Радар: Ошибка чтения папки Download:', error);
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
        <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">Найдено файлов (архивов/игр): <b>${filesObjects.length}</b><br><br>${fileNamesHtml}</p>
        <button id="radar-install-btn" class="action-btn" style="width:100%; background:#10b981; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">📥 ПРОВЕРИТЬ И УСТАНОВИТЬ ВСЕ</button>
        <button id="radar-ignore-btn" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer;">❌ ПРОПУСТИТЬ МУСОР (Больше не предлагать)</button>
        <button id="radar-close-btn" class="action-btn" style="width:100%; background:#475569; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">СВЕРНУТЬ (Отложить)</button>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('radar-close-btn').onclick = () => {
        overlay.remove();
    };

    document.getElementById('radar-ignore-btn').onclick = () => {
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        filesObjects.forEach(f => ignored.push(f.name));
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));
        overlay.remove();
    };

    document.getElementById('radar-install-btn').onclick = async () => {
        // ЗАЩИТА: Ждем загрузки функции processSingleFile
        if (typeof window.processSingleFile !== 'function') {
            alert('❌ Ошибка: ядро эмулятора еще загружается. Попробуйте через пару секунд.');
            return;
        }

        let installed = 0;
        let failed = 0;
        let toDelete = []; 
        let processedFiles = []; 

        for (let i = 0; i < filesObjects.length; i++) {
            let fileObj = filesObjects[i];
            processedFiles.push(fileObj.name);

            modal.innerHTML = `
                <h3 style="color:#38bdf8; text-shadow: 0 2px 4px #000;">Анализ... ${i + 1}/${filesObjects.length}</h3>
                <p style="font-size:12px; color:#aaa;">${fileObj.name}</p>
            `;
            
            try {
                const fileData = await Filesystem.readFile({
                    path: fileObj.path,
                    directory: Directory.ExternalStorage
                });
                
                let blob;
                if (fileData.data) {
                    const byteCharacters = atob(fileData.data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let j = 0; j < byteCharacters.length; j++) {
                        byteNumbers[j] = byteCharacters.charCodeAt(j);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    blob = new Blob([byteArray]);
                } else if (fileData.blob) {
                    blob = fileData.blob;
                } else {
                    throw new Error('Нет данных файла');
                }
                
                const fakeFile = new File([blob], fileObj.name, { type: 'application/octet-stream' });
                
                await window.processSingleFile(fakeFile); 
                
                installed++;
                toDelete.push(fileObj);
            } catch (err) {
                console.error('Пропущен не-игровой файл:', fileObj.name, err.message);
                failed++;
            }
        }
        
        let ignored = JSON.parse(localStorage.getItem('radar_ignored')) || [];
        ignored.push(...processedFiles);
        localStorage.setItem('radar_ignored', JSON.stringify(ignored));

        if (typeof window.renderAllGames === 'function') window.renderAllGames();

        modal.innerHTML = `
            <h3 style="margin-top:0; color:#10b981;">✅ АНАЛИЗ ЗАВЕРШЕН!</h3>
            <p style="font-size:13px; color:#94a3b8; margin-bottom:20px;">
                Успешно обработано архивов/игр: ${installed} шт.<br>
                ${failed > 0 ? `Отсеяно мусора (пустые архивы): ${failed} шт.<br><br>` : '<br>'}
                Игры из архивов добавлены в меню.<br>Удалить исходные файлы из "Загрузок", чтобы не занимали место?
            </p>
            <button id="radar-delete-yes" class="action-btn" style="width:100%; background:#ef4444; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; margin-bottom:10px; cursor:pointer; display: ${installed > 0 ? 'block' : 'none'};">🗑️ ДА, ОЧИСТИТЬ ПАМЯТЬ</button>
            <button id="radar-delete-no" class="action-btn" style="width:100%; background:#334155; color:#fff; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer;">ЗАКРЫТЬ</button>
        `;
        
        document.getElementById('radar-delete-yes').onclick = async () => {
            modal.innerHTML = '<h3 style="color:#ef4444;">Удаление...</h3>';
            for (let f of toDelete) {
                try {
                    await Filesystem.deleteFile({ path: f.path, directory: Directory.ExternalStorage });
                } catch(e) {}
            }
            overlay.remove();
        };
        
        document.getElementById('radar-delete-no').onclick = () => {
            overlay.remove();
        };
    };
}

// ==========================================
// УМНАЯ РАСПАКОВКА АРХИВОВ С РЕКУРСИЕЙ (Inception Mode) + ЗАЩИТА DOS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const initExtendedProcessor = () => {
        if (typeof window.processSingleFile !== 'function') {
            setTimeout(initExtendedProcessor, 100);
            return;
        }
        
        if (window.processSingleFile.isExtended) return;

        const coreProcessSingleFile = window.processSingleFile;

        window.processSingleFileExtended = async function(file) {
            const fileName = file.name.toLowerCase();
            const validRomExts = ['.nes', '.md', '.sfc', '.smc', '.gen', '.bin', '.ngp', '.ngc', '.html'];
            const validDosExts = ['.exe', '.bat', '.com'];
            const validArchiveExts = ['.zip', '.rar', '.7z'];
            
            // ОБРАБОТКА RAR И 7Z
            if ((fileName.endsWith('.rar') || fileName.endsWith('.7z')) && typeof Archive !== 'undefined') {
                console.log('Обнаружен архив RAR/7Z. Анализ...');
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

                let hasValidContent = false;

                // 1. Сначала проверяем вложенные архивы (РЕКУРСИЯ)
                if (nestedArchives.length > 0) {
                    for (let f of nestedArchives) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await window.processSingleFileExtended(newFile); 
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                // 2. Распаковываем ROM-файлы, если они валяются прямо в корне RAR/7Z
                if (romFiles.length > 0) {
                    for (let f of romFiles) {
                        let cleanName = f.path.split('/').pop();
                        let newFile = new File([await readBlobSafe(f.file)], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                // 3. Обрабатываем DOS-файлы (только если это не сборник архивов)
                if (dosFiles.length > 0 && nestedArchives.length === 0) {
                    const zipData = {};
                    for(let f of fileList) {
                        zipData[f.path] = new Uint8Array(await readBlobSafe(f.file));
                    }
                    if (typeof fflate !== 'undefined') {
                        const zipped = fflate.zipSync(zipData);
                        const zipBlob = new Blob([zipped], {type: 'application/zip'});
                        const newZipFile = new File([zipBlob], file.name.replace(/\.(rar|7z)$/i, '.zip'), {type: 'application/zip'});
                        await coreProcessSingleFile(newZipFile);
                        hasValidContent = true;
                    }
                }

                if (!hasValidContent) throw new Error("Архив пуст или не содержит поддерживаемых игр");
                return;
            } 
            // ОБРАБОТКА ZIP
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

                let hasValidContent = false;

                // 1. Вложенные архивы (РЕКУРСИЯ)
                if (nestedArchives.length > 0) {
                    for (let arc of nestedArchives) {
                        let cleanName = arc.path.split('/').pop();
                        let blob = new Blob([arc.data]);
                        let newFile = new File([blob], cleanName);
                        await window.processSingleFileExtended(newFile);
                        await new Promise(r => setTimeout(r, 5));
                    }
                    hasValidContent = true;
                }

                // 2. ROM файлы
                if (romFiles.length > 0) {
                    for (let rom of romFiles) {
                        let cleanName = rom.path.split('/').pop();
                        let blob = new Blob([rom.data]);
                        let newFile = new File([blob], cleanName);
                        await coreProcessSingleFile(newFile);
                        await new Promise(r => setTimeout(r, 5)); 
                    }
                    hasValidContent = true;
                }

                // 3. DOS файлы (Отдаем оригинальный ZIP как есть)
                if (hasDos && nestedArchives.length === 0 && romFiles.length === 0) {
                    await coreProcessSingleFile(file);
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

        window.processSingleFileExtended.isExtended = true;
        window.processSingleFile = window.processSingleFileExtended;
    };
    
    initExtendedProcessor();
});
